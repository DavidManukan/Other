// Сквозная проверка на локальном воркере: вебхук -> очередь -> «Claude» -> «WhatsApp».
// GREEN-API и Claude подменены имитацией (test/mock.mjs). Запуск: npm run e2e
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls, claude, flags, settings, start } from "./mock.mjs";

const MOCK = 8788, PORT = 8787, TOKEN = "testtoken-1234567890abcdef", KEY_CLAUDE = "sk-ant-test-1234567890";
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = createHash("sha256").update("solver:" + TOKEN).digest("hex").slice(0, 32);
const OUT = process.env.E2E_OUT; // куда сохранить рисунок, чтобы посмотреть глазами
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const ok = (cond, name, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${cond ? "" : " " + extra}`);
  if (!cond) failed++;
};

let n = 0;
const hook = (chat, messageData, id = `MSG${++n}`) =>
  fetch(`${BASE}/?k=${KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeWebhook: "incomingMessageReceived", idMessage: id, timestamp: 1, senderData: { chatId: `${chat}@c.us`, sender: `${chat}@c.us` }, messageData }),
  });
const text = (chat, t, id) => hook(chat, { typeMessage: "textMessage", textMessageData: { textMessage: t } }, id);
const photo = (chat, caption = "", id, url = `http://127.0.0.1:${MOCK}/photo.jpg`) =>
  hook(chat, { typeMessage: "imageMessage", fileMessageData: { downloadUrl: url, caption, mimeType: "image/jpeg" } }, id);
const of = (chat) => calls.filter((c) => c.chatId === `${chat}@c.us`);
const texts = (chat) => of(chat).filter((c) => c.method === "sendMessage").map((c) => c.text);
async function until(f, ms = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await f()) return true;
    await sleep(100);
  }
  return false;
}
const quiet = (chat, ms = 1500) => {
  const before = of(chat).length;
  return sleep(ms).then(() => of(chat).length === before);
};

await start(MOCK);
// настройки передаём флагами, файл .dev.vars не трогаем (в нём могут лежать настоящие ключи)
const VARS = {
  ANTHROPIC_API_KEY: KEY_CLAUDE,
  GREEN_URL: `http://127.0.0.1:${MOCK}/green`,
  GREEN_ID: "1101000001",
  GREEN_TOKEN: TOKEN,
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK}/anthropic`,
  GREEN_MEDIA_URL: `http://127.0.0.1:${MOCK}/media`,
  TIME_SCALE: "60",
};
const state = mkdtempSync(join(tmpdir(), "solver-e2e-")); // каждый прогон с чистого листа
if (await fetch(`${BASE}/ready`).catch(() => null)) {
  console.log(`❌ порт ${PORT} занят: останови другой запущенный воркер`);
  process.exit(1);
}
// отдельная группа процессов: в конце гасим wrangler вместе с его дочерним workerd
let log = "";
function startDev() {
  const p = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", state, ...Object.entries(VARS).flatMap(([k, v]) => ["--var", `${k}:${v}`])], { env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => (log += d));
  p.stderr.on("data", (d) => (log += d));
  return p;
}
const ready = () => until(async () => (await fetch(`${BASE}/ready`).catch(() => null))?.status === 404, 90_000);
let dev = startDev();
const stopAll = (code) => {
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {}
  if (code) console.log("\n--- лог воркера ---\n" + log.slice(-6000));
  setTimeout(() => process.exit(code), 500);
};

