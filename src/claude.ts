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
}

export interface AskOptions {
  messages: Anthropic.Beta.BetaMessageParam[];
  effort: Effort;
  fast: boolean;
  until: number; // срок куска, мс
  stop?: AbortSignal; // «стоп» или новое фото к этому же заданию: причина лежит в signal.reason
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
    return new Fatal(`Ошибка Claude ${e.status}: ${msg.slice(0, 120)}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

export function client(c: Cfg): Anthropic {
  return new Anthropic({ apiKey: c.claudeKey, baseURL: c.claudeBase, maxRetries: 2 });
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
    const model = activeModel(c);
    try {
      return await converse(c, model, o);
    } catch (e) {
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
// Часть хода после перехода на запасную модель (всё, что было до него, запасная модель переписывает заново)
const tail = (content: Content) => content.slice(content.map((b) => b.type as string).lastIndexOf("fallback") + 1);
// Готовый ответ: текст после последнего обращения к песочнице. Заметки, которые модель писала между
// проверками («сейчас пересчитаю»), читателю не нужны. У Fable 5.2 они и так уходят в размышления,
// а запасные модели пишут их обычным текстом.
export function answerText(content: Content): string {
  const t = tail(content);
  const lastTool = t.reduce((k, b, i) => (isTool(b.type as string) ? i : k), -1);
  return texts(t.slice(lastTool + 1)).join("");
}
// Весь текст хода: если после проверок модель ничего не написала, ответ мог остаться перед ними
export const allText = (content: Content): string => texts(tail(content)).join("\n\n");

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
      // срок вышел или Claude отвалился уже после того, как часть ответа написана: её не теряем
      const sofar = answerText(blocks);
      if ((e instanceof Timeout || e instanceof Busy) && sofar.trim()) return { text: sofar, cut: true, refused: false, tokens, model, checks };
      throw e;
    }
    tokens.in += r.tokens.in;
    tokens.out += r.tokens.out;
    // поток оборвался на полуслове: берём написанное после последней проверки
    if (!r.msg) return { text: r.fresh ? r.text : answerText(blocks) + r.text, cut: true, refused: false, tokens, model, checks };
    const msg = r.msg;
    blocks.push(...msg.content);
    checks += msg.content.filter((b) => b.type === "server_tool_use").length;
    const out = answerText(blocks);
    // pause_turn здесь значит «ход не закончен»: если продолжить его нельзя, ответ считается оборванным
    const cut = msg.stop_reason === "max_tokens" || msg.stop_reason === "model_context_window_exceeded" || msg.stop_reason === "pause_turn";
    const done: Answer = {
      text: cut ? out : out || allText(blocks),
      cut,
      refused: msg.stop_reason === "refusal",
      tokens,
      model: msg.model,
      checks,
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
    system: [{ type: "text", text: PROMPT, cache_control: { type: "ephemeral" } }],
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
  try {
    const stream = client(c).beta.messages.stream(params, { signal: ctrl.signal });
    for await (const ev of stream) {
      opened = true;
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") out += ev.delta.text;
      else if (ev.type === "content_block_start" && (isTool(ev.content_block.type as string) || (ev.content_block.type as string) === "fallback")) {
        out = ""; // всё, что было написано до проверки, это заметки, а не ответ
        fresh = true;
      }
    }
    const msg = await stream.finalMessage();
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
  }
}

// Делит готовый ответ на задания по отдельной строке @@@
export function tasks(answer: string): string[] {
  return answer.split(/(?:^|\n)[ \t]*@@@[^\n]*(?:\n|$)/).map((t) => t.trim()).filter(Boolean);
}
