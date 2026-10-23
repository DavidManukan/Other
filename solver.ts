// Solver: фото задания в WhatsApp -> Claude -> ответ обратно в WhatsApp.
// Val Town, HTTP val. Ключи сюда НЕ писать: они живут в Env vars.
import { blob } from "https://esm.town/v/std/blob/main.ts";

const env = (k: string, d = "") => (Deno.env.get(k) ?? d).trim();
const CLAUDE_KEY = env("ANTHROPIC_API_KEY");
const GREEN_URL = env("GREEN_URL").replace(/\/+$/, "").replace(/^(?!https?:\/\/)(?=.)/i, "https://");
const GREEN_ID = env("GREEN_ID").replace(/\D/g, "");
const GREEN_TOKEN = env("GREEN_TOKEN");
const MODEL = env("MODEL", "claude-sonnet-5-5");
const EFFORT = env("EFFORT", "medium");

// Секрет для вебхука: выводится из GREEN_TOKEN, но сам токен не раскрывает
const HOOK_KEY = GREEN_TOKEN
  ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("solver:" + GREEN_TOKEN)))]
    .slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("")
  : "";

// Вал публичный: ключи не должны попасть ни на страницу, ни в чат
const hide = (x: unknown) =>
  [GREEN_TOKEN, CLAUDE_KEY].filter((s) => s.length >= 8).reduce((t, s) => t.split(s).join("***"), String(x ?? ""));

const PROMPT = `Ты решаешь школьные задания (10 класс) по фото. Фото сделано камерой очков, поэтому оно может быть под углом, с бликами или мелким шрифтом. Внимательно прочитай условие и реши задание только школьными методами.

Ответ читают на маленьком экране очков. Пиши по-русски обычным текстом, как SMS. Не используй Markdown (звёздочки, решётки, таблицы) и LaTeX (знаки $, \\frac, \\sqrt). Формулы пиши обычными символами: x², x³, √, ·, /, ±, ≈, ≠, ≤, ≥, π, °, Δ. Индексы пиши так: v0, H2O.

Формат для каждого задания. Первая строка: номер задания, если он виден на фото. Дальше короткое решение из 2–6 шагов, каждый шаг с новой строки и начинается с «1)», «2)» и так далее. Одна мысль на строку, без вступлений и без пересказа условия. Последняя строка: «Ответ: ...» с единицами измерения. В тесте укажи номер или букву варианта.

Если заданий несколько, решай по порядку и разделяй их пустой строкой. Если заданий больше трёх, реши первые три и последней строкой напиши «Остальные пришли отдельным фото.». Если часть условия не читается, ничего не выдумывай: реши то, что видно, и последней строкой напиши «Не видно: ... Пересними ближе.». Если на фото нет задания, ответь одной строкой: «Не разобрал фото. Пересними ближе.». Если пришёл текстовый вопрос, ответь так же коротко. Учитывай прошлые сообщения этого чата: если просят объяснить шаг или решить другое задание с прошлого фото, продолжай с ним.

Если к заданию полезен рисунок (геометрия, график функции, схема по физике) или тебя просят нарисовать, в самом конце ответа добавь один рисунок в формате SVG: блок от <svg до </svg> с xmlns="http://www.w3.org/2000/svg" и viewBox="0 0 800 600", белый фон, чёрные линии толщиной 3, подписи font-size 28, оси и точки подписаны. Без рисунка, если он не нужен. Про сам рисунок в тексте не пиши.`;

// ---------- память чата (Val Town Blob) ----------
const HISTORY_TTL = 2 * 3600_000; // через 2 часа без сообщений чат начинается заново
const HISTORY_MAX = 12; // последние 6 вопросов и ответов
const histKey = (chatId: string) => `solver_hist_${chatId.replace(/\W/g, "_")}`;

async function loadHistory(chatId: string): Promise<any[]> {
  try {
    const h: any = await blob.getJSON(histKey(chatId));
    return h && Date.now() - h.at < HISTORY_TTL && Array.isArray(h.turns) ? h.turns : [];
  } catch (e) {
    console.log("history load:", e);
    return [];
  }
}

async function saveHistory(chatId: string, turns: any[]) {
  // фото храним только последнее, старые заменяем пометкой
  let seenImage = false;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (!Array.isArray(turns[i].content)) continue;
    turns[i] = {
      ...turns[i],
      content: turns[i].content.map((b: any) => {
        if (b.type !== "image") return b;
        if (!seenImage) return (seenImage = true, b);
        return { type: "text", text: "[фото задания]" };
      }),
    };
  }
  let t = turns.slice(-HISTORY_MAX);
  while (t.length && t[0].role !== "user") t = t.slice(1);
  try {
    await blob.setJSON(histKey(chatId), { at: Date.now(), turns: t });
  } catch (e) {
    console.log("history save:", e);
  }
}

