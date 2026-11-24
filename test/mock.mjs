// Имитация GREEN-API и Claude для локальной проверки. В настоящие сервисы ничего не уходит.
import http from "node:http";

export const calls = []; // всё, что бот отправил «в WhatsApp»
export const claude = []; // тела запросов к «Claude»
export const counted = []; // тела запросов на бесплатный подсчёт токенов
export const settings = { webhookUrl: "", incomingWebhook: "no" };
// тест может «сломать» шлюз: загрузку файлов, отправку в чат, ответ на отправку (сообщение ушло, а ответа нет), выдачу фото
export const flags = { uploadBroken: false, uploadHang: "", sendDown: "", send466: "", sendHang: "", photoDown: 0, noFable: false };
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

function message(text, { stop = "end_turn", think = 50, model, gap = 5, blocks = [], container, after = "", out = 345 } = {}) {
  if (after) return notes(text, blocks, after, model);
  const ev = [
    { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: model ?? "claude-fable-5-2", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 5000, cache_creation_input_tokens: 400, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 300 } } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    think,
    { type: "content_block_stop", index: 0 },
  ];
  let index = 1;
  for (const block of blocks) {
    ev.push({ type: "content_block_start", index, content_block: block }, { type: "content_block_stop", index });
    index++;
  }
  if (text) {
    ev.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
    for (let i = 0; i < text.length; i += 17) ev.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: text.slice(i, i + 17) } });
    ev.push({ type: "content_block_stop", index });
  }
  ev.push({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null, ...(container ? { container: { id: container, expires_at: "2027-01-01T00:00:00Z" } } : {}) }, usage: { output_tokens: out, output_tokens_details: { thinking_tokens: Math.round(out * 0.6) } } });
  ev.push({ type: "message_stop" });
  return { ev, gap };
}

// текст-заметка, проверка в песочнице, потом настоящий ответ
function notes(before, blocks, after, model) {
  const ev = [{ type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: model ?? "claude-fable-5-2", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } }];
  let index = 0;
  const say = (text) => {
    ev.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index, delta: { type: "text_delta", text } }, { type: "content_block_stop", index });
    index++;
  };
  say(before);
  for (const block of blocks) (ev.push({ type: "content_block_start", index, content_block: block }, { type: "content_block_stop", index }), index++);
  say(after);
  ev.push({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 345 } }, { type: "message_stop" });
  return { ev, gap: 5 };
}

export const CONT = "Ответ оборвался. Продолжай со следующей строки после уже написанного: написанное не повторяй, незаконченный рисунок начни заново целиком.";
export const NUDGE = "Теперь напиши готовый ответ целиком, по формату.";
// пересчёт кодом в песочнице: так его видит клиент
const CHECK = [
  { type: "server_tool_use", id: "srvtoolu_1", name: "bash_code_execution", input: { command: "python check.py" } },
  { type: "bash_code_execution_tool_result", tool_use_id: "srvtoolu_1", content: { type: "bash_code_execution_result", stdout: "ok", stderr: "", return_code: 0, content: [] } },
];
const ANSWER = `№1\nДано: v_0 = 5 м/с, H2SO4\nx^2 + 2x = 8\nОтвет: 4 см2\n@@@\n№2\nРешение второго.\nОтвет: 5\n@@@\n${SVG}`;

function lastUserText(body) {
  const users = body.messages.filter((m) => m.role === "user");
  const last = users[users.length - 1];
  const texts = (m) => (typeof m.content === "string" ? [m.content] : m.content.filter((b) => b.type === "text").map((b) => b.text));
  return { text: texts(last).join("\n"), all: body.messages.flatMap(texts).join("\n") };
}

