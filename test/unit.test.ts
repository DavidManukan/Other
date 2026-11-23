// Модульные проверки чистых функций. Запуск: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { Busy, Fatal, activeModel, claudeProblem, tasks, unavailable } from "../src/claude.ts";
import { config, hider, hookKey, lower, publicOrigin } from "../src/config.ts";
import { Green, GreenError, permanent } from "../src/green.ts";
import { fixSvg } from "../src/svg.ts";
import { RULE, compose, prettyMath, splitAnswer } from "../src/text.ts";
import { base64, fingerprint, imageSize, imageType, sameSecret } from "../src/util.ts";

test("степени и индексы: то, что модель написала через ^ и _, становится маленькими цифрами", () => {
  const cases: Record<string, string> = {
    "x^2 + 2x = 8": "x² + 2x = 8",
    "10^-3": "10⁻³",
    "x^{n+1}": "xⁿ⁺¹",
    "(a + b)^2": "(a + b)²",
    "e^x": "eˣ",
    "sin^2 x": "sin² x",
    "v_0 = 5 м/с": "v₀ = 5 м/с",
    "a_{10}": "a₁₀",
    "log_2 8 = 3": "log₂ 8 = 3",
    "x1 + x2 = 5": "x₁ + x₂ = 5",
    "A1B1 || CD": "A₁B₁ || CD",
    "U1 = 220 В": "U₁ = 220 В",
  };
  for (const [a, b] of Object.entries(cases)) assert.equal(prettyMath(a), b);
});

test("химия и единицы: формулы с индексами, коэффициенты и обычные числа не портятся", () => {
  const cases: Record<string, string> = {
    "H2SO4 + 2NaOH": "H₂SO₄ + 2NaOH",
    "2H2O": "2H₂O",
    "CH3-CH2-OH": "CH₃-CH₂-OH",
    "Ca(OH)2": "Ca(OH)₂",
    "S = 4 см2": "S = 4 см²",
    "5 км2": "5 км²",
    "V = 2 м3": "V = 2 м³",
    "t = 2,5 с": "t = 2,5 с",
    "№3": "№3",
    "Ответ: 12": "Ответ: 12",
  };
  for (const [a, b] of Object.entries(cases)) assert.equal(prettyMath(a), b);
});

test("ответ модели: текст отдельно, рисунки отдельно, недописанный рисунок отбрасывается", () => {
  const r = splitAnswer("№1\nОтвет: 4\n\n\n\n```svg\n<svg a></svg>\n```\nхвост <svg недописан");
  assert.deepEqual(r, { text: "№1\nОтвет: 4\n\nхвост", svgs: ["<svg a></svg>"] });
  assert.deepEqual(splitAnswer("<svg>1</svg><svg>2</svg>"), { text: "", svgs: ["<svg>1</svg>", "<svg>2</svg>"] });
});

test("готовый ответ делится на задания по отдельной строке @@@", () => {
  assert.deepEqual(tasks("№1\nA\n@@@\n№2 @@@ в строке\nB\n  @@@ конец\n№3\n@@@"), ["№1\nA", "№2 @@@ в строке\nB", "№3"]);
  assert.deepEqual(tasks("@@@\n№1\nОтвет: 1"), ["№1\nОтвет: 1"]);
  assert.deepEqual(tasks("   "), []);
});

test("одно сообщение: сверху список ответов, ниже задания через черту", () => {
  const one = compose(["№1\nx = 2\nОтвет: 2."], 1000);
  assert.deepEqual(one, ["№1\nx = 2\nОтвет: 2."]); // одно задание: список ответов не нужен
  const two = compose(["Вариант 1 · №1\nрешение\nОтвет: а) 4; б) −1", "Вариант 1 · №2\nдоказательство\nч.т.д."], 1000);
  assert.equal(two.length, 1);
  assert.equal(two[0], `✅ Ответы\nВариант 1 · №1: а) 4; б) −1\nВариант 1 · №2: см. решение\n${RULE}\nВариант 1 · №1\nрешение\nОтвет: а) 4; б) −1\n${RULE}\nВариант 1 · №2\nдоказательство\nч.т.д.`);
  // в задании две строки «Ответ:» (проверка и итог): в список идёт последняя
  assert.match(compose(["№1\nОтвет: 3 (промежуточный)\nОтвет: 5", "№2\nОтвет: 6"], 1000)[0], /^✅ Ответы\n№1: 5\n№2: 6\n/);
});

