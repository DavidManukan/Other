// Запрос к Claude через официальный SDK: ответ идёт потоком и режется на задания по строке @@@.
import Anthropic from "@anthropic-ai/sdk";
import type { Cfg, Effort } from "./config.ts";
import { PROMPT } from "./prompt.ts";
import { left } from "./util.ts";

export class Timeout extends Error {} // время куска вышло, а модель ещё ничего не написала
export class Stopped extends Error {} // пользователь написал «стоп»
export class Busy extends Error {} // Claude перегружен или лимит запросов: стоит повторить позже
export class Fatal extends Error {} // ошибка настройки: повтор не поможет
class Undelivered {
  cause: unknown;
  constructor(cause: unknown) {
    this.cause = cause;
  }
}

// Режет поток текста на готовые задания. Разделитель: отдельная строка @@@
export class Splitter {
  private pending = "";
  private static SPLIT = /(?:^|\n)[ \t]*@@@[^\n]*\n/;
  private marked = false; // в накопленном тексте есть @@@ (значит, разделитель может завершиться переводом строки)
  push(delta: string): string[] {
    // Регулярное выражение по всему накопленному тексту дорогое, поэтому запускаем его, только когда
    // разделитель действительно мог появиться: @@@ уже встречалось и пришёл перевод строки.
    const from = Math.max(0, this.pending.length - 2);
    this.pending += delta;
    this.marked ||= this.pending.indexOf("@@@", from) >= 0;
    if (!this.marked || !delta.includes("\n")) return [];
    const out: string[] = [];
    let m: RegExpMatchArray | null;
    while ((m = this.pending.match(Splitter.SPLIT))) {
      const chunk = this.pending.slice(0, m.index);
      this.pending = this.pending.slice(m.index! + m[0].length);
      if (chunk.trim()) out.push(chunk);
    }
    this.marked = this.pending.includes("@@@");
    return out;
  }
  rest(): string {
    return this.pending.replace(/(?:^|\n)[ \t]*@@@[^\n]*$/, "").trim(); // хвостовой разделитель без перевода строки
  }
}

export interface Answer {
  rest: string; // хвост после последнего @@@ (ещё не отправлен)
  cut: boolean; // ответ оборван (время или лимит токенов): продолжить в следующем куске
  refused: boolean;
  empty: boolean; // модель не написала ни одного символа
  tokens: { in: number; out: number };
  model: string; // модель, которая реально ответила (при отказе основной может ответить запасная)
}

export interface AskOptions {
  messages: Anthropic.Beta.BetaMessageParam[];
  effort: Effort;
  fast: boolean;
  until: number; // срок куска, мс
  stop?: AbortSignal; // команда «стоп»
  onChunk: (text: string) => Promise<void>; // готовое задание
}

type StreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

// Необязательные параметры запроса. Если модель из MODEL какой-то из них не знает (ошибка 400),
// бот по очереди отключает их и запоминает, чтобы не ошибаться на каждом фото.
type Feature = "speed" | "fallbacks" | "effort";
const ORDER: Feature[] = ["speed", "fallbacks", "effort"];
const disabled = new Map<string, Set<Feature>>();
export const featureOff = (model: string, f: Feature) => disabled.get(model)?.has(f) ?? false;

