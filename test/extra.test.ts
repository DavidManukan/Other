// Модульные проверки новых функций: цена запроса, вердикт второй проверки, файлы PDF, заголовок исправления.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { test } from "node:test";
import { allText, answerText, ask, cost, judgeReply, price, type Spent, tailText } from "../src/claude.ts";
import { config } from "../src/config.ts";
import { CHECK_PROMPT, judgeText, PROMPT } from "../src/prompt.ts";
import { card, compose, plainText, verdict } from "../src/text.ts";
import { fileType } from "../src/util.ts";

const near = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} вместо ${b}`);

test("цена запроса: вход, выход, чтение и запись кэша по ценам модели; fast вдвое дороже", () => {
  const u = { in: 1200, out: 345, read: 5000, write: 400 };
  near(price("claude-fable-5-2", u, false), (1200 * 8 + 345 * 40 + 5000 * 0.2 + 400 * 10) / 1e6);
  near(price("claude-fable-5-2", u, true), (2 * (1200 * 8 + 345 * 40 + 5000 * 0.2 + 400 * 10)) / 1e6);
  near(price("claude-opus-5-5", u, false), (1200 * 4 + 345 * 20 + 5000 * 0.2 + 400 * 5) / 1e6);
  near(price("claude-fable-5-2-20261001", { in: 1_000_000, out: 0, read: 0, write: 0 }, false), 8); // имя модели с датой
  assert.equal(price("some-other-model", u, false), null); // цену чужой модели не выдумываем
});

test("цена запасных моделей Anthropic: точное имя, потом самое длинное известное начало", () => {
  const u = { in: 1_000_000, out: 1_000_000, read: 0, write: 0 };
  near(price("claude-opus-5", u, false), 30); // на неё Anthropic переводит отклонённый запрос
  near(price("claude-opus-4-8", u, false), 30);
  near(price("claude-opus-5-20261001", u, false), 30);
  near(price("claude-opus-5-5", u, false), 24); // «claude-opus-5» не перебивает «claude-opus-5-5»
  near(price("claude-opus-5-5-20261001", u, false), 24);
  assert.equal(price("claude-opus-50", u, false), null); // начало имени совпадает, но это другая модель
});

test("для лимита оплаченный запрос не стоит $0: неизвестную модель считаем по заказанной, иначе по самой дорогой", () => {
  const u = { in: 1000, out: 2000, read: 0, write: 0 };
  assert.deepEqual(cost("claude-opus-5", "claude-fable-5-2", u, false), { usd: price("claude-opus-5", u, false), approx: false });
  assert.deepEqual(cost("claude-mystery-9", "claude-opus-5-5", u, false), { usd: price("claude-opus-5-5", u, false), approx: true });
  assert.deepEqual(cost("claude-mystery-9", "claude-mystery-8", u, true), { usd: price("claude-fable-5-2", u, true), approx: true });
});

// Поддельный Claude: отдаёт события потока и, если нужно, рвёт связь до конца ответа
async function fakeClaude(events: object[], drop: boolean): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const ev of events) res.write(`event: ${(ev as { type: string }).type}\ndata: ${JSON.stringify(ev)}\n\n`);
      if (drop) setTimeout(() => res.destroy(), 50);
      else res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}
const start = (model: string) => ({ type: "message_start", message: { id: "m", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1 } } });
const textEvents = (text: string) => [
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  ...Array.from({ length: Math.ceil(text.length / 500) }, (_, i) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i * 500, i * 500 + 500) } })),
];
async function spentOn(events: object[], drop: boolean): Promise<{ spent: Spent[]; cut: boolean }> {
  const fake = await fakeClaude(events, drop);
  try {
    const spent: Spent[] = [];
    const c = config({ CHAT: {} as never, ANTHROPIC_API_KEY: "sk-test-1234567890", ANTHROPIC_BASE_URL: fake.url, CODE: "0" });
    const a = await ask(c, { messages: [{ role: "user", content: "реши" }], effort: "high", fast: false, until: Date.now() + 30_000, spent: (s) => spent.push(s) });
    return { spent, cut: a.cut };
  } finally {
    fake.close();
  }
}

test("поток оборвался до итога: выход оценён по написанному (3 знака на токен), а не почти ноль", async () => {
  const r = await spentOn([start("claude-fable-5-2"), ...textEvents("№1\n" + "х".repeat(2997))], true);
  assert.equal(r.cut, true);
  assert.equal(r.spent.length, 1);
  assert.equal(r.spent[0].out, 1000);
  assert.equal(r.spent[0].approx, true);
  near(r.spent[0].usd, price("claude-fable-5-2", { in: 1000, out: 1000, read: 0, write: 0 }, false)!);
});

test("поток оборвался после итогового счёта: точные цифры важнее оценки", async () => {
  const r = await spentOn([start("claude-fable-5-2"), ...textEvents("№1\n" + "х".repeat(2997)), { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 50 } }], true);
  assert.equal(r.spent[0].out, 50);
  assert.equal(r.spent[0].approx, undefined);
});

test("ответила модель с неизвестной ценой: запрос посчитан по цене заказанной модели и помечен примерным", async () => {
  const r = await spentOn([start("claude-mystery-9"), ...textEvents("№1\nОтвет: 4"), { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } }, { type: "message_stop" }], false);
  assert.equal(r.cut, false);
  assert.equal(r.spent[0].model, "claude-mystery-9");
  assert.equal(r.spent[0].approx, true);
  near(r.spent[0].usd, price("claude-fable-5-2", { in: 1000, out: 20, read: 0, write: 0 }, false)!);
});

test("попытка засчитывается до сборки запроса: падение на фото и подсчёте PDF ограничено числом попыток", () => {
  // chat.ts нельзя загрузить без площадки Workers, поэтому проверяем порядок в исходнике solve()
  const src = readFileSync(new URL("../src/chat.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("private async solve("), src.indexOf("private async pack("));
  const tries = body.indexOf("job.tries++");
  assert.ok(tries > 0 && tries < body.indexOf("this.toApi(turns)") && tries < body.indexOf("inputTokens(") && tries < body.indexOf("await ask("));
});

test("вердикт второй проверки: верно, ошибка с замечаниями, ответ не по форме", () => {
  assert.deepEqual(verdict("ВЕРДИКТ: ВЕРНО"), { ok: true });
  assert.deepEqual(verdict("Проверил.\nВЕРДИКТ: верно\n"), { ok: true });
  assert.deepEqual(verdict("ВЕРДИКТ: ОШИБКА\n№2: в решении 5, а получается 7\n№3: потерян корень"), { ok: false, issues: "№2: в решении 5, а получается 7\n№3: потерян корень" });
  assert.equal(verdict("ВЕРДИКТ: ОШИБКА"), null); // ошибка без единого замечания: исправлять нечего, это ответ не по форме
  assert.equal(verdict("Мне кажется, тут всё хорошо."), null);
  assert.equal(verdict(""), null);
});

// Ход модели так, как его собирает converse(): текст, пересчёт кодом в песочнице, снова текст
const turn = (...xs: (string | null)[]) => xs.map((x) => (x === null ? { type: "server_tool_use", id: "t", name: "code_execution", input: {} } : { type: "text", text: x })) as never;

test("вердикт проверяющего: последняя строка «ВЕРДИКТ:» во всём ходе, даже если до пересчёта он писал своё «Ответ:»", () => {
  const blocks = turn("Решу №1 сам.\nОтвет: 4\nПроверю кодом.", null, "ВЕРДИКТ: ВЕРНО");
  assert.equal(answerText(blocks), "Решу №1 сам.\nОтвет: 4\nПроверю кодом."); // для решения берётся кусок с ответом...
  assert.equal(verdict(answerText(blocks)), null); // ...и вердикта в нём нет
  assert.deepEqual(verdict(allText(blocks)), { ok: true }); // во всём ходе он есть
  assert.deepEqual(verdict("Если ошибок нет, напишу ВЕРДИКТ: ВЕРНО.\nВЕРДИКТ: ОШИБКА\n№2: получается 7"), { ok: false, issues: "№2: получается 7" });
  assert.deepEqual(verdict("ВЕРДИКТ: ОШИБКА\n№2: получается 7\nПересчитал ещё раз, ошибся я.\nВЕРДИКТ: ВЕРНО"), { ok: true });
});

test("решение основной модели по замечаниям: согласие, оборванный ответ, исправление, заметка", () => {
  const reply = (blocks: never, cut = false, refused = false) => judgeReply({ text: answerText(blocks, cut), tail: tailText(blocks), cut, refused });
  // пересчёт со строкой «Ответ:», потом согласие: решение остаётся
  assert.deepEqual(reply(turn("Пересчитаю №2.\nОтвет: 5", null, "ВСЁ ВЕРНО")), { ok: true });
  assert.deepEqual(reply(turn("№2\nПересчитаю.\nОтвет: 5", null, "ВСЁ ВЕРНО")), { ok: true });
  // согласие, а следом повтор ответа
  assert.deepEqual(reply(turn("ВСЁ ВЕРНО\n№2\nОтвет: 5")), { ok: true });
  // согласие другими словами
  assert.deepEqual(reply(turn("Замечание ошибочно: ВСЁ ВЕРНО")), { ok: true });
  assert.deepEqual(reply(turn("Пересчёт подтвердил решение.\n\nВСЁ ВЕРНО")), { ok: true });
  // «не всё верно» это не согласие
  assert.deepEqual(reply(turn("НЕ ВСЁ ВЕРНО.\n№2\nПересчёт: 3 + 4 = 7\nОтвет: 7")), { fix: "НЕ ВСЁ ВЕРНО.\n№2\nПересчёт: 3 + 4 = 7\nОтвет: 7" });
  assert.equal(reply(turn("Тут не ВСЁ ВЕРНО")), null);
  // оборван прямо на строке «Ответ:» или после первого из двух заданий: не исправление, повтор
  assert.equal(reply(turn("№2\nПересчёт\nОтвет: x = 12"), true), null);
  assert.equal(reply(turn("№2\nОтвет: 7\n@@@\n"), true), null);
  assert.equal(reply(turn("№2\nОтвет: 7"), false, true), null); // отказ
  // настоящее исправление, в том числе со строкой-заметкой после пересчёта
  assert.deepEqual(reply(turn("№2\nПересчёт: 3 + 4 = 7\nОтвет: 7")), { fix: "№2\nПересчёт: 3 + 4 = 7\nОтвет: 7" });
  assert.deepEqual(reply(turn("№2\nОтвет: 7", null, "Проверка подтвердила.")), { fix: "№2\nОтвет: 7" });
  // заметка без заголовка задания исправлением не считается
  assert.equal(reply(turn("Пересчитаю №2.\nОтвет: 5", null, "Проверка завершена.")), null);
  assert.equal(reply(turn("Не уверен, нужно подумать.")), null);
});

test("файл с заданием: фото и PDF определяются по содержимому", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  assert.equal(fileType(bytes("%PDF-1.7\n...")), "application/pdf");
  assert.equal(fileType(bytes("\n\n  %PDF-1.4 начинается не с первого байта")), "application/pdf");
  assert.equal(fileType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(fileType(bytes("это текст, а не файл с заданием")), null);
  assert.equal(fileType(bytes("PK\u0003\u0004 docx")), null);
  assert.equal(fileType(new Uint8Array(0)), null);
});

test("исправление после второй проверки подписано своим заголовком и в подписи, и в тексте", () => {
  const fix = [plainText("№2\nПересчёт: $3 + 4 = 7$\nОтвет: $7$")];
  const title = "⚠️ Исправление к ответу «№1: 4 см²; №2: 5»";
  assert.equal(card(fix, title), `${title}\n№2: 7`);
  assert.equal(compose(fix, 12000, title).join("\n"), `${title}\n№2: 7\n——————————\n№2\nПересчёт: 3 + 4 = 7\nОтвет: 7`);
  assert.equal(compose(fix, 12000).join("\n"), "№2\nПересчёт: 3 + 4 = 7\nОтвет: 7"); // обычный ответ из одного задания идёт без списка
  assert.ok(card(fix).startsWith("✅ Ответы\n"));
});

test("настройки второй проверки: включена по умолчанию, идёт на запасной модели", () => {
  const base = { CHAT: {} as never };
  assert.equal(config(base).check, true);
  assert.equal(config(base).checkModel, "claude-opus-5-5");
  assert.equal(config({ ...base, CHECK: "0" }).check, false);
  assert.equal(config({ ...base, CHECK_MODEL: "claude-sonnet-5-5" }).checkModel, "claude-sonnet-5-5");
  assert.equal(config({ ...base, FALLBACK_MODEL: "claude-fable-5-2" }).checkModel, "claude-fable-5-2");
});

test("инструкции второй проверки: строгая форма ответа, замечания доходят до основной модели", () => {
  assert.ok(CHECK_PROMPT.includes("ВЕРДИКТ: ВЕРНО") && CHECK_PROMPT.includes("ВЕРДИКТ: ОШИБКА"));
  assert.ok(CHECK_PROMPT.startsWith("Ты проверяешь готовое решение"));
  const j = judgeText("№2: в решении 5, а получается 7");
  assert.ok(j.startsWith("Независимая перепроверка") && j.includes("№2: в решении 5, а получается 7") && j.includes("ВСЁ ВЕРНО") && j.includes("@@@"));
  assert.ok(PROMPT.includes("файл PDF")); // основная инструкция знает, что вместо фото может прийти файл
});