test("слишком длинный ответ делится по границам заданий, длинное задание по строкам", () => {
  const parts = Array.from({ length: 6 }, (_, i) => `№${i + 1}\n${"строка\n".repeat(20)}Ответ: ${i}`);
  const msgs = compose(parts, 400);
  assert.ok(msgs.length > 1);
  assert.ok(msgs.every((m) => m.length <= 420), String(msgs.map((m) => m.length)));
  assert.match(msgs[0], /^\(1\/\d+\)\n✅ Ответы/);
  for (let i = 0; i < 6; i++) assert.equal(msgs.join("\n").split(`Ответ: ${i}`).length, 2); // каждое решение ровно один раз (в списке ответов слова «Ответ:» нет)
  const long = compose([`№1\n${"очень длинная строка решения\n".repeat(60)}Ответ: 1`], 500);
  assert.ok(long.length > 2 && long.every((m) => m.length <= 520));
  assert.ok(long.join("\n").includes("Ответ: 1"));
});

test("код программы в ответе не трогаем, остальной текст приводим в порядок", () => {
  const r = splitAnswer("№1\nx^2 и my_var, **важно**\n```\nfor i in range(3):\n    x_1 = a ** 2  # x^2\n```\nH2O\nОтвет: 9");
  assert.equal(r.text, "№1\nx² и my_var, важно\n```\nfor i in range(3):\n    x_1 = a ** 2  # x^2\n```\nH₂O\nОтвет: 9");
  assert.equal(splitAnswer("## №1\nОтвет: 1").text, "№1\nОтвет: 1");
});

test("размер и отпечаток фото", async () => {
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=", "base64");
  assert.deepEqual(imageSize(new Uint8Array(jpeg)), { w: 1, h: 1 });
  const png = new Uint8Array(32);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x06, 0x40, 0, 0, 0x04, 0xb0]);
  assert.deepEqual(imageSize(png), { w: 1600, h: 1200 });
  assert.equal(imageSize(new TextEncoder().encode("не картинка")), null);
  const a = await fingerprint(new Uint8Array([1, 2, 3])), b = await fingerprint(new Uint8Array([1, 2, 3])), c = await fingerprint(new Uint8Array([1, 2, 4]));
  assert.ok(a === b && a !== c && /^[0-9a-f]{24}$/.test(a));
});

test("ошибки Claude: что повторять, а что сразу показывать", () => {
  const c = config({ MODEL: "claude-opus-5-5" } as any);
  const api = (status: number | undefined, type: string, message: string, headers: Record<string, string> = {}, details?: unknown) =>
    Anthropic.APIError.generate(status, { type: "error", error: { type, message, details } }, undefined, new Headers(headers));
  assert.ok(claudeProblem(c, api(529, "overloaded_error", "Overloaded")) instanceof Busy);
  assert.ok(claudeProblem(c, api(500, "api_error", "boom")) instanceof Busy);
  assert.ok(claudeProblem(c, api(429, "rate_limit_error", "slow down")) instanceof Busy); // без retry-after тоже повтор
  assert.ok(claudeProblem(c, api(undefined, "overloaded_error", "Overloaded")) instanceof Busy); // ошибка внутри потока
  assert.ok(claudeProblem(c, new Anthropic.APIConnectionError({ message: "x" })) instanceof Busy);
  assert.match(claudeProblem(c, api(401, "authentication_error", "bad key")).message, /Неверный ключ/);
  assert.match(claudeProblem(c, api(404, "not_found_error", "no model")).message, /Нет модели claude-opus-5-5/);
  assert.match(claudeProblem(c, api(402, "billing_error", "pay")).message, /кончились деньги/);
  assert.match(claudeProblem(c, api(400, "invalid_request_error", "Your credit balance is too low")).message, /кончились деньги/);
  assert.match(claudeProblem(c, api(400, "invalid_request_error", "You have reached your specified API usage limits.")).message, /лимит трат, который задан в консоли/);
  assert.match(claudeProblem(c, api(413, "request_too_large", "big")).message, /Фото слишком большое/);
  assert.match(claudeProblem(c, api(400, "invalid_request_error", "In order to access this model, your organization or workspace must have data retention enabled.")).message, /хранения данных 30 дней/);
  assert.ok(unavailable(api(404, "not_found_error", "model: x")) && unavailable(api(400, "invalid_request_error", "must have data retention enabled")) && !unavailable(api(400, "invalid_request_error", "messages: bad")));
  assert.equal(activeModel(c), "claude-opus-5-5"); // в этом тесте MODEL задана как Opus: запасная не нужна
  const other = claudeProblem(c, api(400, "invalid_request_error", "messages: bad"));
  assert.ok(other instanceof Fatal);
  assert.equal(other.message, "Ошибка Claude 400: messages: bad");
});

