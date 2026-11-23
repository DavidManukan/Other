// Один объект на чат: очередь заданий, память разговора и рисунки.
// Вебхук только кладёт задание в очередь и сразу отвечает шлюзу. Решает будильник объекта:
// у него до 15 минут на кусок работы, а длинный ответ продолжается следующим будильником.
import { DurableObject } from "cloudflare:workers";
import type Anthropic from "@anthropic-ai/sdk";
import { type Cfg, type Effort, type Env, chatStub, config, hider, isEffort, lower } from "./config.ts";
import { ask, Busy, Fatal, Stopped, Timeout } from "./claude.ts";
import { Green } from "./green.ts";
import { renderPng } from "./render.ts";
import { type SelfTest, SAMPLE_SVG, status } from "./status.ts";
import { splitAnswer } from "./text.ts";
import { base64, clock, imageType } from "./util.ts";

const SEGMENT = 13 * 60_000; // столько работает один кусок (потолок будильника 15 минут)
const SEGMENT_TAIL = 45_000; // запас в конце куска на отправку и сохранение
const WATCHDOG = 15.5 * 60_000; // если кусок оборвался молча (обновление кода), будильник поднимет задание снова
const HELLO = 75_000; // столько молчим, прежде чем написать «решаю»
const BACKOFF = [15_000, 45_000, 120_000]; // паузы перед повтором, когда Claude занят
const HISTORY_TTL = 2 * 3600_000; // через 2 часа без сообщений чат начинается заново
const HISTORY_MAX = 12; // последние 6 вопросов и ответов
const TURN_MAX = 50_000; // длиннее в памяти не храним
const MAX_TRIES = 4; // попыток на один кусок
const MAX_DRAWINGS = 8;
const MAX_SENDS = 35; // сообщений за один кусок (у бесплатного тарифа Cloudflare 50 внешних запросов на запуск)
const MAX_QUEUE = 20; // заданий в очереди одного чата
const PHOTO_CHUNK = 1_000_000; // значение в хранилище не больше 2 МБ, фото режем на части
const PHOTO_MAX = 5_000_000; // больше Claude не примет
const IMG_TTL = 86_400_000; // рисунки храним сутки
const LOG_MAX = 12;
const CUT_NOTE = "(ответ слишком длинный: пришли фото по частям)";
export const STATUS = "__status"; // имя служебного объекта: журнал и страница проверки

const NUDGE = new Set(["videoMessage", "audioMessage", "documentMessage", "stickerMessage", "locationMessage", "contactMessage"]);
const EFFORT_WORDS: Record<string, Effort> = { быстро: "low", средне: "medium", умно: "high", макс: "xhigh" };

type Block = { type: "text"; text: string } | { type: "photo"; id: string };
interface Turn {
  role: "user" | "assistant";
  content: string | Block[];
}
interface Meta {
  chatId: string;
  origin: string;
}
interface Opts {
  effort?: Effort;
  fast?: boolean;
}
interface PhotoMeta {
  id: string;
  type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  n: number;
}
interface Job {
  id: string;
  at: number;
  kind: "image" | "text";
  url?: string;
  caption?: string;
  text?: string;
  phase: "solve" | "draw";
  step: number; // сколько раз ответ уже продолжали
  tries: number; // попытки текущего куска
  effort: Effort;
  cont: boolean; // следующий кусок продолжает ответ («дальше»)
  sent: string[]; // что уже ушло в чат в текущем куске
  svgs: string[]; // рисунки ждут своей очереди: сначала все ответы, потом картинки
  drawn: number;
  after?: number; // не раньше этого времени (пауза перед повтором)
  hello?: boolean; // «⏳ решаю» уже отправляли
  started?: number;
  msgs: number;
  tokens: number;
}

class Delivery extends Error {} // ответ готов, но шлюз его не принял

