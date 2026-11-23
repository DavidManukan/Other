// Запрос к Claude через официальный SDK. Ответ собирается целиком: модель сначала проверяет себя
// (в том числе пересчётом в песочнице Anthropic), потом пишет решение, и только готовый текст уходит в чат.
import Anthropic from "@anthropic-ai/sdk";
import type { Cfg, Effort } from "./config.ts";
import { PROMPT } from "./prompt.ts";
import { left } from "./util.ts";

export class Timeout extends Error {} // время куска вышло, а модель ещё ничего не написала
export class Stopped extends Error {} // пользователь написал «стоп»
export class Busy extends Error {} // Claude перегружен или лимит запросов: стоит повторить позже
export class Fatal extends Error {} // ошибка настройки: повтор не поможет

export interface Answer {
  text: string; // весь текст ответа (задания разделены строкой @@@, рисунки идут блоками <svg>)
  cut: boolean; // ответ оборван (время или лимит токенов): продолжить в следующем куске
  refused: boolean;
  tokens: { in: number; out: number };
  model: string; // модель, которая реально ответила
  checks: number; // сколько раз модель запускала пересчёт кодом
  all?: string; // весь текст хода, включая заметки между проверками: вердикт проверяющего может стоять в любом его месте
  tail?: string; // текст после последнего обращения к песочнице: итоговое слово модели («ВСЁ ВЕРНО»), даже если решение стояло раньше
}

export interface AskOptions {
  messages: Anthropic.Beta.BetaMessageParam[];
  effort: Effort;
  fast: boolean;
  until: number; // срок куска, мс
  stop?: AbortSignal; // «стоп» или новое фото к этому же заданию: причина лежит в signal.reason
  system?: string; // своя инструкция вместо основной (перепроверка готового решения)
  model?: string; // своя модель для этого запроса; недоступна на ключе: запрос идёт на основной
  spent?: (s: Spent) => void; // вызывается после каждого обращения к Claude, чем бы оно ни кончилось: по этим цифрам считается расход
}

// Что потрачено за одно обращение: токены по видам и цена в долларах
export interface Spent {
  model: string;
  in: number;
  out: number;
  read: number; // прочитано из кэша
  write: number; // записано в кэш
  usd: number;
  approx?: boolean; // цена или выход посчитаны примерно: модель с неизвестной ценой или поток оборвался до итога
}
// Цена за миллион токенов, доллары: вход, выход, чтение кэша, запись в кэш на 5 минут. Fast-режим вдвое дороже.
// claude-opus-5 и claude-opus-4-8 сами не заказываем: на них Anthropic переводит запрос, если основная модель его отклонит.
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-fable-5-2": [8, 40, 0.2, 10],
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.1, 2.5],
  "claude-opus-5": [5, 25, 0.5, 6.25],
  "claude-opus-4-8": [5, 25, 0.5, 6.25],
};
type Usage = { in: number; out: number; read: number; write: number };
// Сначала точное имя, потом самое длинное известное начало («claude-fable-5-2-20261001»): «claude-opus-5» не должен оценить «claude-opus-5-5»
export function price(model: string, u: Usage, fast: boolean): number | null {
  const key = model in PRICES ? model : Object.keys(PRICES).filter((k) => model.startsWith(k + "-")).sort((a, b) => b.length - a.length)[0];
  const p = key ? PRICES[key] : undefined;
  return p ? ((u.in * p[0] + u.out * p[1] + u.read * p[2] + u.write * p[3]) / 1e6) * (fast ? 2 : 1) : null;
}
// Цена для дневного лимита. Оплаченный запрос не может стоить $0: модель с неизвестной ценой считаем по цене заказанной,
// а если неизвестна и та, по самой дорогой из известных. Такая сумма помечается как примерная.
export function cost(served: string, asked: string, u: Usage, fast: boolean): { usd: number; approx: boolean } {
  const exact = price(served, u, fast);
  if (exact !== null) return { usd: exact, approx: false };
  const dearest = Math.max(...Object.keys(PRICES).map((k) => price(k, u, fast) ?? 0));
  return { usd: price(asked, u, fast) ?? dearest, approx: true };
}

type StreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];
type Content = Anthropic.Beta.BetaMessage["content"];

// Необязательные параметры запроса. Если модель из MODEL какой-то из них не знает (ошибка 400),
// бот отключает именно его и запоминает, чтобы не ошибаться на каждом фото.
type Feature = "speed" | "fallbacks" | "effort" | "tools" | "thinking";
const disabled = new Map<string, Set<Feature>>();
export const featureOff = (model: string, f: Feature) => disabled.get(model)?.has(f) ?? false;

// Основная модель недоступна на этом ключе (нет доступа, не включено хранение данных): до этого времени работаем на запасной
const down = new Map<string, number>();
const MODEL_RETRY = 30 * 60_000;
export function activeModel(c: Cfg): string {
  return c.fallbackModel && c.fallbackModel !== c.model && (down.get(c.model) ?? 0) > Date.now() ? c.fallbackModel : c.model;
}

const CREDIT = /credit balance/i;
const SPEND = /specified (workspace )?API usage limits/i;
const RETENTION = /data retention/i;

export function unavailable(e: unknown): boolean {
  if (e instanceof Anthropic.NotFoundError) return true;
  const msg = e instanceof Anthropic.APIError ? String(e.apiMessage ?? e.message ?? "") : "";
  if (e instanceof Anthropic.BadRequestError && RETENTION.test(msg)) return true;
  return e instanceof Anthropic.PermissionDeniedError && /model/i.test(msg);
}