test("рисунок приводится к тёмному стилю: фон, цвета, шрифт, индексы", () => {
  const out = fixSvg('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="white"/><text fill="black">CH3 x^2 A₁</text><line stroke="#000"/></svg>');
  assert.match(out, /^<svg font-family="DejaVu Sans"/);
  assert.match(out, /<rect width="10" height="10" fill="#171717"\/>/);
  assert.ok(!/black|#000"/.test(out));
  assert.match(out, /CH<tspan baseline-shift="sub" font-size="65%">3<\/tspan>/);
  assert.match(out, /x<tspan baseline-shift="super" font-size="65%">2<\/tspan>/);
  assert.match(out, /A<tspan baseline-shift="sub" font-size="65%">1<\/tspan>/);
  // рисунок без фона получает тёмную подложку
  assert.match(fixSvg('<svg viewBox="0 0 1 1"><circle r="1"/></svg>'), /<rect width="100%" height="100%" fill="#171717"\/>/);
});

test("настройки: значения по умолчанию, чистка ввода, список незаполненного", () => {
  const empty = config({} as any);
  assert.deepEqual(empty.missing, ["ANTHROPIC_API_KEY", "GREEN_URL", "GREEN_ID", "GREEN_TOKEN"]);
  assert.equal(empty.model, "claude-fable-5-2");
  assert.equal(empty.fallbackModel, "claude-opus-5-5");
  assert.equal(empty.code, true);
  assert.equal(config({ CODE: "0" } as any).code, false);
  assert.equal(empty.effort, "high");
  assert.equal(empty.fast, false);
  assert.equal(empty.autoMax, 5);
  assert.equal(empty.region, "eu");
  const c = config({ ANTHROPIC_API_KEY: " sk-1 ", GREEN_URL: "7103.api.greenapi.com/", GREEN_ID: "id 7103 123", GREEN_TOKEN: "tok", EFFORT: "MAX", FAST: "1", AUTO_MAX: "0" } as any);
  assert.equal(c.claudeKey, "sk-1");
  assert.equal(c.greenUrl, "https://7103.api.greenapi.com");
  assert.equal(c.greenId, "7103123");
  assert.equal(c.effort, "max");
  assert.equal(c.fast, true);
  assert.equal(c.autoMax, 0);
  assert.deepEqual(c.missing, []);
  assert.equal(config({ EFFORT: "ерунда" } as any).effort, "high");
});

test("ступени размышления понижаются по одной и не уходят ниже low", () => {
  assert.equal(lower("max"), "xhigh");
  assert.equal(lower("high"), "medium");
  assert.equal(lower("low"), "low");
});

test("секреты: ключ вебхука не раскрывает токен, ключи не попадают в текст", async () => {
  const c = config({ ANTHROPIC_API_KEY: "sk-ant-secret-123456", GREEN_URL: "https://x", GREEN_ID: "1", GREEN_TOKEN: "green-token-abcdef" } as any);
  const key = await hookKey(c);
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.equal(key, await hookKey(c));
  assert.ok(!key.includes("green"));
  assert.equal(hider(c)("ошибка: https://x/waInstance1/sendMessage/green-token-abcdef и sk-ant-secret-123456"), "ошибка: https://x/waInstance1/sendMessage/*** и ***");
  assert.equal(await hookKey(config({} as any)), "");
  assert.ok(sameSecret(key, key));
  assert.ok(!sameSecret(key, key.slice(1) + "0"));
  assert.ok(!sameSecret("", ""));
});

test("формат фото определяется по содержимому, base64 без потерь", () => {
  assert.equal(imageType(new Uint8Array([0xff, 0xd8, 0xff])), "image/jpeg");
  assert.equal(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), "image/png");
  assert.equal(imageType(new TextEncoder().encode("RIFFxxxxWEBP")), "image/webp");
  assert.equal(imageType(new TextEncoder().encode("это не картинка")), null);
  const big = new Uint8Array(100_000).map((_, i) => i % 251);
  assert.deepEqual(new Uint8Array(Buffer.from(base64(big), "base64")), big);
});