export class Chat extends DurableObject<Env> {
  private c: Cfg;
  private green: Green;
  private hide: (x: unknown) => string;
  private running = false;
  private stop: AbortController | null = null;
  private photo: { id: string; type: PhotoMeta["type"]; data: string } | null = null;
  private page: { at: number; html: string } | null = null;
  private epoch = 0; // растёт на «сброс»: решение, начатое до сброса, память уже не трогает
  private k: number; // масштаб времени: 1 в работе, больше только в локальных тестах

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.c = config(env);
    this.green = new Green(this.c);
    this.hide = hider(this.c);
    this.k = Math.max(1, Number(env.TIME_SCALE) || 1);
  }

  private get db() {
    return this.ctx.storage;
  }

  // ---------- вход: сообщение из WhatsApp ----------
  async onWebhook(h: any, origin: string): Promise<void> {
    const chatId = String(h?.senderData?.chatId ?? "");
    const id = String(h?.idMessage ?? "");
    if (!chatId || (await this.seen(id))) return; // шлюз иногда присылает одно сообщение дважды
    await this.db.put<Meta>("meta", { chatId, origin });
    const md = h.messageData ?? {};
    const type = String(md.typeMessage ?? "");
    const fd = md.fileMessageData ?? {};
    try {
      if (type === "imageMessage" || (type === "documentMessage" && /^image\//.test(String(fd.mimeType ?? "")))) {
        const caption = String(fd.caption ?? "").trim();
        await this.enqueue({ kind: "image", id, url: fd.downloadUrl ? String(fd.downloadUrl) : undefined, caption });
      } else if (type === "textMessage" || type === "extendedTextMessage" || type === "quotedMessage") {
        const text = String(md.textMessageData?.textMessage ?? md.extendedTextMessageData?.text ?? "").trim();
        if (!text || (await this.command(chatId, text))) return;
        await this.enqueue({ kind: "text", id, text });
      } else if (NUDGE.has(type)) {
        await this.green.send(chatId, "Пришли фото задания.");
      } // реакции, правки, удаления: молча пропускаем
    } catch (e: any) {
      console.log(this.hide(e?.stack ?? e));
      await this.say(chatId, `⚠️ ${this.hide(e?.message ?? e)}`);
    }
  }

  private async seen(id: string): Promise<boolean> {
    if (!id) return false;
    const seen = (await this.db.get<string[]>("seen")) ?? [];
    if (seen.includes(id)) return true;
    await this.db.put("seen", [...seen, id].slice(-200));
    return false;
  }

  private async options(): Promise<{ effort: Effort; fast: boolean }> {
    const o = (await this.db.get<Opts>("opts")) ?? {};
    return { effort: o.effort ?? this.c.effort, fast: o.fast ?? this.c.fast };
  }

  // Команды из чата. true = сообщение было командой, решать его не нужно
  private async command(chatId: string, text: string): Promise<boolean> {
    const t = text.toLowerCase().replace(/[.!]+$/, "").trim();
    if (/^(ping|пинг)$/.test(t)) {
      const o = await this.options();
      const queue = (await this.db.list({ prefix: "job:" })).size;
      await this.green.send(
        chatId,
        `pong ✅ модель ${this.c.model}, думает: ${o.effort}, fast ${o.fast ? "вкл" : "выкл"}${queue ? `, в работе: ${queue}` : ""}\n` +
          "Команды: быстро / средне / умно / макс, fast вкл / fast выкл, стоп, сброс",
      );
      return true;
    }
    if (/^(сброс|новое|reset)$/.test(t)) {
      await this.forget();
      await this.green.send(chatId, "Память чата очищена ✅");
      return true;
    }
    if (/^(стоп|stop|отмена)$/.test(t)) {
      const jobs = await this.db.list({ prefix: "job:" });
      await this.db.delete([...jobs.keys()]);
      this.stop?.abort();
      await this.green.send(chatId, jobs.size ? "Остановил ✅" : "Сейчас ничего не решаю.");
      return true;
    }
    const m = t.match(/^(?:effort|режим)\s+(\S+)$/);
    const effort = EFFORT_WORDS[t] ?? (m ? (EFFORT_WORDS[m[1]] ?? m[1]) : isEffort(t) ? t : undefined);
    if (effort !== undefined) {
      if (!isEffort(effort)) {
        await this.green.send(chatId, "Не понял режим. Есть: быстро, средне, умно, макс.");
        return true;
      }
      await this.db.put<Opts>("opts", { ...((await this.db.get<Opts>("opts")) ?? {}), effort });
      await this.green.send(chatId, `Режим: ${effort} ✅${effort === "low" ? " (быстрее и дешевле)" : effort === "xhigh" || effort === "max" ? " (дольше и дороже)" : ""}`);
      return true;
    }
    const f = t.match(/^fast\s+(вкл|выкл|on|off)$/);
    if (f) {
      const fast = f[1] === "вкл" || f[1] === "on";
      await this.db.put<Opts>("opts", { ...((await this.db.get<Opts>("opts")) ?? {}), fast });
      await this.green.send(chatId, `Fast ${fast ? "включён ✅ (ответ пишется быстрее, токены вдвое дороже)" : "выключен ✅"}`);
      return true;
    }
    return false;
  }

  private async forget() {
    const p = await this.db.get<PhotoMeta>("photo");
    await this.db.delete(["hist", "photo", ...Array.from({ length: p?.n ?? 0 }, (_, i) => `photo:${i}`)]);
    this.photo = null;
    this.epoch++;
  }

  private async enqueue(j: Pick<Job, "kind" | "id" | "url" | "caption" | "text">) {
    if ((await this.db.list({ prefix: "job:", limit: MAX_QUEUE })).size >= MAX_QUEUE) throw new Error("Слишком много заданий в очереди. Подожди ответов или напиши «стоп».");
    const seq = ((await this.db.get<number>("seq")) ?? 0) + 1;
    const { effort } = await this.options();
    const job: Job = { ...j, at: Date.now(), phase: "solve", step: 0, tries: 0, effort, cont: false, sent: [], svgs: [], drawn: 0, msgs: 0, tokens: 0 };
    await this.db.put({ seq, [`job:${String(seq).padStart(9, "0")}`]: job });
    await this.db.setAlarm(Date.now());
  }

  // ---------- будильник: один кусок работы ----------
  async alarm(): Promise<void> {
    if (this.running) {
      // новое сообщение пришло, пока решается прошлое: оно дождётся очереди
      await this.db.setAlarm(Date.now() + WATCHDOG / this.k);
      return;
    }
    this.running = true;
    try {
      const first = await this.db.list<Job>({ prefix: "job:", limit: 1 });
      const [key, job] = [...first][0] ?? [];
      if (!key || !job) return await this.selfTest();
      if (job.after && job.after > Date.now()) return; // пауза перед повтором ещё не прошла
      await this.db.setAlarm(Date.now() + WATCHDOG / this.k);
      await this.run(key, job);
    } catch (e: any) {
      console.log("alarm:", this.hide(e?.stack ?? e));
    } finally {
      this.running = false;
      const next = await this.db.list<Job>({ prefix: "job:", limit: 1 });
      const job = [...next.values()][0];
      if (job) await this.db.setAlarm(Math.max(Date.now(), job.after ?? 0));
      else await this.db.deleteAlarm();
    }
  }

  private async run(key: string, job: Job) {
    const meta = await this.db.get<Meta>("meta");
    if (!meta) return void (await this.db.delete(key));
    const { chatId, origin } = meta;
    const end = Date.now() + SEGMENT / this.k;
    if (!(await this.db.get(key))) return; // «стоп» успел удалить задание
    const stop = new AbortController();
    this.stop = stop;
    job.tries++;
    job.started ??= Date.now();
    delete job.after;
    if (job.tries > MAX_TRIES) {
      await this.db.delete(key);
      await this.note(`не получилось после ${MAX_TRIES} попыток (${job.phase === "draw" ? "рисунки" : "решение"})`);
      return void (await this.say(chatId, job.phase === "draw" ? "(рисунки не получились)" : "⚠️ Не получилось решить. Пришли фото ещё раз."));
    }
    await this.db.put(key, job);
    // «стоп» удаляет задание из очереди: после него ничего не дописываем
    const save = async () => {
      if (stop.signal.aborted) throw new Stopped("стоп");
      await this.db.put(key, job);
    };
    try {
      if (job.phase === "draw") await this.draw(key, job, chatId, origin, save);
      else await this.solve(key, job, chatId, end, stop.signal, save);
    } catch (e: any) {
      if (e instanceof Stopped || stop.signal.aborted) return;
      console.log(this.hide(e?.stack ?? e));
      const retry = job.tries < MAX_TRIES;
      if (e instanceof Timeout && retry) {
        // модель думала весь кусок и ничего не написала: следующая попытка на ступень проще
        job.effort = lower(job.effort);
        await this.db.put(key, job);
        await this.say(chatId, "⏳ долго думаю, решаю быстрее…");
      } else if ((e instanceof Busy || e instanceof Delivery) && retry) {
        job.after = Date.now() + BACKOFF[job.tries - 1] / this.k;
        await this.db.put(key, job);
        if (job.tries === 1 && e instanceof Busy) await this.say(chatId, "⏳ Claude занят, пробую ещё раз…");
      } else {
        await this.db.delete(key);
        const why = e instanceof Timeout
          ? "Не успел решить. Пришли фото ещё раз (лучше одно задание)."
          : e instanceof Busy
          ? "Claude занят. Пришли ещё раз через минуту."
          : e instanceof Delivery
          ? "Не смог отправить ответ. Пришли фото ещё раз."
          : String(e?.message ?? e);
        await this.note(`ошибка: ${this.hide(why).slice(0, 160)}`);
        await this.say(chatId, `⚠️ ${this.hide(why)}`);
      }
    } finally {
      if (this.stop === stop) this.stop = null;
    }
  }

  // ---------- решение: вопрос + память чата -> Claude -> ответы по одному заданию ----------
  private async solve(key: string, job: Job, chatId: string, end: number, stop: AbortSignal, save: () => Promise<void>) {
    let content: Block[];
    if (job.cont) content = [{ type: "text", text: "дальше" }];
    else if (job.kind === "image") {
      if ((await this.db.get<PhotoMeta>("photo"))?.id !== job.id) {
        const bytes = await this.green.photo(chatId, job.id, job.url, Date.now() + 40_000);
        const type = imageType(bytes);
        if (!type || bytes.length > PHOTO_MAX) {
          await this.db.delete(key);
          return void (await this.say(chatId, type ? "Фото слишком большое. Пришли обычное фото." : "Не понял формат фото. Пришли обычное фото."));
        }
        await this.savePhoto(job.id, bytes, type);
      }
      content = [{ type: "photo", id: job.id }, { type: "text", text: job.caption ? `Реши задания на фото. Подпись: ${job.caption}` : "Реши задания на фото." }];
    } else content = [{ type: "text", text: job.text ?? "" }];

    const epoch = this.epoch;
    const remember = async (t: Turn[]) => {
      if (epoch === this.epoch) await this.saveHistory(t);
    };
    const svgsBefore = job.svgs.length;
    let turns = await this.history();
    if (job.sent.length) {
      // прошлый запуск оборвался посреди ответа: отправленное уже в чате, продолжаем с этого места
      turns = [...turns, { role: "user", content }, { role: "assistant", content: job.sent.join("\n\n") }];
      await remember(turns);
      job.sent = [];
      job.cont = true;
      content = [{ type: "text", text: "дальше" }];
      await save();
    }
    turns = [...turns, { role: "user", content }];

    let sends = 0;
    const held: string[] = []; // если заданий очень много, хвост уйдёт одним сообщением
    const post = async (text: string) => {
      try {
        await this.green.send(chatId, text);
      } catch (e: any) {
        throw new Delivery(String(e?.message ?? e));
      }
      sends++;
      job.sent.push(text);
      job.msgs++;
      await save();
    };
    const deliver = async (raw: string) => {
      const { text, svgs } = splitAnswer(raw);
      job.svgs.push(...svgs);
      if (!text) return;
      if (sends >= MAX_SENDS) held.push(text);
      else await post(text);
    };

    // долгое молчание похоже на поломку: один раз даём знать, что бот жив
    const hello = job.hello || job.cont ? undefined : setTimeout(() => {
      if (job.sent.length || stop.aborted) return;
      job.hello = true;
      this.ctx.waitUntil(this.say(chatId, "⏳ решаю, задача непростая…"));
    }, HELLO / this.k);

    const { fast } = await this.options();
    let a;
    try {
      a = await ask(this.c, { messages: await this.toApi(turns), effort: job.effort, fast, until: end - SEGMENT_TAIL / this.k, stop, onChunk: deliver });
    } finally {
      clearTimeout(hello);
    }
    if (a.rest) await deliver(a.rest);
    if (held.length) await post(held.join("\n\n"));
    job.tokens += a.tokens.in + a.tokens.out;

    if (!job.msgs && !job.svgs.length) {
      // за всё задание ни текста, ни рисунка
      if (a.refused) return await this.finish(key, job, chatId, "Модель не стала это решать. Пересними задание.");
      if (a.cut && a.empty && job.effort !== "low") throw new Timeout("лимит токенов ушёл на размышления"); // повтор на ступень проще
      return await this.finish(key, job, chatId, a.cut ? "Задание слишком длинное. Сфоткай одно задание." : "Пустой ответ. Пришли фото ещё раз.");
    }
    if (job.sent.length || job.svgs.length > svgsBefore) await remember([...turns, { role: "assistant", content: job.sent.join("\n\n") || "[рисунок]" }]);
    job.sent = [];
    job.tries = 0;
    if (a.cut && job.step < this.c.autoMax) {
      job.step++;
      job.cont = true;
      return await save(); // следующий будильник продолжит со свежим запасом времени
    }
    if (a.cut) await this.say(chatId, CUT_NOTE);
    if (job.svgs.length) {
      job.phase = "draw";
      return await save();
    }
    await this.finish(key, job, chatId);
  }

  // ---------- рисунки: SVG от Claude -> PNG -> в чат ----------
  private async draw(key: string, job: Job, chatId: string, origin: string, save: () => Promise<void>) {
    let failed = 0;
    const total = Math.min(job.svgs.length, MAX_DRAWINGS);
    for (let i = job.drawn; i < total; i++) {
      job.drawn = i + 1; // если рисунок роняет рендер, при повторе идём к следующему
      await save();
      try {
        let png = await renderPng(job.svgs[i]);
        if (png.length > 1_900_000) png = await renderPng(job.svgs[i], 800);
        const id = crypto.randomUUID().replace(/-/g, "");
        await this.db.put(`img:${id}`, { at: Date.now(), png });
        await this.green.sendImage(chatId, png, `${origin}/?img=${this.ctx.id.toString()}${id}`);
        job.msgs++;
      } catch (e) {
        console.log("drawing:", this.hide(e));
        failed++;
      }
    }
    if (failed) await this.say(chatId, `(рисунков не получилось: ${failed})`);
    await this.finish(key, job, chatId);
    // старые рисунки удаляем
    const imgs = await this.db.list<{ at: number }>({ prefix: "img:" });
    const old = [...imgs].filter(([, v]) => Date.now() - v.at > IMG_TTL).map(([k]) => k);
    if (old.length) await this.db.delete(old);
  }

  async image(id: string): Promise<Response> {
    const v = await this.db.get<{ png: Uint8Array }>(`img:${id}`);
    if (!v) return new Response("no", { status: 404 });
    return new Response(v.png, { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } });
  }

  private async finish(key: string, job: Job, chatId: string, message?: string) {
    await this.db.delete(key);
    if (message) await this.say(chatId, message);
    const sec = Math.round((Date.now() - (job.started ?? job.at)) / 1000);
    await this.note(`${message ? "без ответа" : "решено"} за ${sec} с: сообщений ${job.msgs}, рисунков ${job.drawn}, режим ${job.effort}, токенов ${job.tokens}`);
  }

  // Сообщение, которое не должно ронять работу, если шлюз не ответил
  private async say(chatId: string, text: string) {
    await this.green.send(chatId, text).catch((e) => console.log(this.hide(e)));
  }

  // ---------- память чата ----------
  private async history(): Promise<Turn[]> {
    const h = await this.db.get<{ at: number; turns: Turn[] }>("hist");
    return h && Date.now() - h.at < HISTORY_TTL && Array.isArray(h.turns) ? h.turns : [];
  }

  private async saveHistory(turns: Turn[]) {
    let t = turns.slice(-HISTORY_MAX);
    while (t.length && t[0].role !== "user") t = t.slice(1);
    t = t.map((x) => (typeof x.content === "string" && x.content.length > TURN_MAX ? { ...x, content: x.content.slice(0, TURN_MAX) + "…" } : x));
    await this.db.put("hist", { at: Date.now(), turns: t });
  }

  // Фото храним только последнее: на него ссылаются «объясни шаг» и «реши №5 с прошлого фото»
  private async savePhoto(id: string, bytes: Uint8Array, type: PhotoMeta["type"]) {
    const old = await this.db.get<PhotoMeta>("photo");
    const n = Math.ceil(bytes.length / PHOTO_CHUNK);
    const parts: Record<string, unknown> = { photo: { id, type, n } satisfies PhotoMeta };
    for (let i = 0; i < n; i++) parts[`photo:${i}`] = bytes.slice(i * PHOTO_CHUNK, (i + 1) * PHOTO_CHUNK);
    await this.db.put(parts);
    if (old && old.n > n) await this.db.delete(Array.from({ length: old.n - n }, (_, i) => `photo:${n + i}`));
    this.photo = { id, type, data: base64(bytes) };
  }

  private async loadPhoto() {
    const p = await this.db.get<PhotoMeta>("photo");
    if (!p) return null;
    if (this.photo?.id === p.id) return this.photo;
    const parts = await this.db.get<Uint8Array>(Array.from({ length: p.n }, (_, i) => `photo:${i}`));
    const bytes = new Uint8Array([...parts.values()].reduce((s, b) => s + b.byteLength, 0));
    let at = 0;
    for (let i = 0; i < p.n; i++) {
      const b = parts.get(`photo:${i}`);
      if (!b) return null;
      bytes.set(new Uint8Array(b), at);
      at += b.byteLength;
    }
    return (this.photo = { id: p.id, type: p.type, data: base64(bytes) });
  }

  private async toApi(turns: Turn[]): Promise<Anthropic.Beta.BetaMessageParam[]> {
    const photo = await this.loadPhoto();
    return turns.map((t) => ({
      role: t.role,
      content: typeof t.content === "string" ? t.content : t.content.map((b): Anthropic.Beta.BetaContentBlockParam =>
        b.type === "text"
          ? b
          : photo && photo.id === b.id
          ? { type: "image", source: { type: "base64", media_type: photo.type, data: photo.data } }
          : { type: "text", text: "[фото задания]" }
      ),
    }));
  }

  // ---------- служебный объект: журнал и страница проверки ----------
  private async note(text: string) {
    try {
      await chatStub(this.env, STATUS).log(text);
    } catch (e) {
      console.log("note:", this.hide(e));
    }
  }

  async log(text: string): Promise<void> {
    const log = (await this.db.get<string[]>("log")) ?? [];
    await this.db.put("log", [...log, `${clock(Date.now())} ${text}`].slice(-LOG_MAX));
  }

  // Самопроверка: настоящий рендер рисунка внутри будильника, то есть там же, где работает бот.
  // Если тариф Cloudflare не даёт на это процессорного времени, это видно на странице проверки,
  // а вебхук остаётся на старом адресе.
  private async selfTest() {
    const t = await this.db.get<SelfTest>("selftest");
    if (t?.state !== "running") return;
    if (t.tries >= 1) return void (await this.db.put<SelfTest>("selftest", { ...t, state: "failed", at: Date.now() })); // прошлую попытку оборвали
    await this.db.put<SelfTest>("selftest", { ...t, tries: t.tries + 1 });
    try {
      let bytes = 0;
      for (let i = 0; i < 4; i++) bytes = (await renderPng(SAMPLE_SVG)).length;
      await this.db.put<SelfTest>("selftest", { state: bytes > 1000 ? "ok" : "failed", at: Date.now(), tries: 1 });
    } catch (e) {
      console.log("selftest:", this.hide(e));
      await this.db.put<SelfTest>("selftest", { state: "failed", at: Date.now(), tries: 1, error: this.hide(e).slice(0, 120) });
    }
  }

  async statusPage(origin: string): Promise<string> {
    if (this.page && Date.now() - this.page.at < 15_000 / this.k) return this.page.html;
    let test = await this.db.get<SelfTest>("selftest");
    const age = Date.now() - (test?.at ?? 0);
    if (test?.state === "running" && age > 60_000 / this.k) {
      test = { ...test, state: "failed", at: Date.now() }; // будильник так и не ответил
      await this.db.put("selftest", test);
    } else if (!test || (test.state === "ok" && age > 86_400_000) || (test.state === "failed" && age > 60_000 / this.k)) {
      test = { state: "running", at: Date.now(), tries: 0 };
      await this.db.put("selftest", test);
      await this.db.setAlarm(Date.now());
    }
    const html = await status(this.c, this.green, origin, (await this.db.get<string[]>("log")) ?? [], test);
    if (test.state !== "running") this.page = { at: Date.now(), html };
    return html;
  }
}
