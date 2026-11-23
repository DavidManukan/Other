// Модульные проверки чистых функций. Запуск: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { Splitter } from "../src/claude.ts";
import { config, hider, hookKey, lower } from "../src/config.ts";
import { fixSvg } from "../src/svg.ts";
import { prettyMath, splitAnswer } from "../src/text.ts";
import { base64, imageType, sameSecret } from "../src/util.ts";

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

test("поток режется на задания по отдельной строке @@@, даже если разделитель пришёл по кусочкам", () => {
  const s = new Splitter();
  assert.deepEqual(s.push("№1\nA\n@"), []);
  assert.deepEqual(s.push("@"), []);
  assert.deepEqual(s.push("@\n№2 @@@ в строке\nB"), ["№1\nA"]); // @@@ посреди строки не разделитель
  assert.deepEqual(s.push("\n  @@@ конец\n"), ["№2 @@@ в строке\nB"]);
  assert.deepEqual(s.push("<svg></svg>\n@@@"), []);
  assert.equal(s.rest(), "<svg></svg>"); // хвостовой разделитель без перевода строки убран
});

test("поток: посимвольная подача даёт тот же результат, что и целиком", () => {
  const text = "№1\nx = 2\n@@@\n№2\ny = 3\n@@@\n№3\nz = 4";
  const whole = new Splitter(), byChar = new Splitter();
  const a = [...whole.push(text), whole.rest()];
  const b = [...[...text].flatMap((ch) => byChar.push(ch)), byChar.rest()];
  assert.deepEqual(a, ["№1\nx = 2", "№2\ny = 3", "№3\nz = 4"]);
  assert.deepEqual(b, a);
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
  assert.equal(empty.model, "claude-opus-5-5");
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