test("адрес для вебхука и рисунков всегда https, кроме локального запуска", () => {
  assert.equal(publicOrigin(new URL("http://solver.example.workers.dev/?k=1")), "https://solver.example.workers.dev");
  assert.equal(publicOrigin(new URL("https://solver.example.workers.dev/")), "https://solver.example.workers.dev");
  assert.equal(publicOrigin(new URL("http://127.0.0.1:8787/")), "http://127.0.0.1:8787");
});

test("хозяева из OWNER: номера и id чатов через запятую", () => {
  assert.deepEqual(config({ OWNER: " 79990001122, 12345@lid " } as any).owners, ["79990001122", "12345@lid"]);
  assert.deepEqual(config({} as any).owners, []);
});

test("шлюз: повтор только когда запрос точно не принят; после таймаута и отказа по существу повтора нет", async () => {
  const c = config({ ANTHROPIC_API_KEY: "k", GREEN_URL: "https://7103.api.greenapi.com", GREEN_ID: "7103", GREEN_TOKEN: "secret-token-123" } as any);
  const real = globalThis.fetch;
  const run = async (answers: Array<() => Response | Promise<Response>>) => {
    let n = 0;
    globalThis.fetch = (async () => answers[Math.min(n++, answers.length - 1)]()) as typeof fetch;
    try {
      const r = await new Green(c).send("1@c.us", "привет").then((v) => ({ ok: v }), (e) => ({ err: e }));
      return { ...r, calls: n } as { ok?: any; err?: any; calls: number };
    } finally {
      globalThis.fetch = real;
    }
  };
  const timeout = () => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
  const offline = () => Promise.reject(new TypeError("fetch failed: https://7103.api.greenapi.com/waInstance7103/sendMessage/secret-token-123"));
  const ok200 = () => new Response(JSON.stringify({ idMessage: "X" }));

  let r = await run([timeout, ok200]);
  assert.equal(r.calls, 1); // сообщение могло дойти: повтор задвоил бы его
  assert.ok(r.err instanceof GreenError && r.err.timeout && !permanent(r.err));

  r = await run([() => new Response("quota", { status: 466 }), ok200]);
  assert.equal(r.calls, 1);
  assert.ok(permanent(r.err));

  r = await run([() => new Response("boom", { status: 503 }), ok200]);
  assert.equal(r.calls, 2);
  assert.deepEqual(r.ok, { idMessage: "X" });

  r = await run([offline, ok200]);
  assert.equal(r.calls, 2);

  r = await run([offline, offline]);
  assert.ok(!String(r.err.message).includes("secret-token-123")); // токен не утекает в текст ошибки
  assert.ok(!permanent(r.err));

  r = await run([() => new Response("slow down", { status: 429 }), ok200]);
  assert.equal(r.calls, 2);
});