export function claudeProblem(c: Cfg, e: unknown): Error {
  if (e instanceof Timeout || e instanceof Stopped || e instanceof Busy || e instanceof Fatal) return e;
  if (e instanceof Anthropic.AuthenticationError) return new Fatal("Неверный ключ Claude. Проверь ANTHROPIC_API_KEY.");
  if (e instanceof Anthropic.NotFoundError) return new Fatal(`Нет модели ${c.model}. Исправь MODEL.`);
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
    return new Fatal(`Ошибка Claude ${e.status}: ${msg.slice(0, 120)}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

const CREDIT = /credit balance/i;
const SPEND = /specified (workspace )?API usage limits/i;
export function client(c: Cfg): Anthropic {
  return new Anthropic({ apiKey: c.claudeKey, baseURL: c.claudeBase, maxRetries: 2 });
}

// Какой необязательный параметр не понравился модели. Если ошибка 400 не называет ни одного из них,
// дело не в параметрах: ничего не отключаем и показываем ошибку как есть.
function blamed(e: unknown, fast: boolean, off: Set<Feature>): Feature | undefined {
  if (!(e instanceof Anthropic.BadRequestError)) return undefined;
  const msg = String(e.apiMessage ?? e.message ?? "");
  const f: Feature | undefined = /speed|fast/i.test(msg) ? "speed" : /fallback|anthropic-beta/i.test(msg) ? "fallbacks" : /output_config|effort/i.test(msg) ? "effort" : undefined;
  return f && !off.has(f) && (f !== "speed" || fast) ? f : undefined;
}

export async function ask(c: Cfg, o: AskOptions): Promise<Answer> {
  const removed: Feature[] = [];
  // Параметр считаем лишним, только если без него запрос прошёл. При любой другой концовке возвращаем как было.
  const restore = () => {
    const off = disabled.get(c.model);
    for (const f of removed) off?.delete(f);
  };
  for (;;) {
    try {
      return await attempt(c, o);
    } catch (e) {
      const off = disabled.get(c.model) ?? new Set<Feature>();
      const next = blamed(e, o.fast, off);
      if (!next) {
        restore();
        throw claudeProblem(c, e);
      }
      console.log(`Claude 400, пробую без ${next}:`, String((e as Error).message).slice(0, 200));
      off.add(next);
      disabled.set(c.model, off);
      removed.push(next);
    }
  }
}

async function attempt(c: Cfg, o: AskOptions): Promise<Answer> {
  const off = disabled.get(c.model) ?? new Set<Feature>();
  const params: StreamParams = {
    model: c.model,
    // размышления тоже идут в счёт max_tokens, на высоких ступенях им нужно больше места
    max_tokens: o.effort === "xhigh" || o.effort === "max" ? 128_000 : 64_000,
    // инструкция одна и та же для всех фото: кэшируем, следующие запросы дешевле и быстрее
    system: [{ type: "text", text: PROMPT, cache_control: { type: "ephemeral" } }],
    messages: o.messages,
  };
  if (!off.has("effort")) params.output_config = { effort: o.effort };
  if (o.fast && !off.has("speed")) params.speed = "fast";
  if (!off.has("fallbacks")) {
    // если защитный фильтр основной модели по ошибке отклонит задание (бывает на химии и биологии),
    // Anthropic сам повторит запрос на запасной модели
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Timeout("время вышло")), left(o.until, 3_000));
  const onStop = () => ctrl.abort(new Stopped("стоп"));
  if (o.stop?.aborted) onStop();
  o.stop?.addEventListener("abort", onStop);

  const split = new Splitter();
  let wrote = false; // модель написала хоть что-то, кроме пробелов
  let opened = false; // поток открылся: модель приняла запрос и начала работать
  try {
    const stream = client(c).beta.messages.stream(params, { signal: ctrl.signal });
    for await (const ev of stream) {
      opened = true;
      if (ev.type !== "content_block_delta" || ev.delta.type !== "text_delta") continue;
      wrote ||= /\S/.test(ev.delta.text);
      for (const chunk of split.push(ev.delta.text)) {
        try {
          await o.onChunk(chunk);
        } catch (cause) {
          throw new Undelivered(cause); // сбой отправки в чат: это не обрыв ответа, решает вызывающий
        }
      }
    }
    const msg = await stream.finalMessage();
    return {
      rest: split.rest(),
      cut: msg.stop_reason === "max_tokens",
      refused: msg.stop_reason === "refusal",
      empty: !wrote,
      tokens: { in: msg.usage.input_tokens, out: msg.usage.output_tokens },
      model: msg.model,
    };
  } catch (e) {
    if (ctrl.signal.reason instanceof Stopped) throw ctrl.signal.reason;
    // Срок вышел или связь оборвалась посреди ответа: написанное не теряем, остальное в следующем куске
    if (e instanceof Undelivered) throw e.cause;
    if (wrote) {
      console.log("ответ оборван:", e instanceof Error ? e.message : String(e));
      return { rest: split.rest(), cut: true, refused: false, empty: false, tokens: { in: 0, out: 0 }, model: c.model };
    }
    // Срок вышел. Если модель всё это время думала, следующую попытку делаем на ступень проще.
    // Если поток так и не открылся (очередь у Claude, зависшее соединение), модель ни при чём: просто повтор.
    if (ctrl.signal.aborted) throw opened ? new Timeout("время вышло") : new Busy("Claude не ответил");
    // Связь оборвалась или ошибка пришла прямо в потоке, пока модель думала: это не приговор, повторяем позже
    if (!(e instanceof Anthropic.APIError && typeof e.status === "number")) throw new Busy("связь с Claude оборвалась");
    throw e;
  } finally {
    clearTimeout(timer);
    o.stop?.removeEventListener("abort", onStop);
  }
}