export function claudeProblem(c: Cfg, e: unknown, model = c.model): Error {
  if (e instanceof Timeout || e instanceof Stopped || e instanceof Busy || e instanceof Fatal) return e;
  if (e instanceof Anthropic.AuthenticationError) return new Fatal("Неверный ключ Claude. Проверь ANTHROPIC_API_KEY.");
  if (e instanceof Anthropic.NotFoundError) return new Fatal(`Нет модели ${model} на этом ключе. Исправь MODEL.`);
  if (e instanceof Anthropic.PaymentRequiredError || (e instanceof Anthropic.APIError && e.type === "billing_error")) {
    return new Fatal("На балансе Claude кончились деньги (platform.claude.com → Billing).");
  }
  if (e instanceof Anthropic.RateLimitError) {
    if (e.errorCode === "enforced_spend_limit_reached" || e.errorCode === "contract_spend_limit_reached") {
      return new Fatal("Claude: достигнут месячный лимит трат (platform.claude.com → Limits).");
    }
    return new Busy("Claude занят");
  }
  if (e instanceof Anthropic.ContentTooLargeError) return new Fatal("Фото слишком большое. Пришли обычное фото.");
  if (e instanceof Anthropic.PermissionDeniedError) {
    return new Fatal(`Claude отказал в доступе (403): ${String(e.apiMessage ?? "").slice(0, 120)}`);
  }
  if (e instanceof Anthropic.APIConnectionError) return new Busy("нет связи с Claude");
  if (e instanceof Anthropic.APIError) {
    // ошибка без кода ответа приходит прямо в потоке (обычно перегрузка): стоит повторить
    if (typeof e.status !== "number" || e.status >= 500) return new Busy("Claude занят");
    const msg = String(e.apiMessage ?? e.message ?? "");
    // Нехватка денег и лимит трат, заданный в консоли, приходят обычной ошибкой 400, своего типа у них нет
    if (CREDIT.test(msg)) return new Fatal("На балансе Claude кончились деньги (platform.claude.com → Billing).");
    if (SPEND.test(msg)) return new Fatal("Claude: достигнут лимит трат, который задан в консоли (platform.claude.com → Limits).");
    if (RETENTION.test(msg)) return new Fatal(`Модель ${model} требует хранения данных 30 дней: включи его в консоли Claude или поставь другую модель в MODEL.`);
    if (/\bpdf\b|document/i.test(msg)) return new Fatal("Не смог прочитать файл PDF (он защищён паролем, повреждён или слишком длинный). Пришли фото нужных страниц.");
    return new Fatal(`Ошибка Claude ${e.status}: ${msg.slice(0, 120)}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

export function client(c: Cfg): Anthropic {
  return new Anthropic({ apiKey: c.claudeKey, baseURL: c.claudeBase, maxRetries: 2 });
}

// Сколько токенов займёт запрос: бесплатная проверка перед дорогим запросом с файлом PDF.
// Infinity: запрос заведомо не помещается. null: посчитать не вышло, тогда решаем как обычно.
export async function inputTokens(c: Cfg, messages: Anthropic.Beta.BetaMessageParam[]): Promise<number | null> {
  try {
    const r = await client(c).beta.messages.countTokens({ model: activeModel(c), messages }, { signal: AbortSignal.timeout(30_000) });
    return r.input_tokens;
  } catch (e) {
    if (e instanceof Anthropic.ContentTooLargeError) return Infinity;
    const msg = e instanceof Anthropic.APIError ? String(e.apiMessage ?? e.message ?? "") : "";
    if (e instanceof Anthropic.BadRequestError && /too (long|large|many)|maximum|exceed/i.test(msg)) return Infinity;
    console.log("подсчёт токенов не удался:", String((e as Error)?.message ?? e).slice(0, 160));
    return null;
  }
}

// Какой необязательный параметр не понравился модели. Если ошибка 400 не называет ни одного из них,
// дело не в параметрах: ничего не отключаем и показываем ошибку как есть.
function blamed(e: unknown, o: AskOptions, c: Cfg, off: Set<Feature>): Feature | undefined {
  if (!(e instanceof Anthropic.BadRequestError)) return undefined;
  const msg = String(e.apiMessage ?? e.message ?? "");
  const f: Feature | undefined = /speed|fast/i.test(msg)
    ? "speed"
    : /fallback|anthropic-beta/i.test(msg)
    ? "fallbacks"
    : /code_execution|tools|container/i.test(msg)
    ? "tools"
    : /output_config|effort/i.test(msg)
    ? "effort"
    : /thinking/i.test(msg)
    ? "thinking"
    : undefined;
  if (!f || off.has(f)) return undefined;
  if ((f === "speed" && !o.fast) || (f === "tools" && !c.code)) return undefined;
  return f;
}

export async function ask(c: Cfg, o: AskOptions): Promise<Answer> {
  const removed: [string, Feature][] = [];
  // Параметр считаем лишним, только если без него запрос прошёл. При любой другой концовке возвращаем как было.
  const restore = () => {
    for (const [m, f] of removed) disabled.get(m)?.delete(f);
  };
  for (;;) {
    const own = o.model && (down.get(o.model) ?? 0) <= Date.now() ? o.model : undefined;
    const model = own ?? activeModel(c);
    try {
      return await converse(c, model, o);
    } catch (e) {
      if (own && own !== c.model && unavailable(e)) {
        console.log(`модель ${own} недоступна, этот запрос идёт на основной:`, String((e as Error).message).slice(0, 200));
        down.set(own, Date.now() + MODEL_RETRY);
        continue;
      }
      if (model === c.model && c.fallbackModel && c.fallbackModel !== c.model && unavailable(e)) {
        console.log(`модель ${model} недоступна, работаю на ${c.fallbackModel}:`, String((e as Error).message).slice(0, 200));
        down.set(c.model, Date.now() + MODEL_RETRY);
        continue;
      }
      const off = disabled.get(model) ?? new Set<Feature>();
      // у fast-режима свой, меньший лимит запросов: если упёрлись в него, этот запрос идёт на обычной скорости
      const spend = e instanceof Anthropic.RateLimitError && (e.errorCode === "enforced_spend_limit_reached" || e.errorCode === "contract_spend_limit_reached");
      if (o.fast && !off.has("speed") && !spend && e instanceof Anthropic.APIError && (e.status === 429 || e.status === 529)) {
        console.log("fast: лимит или перегрузка, повторяю на обычной скорости");
        o = { ...o, fast: false };
        continue;
      }
      const next = blamed(e, o, c, off);
      if (!next) {
        restore();
        throw claudeProblem(c, e, model);
      }
      console.log(`Claude 400, пробую без ${next}:`, String((e as Error).message).slice(0, 200));
      off.add(next);
      disabled.set(model, off);
      removed.push([model, next]);
    }
  }
}

const has = (content: Content, type: string) => content.some((b) => (b.type as string) === type);
const isTool = (type: string) => type === "server_tool_use" || type.endsWith("_tool_result");
const texts = (content: Content) => content.flatMap((b) => (b.type === "text" && b.text.trim() ? [b.text] : []));
const MARK = /^[ \t]*(Ответ:|@@@)/m; // по этим строкам видно, что кусок текста это решение, а не заметка
// Текст хода, разрезанный обращениями к песочнице
function segments(content: Content): string[] {
  const out: string[] = [""];
  for (const b of content) {
    if (isTool(b.type as string)) out.push("");
    else if (b.type === "text") out[out.length - 1] += b.text;
  }
  return out;
}
// Готовый ответ: то, что модель написала после последнего обращения к песочнице. Заметки между проверками
// («сейчас пересчитаю», «проверка подтвердила») читателю не нужны. У Fable 5.2 они уходят в размышления,
// а запасные модели пишут их обычным текстом. Если решение стоит до проверки, а после неё только заметка, берём решение.
// Блок fallback (ход подхватила запасная модель) текст не разрывает: она продолжает с того же места.
// cut: ход оборван. Тогда недописанный текст после проверки это и есть ответ (модель переписывала решение), старое решение до проверки не берём.
export function answerText(content: Content, cut = false): string {
  const segs = segments(content);
  const last = segs[segs.length - 1];
  if (MARK.test(last) || (cut && last.trim())) return last;
  return [...segs].reverse().find((s) => MARK.test(s)) ?? last;
}
// Последнее слово модели: текст после последнего обращения к песочнице
export const tailText = (content: Content): string => segments(content).at(-1) ?? "";
// Весь текст хода: если после проверок модель ничего не написала, ответ мог остаться перед ними
export const allText = (content: Content): string => texts(content).join("\n\n");

// Что решила основная модель по замечаниям проверяющего. body: решение, которое уже отправлено человеку.
// Ошибиться здесь можно в обе стороны, и обе плохи: прислать «исправление» к верному ответу или подтвердить неверный.
// Поэтому всё неоднозначное это null: запрос повторяется (число попыток ограничено), и в чат ничего лишнего не уходит.
// 1. Итоговое слово (текст после последнего пересчёта кодом) содержит целое задание с ответом, которого в отправленном
//    решении не было: это исправление. Строки согласия по другим заданиям («В №1 всё верно») из него убираются.
// 2. Итоговое слово это согласие («ВСЁ ВЕРНО» без «не» перед ним), и по ходу модель не получила ни одного ответа,
//    которого нет в отправленном решении: решение устояло. Повтор прежнего ответа рядом с согласием это тоже согласие.
// 3. Согласия нет, но раньше в ходе есть целое задание с новым ответом (после него модель только пересчитала кодом): исправление.
// 4. Оборванный ответ, отказ, согласие вперемешку с другим ответом, заметка без задания: null.
const AGREE = /(?<![а-яё])вс[её]\s+верно(?![а-яё])/gi;
const agrees = (s: string) => [...s.matchAll(AGREE)].some((m) => !/(^|[^а-яё])не[\s,:—–-]*$/i.test(s.slice(0, m.index)));
const TASK = /^\s*(?:[^·\n]{1,30}·\s*){0,2}(?:№\s*\S+|(?:Задание|Задача|Вариант)\s+\d\S*)/; // заголовок задания, а не фраза «Вариант с ошибкой проверен»
const whole = (text: string) => text.split(/^[ \t]*@@@.*$/m).some((t) => {
  const rows = t.split("\n");
  const head = rows.findIndex((r) => TASK.test(r));
  return head >= 0 && rows.findLastIndex((r) => /^[ \t]*Ответ:/.test(r)) > head;
});
const squeeze = (s: string) => s.replace(/[\s$]/g, "").replace(/[.;]+$/, "").toLowerCase();
const answersOf = (text: string) => [...text.matchAll(/^[ \t]*Ответ:[ \t]*(.+)$/gm)].map((m) => squeeze(m[1])).filter(Boolean);
// Ответы из текста, которых нет среди ответов отправленного решения. Без решения под рукой (body пуст) сравнить не с чем: новым считается любой
function fresh(text: string, body: string): string[] {
  const sent = new Set(answersOf(body));
  return answersOf(text).filter((x) => !body || !sent.has(x));
}
const SAYS = /(?<![а-яё])вс[её]\s+верно(?![а-яё])/i;

export function judgeReply(a: Pick<Answer, "text" | "tail" | "all" | "cut" | "refused">, body = ""): { ok: true } | { fix: string } | null {
  const last = (a.tail ?? a.text).trim();
  const broken = a.cut || a.refused;
  if (!broken && whole(last) && fresh(last, body).length) {
    return { fix: last.split("\n").filter((r) => !(SAYS.test(r) && !/Ответ:/.test(r) && r.length < 80)).join("\n").trim() };
  }
  if (agrees(last)) {
    if (broken && last.length > 60) return null; // оборвано посреди разбора: что шло бы дальше, неизвестно
    return body && fresh(a.all ?? a.text, body).length ? null : { ok: true };
  }
  if (!broken && body && whole(last)) return { ok: true }; // задание переписано, а ответы те же: исправлять нечего
  return !broken && whole(a.text) && fresh(a.text, body).length ? { fix: a.text } : null;
}

// Один ход модели. Пересчёт в песочнице идёт на стороне Anthropic; если он затянулся, ход приходит
// с пометкой pause_turn, и его нужно продолжить, вернув модели её же сообщение без изменений.
async function converse(c: Cfg, model: string, o: AskOptions): Promise<Answer> {
  let messages = o.messages;
  let container: string | undefined;
  const blocks: Content = []; // всё, что модель написала за этот ход, по порядку
  let checks = 0;
  let nudged = false;
  const tokens = { in: 0, out: 0 };
  for (let round = 0; ; round++) {
    let r: Attempt;
    try {
      r = await attempt(c, model, o, messages, container);
    } catch (e) {
      // fast-режим упёрся в свой лимит посреди хода: этот же круг повторяем на обычной скорости, оплаченные круги не теряем
      const spend = e instanceof Anthropic.RateLimitError && (e.errorCode === "enforced_spend_limit_reached" || e.errorCode === "contract_spend_limit_reached");
      if (round > 0 && o.fast && !spend && e instanceof Anthropic.APIError && (e.status === 429 || e.status === 529)) {
        console.log("fast: лимит или перегрузка посреди хода, продолжаю на обычной скорости");
        o = { ...o, fast: false };
        round--;
        continue;
      }
      // срок вышел или Claude отвалился уже после того, как часть ответа написана: её не теряем
      const sofar = answerText(blocks);
      if ((e instanceof Timeout || e instanceof Busy) && sofar.trim()) return { text: sofar, cut: true, refused: false, tokens, model, checks, all: allText(blocks), tail: tailText(blocks) };
      throw e;
    }
    tokens.in += r.tokens.in;
    tokens.out += r.tokens.out;
    // поток оборвался на полуслове: берём написанное после последней проверки
    if (!r.msg) {
      const got = [...blocks, { type: "text", text: r.text } as Content[number]];
      // в оборванном потоке была проверка: его текст до неё неизвестен, известен только хвост после неё
      return { text: r.fresh ? r.text : answerText(got, true), cut: true, refused: false, tokens, model, checks, all: allText(got), tail: r.fresh ? r.text : tailText(got) };
    }
    const msg = r.msg;
    blocks.push(...msg.content);
    checks += msg.content.filter((b) => b.type === "server_tool_use").length;
    // pause_turn здесь значит «ход не закончен»: если продолжить его нельзя, ответ считается оборванным
    const cut = msg.stop_reason === "max_tokens" || msg.stop_reason === "model_context_window_exceeded" || msg.stop_reason === "pause_turn";
    const out = answerText(blocks, cut);
    const done: Answer = {
      text: cut ? out : out || allText(blocks),
      cut,
      refused: msg.stop_reason === "refusal",
      tokens,
      model: msg.model,
      checks,
      all: allText(blocks),
      tail: tailText(blocks),
    };
    // после перехода на запасную модель сообщение нельзя вернуть как есть: отдаём то, что получилось
    if (has(msg.content, "fallback") || round >= 8) return done;
    if (msg.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] }];
      container = msg.container?.id ?? container;
      continue;
    }
    // Модель всё проверила, но итоговый текст не написала (он остался в её заметках между проверками): просим написать
    if (msg.stop_reason === "end_turn" && !out.trim() && checks > 0 && !nudged) {
      nudged = true;
      messages = [
        ...messages,
        { role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] },
        { role: "user", content: "Теперь напиши готовый ответ целиком, по формату." },
      ];
      container = msg.container?.id ?? container;
      continue;
    }
    return done;
  }
}

interface Attempt {
  text: string; // если поток оборвался: текст, написанный после последней проверки в этом потоке
  fresh?: boolean; // в оборванном потоке была проверка: текст прошлых кругов к ответу уже не относится
  tokens: { in: number; out: number };
  msg?: Anthropic.Beta.BetaMessage; // нет, если ответ оборвался на полуслове
}

async function attempt(c: Cfg, model: string, o: AskOptions, messages: Anthropic.Beta.BetaMessageParam[], container?: string): Promise<Attempt> {
  const off = disabled.get(model) ?? new Set<Feature>();
  const params: StreamParams = {
    model,
    // размышления тоже идут в счёт max_tokens, на высоких ступенях им нужно больше места
    max_tokens: o.effort === "xhigh" || o.effort === "max" ? 128_000 : 64_000,
    // инструкция одна и та же для всех фото: кэшируем, следующие запросы дешевле и быстрее
    system: [{ type: "text", text: o.system ?? PROMPT, cache_control: { type: "ephemeral" } }],
    // и разговор тоже: при добавлении фото, продолжении и уточнениях старые фото читаются из кэша
    cache_control: { type: "ephemeral" },
    messages,
  };
  // размышления включаем явно: тогда и запасная модель (если основная откажется) будет думать
  if (!off.has("thinking")) params.thinking = { type: "adaptive" };
  if (!off.has("effort")) params.output_config = { effort: o.effort };
  if (o.fast && !off.has("speed")) params.speed = "fast";
  if (!off.has("fallbacks")) {
    // если защитный фильтр основной модели по ошибке отклонит задание (бывает на химии и биологии),
    // Anthropic сам повторит запрос на запасной модели
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  if (c.code && !off.has("tools")) {
    // песочница с Python (sympy, numpy): модель пересчитывает в ней вычисления перед тем, как писать ответ
    params.tools = [{ type: "code_execution_20260521", name: "code_execution" }];
    if (container) params.container = container;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Timeout("время вышло")), left(o.until, 3_000));
  const interrupt = () => ctrl.abort(o.stop?.reason instanceof Error ? o.stop.reason : new Stopped("стоп"));
  if (o.stop?.aborted) interrupt();
  o.stop?.addEventListener("abort", interrupt);

  let out = "";
  let fresh = false;
  let opened = false; // поток открылся: модель приняла запрос и начала работать
  // Расход считаем по ходу потока: если он оборвётся, уже потраченное всё равно попадёт в учёт
  const used = { in: 0, out: 0, read: 0, write: 0 };
  let served = model;
  // Точный выход приходит только в конце потока. Если поток оборвётся раньше, выход оцениваем по написанному
  // (текст, размышления, код для песочницы): около 3 знаков русского текста на токен. Иначе лимит видел бы почти $0.
  let streamed = 0;
  let exact = false;
  const count = (u: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined, final = false) => {
    if (!u) return;
    if (final) exact = true;
    used.in = Math.max(used.in, u.input_tokens ?? 0);
    used.out = Math.max(used.out, u.output_tokens ?? 0);
    used.read = Math.max(used.read, u.cache_read_input_tokens ?? 0);
    used.write = Math.max(used.write, u.cache_creation_input_tokens ?? 0);
  };
  try {
    const stream = client(c).beta.messages.stream(params, { signal: ctrl.signal });
    for await (const ev of stream) {
      opened = true;
      if (ev.type === "message_start") (count(ev.message.usage), (served = ev.message.model || served));
      else if (ev.type === "message_delta") count(ev.usage, true);
      if (ev.type === "content_block_delta") {
        const d = ev.delta as { text?: string; thinking?: string; partial_json?: string };
        streamed += (d.text ?? d.thinking ?? d.partial_json ?? "").length;
      }
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") out += ev.delta.text;
      else if (ev.type === "content_block_start" && isTool(ev.content_block.type as string)) {
        out = ""; // всё, что было написано до проверки, это заметки, а не ответ
        fresh = true;
      }
    }
    const msg = await stream.finalMessage();
    count(msg.usage, true);
    served = msg.model || served;
    return { text: "", tokens: { in: msg.usage.input_tokens, out: msg.usage.output_tokens }, msg };
  } catch (e) {
    // «стоп» или новое фото: причину решает вызывающий
    if (o.stop?.aborted) throw o.stop.reason instanceof Error ? o.stop.reason : new Stopped("стоп");
    // Срок вышел или связь оборвалась посреди ответа: написанное не теряем, остальное в следующем куске
    if (out.trim()) {
      console.log("ответ оборван:", e instanceof Error ? e.message : String(e));
      return { text: out, fresh, tokens: { in: 0, out: 0 } };
    }
    // Срок вышел. Если модель всё это время думала, следующую попытку делаем на ступень проще.
    // Если поток так и не открылся (очередь у Claude, зависшее соединение), модель ни при чём: просто повтор.
    if (ctrl.signal.aborted) throw opened ? new Timeout("время вышло") : new Busy("Claude не ответил");
    // Связь оборвалась или ошибка пришла прямо в потоке, пока модель думала: это не приговор, повторяем позже
    if (!(e instanceof Anthropic.APIError && typeof e.status === "number")) throw new Busy("связь с Claude оборвалась");
    throw e;
  } finally {
    clearTimeout(timer);
    o.stop?.removeEventListener("abort", interrupt);
    const guess = exact ? 0 : Math.ceil(streamed / 3);
    const estimated = guess > used.out;
    if (estimated) used.out = guess;
    if (used.in + used.out + used.read + used.write > 0) {
      try {
        const paid = cost(served, model, used, params.speed === "fast");
        o.spent?.({ model: served, ...used, usd: paid.usd, ...(paid.approx || estimated ? { approx: true } : {}) });
      } catch (e) {
        console.log("учёт расхода:", String(e));
      }
    }
  }
}

// Делит готовый ответ на задания по отдельной строке @@@
export function tasks(answer: string): string[] {
  return answer.split(/(?:^|\n)[ \t]*@@@[^\n]*(?:\n|$)/).map((t) => t.trim()).filter(Boolean);
}
