// Сценарий раскладки (PAGINATE) в настоящем браузере: подписи на рисунках, разрезание высоких блоков, шапка продолжения.
// Нужен Playwright с браузером. Там, где его нет, проверки пропускаются (остальные тесты от него не зависят).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import { PAGE_H, PAGE_W, PAGINATE, pageHtml } from "../src/page.ts";
import { texLeak } from "../src/tex.ts";
import { splitAnswer } from "../src/text.ts";

let chromium: any = null;
try {
  chromium = createRequire("/")("playwright").chromium;
} catch {}
let browser: any = null;
const open = async () => (browser ??= await chromium.launch());
after(async () => { await browser?.close(); });
const skip = chromium ? false : "нет Playwright";

// Страница после раскладки: высоты листов, текст шапок продолжения, сдвинутые подписи
async function lay(parts: string[], svgs: string[] = []) {
  const page = await (await open()).newPage({ viewport: { width: PAGE_W, height: 800 } });
  await page.setContent(pageHtml(parts, svgs, "", ""));
  const before = await page.evaluate(() => (document.getElementById("flow") as HTMLElement).innerText.replace(/\s+/g, " ").trim());
  const total = await page.evaluate(PAGINATE);
  const out = await page.evaluate(() => ({
    heights: [...document.querySelectorAll(".sheet")].map((s) => Math.round(s.getBoundingClientRect().height)),
    conts: [...document.querySelectorAll(".cont")].map((c) => c.textContent ?? ""),
    moved: [...document.querySelectorAll("text[data-moved]")].map((t) => (t.textContent ?? "").trim()),
    text: [...document.querySelectorAll(".sheet")].map((s) => (s as HTMLElement).innerText).join(" ").replace(/\s+/g, " ").trim(),
    lone: [...document.querySelectorAll(".sheet")].some((s) => s.querySelectorAll(".b").length === 1 && s.querySelector("h2.b") !== null),
  }));
  await page.close();
  return { total: Number(total), before, ...out };
}
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#000"/><text x="40" y="50" fill="#fff" font-size="34">№1</text>${body}</svg>`;
const TASK = ["№1\nОтвет: 5"];

test("подпись, которая легла на толстую линию, отодвигается; подпись в стороне остаётся", { skip }, async () => {
  const r = await lay(TASK, [svg(`<line x1="100" y1="300" x2="700" y2="300" stroke="#fff" stroke-width="4"/><text x="380" y="310" fill="#fff" font-size="30">M</text><text x="380" y="200" fill="#fff" font-size="30">K</text>`)]);
  assert.deepEqual(r.moved, ["M"]);
});

test("числа у делений на тонких осях и сетке остаются под своими делениями", { skip }, async () => {
  const grid = Array.from({ length: 9 }, (_, i) => `<line x1="${100 + 75 * i}" y1="80" x2="${100 + 75 * i}" y2="460" stroke="#fff" stroke-width="1" stroke-dasharray="4 6"/><text x="${100 + 75 * i}" y="300" fill="#fff" font-size="24" text-anchor="middle">${i - 4}</text>`).join("");
  const r = await lay(TASK, [svg(`<line x1="60" y1="270" x2="760" y2="270" stroke="#fff" stroke-width="1"/>${grid}`)]);
  assert.deepEqual(r.moved, []);
});

test("буква на чёрном кружке (прибор в цепи, группа атомов) стоит там нарочно и не двигается", { skip }, async () => {
  const r = await lay(TASK, [svg(`<line x1="100" y1="250" x2="700" y2="250" stroke="#fff" stroke-width="3"/><circle cx="400" cy="250" r="34" fill="#000" stroke="#fff" stroke-width="3"/><text x="400" y="262" fill="#fff" font-size="32" text-anchor="middle">V</text>`)]);
  assert.deepEqual(r.moved, []);
});

test("кривая без fill=\"none\" подложкой не считается: подпись с неё всё равно уходит", { skip }, async () => {
  const r = await lay(TASK, [svg(`<path d="M150,460 Q400,-100 650,460" stroke="#fff" stroke-width="4"/><text x="235" y="300" fill="#fff" font-size="30">y = x²</text>`)]);
  assert.deepEqual(r.moved, ["y = x2"]);
});

test("длинный абзац и длинный листинг режутся на листы обычной высоты, текст при этом не теряется", { skip }, async () => {
  const essay = "Литература · №1\n" + Array.from({ length: 40 }, (_, i) => `Предложение номер ${i + 1} рассказывает о герое и его поступках подробно, с примерами из текста и выводом.`).join(" ") + "\nОтвет: герой меняется.";
  const e = await lay([essay]);
  assert.ok(e.total >= 3 && Math.max(...e.heights) <= PAGE_H + 120, JSON.stringify(e.heights));
  for (let i = 1; i <= 40; i++) assert.ok(e.text.includes(`Предложение номер ${i} рассказывает`), `пропало предложение ${i}`);
  assert.equal(e.lone, false); // заголовок не остался на листе один
  const code = "Информатика · №2\n```\n" + Array.from({ length: 90 }, (_, i) => `x_${i} = ${i} * 2  # строка ${i}`).join("\n") + "\n```\nОтвет: 178";
  const c = await lay([code]);
  assert.ok(c.total >= 3 && Math.max(...c.heights) <= PAGE_H + 120, JSON.stringify(c.heights));
  for (const i of [0, 1, 44, 45, 88, 89]) assert.ok(c.text.includes(`x_${i} = ${i} * 2`), `пропала строка ${i}`);
});

test("шапка продолжения на следующих листах без разметки", { skip }, async () => {
  const raw = "Вариант 2 · №1 ($x^{2} = \\frac{1}{4}$)\n" + Array.from({ length: 45 }, (_, k) => `Шаг ${k + 1}: $x_{${k}} = \\frac{${k}}{2} + \\sqrt{${k}}$`).join("\n") + "\nОтвет: $\\frac{1}{2}$";
  const r = await lay([splitAnswer(raw).text]);
  assert.ok(r.total >= 2 && r.conts.length >= 1, JSON.stringify(r.heights));
  for (const c of r.conts) {
    assert.equal(c, "Вариант 2 · №1 (x² = 1/4) (продолжение)");
    assert.equal(texLeak(c), null);
  }
});
