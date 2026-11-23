// Имитация GREEN-API и Claude для локальной проверки. В настоящие сервисы ничего не уходит.
import http from "node:http";

export const calls = []; // всё, что бот отправил «в WhatsApp»
export const claude = []; // тела запросов к «Claude»
export const settings = { webhookUrl: "", incomingWebhook: "no" };
export const flags = { uploadBroken: false, sendDown: "", send466: "" }; // тест может «сломать» шлюз: загрузку файлов или отправку в чат
// Большое фото (2,5 МБ): проверяем, что оно без потерь переживает хранение по частям
export const BIG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(Uint8Array.from({ length: 2_500_000 }, (_, i) => (i * 31 + (i >> 8)) & 255))]);
const counters = new Map();
const hit = (k) => (counters.set(k, (counters.get(k) ?? 0) + 1), counters.get(k));

// Маленький настоящий JPEG 1x1
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
  "base64",
);

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><rect width="800" height="520" fill="white"/><text x="40" y="50" fill="black" font-size="34">№1</text><line x1="100" y1="400" x2="700" y2="400" stroke="black" stroke-width="2"/><line x1="100" y1="400" x2="400" y2="120" stroke="#D5643C" stroke-width="4"/><circle cx="100" cy="400" r="7" fill="#fff"/><text x="60" y="440" fill="#fff" font-size="32">A1</text><text x="410" y="110" fill="#fff" font-size="32">B</text><text x="300" y="480" fill="#D9D9D0" font-size="28">2-метилбутан, CH3, x^2</text></svg>`;

function sse(res, events, { gap = 5 } = {}) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  let i = 0;
  const next = () => {
    if (res.destroyed) return;
    if (i >= events.length) return res.end();
    const ev = events[i++];
    if (typeof ev === "number") return setTimeout(next, ev); // пауза
    res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    setTimeout(next, gap);
  };
  next();
}

function message(text, { stop = "end_turn", think = 50, model = "claude-opus-5-5", gap = 5 } = {}) {
  const ev = [
    { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    think,
    { type: "content_block_stop", index: 0 },
  ];
  if (text) {
    ev.push({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
    for (let i = 0; i < text.length; i += 17) ev.push({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: text.slice(i, i + 17) } });
    ev.push({ type: "content_block_stop", index: 1 });
  }
  ev.push({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 345 } });
  ev.push({ type: "message_stop" });
  return { ev, gap };
}

function lastUserText(body) {
  const users = body.messages.filter((m) => m.role === "user");
  const last = users[users.length - 1];
  const all = body.messages.flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.filter((b) => b.type === "text").map((b) => b.text))).join("\n");
  const text = typeof last.content === "string" ? last.content : last.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return { text, all };
}

function anthropic(req, res, body) {
  claude.push(body);
  const { text, all } = lastUserText(body);
  const scenario = (all.match(/S_[A-Z0-9]+/g) ?? []).pop() ?? "";
  const n = hit(scenario || "default");
  const err = (status, type, message, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify({ type: "error", error: { type, message } }));
  };
  if (scenario === "S_BUSY" && n <= 3) return err(529, "overloaded_error", "Overloaded", { "x-should-retry": "false" });
  if (scenario === "S_400" && body.fallbacks) return err(400, "invalid_request_error", "fallbacks: Extra inputs are not permitted");
  if (scenario === "S_BADIMG") return err(400, "invalid_request_error", "messages.0.content.0.image: Could not process image");
  if (scenario === "S_NOKEY") return err(401, "authentication_error", "invalid x-api-key");
  if (scenario === "S_SLOW" && body.output_config?.effort === "high") {
    const m = message("", { think: 600_000 });
    return sse(res, m.ev);
  }
  if (scenario === "S_SPEND") return err(400, "invalid_request_error", "You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.");
  if ((scenario === "S_SSEERR" || scenario === "S_EARLYDROP") && n === 1) {
    // модель ещё думает, а поток обрывается: ошибкой перегрузки или просто разрывом связи
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const ev of message("").ev.slice(0, 2)) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    if (scenario === "S_EARLYDROP") return setTimeout(() => res.destroy(), 150);
    res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}\n\n`);
    return res.end();
  }
  if (scenario === "S_REFMID") return sse(res, message("№1\nОтвет: 5\n@@@\n№2\nначало", { stop: "refusal" }).ev);
  if (scenario === "S_REFUSE") return sse(res, message("", { stop: "refusal" }).ev);
  if (scenario === "S_CUT" && text !== "дальше") return sse(res, message("№1\nx^2 = 16\nОтвет: 4\n@@@\n№2\nначало решения, которое не помести", { stop: "max_tokens" }).ev);
  if (scenario === "S_CUT") return sse(res, message("лось в первый кусок.\nОтвет: 7 см2").ev);
  if (scenario === "S_HELLO") return sse(res, message("№1\nОтвет: 42", { think: 2500 }).ev);
  if (scenario === "S_STOP") {
    const m = message("№1\nОтвет: 1\n@@@\n" + "очень длинное решение ".repeat(400), { gap: 40 });
    return sse(res, m.ev, { gap: 40 });
  }
  if (scenario === "S_CRASH" && text !== "дальше") {
    const m = message("№1\nОтвет: 1\n@@@\n" + "долгое второе задание ".repeat(600), { gap: 40 });
    return sse(res, m.ev, { gap: 40 });
  }
  if (scenario === "S_RESETCUT") return sse(res, message("№1\nОтвет: 1\n@@@\n№2\nначало длинного решения", { stop: "max_tokens", gap: 60 }).ev, { gap: 60 });
  if (scenario === "S_MANY") return sse(res, message(Array.from({ length: 45 }, (_, i) => `№${i + 1}\nОтвет: ${i}`).join("\n@@@\n"), { gap: 1 }).ev, { gap: 1 });
  if (scenario === "S_DROP" && n === 1) {
    // связь рвётся посреди ответа
    res.writeHead(200, { "content-type": "text/event-stream" });
    const m = message("№1\nОтвет: 10\n@@@\n№2\nполовина").ev.slice(0, 9);
    for (const ev of m) if (typeof ev !== "number") res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    return setTimeout(() => res.destroy(), 200);
  }
  if (scenario === "S_DROP") return sse(res, message("№2\nОтвет: 20").ev);
  if (text === "дальше") return sse(res, message("Продолжение.\nОтвет: 9").ev);
  // обычный ответ: два задания и рисунок в конце
  return sse(res, message(`№1\nДано: v_0 = 5 м/с, H2SO4\nx^2 + 2x = 8\nОтвет: 4 см2\n@@@\n№2\nРешение второго.\nОтвет: 5\n@@@\n${SVG}`).ev);
}

