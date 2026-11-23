// Один объект на чат: очередь заданий, память разговора и рисунки.
// Вебхук только кладёт задание в очередь и сразу отвечает шлюзу. Решает будильник объекта:
// у него до 15 минут на кусок работы, а длинный ответ продолжается следующим будильником.
import { DurableObject } from "cloudflare:workers";
import type Anthropic from "@anthropic-ai/sdk";
import { type Cfg, type Effort, type Env, chatStub, config, hider, hookKey, isEffort, lower } from "./config.ts";
import { ask, Busy, Fatal, Stopped, Timeout } from "./claude.ts";
import { Green, permanent, TooBig } from "./green.ts";
import { renderPng } from "./render.ts";
import { type SelfTest, SAMPLE_SVG, status } from "./status.ts";
import { splitAnswer } from "./text.ts";
import { base64, clock, imageType } from "./util.ts";

const SEGMENT = 13 * 60_000; // столько работает один кусок (потолок будильника 15 минут)
const SEGMENT_TAIL = 45_000; // запас в конце куска на отправку и сохранение
const BEAT = 60_000; // пульс: пока кусок работает, раз в минуту отодвигаем сторожевой будильник
const WATCHDOG = 150_000; // пульс пропал (площадка перезапустила объект): через столько будильник поднимет задание снова
const HELLO = 120_000; // столько молчим, прежде чем написать «решаю»
const BACKOFF = [15_000, 45_000, 120_000]; // паузы перед повтором, когда Claude занят
const GATEWAY_WAIT = [20_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000]; // ждём шлюз около часа, Claude при этом не трогаем
const HISTORY_TTL = 2 * 3600_000; // через 2 часа без сообщений чат начинается заново
const HISTORY_MAX = 12; // последние 6 вопросов и ответов
const TURN_MAX = 50_000; // длиннее в памяти не храним
const MAX_TRIES = 4; // попыток на один кусок
const MAX_DRAWINGS = 8;
const MAX_SENDS = 35; // сообщений за один запуск (у бесплатного тарифа Cloudflare 50 внешних запросов на запуск)
const MAX_QUEUE = 10; // заданий в очереди одного чата
const PHOTO_CHUNK = 1_000_000; // значение в хранилище ограничено по размеру, фото режем на части
const PHOTO_MAX = 5_000_000; // больше не берём: такое фото не нужно и бьёт по памяти
const IMG_TTL = 86_400_000; // рисунки храним сутки
const LOG_MAX = 12;
const CUT_NOTE = "(ответ слишком длинный: пришли фото по частям)";
export const STATUS = "__status"; // имя служебного объекта: журнал, страница проверки, хозяин бота

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
// Чем закончился запрос к Claude в этом куске (нужно, если ответ готов, а доставить его сразу не вышло)
interface Outcome {
  cut: boolean;
  refused: boolean;
  empty: boolean;
  drew: boolean; // в этом куске появились новые рисунки
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
  outbox: string[]; // готовые ответы, которые ещё не ушли: шлюз не принял или кончился запас запросов на запуск
  done?: Outcome; // Claude на этот кусок уже ответил, осталось доставить outbox
  down: number; // сколько раз подряд шлюз не принял сообщение
  svgs: string[]; // рисунки ждут своей очереди: сначала все ответы, потом картинки
  drawn: number; // сколько рисунков уже отправлено
  drawing?: { i: number; tries: number }; // какой рисунок сейчас в работе и какая это попытка
  after?: number; // не раньше этого времени (пауза перед повтором)
  hello?: boolean; // «⏳ решаю» уже отправляли
  started?: number;
  msgs: number;
  tokens: number;
}

class Delivery extends Error {} // ответ готов, но шлюз его сейчас не принимает: Claude не переспрашиваем, ждём шлюз