// ---------- рисунки: SVG от Claude -> PNG ----------
let renderer: Promise<(svg: string) => Uint8Array> | null = null;
function getRenderer() {
  renderer ??= (async () => {
    const { initWasm, Resvg } = await import("npm:@resvg/resvg-wasm@2.6.2");
    const [, font] = await Promise.all([
      initWasm(fetch("https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm")),
      fetch("https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf").then((r) => r.arrayBuffer()),
    ]);
    const fontBuffers = [new Uint8Array(font)];
    return (svg: string) =>
      new Resvg(svg, {
        font: { fontBuffers, defaultFontFamily: "DejaVu Sans" },
        fitTo: { mode: "width", value: 1200 },
        background: "white",
      }).render().asPng();
  })();
  renderer.catch(() => (renderer = null));
  return renderer;
}

// Рисунок кладём в Blob и отдаём по ссылке /?img=..., GREEN-API забирает его сам
async function sendDrawing(chatId: string, svg: string, origin: string, ms: number) {
  try {
    const png = (await getRenderer())(svg);
    const id = crypto.randomUUID().replace(/-/g, "");
    await blob.set(`solver_img_${id}`, new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }));
    await green("sendFileByUrl", { chatId, urlFile: `${origin}/?img=${id}`, fileName: "risunok.png" }, ms);
    // старые рисунки (старше суток) удаляем
    const old = (await blob.list("solver_img_")).filter((b) => Date.now() - Date.parse(b.lastModified) > 86_400_000);
    await Promise.all(old.map((b) => blob.delete(b.key)));
  } catch (e) {
    console.log("drawing:", hide(e));
    await send(chatId, "(рисунок не получился)", 3_000).catch(() => {});
  }
}