function green(req, res, method, body) {
  const json = (o) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(o));
  };
  if (method === "getStateInstance") return json({ stateInstance: "authorized" });
  if (method === "getSettings") return json(settings);
  if (method === "setSettings") return (Object.assign(settings, body), json({ saveSettings: true }));
  if (method === "downloadFile") return json({ downloadUrl: `http://127.0.0.1:${PORT}/photo.jpg` });
  if (method === "sendMessage") {
    if (flags.sendDown && body.chatId.startsWith(flags.sendDown)) return (res.writeHead(503), res.end("gateway is down"));
    if (flags.send466 && body.chatId.startsWith(flags.send466)) return (res.writeHead(466), res.end(JSON.stringify({ invokeStatus: { method: "sendMessage", used: 3, total: 3, status: "QUOTE_ALLOWED_EXCEEDED" } })));
    calls.push({ method, at: Date.now(), chatId: body.chatId, text: body.message });
    return json({ idMessage: "OUT" + calls.length });
  }
  if (method === "sendFileByUrl") {
    // как настоящий шлюз: сам забирает картинку по ссылке
    return fetch(body.urlFile).then(async (r) => {
      const b = Buffer.from(await r.arrayBuffer());
      calls.push({ method, at: Date.now(), chatId: body.chatId, url: body.urlFile, status: r.status, type: r.headers.get("content-type"), png: b.subarray(0, 4).toString("hex") === "89504e47", bytes: b.length, body: b });
      json({ idMessage: "OUT" + calls.length });
    }, (e) => {
      calls.push({ method, error: String(e) });
      res.writeHead(500);
      res.end("fetch failed");
    });
  }
  res.writeHead(404);
  res.end("unknown method");
}

// Загрузка файла формой, как в настоящем sendFileByUpload
async function upload(req, res, bytes) {
  if (flags.uploadBroken) return (res.writeHead(500), res.end("upload is down"));
  const form = await new Response(bytes, { headers: { "content-type": req.headers["content-type"] } }).formData();
  const file = form.get("file");
  const b = Buffer.from(await file.arrayBuffer());
  calls.push({ method: "sendFileByUpload", at: Date.now(), chatId: form.get("chatId"), fileName: form.get("fileName"), type: file.type, png: b.subarray(0, 4).toString("hex") === "89504e47", bytes: b.length, body: b });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ idMessage: "OUT" + calls.length, urlFile: "https://example.invalid/file.png" }));
}

export let PORT = 0;
export function start(port) {
  PORT = port;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const rawBytes = Buffer.concat(chunks);
      const raw = rawBytes.toString("utf8");
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      const url = new URL(req.url, "http://x");
      if (url.pathname === "/photo.jpg") {
        res.writeHead(200, { "content-type": "image/jpeg" });
        return res.end(JPEG);
      }
      if (url.pathname === "/big.jpg") {
        res.writeHead(200, { "content-type": "image/jpeg", "content-length": BIG.length });
        return res.end(BIG);
      }
      if (url.pathname === "/huge.jpg") {
        res.writeHead(200, { "content-type": "image/jpeg", "content-length": 60_000_000 });
        return res.end(Buffer.alloc(1024)); // размер объявлен огромным: бот не должен это качать
      }
      if (url.pathname === "/notphoto") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("это не картинка");
      }
      if (/^\/media\/waInstance\d+\/sendFileByUpload\//.test(url.pathname)) return upload(req, res, rawBytes);
      const g = url.pathname.match(/^\/green\/waInstance(\d+)\/(\w+)\/(.+)$/);
      if (g) return green(req, res, g[2], body);
      if (url.pathname === "/anthropic/v1/messages" && req.method === "POST") return anthropic(req, res, body);
      if (url.pathname.startsWith("/anthropic/v1/models/")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: url.pathname.split("/").pop(), type: "model", display_name: "Test" }));
      }
      res.writeHead(404);
      res.end("mock: not found " + url.pathname);
    });
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}