export class Chat extends DurableObject<Env> {
  private c: Cfg;
  private green: Green;
  private hide: (x: unknown) => string;
  private running = false;
  private stop: AbortController | null = null;
  private photo: { id: string; type: PhotoMeta["type"]; data: string } | null = null;
  private page = new Map<boolean, { at: number; html: string }>();
  private epoch = 0; // растёт на «сброс»: решение, начатое до сброса, память уже не трогает
  private owner: boolean | undefined; // этот чат принадлежит хозяину бота
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
    if (!chatId) return;
    const seen = (await this.db.get<string[]>("seen")) ?? [];
    if (id && seen.includes(id)) return; // шлюз иногда присылает одно сообщение дважды
    // Отметка «уже видели» пишется одной записью вместе с заданием: если объект упадёт на полпути,
    // шлюз пришлёт сообщение снова и оно не потеряется.
    const meta: Meta = { chatId, origin };
    await this.isOwner(chatId).catch(() => false); // первый чат, который написал боту, становится хозяином
    const mark: Record<string, unknown> = { seen: id ? [...seen, id].slice(-200) : seen, meta };
    const md = h.messageData ?? {};
    const type = String(md.typeMessage ?? "");
    const fd = md.fileMessageData ?? {};
    try {
      if (type === "imageMessage" || (type === "documentMessage" && /^image\//.test(String(fd.mimeType ?? "")))) {
        const caption = String(fd.caption ?? "").trim();
        return await this.enqueue({ kind: "image", id, url: fd.downloadUrl ? String(fd.downloadUrl) : undefined, caption }, mark);
      }
      if (type === "textMessage" || type === "extendedTextMessage" || type === "quotedMessage") {
        const text = String(md.textMessageData?.textMessage ?? md.extendedTextMessageData?.text ?? "").trim();
        if (text && !(await this.command(meta, text))) return await this.enqueue({ kind: "text", id, text }, mark);
      } else if (NUDGE.has(type)) {
        await this.green.send(chatId, "Пришли фото задания.");
      } // реакции, правки, удаления: молча пропускаем
      await this.markSeen(id, meta);
    } catch (e: any) {
      console.log(this.hide(e?.stack ?? e));
      await this.markSeen(id, meta);
      await this.say(chatId, `⚠️ ${this.hide(e?.message ?? e)}`);
    }
  }

  // Команда отвечает в чат, и за это время могло прийти другое сообщение: список читаем заново, чтобы не затереть его отметку
  private async markSeen(id: string, meta: Meta) {
    const seen = (await this.db.get<string[]>("seen")) ?? [];
    await this.db.put({ seen: id ? [...seen.filter((x) => x !== id), id].slice(-200) : seen, meta });
  }

  private async options(): Promise<{ effort: Effort; fast: boolean }> {
    const o = (await this.db.get<Opts>("opts")) ?? {};
    return { effort: o.effort ?? this.c.effort, fast: o.fast ?? this.c.fast };
  }

  // Режим (а значит и расходы) меняет только хозяин: чаты из OWNER, а без неё первый чат, который написал боту
  private async isOwner(chatId: string): Promise<boolean> {
    if (this.c.owners.length) return this.c.owners.some((o) => o === chatId || o.replace(/\D/g, "") === chatId.replace(/\D/g, ""));
    return (this.owner ??= await chatStub(this.env, STATUS).claim(chatId));
  }

  async claim(chatId: string): Promise<boolean> {
    const owner = await this.db.get<string>("owner");
    if (!owner) await this.db.put("owner", chatId);
    return !owner || owner === chatId;
  }