try {
  ok(await ready(), "воркер запустился");

  // --- страница проверки: сначала самопроверка рендера, и только потом вебхук переезжает сюда ---
  let page = await (await fetch(BASE)).text();
  ok(page.includes("✅ WhatsApp бота подключён") && page.includes("✅ Ключ Claude принят") && page.includes("⏳ Проверяю рендер рисунков") && page.includes('http-equiv="refresh"'), "страница проверки: первый заход запускает самопроверку", page);
  ok(settings.webhookUrl === "", "пока самопроверка не прошла, вебхук не тронут", JSON.stringify(settings));
  ok(await until(async () => (await (await fetch(BASE)).text()).includes("✅ Рисунки рендерятся"), 30_000), "самопроверка рендера прошла");
  ok(await until(() => settings.webhookUrl === `${BASE}/?k=${KEY}`), "после самопроверки вебхук GREEN-API указывает на воркер", JSON.stringify(settings));
  ok(settings.incomingWebhook === "yes" && settings.webhookUrlToken === KEY && settings.outgoingAPIMessageWebhook === "no", "настройки вебхука верные", JSON.stringify(settings));
  await sleep(400);
  page = await (await fetch(BASE)).text();
  ok(page.includes("✅ Вебхук настроен") && !page.includes('http-equiv="refresh"'), "страница проверки: всё зелёное", page);
  ok(!page.includes(TOKEN) && !page.includes(KEY_CLAUDE), "на странице нет ключей");

  // --- защита входа ---
  const bad = await fetch(`${BASE}/?k=wrong`, { method: "POST", body: "{}" });
  ok((await bad.text()) === "no", "вебхук с чужим ключом не принимается");
  ok((await fetch(`${BASE}/?img=${"0".repeat(96)}`)).status === 404, "несуществующий рисунок: 404");

  // --- обычное фото: два задания отдельными сообщениями, потом рисунок ---
  await photo("111", "", "DUP1");
  await photo("111", "", "DUP1"); // шлюз прислал то же сообщение второй раз
  ok(await until(() => of("111").some((c) => c.method === "sendFileByUpload")), "фото: пришли ответы и рисунок");
  const t1 = texts("111");
  ok(t1.length === 2, "фото: два задания двумя сообщениями, повтор вебхука не задвоил", JSON.stringify(t1));
  ok(t1[0]?.includes("v₀ = 5") && t1[0]?.includes("H₂SO₄") && t1[0]?.includes("x² + 2x") && t1[0]?.includes("4 см²"), "степени и индексы приведены в порядок", t1[0]);
  ok(!t1.join("").includes("@@@") && !t1.join("").includes("<svg"), "в тексте нет разделителей и кода рисунка");
  const img = of("111").find((c) => c.method === "sendFileByUpload");
  ok(img?.png && img.bytes > 3000 && img.type === "image/png" && img.fileName === "risunok.png", "рисунок загружен в шлюз как PNG", JSON.stringify({ ...img, body: undefined }));
  ok(of("111").findIndex((c) => c.method === "sendFileByUpload") === of("111").length - 1, "рисунок идёт после всех ответов");
  if (OUT && img?.body) (mkdirSync(OUT, { recursive: true }), writeFileSync(`${OUT}/drawing.png`, img.body));
  const first = claude[0];
  ok(first.model === "claude-opus-5-5" && first.output_config?.effort === "high" && first.fallbacks === "default" && first.stream === true, "запрос к Claude: модель, effort, запасная модель, поток", JSON.stringify({ ...first, messages: undefined, system: undefined }));
  ok(first.system?.[0]?.cache_control?.type === "ephemeral" && first.messages[0].content[0]?.source?.media_type === "image/jpeg", "инструкция кэшируется, фото ушло картинкой");
  ok(first.max_tokens === 64000 && !("thinking" in first) && !("temperature" in first), "без устаревших параметров");

  // --- память чата: следующий вопрос видит прошлое фото и ответ ---
  const before = claude.length;
  await text("111", "объясни шаг 2");
  ok(await until(() => texts("111").length === 3), "текстовый вопрос: ответ пришёл");
  const follow = claude[before];
  ok(follow.messages.length === 3 && follow.messages[0].content[0].type === "image" && follow.messages[1].role === "assistant" && follow.messages[1].content.includes("Ответ: 5"), "память: прошлое фото и ответ ушли в запрос", JSON.stringify(follow.messages).slice(0, 400));

  // --- команды ---
  await text("111", "Пинг");
  ok(await until(() => texts("111").some((t) => t.startsWith("pong ✅ модель claude-opus-5-5, думает: high"))), "ping", JSON.stringify(texts("111").slice(-1)));
  await text("111", "быстро");
  ok(await until(() => texts("111").some((t) => t.startsWith("Режим: low"))), "команда «быстро»");
  const b2 = claude.length;
  await text("111", "ещё вопрос");
  ok(await until(() => claude.length > b2) && claude[b2].output_config.effort === "low", "режим из чата применился к запросу");
  await text("111", "сброс"); // посреди решения прошлого вопроса: его ответ в память уже не попадёт
  ok(await until(() => texts("111").includes("Память чата очищена ✅")), "сброс");
  await sleep(1500);
  const b3 = claude.length;
  await text("111", "новый вопрос");
  ok(await until(() => claude.length > b3) && claude[b3].messages.length === 1, "после сброса память пустая, даже если сброс пришёл посреди решения", JSON.stringify(claude[b3]?.messages).slice(0, 300));
  await hook("111", { typeMessage: "stickerMessage" });
  ok(await until(() => texts("111").includes("Пришли фото задания.")), "стикер: просим фото");

  // --- длинный ответ: оборван по лимиту токенов, продолжается сам ---
  await photo("222", "S_CUT");
  ok(await until(() => texts("222").some((t) => t.includes("Ответ: 7 см²"))), "длинный ответ продолжился сам");
  const t2 = texts("222");
  ok(t2.length === 3 && t2[0].includes("x² = 16") && t2[1].includes("начало решения") && !t2.some((t) => t.includes("слишком длинный")), "длинный ответ: три сообщения без просьб к пользователю", JSON.stringify(t2));
  const cont = claude.filter((b) => JSON.stringify(b.messages).includes("S_CUT"));
  ok(cont.length === 2 && cont[1].messages.at(-1).content[0].text === "дальше" && cont[1].messages.at(-2).content.includes("начало решения"), "продолжение: в запросе уже отправленный текст и «дальше»");

  // --- Claude перегружен: пауза и повтор без участия пользователя ---
  await photo("333", "S_BUSY");
  ok(await until(() => texts("333").some((t) => t.includes("Ответ: 5")), 30_000), "Claude занят: бот сам повторил и решил", JSON.stringify(texts("333")));
  ok(texts("333")[0] === "⏳ Claude занят, пробую ещё раз…", "Claude занят: одно уведомление");

  // --- модель думает дольше куска: следующая попытка на ступень проще ---
  await photo("444", "S_SLOW");
  ok(await until(() => texts("444").some((t) => t.includes("Ответ: 5")), 40_000), "долгие размышления: решено со второй попытки", JSON.stringify(texts("444")));
  const slow = claude.filter((b) => JSON.stringify(b.messages).includes("S_SLOW"));
  ok(slow.length === 2 && slow[0].output_config.effort === "high" && slow[1].output_config.effort === "medium", "долгие размышления: effort понижен на ступень", JSON.stringify(slow.map((b) => b.output_config)));
  ok(texts("444")[0].startsWith("⏳ решаю") && texts("444")[1].startsWith("⏳ долго думаю") && texts("444").length === 4, "долгие размышления: пользователь видит, что бот жив", JSON.stringify(texts("444")));

  // --- модель не знает необязательный параметр: бот убирает его и запоминает ---
  await photo("555", "S_400");
  ok(await until(() => texts("555").some((t) => t.includes("Ответ: 5"))), "ошибка 400 на параметре: решено без него");
  const b5 = claude.length;
  await text("555", "ещё");
  ok(await until(() => claude.length > b5) && !("fallbacks" in claude[b5]) && claude[b5].output_config?.effort === "high", "параметр запомнен как лишний, effort на месте", JSON.stringify({ ...claude[b5], messages: undefined, system: undefined }));

  // --- ошибка не в параметрах: настройки не портятся, пользователь видит причину ---
  await photo("666", "S_BADIMG");
  ok(await until(() => texts("666").some((t) => t.startsWith("⚠️ Ошибка Claude 400"))), "ошибка 400 не из-за параметров: показана причина", JSON.stringify(texts("666")));
  const b6 = claude.length;
  await text("777", "проверка");
  ok(await until(() => claude.length > b6) && claude[b6].output_config?.effort === "high", "после чужой ошибки 400 effort не потерян");

  // --- отказ модели, неверный ключ ---
  await photo("888", "S_REFUSE");
  ok(await until(() => texts("888").includes("Модель не стала это решать. Пересними задание.")), "отказ модели: понятное сообщение", JSON.stringify(texts("888")));
  await photo("889", "S_NOKEY");
  ok(await until(() => texts("889").includes("⚠️ Неверный ключ Claude. Проверь ANTHROPIC_API_KEY.")), "неверный ключ: понятное сообщение", JSON.stringify(texts("889")));
  ok(await quiet("889"), "неверный ключ: без повторов");

  // --- поток оборвался, пока модель думала (перегрузка в потоке или разрыв связи): повтор, а не отказ ---
  for (const [chat, sc] of [["890", "S_SSEERR"], ["891", "S_EARLYDROP"]]) {
    await photo(chat, sc);
    ok(await until(() => texts(chat).some((t) => t.includes("Ответ: 5")), 30_000), `${sc}: бот сам повторил и решил`, JSON.stringify(texts(chat)));
    ok(texts(chat)[0] === "⏳ Claude занят, пробую ещё раз…" && !texts(chat).some((t) => t.startsWith("⚠️")), `${sc}: без сообщения об ошибке`, JSON.stringify(texts(chat)));
  }

  // --- лимит трат, заданный в консоли Claude: одна попытка и понятный текст ---
  await photo("892", "S_SPEND");
  ok(await until(() => texts("892").includes("⚠️ Claude: достигнут лимит трат, который задан в консоли (platform.claude.com → Limits).")), "лимит трат: понятное сообщение", JSON.stringify(texts("892")));
  ok(claude.filter((b) => JSON.stringify(b.messages).includes("S_SPEND")).length === 1, "лимит трат: без лишних запросов");
  const b9 = claude.length;
  await text("893", "проверка после лимита");
  ok(await until(() => claude.length > b9) && claude[b9].output_config?.effort === "high", "лимит трат: настройки запроса не испорчены");

  // --- фильтр остановил модель посреди ответа: готовое доставлено, обрывок нет, есть подсказка ---
  await photo("894", "S_REFMID");
  ok(await until(() => texts("894").some((t) => t.startsWith("(модель остановилась"))), "отказ посреди ответа: есть подсказка", JSON.stringify(texts("894")));
  ok(texts("894").length === 2 && texts("894")[0].includes("Ответ: 5") && !texts("894").join("").includes("начало"), "отказ посреди ответа: обрывок не отправлен", JSON.stringify(texts("894")));

  // --- долгое молчание: один раз «решаю» ---
  await photo("901", "S_HELLO");
  ok(await until(() => texts("901").some((t) => t.includes("Ответ: 42"))), "долгая задача решена");
  ok(texts("901")[0] === "⏳ решаю, задача непростая…" && texts("901").length === 2, "при долгом молчании одно «решаю»", JSON.stringify(texts("901")));

  // --- стоп ---
  await photo("902", "S_STOP");
  ok(await until(() => texts("902").some((t) => t.includes("Ответ: 1"))), "стоп: первое задание пришло");
  await text("902", "стоп");
  ok(await until(() => texts("902").includes("Остановил ✅")), "стоп: подтверждение");
  ok(await quiet("902", 2500) && !texts("902").some((t) => t.includes("очень длинное")), "стоп: больше ничего не приходит", JSON.stringify(texts("902").map((t) => t.slice(0, 40))));
  await text("902", "ping");
  ok(await until(() => texts("902").some((t) => t.startsWith("pong") && !t.includes("в работе"))), "стоп: очередь пустая");

  // --- обрыв связи посреди ответа: написанное не теряется, остальное дорешивается ---
  await photo("903", "S_DROP");
  ok(await until(() => texts("903").some((t) => t.includes("Ответ: 20"))), "обрыв связи: бот дорешал", JSON.stringify(texts("903")));
  ok(texts("903").filter((t) => t.includes("Ответ: 10")).length === 1, "обрыв связи: первое задание не задвоилось", JSON.stringify(texts("903")));

  // --- очень много заданий: укладываемся в лимит запросов Cloudflare ---
  await photo("904", "S_MANY");
  ok(await until(() => texts("904").some((t) => t.includes("№45")), 30_000), "45 заданий: дошли все");
  ok(texts("904").length === 36 && texts("904")[35].includes("№36") && texts("904")[35].includes("№45"), "45 заданий: 35 сообщений и хвост одним", String(texts("904").length));

  // --- не картинка ---
  await photo("905", "", undefined, `http://127.0.0.1:${MOCK}/notphoto`);
  ok(await until(() => texts("905").includes("Не понял формат фото. Пришли обычное фото.")), "не картинка: понятное сообщение", JSON.stringify(texts("905")));

  // --- два фото подряд: решаются по очереди, ничего не теряется ---
  await photo("906", "", "Q1");
  await photo("906", "", "Q2");
  ok(await until(() => of("906").filter((c) => c.method === "sendFileByUpload").length === 2, 30_000), "два фото подряд: оба решены");
  ok(texts("906").length === 4, "два фото подряд: четыре ответа", JSON.stringify(texts("906").length));

  // --- загрузка файлов в шлюз не работает: рисунок уходит запасным путём, по ссылке ---
  flags.uploadBroken = true;
  await photo("907");
  ok(await until(() => of("907").some((c) => c.method === "sendFileByUrl"), 30_000), "загрузка сломана: рисунок ушёл по ссылке");
  const byUrl = of("907").find((c) => c.method === "sendFileByUrl");
  ok(byUrl?.png && byUrl.status === 200 && byUrl.type === "image/png" && byUrl.bytes > 3000 && /\?img=[0-9a-f]{96}$/.test(byUrl.url), "по ссылке отдаётся настоящий PNG", JSON.stringify({ ...byUrl, body: undefined }));
  flags.uploadBroken = false;

  // --- воркер внезапно перезапустился посреди решения (обновление кода, сбой площадки) ---
  await photo("908", "S_CRASH");
  ok(await until(() => texts("908").some((t) => t.includes("Ответ: 1"))), "перезапуск: первое задание пришло до сбоя");
  process.kill(-dev.pid, "SIGKILL");
  await sleep(1500);
  dev = startDev();
  ok(await ready(), "перезапуск: воркер поднялся снова");
  const resumed = await until(() => texts("908").some((t) => t.includes("Ответ: 9")), 45_000);
  ok(resumed, "перезапуск: бот сам продолжил решение с того же места", JSON.stringify(texts("908").map((t) => t.slice(0, 60))));
  ok(texts("908").filter((t) => t.includes("Ответ: 1")).length === 1, "перезапуск: уже отправленное не повторилось");
  const after = claude.filter((b) => JSON.stringify(b.messages).includes("S_CRASH")).at(-1);
  ok(after?.messages.at(-1).content[0].text === "дальше" && String(after.messages.at(-2).content).includes("Ответ: 1"), "перезапуск: модель получила уже отправленный текст и «дальше»");

  // --- журнал на странице проверки ---
  await sleep(400);
  page = await (await fetch(BASE)).text();
  ok(page.includes("Последние события") && page.includes("решено за") && !page.includes("@c.us") && !/\b(111|222|906)\b/.test(page.split("Последние события")[1] ?? ""), "журнал событий без номеров телефонов");
} catch (e) {
  console.log("❌ проверка упала:", e);
  failed++;
}
console.log(failed ? `\nНе прошло: ${failed}` : "\nВсё прошло");
stopAll(failed ? 1 : 0);