function anthropic(req, res, body) {
  claude.push(body);
  const { text, all } = lastUserText(body);
  const scenario = (all.match(/S_[A-Z0-9]+/g) ?? []).pop() ?? "";
  const n = hit(scenario || "default");
  const send = (t, o) => {
    const m = message(t, { model: body.model, ...o });
    return sse(res, m.ev, { gap: m.gap });
  };
  const err = (status, type, message, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify({ type: "error", error: { type, message } }));
  };
  if (flags.noFable && body.model === "claude-fable-5-2") return err(404, "not_found_error", "model: claude-fable-5-2");
  // вторая проверка готового решения (своя инструкция) и арбитраж основной модели
  const system = Array.isArray(body.system) ? body.system.map((b) => b.text).join("") : String(body.system ?? "");
  if (system.startsWith("Ты проверяешь готовое решение")) {
    if (scenario === "S_CHKFIX" || scenario === "S_CHKARG") return send("ВЕРДИКТ: ОШИБКА\n№2: в решении 5, а получается 7");
    if (scenario === "S_CHKBAD") return send("Мне кажется, тут всё хорошо, но я не уверена.");
    if (scenario === "S_CHKSLOW") return send("ВЕРДИКТ: ОШИБКА\n№1: ответ другой", { think: 4000 });
    if (scenario === "S_FIXQ") return send("ВЕРДИКТ: ОШИБКА\n№2: в решении 5, а получается 7", { think: 3000 });
    // проверяющий занял больше половины куска: основной модели нужен свой срок
    if (scenario === "S_CHKLONG") return send("ВЕРДИКТ: ОШИБКА\n№2: в решении 5, а получается 7", { think: 7000 });
    // проверяющий сам решает со строкой «Ответ:», пересчитывает кодом и только потом пишет вердикт
    if (scenario === "S_CHKNOTE" || scenario === "S_CHKCUT") return send("Решу №2 сам.\nОтвет: 7\nПроверю кодом.", { blocks: CHECK, after: "ВЕРДИКТ: ОШИБКА\n№2: в решении 5, а получается 7" });
    return send("ВЕРДИКТ: ВЕРНО");
  }
  if (text.startsWith("Независимая перепроверка")) {
    if (scenario === "S_CHKARG") return send("ВСЁ ВЕРНО");
    // пересчёт со строкой «Ответ:», затем согласие другими словами: это не исправление
    if (scenario === "S_CHKNOTE") return send("Пересчитаю №2.\nОтвет: 5", { blocks: CHECK, after: "Замечание ошибочно: ВСЁ ВЕРНО" });
    // первый ответ оборван на строке «Ответ:», второй дописан
    if (scenario === "S_CHKCUT") return hit("judgecut") === 1 ? send("№2\nПересчёт: 3 + 4\nОтвет: x = 12", { stop: "max_tokens" }) : send("№2\nПересчёт: 3 + 4\nОтвет: x = 125");
    if (scenario === "S_CHKLONG") return send("№2\nПересчёт: $3 + 4 = 7$\nОтвет: $7$", { think: 6000 });
    return send("№2\nПересчёт: $3 + 4 = 7$\nОтвет: $7$");
  }
  if (scenario === "S_BUSY" && n <= 3) return err(529, "overloaded_error", "Overloaded", { "x-should-retry": "false" });
  if (scenario === "S_400" && body.fallbacks) return err(400, "invalid_request_error", "fallbacks: Extra inputs are not permitted");
  if (scenario === "S_BADIMG") return err(400, "invalid_request_error", "messages.0.content.0.image: Could not process image");
  if (scenario === "S_NOKEY") return err(401, "authentication_error", "invalid x-api-key");
  if (scenario === "S_SPEND") return err(400, "invalid_request_error", "You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.");
  if ((scenario === "S_SSEERR" || scenario === "S_EARLYDROP") && n === 1) {
    // модель ещё думает, а поток обрывается: ошибкой перегрузки или просто разрывом связи
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const ev of message("").ev.slice(0, 2)) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    if (scenario === "S_EARLYDROP") return setTimeout(() => res.destroy(), 150);
    res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}\n\n`);
    return res.end();
  }
  if (scenario === "S_SLOW" && body.output_config?.effort === "high") return send("", { think: 600_000 });
  if (scenario === "S_REFUSE") return send("", { stop: "refusal" });
  if (scenario === "S_REFMID") return send("№1\nОтвет: 5\n@@@\n№2\nначало", { stop: "refusal" });
  if (scenario === "S_CUT" && text !== CONT) return send("№1\nx^2 = 16\nОтвет: 4\n@@@\n№2\nначало решения, которое не помести", { stop: "max_tokens" });
  if (scenario === "S_CUT") return send("начало решения, которое не поместилось в первый кусок.\nОтвет: 7 см2");
  // ответ оборван, и этот кусок дорогой (миллион токенов выхода): после него дневной лимит исчерпан
  if (scenario === "S_CAPCUT") return send("№1\nx^2 = 16\nОтвет: 4\n@@@\n№2\nначало решения, которое не помести", { stop: "max_tokens", out: 1_000_000 });
  if (scenario === "S_WAIT") return send("№1\nОтвет: 42", { think: 2500 });
  if (scenario === "S_SLOWB") return send("№1\nОтвет: 42", { think: 8000 });
  if (scenario === "S_HELLO") return send("№1\nОтвет: 42", { think: 4500 });
  if (scenario === "S_LONG" || (scenario === "S_CRASH" && n === 1)) return send("№1\nОтвет: 1\n@@@\n" + "очень длинное решение ".repeat(400), { gap: 40 });
  if (scenario === "S_CRASH") return send("№1\nОтвет: 9");
  if (scenario === "S_MANY") return send(Array.from({ length: 45 }, (_, i) => `№${i + 1}\nОтвет: ${i}`).join("\n@@@\n"), { gap: 1 });
  if (scenario === "S_LONGCARD") return send(Array.from({ length: 30 }, (_, i) => `№${i + 1}\nСчитаем по формуле.\nОтвет: значение номер ${i} получилось таким, как и ожидалось`).join("\n@@@\n"), { gap: 1 });
  if (scenario === "S_HUGE") return send(Array.from({ length: 30 }, (_, i) => `№${i + 1}\n${"строка решения с выкладками\n".repeat(22)}Ответ: ${i}`).join("\n@@@\n"), { gap: 1 });
  if (scenario === "S_PAUSE") {
    // пересчёт затянулся: ход приходит с pause_turn, его нужно продолжить тем же сообщением и в том же контейнере
    const resumed = body.messages.at(-1).role === "assistant";
    if (!resumed) return send("", { stop: "pause_turn", blocks: CHECK, container: "cont_1" });
    return send("№1\nОтвет: 77");
  }
  if (scenario === "S_NUDGE") return text === NUDGE ? send("№1\nОтвет: 55") : send("", { blocks: CHECK, container: "cont_2" });
  if (scenario === "S_CODE") return send("№1\nвывести a * b и my_var\n```\nfor i in range(3):\n    x_1 = a ** 2\n```\nОтвет: 9", { blocks: CHECK });
  if (scenario === "S_DROP" && n === 1) {
    // связь рвётся посреди ответа
    res.writeHead(200, { "content-type": "text/event-stream" });
    const m = message("№1\nОтвет: 10\n@@@\n№2\nполовина").ev.slice(0, 9);
    for (const ev of m) if (typeof ev !== "number") res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    return setTimeout(() => res.destroy(), 200);
  }
  if (scenario === "S_DROP") return send("половина решена\nОтвет: 20");
  if (scenario === "S_TEX") return send("№1\nДано:\n$AB = 6$ см\nНайти: $x$\nРешение:\n$x^2 = \\dfrac{9}{4}$ | $\\cdot 4$\n$x = \\pm \\dfrac{3}{2}$\nОтвет: $x = \\pm \\dfrac{3}{2}$.\n@@@\n№2\nH2SO4 и $v_0 = 5$ м/с\nОтвет: $\\sqrt{34}$ см\n@@@\n№3\nМетод интервалов.\nОтвет: $x \\in (2; 4]$\n@@@\n" + SVG);
  // вид ответа называет модель: страница, текст с рисунком, тест из одних ответов, таблица
  if (scenario === "S_LOOKP") return send("ВИД: страница\n№1\nРешение:\n$x^2 = \\dfrac{9}{4}$ | $\\cdot 4$\n$x = \\pm \\dfrac{3}{2}$\nОтвет: $x = \\pm \\dfrac{3}{2}$.\n@@@\n" + SVG);
  if (scenario === "S_LOOKT") return send("ВИД: текст\n№1\nДано:\nm(BaCl2) = 20,8 г\nРешение:\nn(BaCl2) = $\\dfrac{20{,}8}{208} = 0{,}1$ моль\nОтвет: 23,3 г\n@@@\n" + SVG);
  if (scenario === "S_QUIZ") return send("ВИД: страница\n№1\nОтвет: Б) 12\n@@@\n№2\nОтвет: $x \\in (2; 5]$\n@@@\n№3\nОтвет: 3214");
  if (scenario === "S_TBL") return send("ВИД: текст\n№1\nТаблица истинности:\n| A | B | F |\n| --- | --- | --- |\n| 0 | 1 | 1 |\n| 1 | 1 | 0 |\nОтвет: F = 1 в одной строке");
  if (scenario === "S_NOSHOT") return send("№1\nSHOT_FAIL\n$x^2 = 9$\nОтвет: $3$\n@@@\n" + SVG);
  if (scenario === "S_SHOTQ") return send("№1\nSHOT_QUOTA\nОтвет: $\\dfrac{1}{2}$");
  if (scenario === "S_NOTES") return send("Проверю вычисления в песочнице.", { blocks: CHECK, after: "№1\nОтвет: 31" });
  if (scenario === "S_AFTER") return send("№1\nx = 4\nОтвет: 4\n@@@\n№2\nОтвет: 7", { blocks: CHECK, after: "Проверка подтвердила оба ответа." });
  if (scenario === "S_FALLBACK") return send("№1\nОтвет: 4\n@@@\n№2\nРеакция идёт ", { blocks: [{ type: "fallback", from: "claude-fable-5-2", to: "claude-opus-5-5" }], after: "с выделением газа.\nОтвет: 22,4 л" });
  // обычный ответ: два задания и рисунок в конце
  return send(ANSWER);
}

function green(req, res, method, body) {
  const json = (o) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(o));
  };
  if (method === "getStateInstance") return json({ stateInstance: "authorized" });
  if (method === "getSettings") return json(settings);
  if (method === "setSettings") return (Object.assign(settings, body), json({ saveSettings: true }));
  if (method === "downloadFile") {
    if (flags.photoDown > 0) return (res.writeHead(503), res.end("storage is down"));
    return json({ downloadUrl: `http://127.0.0.1:${PORT}/photo.jpg` });
  }
  if (method === "lastOutgoingMessages") {
    // журнал исходящих: всё, что шлюз принял
    // как настоящий шлюз: у картинки в журнале своё, сгенерированное имя файла, а не то, с которым её отправили
    return json(calls.filter((c) => c.chatId).map((c, i) => ({ type: "outgoing", chatId: c.chatId, timestamp: Math.floor(c.at / 1000), typeMessage: c.text !== undefined ? "extendedTextMessage" : "imageMessage", textMessage: c.text, fileName: c.text !== undefined ? undefined : `b89ded5e-${i}.png`, caption: c.caption })));
  }
  if (method === "sendMessage") {
    if (flags.sendDown && body.chatId.startsWith(flags.sendDown)) return (res.writeHead(503), res.end("gateway is down"));
    if (flags.send466 && body.chatId.startsWith(flags.send466)) return (res.writeHead(466), res.end(JSON.stringify({ invokeStatus: { method: "sendMessage", used: 3, total: 3, status: "QUOTE_ALLOWED_EXCEEDED" } })));
    calls.push({ method, at: Date.now(), chatId: body.chatId, text: body.message });
    if (flags.sendHang && body.chatId.startsWith(flags.sendHang) && !/^(📥|➕)/.test(body.message)) return; // сообщение принято, а ответа шлюз так и не дал
    return json({ idMessage: "OUT" + calls.length });
  }
  if (method === "sendFileByUrl") {
    // как настоящий шлюз: сам забирает картинку по ссылке
    return fetch(body.urlFile).then(async (r) => {
      const b = Buffer.from(await r.arrayBuffer());
      calls.push({ method, at: Date.now(), chatId: body.chatId, url: body.urlFile, fileName: body.fileName, caption: body.caption, status: r.status, type: r.headers.get("content-type"), png: b.subarray(0, 4).toString("hex") === "89504e47", bytes: b.length, body: b });
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
  calls.push({ method: "sendFileByUpload", at: Date.now(), chatId: form.get("chatId"), fileName: form.get("fileName"), caption: form.get("caption") ?? undefined, type: file.type, png: b.subarray(0, 4).toString("hex") === "89504e47", bytes: b.length, body: b });
  // шлюз принял файл, но связь оборвалась раньше ответа
  if (flags.uploadHang && String(form.get("chatId")).startsWith(flags.uploadHang) && String(form.get("caption") ?? "").replace(/[\u200B\u200C\u2060]/g, "") === "2 / 2") return (flags.uploadHang = ""), res.destroy();
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
      if (url.pathname === "/flaky.jpg") {
        // хранилище шлюза временно не отдаёт файл
        if (flags.photoDown > 0) return (flags.photoDown--, res.writeHead(503), res.end("storage is down"));
        res.writeHead(200, { "content-type": "image/jpeg" });
        return res.end(Buffer.concat([JPEG, Buffer.from([7, 7, 7])]));
      }
      if (url.pathname === "/task.pdf" || url.pathname === "/task2.pdf" || url.pathname === "/mid.pdf" || url.pathname === "/mid2.pdf") {
        res.writeHead(200, { "content-type": "application/pdf" });
        return res.end(Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${url.pathname}\n%%EOF\n`));
      }
      if (url.pathname === "/anthropic/v1/messages/count_tokens" && req.method === "POST") {
        counted.push(body);
        res.writeHead(200, { "content-type": "application/json" });
        // файлы mid*.pdf считаются по 100 тысяч токенов: два таких в одном запросе уже не помещаются, один помещается
        const docs = body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "document");
        const mid = docs.filter((b) => Buffer.from(b.source.data, "base64").toString().includes("/mid")).length;
        return res.end(JSON.stringify({ input_tokens: JSON.stringify(body.messages).includes("S_BIGPDF") ? 400_000 : 5_000 + mid * 100_000 }));
      }
      if (url.pathname === "/photo.jpg") {
        res.writeHead(200, { "content-type": "image/jpeg" });
        return res.end(JPEG);
      }
      if (url.pathname === "/photo2.jpg") {
        res.writeHead(200, { "content-type": "image/jpeg" });
        return res.end(Buffer.concat([JPEG, Buffer.from([1, 2, 3])]));
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
      if (url.pathname.startsWith("/anthropic/v1/models/") && flags.noFable && url.pathname.endsWith("claude-fable-5-2")) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "model: claude-fable-5-2" } }));
      }
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