  // Команды из чата. true = сообщение было командой, решать его не нужно
  private async command({ chatId, origin }: Meta, text: string): Promise<boolean> {
    const t = text.toLowerCase().replace(/[.!]+$/, "").trim();
    if (/^(ping|пинг)$/.test(t)) {
      const o = await this.options();
      const queue = (await this.db.list({ prefix: "job:" })).size;
      const mine = await this.isOwner(chatId);
      await this.green.send(
        chatId,
        `pong ✅ модель ${this.c.model}, думает: ${o.effort}, fast ${o.fast ? "вкл" : "выкл"}${queue ? `, в работе: ${queue}` : ""}\n` +
          (mine
            ? `Команды: быстро / средне / умно / макс, fast вкл / fast выкл, стоп, сброс\nЖурнал: ${origin}/?k=${await hookKey(this.c)}`
            : "Команды: стоп, сброс"),
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
    const f = t.match(/^fast\s+(вкл|выкл|on|off)$/);
    if (effort === undefined && !f) return false;
    if (!(await this.isOwner(chatId))) {
      await this.green.send(chatId, `Режим меняет только хозяин бота. Если это ты, добавь в Cloudflare переменную OWNER со значением ${chatId}`);
      return true;
    }
    if (f) {
      const fast = f[1] === "вкл" || f[1] === "on";
      await this.db.put<Opts>("opts", { ...((await this.db.get<Opts>("opts")) ?? {}), fast });
      await this.green.send(chatId, `Fast ${fast ? "включён ✅ (ответ пишется быстрее, токены вдвое дороже)" : "выключен ✅"}`);
      return true;
    }
    if (!isEffort(effort)) {
      await this.green.send(chatId, "Не понял режим. Есть: быстро, средне, умно, макс.");
      return true;
    }
    await this.db.put<Opts>("opts", { ...((await this.db.get<Opts>("opts")) ?? {}), effort });
    await this.green.send(chatId, `Режим: ${effort} ✅${effort === "low" ? " (быстрее и дешевле)" : effort === "xhigh" || effort === "max" ? " (дольше и дороже)" : ""}`);
    return true;
  }

  private async forget() {
    const p = await this.db.get<PhotoMeta>("photo");
    await this.db.delete(["hist", "photo", ...Array.from({ length: p?.n ?? 0 }, (_, i) => `photo:${i}`)]);
    this.photo = null;
    this.epoch++;
  }

  private async enqueue(j: Pick<Job, "kind" | "id" | "url" | "caption" | "text">, mark: Record<string, unknown>) {
    if ((await this.db.list({ prefix: "job:", limit: MAX_QUEUE })).size >= MAX_QUEUE) throw new Error("Слишком много заданий в очереди. Подожди ответов или напиши «стоп».");
    const seq = ((await this.db.get<number>("seq")) ?? 0) + 1;
    const { effort } = await this.options();
    const job: Job = { ...j, at: Date.now(), phase: "solve", step: 0, tries: 0, effort, cont: false, sent: [], outbox: [], down: 0, svgs: [], drawn: 0, msgs: 0, tokens: 0 };
    await this.db.put({ ...mark, seq, [`job:${String(seq).padStart(9, "0")}`]: job });
    await this.db.setAlarm(Date.now());
  }

  // ---------- будильник: один кусок работы ----------
  async alarm(): Promise<void> {
    if (this.running) {
      // площадка обещает не запускать два будильника сразу; это страховка на случай, если всё же запустит
      await this.db.setAlarm(Date.now() + WATCHDOG / this.k);
      return;
    }
    this.running = true;
    let beat: ReturnType<typeof setInterval> | undefined;
    try {
      const first = await this.db.list<Job>({ prefix: "job:", limit: 1 });
      const [key, job] = [...first][0] ?? [];
      if (!key || !job) return await this.selfTest();
      if (job.after && job.after > Date.now()) return; // пауза перед повтором ещё не прошла
      const watch = () => this.db.setAlarm(Date.now() + WATCHDOG / this.k).catch((e) => console.log("watchdog:", String(e)));
      await watch();
      beat = setInterval(watch, BEAT / this.k);
      await this.run(key, job);
    } catch (e: any) {
      console.log("alarm:", this.hide(e?.stack ?? e));
    } finally {
      clearInterval(beat);
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
    job.outbox ??= [];
    job.down ??= 0;
    job.started ??= Date.now();
    delete job.after;
    if (job.tries >= MAX_TRIES) {
      // столько раз объект падал прямо во время работы над этим куском
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
      if (e instanceof Delivery) {
        // Ответ готов и лежит в задании. Это не неудачная попытка решения: ждём, пока шлюз оживёт.
        if (job.phase === "draw") job.tries = Math.max(0, job.tries - 1);
        job.down++;
        if (job.down <= GATEWAY_WAIT.length) {
          job.after = Date.now() + GATEWAY_WAIT[job.down - 1] / this.k;
          await this.db.put(key, job);
          if (job.down === 1) await this.note(`шлюз не принял сообщение, жду и пробую снова: ${this.hide(e.message).slice(0, 120)}`);
          return;
        }
        await this.db.delete(key);
        await this.note("шлюз не принимал сообщения около часа: ответ не доставлен");
        return void (await this.say(chatId, "⚠️ Не смог отправить ответ. Пришли фото ещё раз."));
      }
      const retry = job.tries < MAX_TRIES;
      if (e instanceof Timeout && retry) {
        // модель думала весь кусок и ничего не написала: следующая попытка на ступень проще
        job.effort = lower(job.effort);
        await this.db.put(key, job);
        await this.say(chatId, "⏳ долго думаю, решаю быстрее…");
      } else if (e instanceof Busy && retry) {
        job.after = Date.now() + (BACKOFF[job.tries - 1] ?? BACKOFF[0]) / this.k;
        await this.db.put(key, job);
        if (job.tries === 1) await this.say(chatId, "⏳ Claude занят, пробую ещё раз…");
      } else {
        await this.db.delete(key);
        const why = e instanceof Timeout
          ? "Не успел решить. Пришли фото ещё раз (лучше одно задание)."
          : e instanceof Busy
          ? "Claude занят. Пришли ещё раз через минуту."
          : e instanceof TooBig
          ? "Фото слишком большое. Пришли обычное фото."
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
        const bytes = await this.green.photo(chatId, job.id, job.url, Date.now() + 40_000, PHOTO_MAX);
        const type = imageType(bytes);
        if (!type) {
          await this.db.delete(key);
          return void (await this.say(chatId, "Не понял формат фото. Пришли обычное фото."));
        }
        await this.savePhoto(job.id, bytes, type);
      }
      content = [{ type: "photo", id: job.id }, { type: "text", text: job.caption ? `Реши задания на фото. Подпись: ${job.caption}` : "Реши задания на фото." }];
    } else content = [{ type: "text", text: job.text ?? "" }];

    const epoch = this.epoch;
    const remember = async (t: Turn[]) => {
      if (epoch === this.epoch) await this.saveHistory(t);
    };

    // Одно сообщение в чат. Шлюз отказал по существу (квота, доступ): повторять и переспрашивать Claude бесполезно.
    let sends = 0;
    const post = async (text: string) => {
      try {
        await this.green.send(chatId, text);
      } catch (e: any) {
        const why = String(e?.message ?? e);
        throw permanent(e) ? new Fatal(why) : new Delivery(why);
      }
      sends++;
      job.sent.push(text);
      job.msgs++;
      job.down = 0;
    };

    // 1. Сначала досылаем то, что было готово, но не ушло
    while (job.outbox.length) {
      if (sends >= MAX_SENDS) return await save(); // запас запросов на этот запуск вышел: остальное в следующем
      await post(job.outbox[0]);
      job.outbox.shift();
      await save();
    }

    let turns = await this.history();
    let a = job.done;
    if (a) {
      turns = [...turns, { role: "user", content }]; // Claude на этот кусок уже ответил, осталось подвести итог
    } else {
      // память сбросили посреди длинного ответа: продолжать нечего
      if (job.cont && !turns.length) return await this.finish(key, job, chatId);
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

      // 2. Спрашиваем Claude. Каждое готовое задание сразу уходит в чат. Если шлюз не принял сообщение,
      // ответ не выбрасываем: дописываем его в задание и доставим, когда шлюз оживёт.
      const svgsBefore = job.svgs.length;
      let gatewayDown = "";
      const deliver = async (raw: string) => {
        const { text, svgs } = splitAnswer(raw);
        for (const svg of svgs) if (!job.svgs.includes(svg)) job.svgs.push(svg);
        if (!text) return;
        if (!gatewayDown && !job.outbox.length && sends < MAX_SENDS) {
          try {
            await post(text);
            return await save();
          } catch (e: any) {
            if (!(e instanceof Delivery)) throw e;
            gatewayDown = e.message;
            console.log("шлюз не принял сообщение, коплю ответ:", this.hide(e.message));
          }
        }
        job.outbox.push(text);
        await save();
      };

      // долгое молчание похоже на поломку: один раз даём знать, что бот жив
      const hello = job.hello || job.cont ? undefined : setTimeout(() => {
        if (job.msgs || job.outbox.length || stop.aborted) return;
        job.hello = true;
        this.ctx.waitUntil(this.say(chatId, "⏳ решаю, задача непростая…"));
      }, HELLO / this.k);

      const { fast } = await this.options();
      job.tries++; // попытка засчитывается до запроса: если объект упадёт посреди него, счётчик это запомнит
      await save();
      let answer;
      try {
        answer = await ask(this.c, { messages: await this.toApi(turns), effort: job.effort, fast, until: end - SEGMENT_TAIL / this.k, stop, onChunk: deliver });
      } finally {
        clearTimeout(hello);
      }
      // если модель остановил защитный фильтр, недописанный хвост не отправляем: он оборван на полуслове
      if (answer.rest && !answer.refused) await deliver(answer.rest);
      job.tokens += answer.tokens.in + answer.tokens.out;
      a = { cut: answer.cut, refused: answer.refused, empty: answer.empty, drew: job.svgs.length > svgsBefore };
      if (job.outbox.length) {
        job.done = a;
        await save();
        if (gatewayDown) throw new Delivery(gatewayDown);
        return; // сообщений больше, чем можно отправить за один запуск: следующий будильник дошлёт
      }
    }

    // 3. Итог куска
    delete job.done;
    if (!job.msgs && !job.svgs.length) {
      // за всё задание ни текста, ни рисунка
      if (a.refused) return await this.finish(key, job, chatId, "Модель не стала это решать. Пересними задание.");
      if (a.cut && a.empty && job.effort !== "low") throw new Timeout("лимит токенов ушёл на размышления"); // повтор на ступень проще
      return await this.finish(key, job, chatId, a.cut ? "Задание слишком длинное. Сфоткай одно задание." : "Пустой ответ. Пришли фото ещё раз.");
    }
    if (job.sent.length || a.drew) {
      // рисунки в память не кладём, только пометку: иначе после «дальше» модель нарисует их заново
      const drawn = a.cut && job.svgs.length ? `\n\n[рисунков уже готово: ${job.svgs.length}, повторять их не нужно]` : "";
      await remember([...turns, { role: "assistant", content: (job.sent.join("\n\n") || "[рисунок]") + drawn }]);
    }
    if (a.refused) await this.say(chatId, "(модель остановилась и не дорешала. Пересними оставшиеся задания.)");
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
    job.tries++;
    const total = Math.min(job.svgs.length, MAX_DRAWINGS);
    for (let i = job.drawn; i < total; i++) {
      // если объект упал прямо на этом рисунке, даём ему ещё одну попытку и идём дальше
      const tries = job.drawing?.i === i ? job.drawing.tries + 1 : 1;
      job.drawing = { i, tries };
      await save();
      try {
        if (tries > 2) throw new Error("рисунок дважды уронил рендер");
        let png = await renderPng(job.svgs[i]);
        if (png.length > 1_900_000) png = await renderPng(job.svgs[i], 800);
        // в начале id стоит время: старые рисунки потом находятся по ключу, без чтения самих картинок
        const id = Date.now().toString(16).padStart(12, "0") + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
        await this.db.put(`img:${id}`, png);
        try {
          await this.green.sendImage(chatId, png, `${origin}/?img=${this.ctx.id.toString()}${id}`);
        } catch (e: any) {
          if (permanent(e)) throw e;
          delete job.drawing; // шлюз не принимает: это не вина рисунка, подождём и пришлём его же
          await save();
          throw new Delivery(String(e?.message ?? e));
        }
        job.msgs++;
        job.down = 0;
      } catch (e) {
        if (e instanceof Delivery || e instanceof Stopped) throw e;
        console.log("drawing:", this.hide(e));
        failed++;
      }
      job.drawn = i + 1;
      await save();
    }
    if (failed) await this.say(chatId, `(рисунков не получилось: ${failed})`);
    await this.finish(key, job, chatId);
    await this.sweep();
  }

  // Старые рисунки удаляем понемногу: ключи идут по времени, читаем только просроченные
  private async sweep() {
    try {
      const cutoff = (Date.now() - IMG_TTL).toString(16).padStart(12, "0");
      const old = await this.db.list({ prefix: "img:", end: `img:${cutoff}`, limit: 16 });
      if (old.size) await this.db.delete([...old.keys()]);
    } catch (e) {
      console.log("sweep:", this.hide(e));
    }
  }

  async image(id: string): Promise<Response> {
    const png = await this.db.get<Uint8Array>(`img:${id}`);
    if (!png) return new Response("no", { status: 404 });
    return new Response(png, { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } });
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

  // priv: страницу открыли по личной ссылке из ответа на «ping», можно показать журнал событий
  async statusPage(origin: string, priv: boolean): Promise<string> {
    const cached = this.page.get(priv);
    if (cached && Date.now() - cached.at < 15_000 / this.k) return cached.html;
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
    const html = await status(this.c, this.green, origin, priv ? ((await this.db.get<string[]>("log")) ?? []) : null, test);
    if (test.state !== "running") this.page.set(priv, { at: Date.now(), html });
    return html;
  }
}