// ---------- GREEN-API (WhatsApp бота) ----------
async function green(method: string, body?: unknown, ms = 10_000): Promise<any> {
  if (!/^https:\/\//.test(GREEN_URL)) throw new Error("GREEN_URL должен начинаться с https://");
  let r: Response;
  try {
    r = await fetch(`${GREEN_URL}/waInstance${GREEN_ID}/${method}/${GREEN_TOKEN}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
  } catch (e: any) {
    if (e?.name === "TimeoutError") throw e;
    throw new Error(`GREEN-API ${method}: нет связи`); // текст ошибки fetch содержит токен, его не показываем
  }
  const t = await r.text();
  if (!r.ok) throw new Error(`GREEN-API ${method}: ${r.status} ${hide(t).slice(0, 150)}`);
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

const send = (chatId: string, message: string, ms = 10_000) =>
  green("sendMessage", {
    chatId,
    message: message.length > 19_000 ? message.slice(0, 19_000) + "\n(обрезано)" : message,
    linkPreview: false,
  }, ms);

// Сколько мс осталось до срока (не меньше min)
const left = (until: number, min = 1_000) => Math.max(min, until - Date.now());

async function getPhoto(chatId: string, idMessage: string, url: string | undefined, until: number): Promise<Uint8Array> {
  const load = async (u: string) => {
    const r = await fetch(u, { signal: AbortSignal.timeout(Math.min(10_000, left(until))) });
    if (!r.ok) throw new Error(`фото не скачалось: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  };
  if (url) {
    try {
      return await load(url);
    } catch (e) {
      console.log("downloadUrl не сработал, пробую downloadFile:", hide(e));
    }
  }
  const j = await green("downloadFile", { chatId, idMessage }, Math.min(10_000, left(until)));
  if (!j?.downloadUrl) throw new Error("GREEN-API не дал ссылку на фото");
  return await load(j.downloadUrl);
}

function imageType(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

function base64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- Claude ----------
function claudeError(status: number, msg: string, retryAfter: string | null = "1"): string {
  if (status === 401) return "Неверный ключ Claude. Проверь ANTHROPIC_API_KEY.";
  if (status === 404) return `Нет модели ${MODEL}. Исправь MODEL.`;
  if (status === 402 || /credit|balance/i.test(msg)) return "На балансе Claude кончились деньги (platform.claude.com → Billing).";
  if (status === 429 && !retryAfter) return "Claude: достигнут месячный лимит трат (platform.claude.com → Limits).";
  if (status === 429 || status >= 500) return "Claude занят. Пришли ещё раз через минуту.";
  return `Ошибка Claude ${status}: ${msg.slice(0, 120)}`;
}

async function askClaude(messages: unknown[], until: number, effort = EFFORT): Promise<string> {
  const body: any = { model: MODEL, max_tokens: 8000, system: PROMPT, messages };
  if (effort) body.output_config = { effort };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(left(until, 3_000)),
  });
  const raw = await r.text(); // если время вышло, тут вылетит TimeoutError
  let j: any = {};
  try {
    j = JSON.parse(raw);
  } catch { /* не JSON */ }
  if (!r.ok) {
    const msg = String(j?.error?.message ?? "");
    if (r.status === 400 && effort && /output_config|effort/i.test(msg)) return askClaude(messages, until, ""); // модель не знает effort
    throw new Error(claudeError(r.status, msg, r.headers.get("retry-after")));
  }
  if (j.stop_reason === "refusal") return "Модель не стала это решать. Пересними задание.";
  const text = (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
  if (!text) {
    return j.stop_reason === "max_tokens" ? "Задание слишком длинное. Сфоткай одно задание." : "Пустой ответ. Пришли фото ещё раз.";
  }
  return j.stop_reason === "max_tokens" ? `${text}\n(ответ обрезан)` : text;
}

// ---------- сообщение из WhatsApp ----------
const NUDGE = new Set(["videoMessage", "audioMessage", "documentMessage", "stickerMessage", "locationMessage", "contactMessage"]);

// Вопрос + память чата -> Claude -> текст и (если есть) рисунок
async function solve(chatId: string, content: unknown[], origin: string, end: number) {
  const history = await loadHistory(chatId);
  const turns = [...history, { role: "user", content }];
  const answer = await askClaude(turns, end - 9_000);
  const svg = answer.match(/<svg[\s\S]*?<\/svg>/i)?.[0];
  const text = answer.replace(/```(?:svg|xml|html)?\s*<svg[\s\S]*?<\/svg>\s*```/gi, "").replace(/<svg[\s\S]*?<\/svg>/gi, "").trim();
  await send(chatId, text || "Рисунок ниже 👇", left(end, 2_000));
  if (svg) await sendDrawing(chatId, svg, origin, left(end, 2_000));
  await saveHistory(chatId, [...turns, { role: "assistant", content: text || "[рисунок]" }]);
}

async function handle(h: any, t0: number, origin: string) {
  if (h?.typeWebhook === "quotaExceeded") return console.log("GREEN-API: лимит чатов тарифа исчерпан", JSON.stringify(h));
  if (h?.typeWebhook !== "incomingMessageReceived") return;
  const chatId = String(h.senderData?.chatId ?? "");
  if (!/@(c\.us|lid)$/.test(chatId)) return; // группы, статусы и каналы пропускаем
  const end = t0 + 57_000; // Val Town Free обрывает запрос на 60 с
  const md = h.messageData ?? {};
  const type = String(md.typeMessage ?? "");
  const fd = md.fileMessageData ?? {};
  try {
    if (type === "imageMessage" || (type === "documentMessage" && /^image\//.test(String(fd.mimeType ?? "")))) {
      const bytes = await getPhoto(chatId, String(h.idMessage ?? ""), fd.downloadUrl, t0 + 20_000);
      const media_type = imageType(bytes);
      if (!media_type) return await send(chatId, "Не понял формат фото. Пришли обычное фото.");
      const caption = String(fd.caption ?? "").trim();
      await solve(chatId, [
        { type: "image", source: { type: "base64", media_type, data: base64(bytes) } },
        { type: "text", text: caption ? `Реши задания на фото. Подпись: ${caption}` : "Реши задания на фото." },
      ], origin, end);
    } else if (type === "textMessage" || type === "extendedTextMessage" || type === "quotedMessage") {
      const text = String(md.textMessageData?.textMessage ?? md.extendedTextMessageData?.text ?? "").trim();
      if (!text) return;
      if (/^(ping|пинг)$/i.test(text)) return await send(chatId, `pong ✅ модель ${MODEL}`);
      if (/^(сброс|новое|reset)$/i.test(text)) {
        await saveHistory(chatId, []);
        return await send(chatId, "Память чата очищена ✅");
      }
      await solve(chatId, [{ type: "text", text }], origin, end);
    } else if (NUDGE.has(type)) {
      await send(chatId, "Пришли фото задания.");
    } // реакции, правки, удаления: молча пропускаем
  } catch (e: any) {
    console.log(hide(e?.stack ?? e));
    const why = e?.name === "TimeoutError" ? "Не успел решить. Пришли фото ещё раз (лучше одно задание)." : String(e?.message ?? e);
    await send(chatId, `⚠️ ${hide(why)}`, left(end, 2_000)).catch((e2) => console.log(hide(e2)));
  }
}

// ---------- страница настройки: открой ссылку вала в Safari ----------
const STATE_HINT: Record<string, string> = {
  starting: "Запускается. Подожди 5 минут и обнови страницу.",
  sleepMode: "Телефон офлайн. Открой WhatsApp Business и подожди 5 минут.",
  notAuthorized: "Привяжи номер заново: «Связать по номеру телефона» в console.green-api.com.",
  blocked: "Номер бота заблокирован WhatsApp.",
  suspended: "WhatsApp временно ограничил номер бота.",
};

async function setupPage(url: URL): Promise<Response> {
  const hook = `${url.origin}/?k=${HOOK_KEY}`;
  const rows: string[] = [];
  const miss = ["ANTHROPIC_API_KEY", "GREEN_URL", "GREEN_ID", "GREEN_TOKEN"].filter((k) => !env(k));
  if (miss.length) {
    rows.push(`❌ Не заполнено: ${miss.join(", ")}`);
  } else {
    try {
      const s = String((await green("getStateInstance"))?.stateInstance);
      rows.push(s === "authorized" ? "✅ WhatsApp бота подключён" : `❌ WhatsApp бота не подключён (${s}). ${STATE_HINT[s] ?? "Привяжи номер заново."}`);
    } catch (e: any) {
      rows.push(`❌ ${e.message}. Проверь GREEN_URL, GREEN_ID, GREEN_TOKEN.`);
    }
    try {
      const s = await green("getSettings");
      const cur = String(s?.webhookUrl ?? "");
      if (/^https:\/\/[^/]+\.val\.run\/\?k=/.test(cur) && cur.endsWith(`?k=${HOOK_KEY}`) && s?.incomingWebhook === "yes") {
        rows.push("✅ Вебхук настроен");
      } else {
        await green("setSettings", {
          webhookUrl: hook,
          webhookUrlToken: HOOK_KEY,
          incomingWebhook: "yes",
          outgoingWebhook: "no",
          outgoingMessageWebhook: "no",
          outgoingAPIMessageWebhook: "no",
          stateWebhook: "no",
          incomingCallWebhook: "no",
          editedMessageWebhook: "no",
          deletedMessageWebhook: "no",
          pollMessageWebhook: "no",
        });
        rows.push("⏳ Вебхук только что настроен. Подожди 5 минут и обнови страницу.");
      }
    } catch (e: any) {
      rows.push(`❌ Не смог настроить вебхук: ${e.message}`);
    }
    const r = await fetch(`https://api.anthropic.com/v1/models/${MODEL}`, {
      headers: { "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const mj: any = r ? await r.json().catch(() => ({})) : {};
    if (!r) rows.push("❌ Claude не отвечает");
    else if (!r.ok) rows.push(`❌ ${claudeError(r.status, String(mj?.error?.message ?? ""), r.headers.get("retry-after"))}`);
    else if (mj?.lifecycle === "retired") rows.push(`❌ Модель ${MODEL} больше не работает. Исправь MODEL.`);
    else rows.push(`✅ Ключ Claude принят, модель ${MODEL}. Баланс смотри на platform.claude.com`);
  }
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Solver</title><body style="font:18px/1.5 -apple-system,sans-serif;margin:16px">
<h2>Solver: проверка</h2>${rows.map((r) => `<p>${hide(r).replace(/</g, "&lt;")}</p>`).join("")}
<p><a href="?">Проверить ещё раз</a></p></body>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// ---------- вход ----------
export default async function (req: Request): Promise<Response> {
  const t0 = Date.now();
  const url = new URL(req.url);
  const img = url.searchParams.get("img");
  if (req.method === "GET" && img) {
    if (!/^[0-9a-f]{32}$/.test(img)) return new Response("no", { status: 404 });
    try {
      const r = await blob.get(`solver_img_${img}`);
      return new Response(r.body, { headers: { "content-type": "image/png" } });
    } catch {
      return new Response("no", { status: 404 });
    }
  }
  if (req.method === "GET") return await setupPage(url);
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!HOOK_KEY || (url.searchParams.get("k") !== HOOK_KEY && bearer !== HOOK_KEY)) return new Response("no");
  const h = await req.json().catch(() => null);
  await handle(h, t0, url.origin);
  return new Response("ok"); // всегда 200, иначе GREEN-API пришлёт то же сообщение ещё раз
}
