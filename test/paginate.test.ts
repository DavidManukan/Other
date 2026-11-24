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

test("буква на линии, проведённой поверх закрашенного круга, уходит с неё; широкая подпись на маленьком кружке остаётся", { skip }, async () => {
  const radius = await lay(TASK, [svg(`<circle cx="400" cy="260" r="180" fill="black" stroke="#fff" stroke-width="4"/><line x1="400" y1="260" x2="580" y2="260" stroke="#fff" stroke-width="4"/><text x="490" y="270" fill="#fff" font-size="30" text-anchor="middle">R</text>`)]);
  assert.deepEqual(radius.moved, ["R"]);
  const chain = await lay(TASK, [svg(`<line x1="150" y1="250" x2="650" y2="250" stroke="#fff" stroke-width="3"/><circle cx="400" cy="250" r="26" fill="#000"/><text x="400" y="262" fill="#fff" font-size="30" text-anchor="middle">CH2</text>`)]);
  assert.deepEqual(chain.moved, []);
});

test("рисунок с вырожденным преобразованием не роняет раскладку", { skip }, async () => {
  const r = await lay(TASK, [svg(`<g transform="scale(0)"><circle cx="400" cy="300" r="40" fill="#000"/></g><g transform="scale(1 0)"><text x="100" y="100" fill="#fff" font-size="30">A</text></g><line x1="100" y1="300" x2="700" y2="300" stroke="#fff" stroke-width="4"/><text x="380" y="310" fill="#fff" font-size="30">M</text>`)]);
  assert.ok(r.total >= 1);
});

test("абзац с чертой внутри скобок это обычный текст: он режется по листам, а не становится узкой колонкой", { skip }, async () => {
  const para = "Вероятность · №1\nУсловная вероятность P(A | B) показывает, как часто событие A наступает при условии B. " + Array.from({ length: 40 }, (_, i) => `Рассуждение ${i + 1}: в опыте ${i + 1} мы считаем исходы и делим одно число на другое.`).join(" ") + "\nОтвет: 0,5";
  const r = await lay([para]);
  assert.ok(r.total >= 3 && Math.max(...r.heights) <= PAGE_H + 120, JSON.stringify(r.heights));
  for (let i = 1; i <= 40; i++) assert.ok(r.text.includes(`Рассуждение ${i}: в опыте`), `пропало рассуждение ${i}`);
});

test("листинг с одной очень длинной строкой тоже режется по листам", { skip }, async () => {
  const data = Array.from({ length: 700 }, (_, i) => i * 7 % 1000).join(", ");
  const r = await lay(["Информатика · №5\nПрограмма:\n```\ndata = [" + data + "]\nprint(sum(data))\n```\nОтвет: 1"]);
  assert.ok(r.total >= 2 && Math.max(...r.heights) <= PAGE_H + 120, JSON.stringify(r.heights));
  // шапки продолжения и номера листов в сравнение не идут
  const body = r.text.replace(/Информатика · №5 \(продолжение\)/g, "").replace(/\d+ \/ \d+/g, "");
  assert.ok(body.replace(/\s+/g, "").includes(data.replace(/\s+/g, "")), "числа из листинга потерялись");
});

test("пометка «| ·4» стоит сразу за своим преобразованием; не помещается рядом: встаёт прямо под ним, формула остаётся целой", { skip }, async () => {
  const page = await (await open()).newPage({ viewport: { width: PAGE_W, height: 800 } });
  await page.setContent(pageHtml(["№1\n$x^2 = 9$ | $\\cdot 4$\n$4x^2 = 36$ | делим на 4\n$\\dfrac{x}{x-2} - \\dfrac{7}{x+2} = \\dfrac{8}{(x-2)(x+2)} + \\dfrac{1}{x^2-4}$ | $\\cdot (x-2)(x+2)$, $x \\ne \\pm 2$\nОтвет: $3$"], [], "", ""));
  await page.evaluate(PAGINATE);
  const rows = await page.evaluate(() => [...document.querySelectorAll(".row")].map((r) => {
    const main = (r.querySelector(".main") as HTMLElement).getBoundingClientRect(), note = (r.querySelector(".note") as HTMLElement).getBoundingClientRect(), all = r.getBoundingClientRect();
    return { gap: Math.round(note.left - main.right), free: Math.round(all.right - note.right), inside: note.right <= all.right + 1 && main.right <= all.right + 1, under: r.classList.contains("under"), drop: Math.round(note.top - main.bottom), indent: Math.round(note.left - main.left), broken: r.querySelectorAll(".f.brk").length };
  }));
  await page.close();
  assert.equal(rows.length, 3);
  for (const r of rows.slice(0, 2)) assert.ok(!r.under && r.gap >= 8 && r.gap <= 20 && r.inside, JSON.stringify(rows));
  assert.ok(rows[0].free > 150, JSON.stringify(rows)); // у короткой формулы пометка рядом с ней: справа остаётся пустое место
  // длинная формула с длинной пометкой: пометка под формулой с отступом, формула не разорвана
  assert.ok(rows[2].under && rows[2].drop >= 0 && rows[2].drop <= 8 && rows[2].indent >= 20 && rows[2].inside && rows[2].broken === 0, JSON.stringify(rows));
});

test("таблица шире листа ужимается и не выходит за его край", { skip }, async () => {
  const page = await (await open()).newPage({ viewport: { width: PAGE_W, height: 800 } });
  const head = "| " + Array.from({ length: 9 }, (_, i) => `Столбец ${i + 1}`).join(" | ") + " |";
  const rule = "| " + Array.from({ length: 9 }, () => "---").join(" | ") + " |";
  const row = "| " + Array.from({ length: 9 }, (_, i) => `$\\dfrac{${i + 1}}{7}$`).join(" | ") + " |";
  await page.setContent(pageHtml([`№1\n${head}\n${rule}\n${row}\n${row}\nОтвет: 1`], [], "", ""));
  await page.evaluate(PAGINATE);
  const box = await page.evaluate(() => {
    const t = (document.querySelector(".tbl") as HTMLElement).getBoundingClientRect(), s = (document.querySelector(".sheet") as HTMLElement).getBoundingClientRect();
    return { right: Math.round(t.right), sheet: Math.round(s.right), cells: document.querySelectorAll(".tbl td, .tbl th").length };
  });
  await page.close();
  assert.equal(box.cells, 27);
  assert.ok(box.right <= box.sheet, JSON.stringify(box));
});

test("таблица выше листа режется по строкам, шапка повторяется, строки не теряются", { skip }, async () => {
  const rows = Array.from({ length: 70 }, (_, i) => `| ${i + 1} | $x_{${i + 1}} = \\dfrac{${i + 1}}{3}$ | строка ${i + 1} |`).join("\n");
  const page = await (await open()).newPage({ viewport: { width: PAGE_W, height: 800 } });
  await page.setContent(pageHtml([`№1\n| n | значение | заметка |\n| --- | --- | --- |\n${rows}\nОтвет: 70 строк`], [], "", ""));
  const total = Number(await page.evaluate(PAGINATE));
  const out = await page.evaluate(() => ({
    heights: [...document.querySelectorAll(".sheet")].map((s) => Math.round(s.getBoundingClientRect().height)),
    tables: document.querySelectorAll(".tbl").length,
    heads: [...document.querySelectorAll(".tbl")].map((t) => (t as HTMLTableElement).rows[0].cells[0].textContent),
    text: [...document.querySelectorAll(".sheet")].map((s) => (s as HTMLElement).innerText).join(" "),
    widths: [...document.querySelectorAll(".tbl")].map((t) => Math.round((t as HTMLTableElement).rows[0].cells[1].getBoundingClientRect().width)),
  }));
  await page.close();
  assert.ok(total >= 3 && Math.max(...out.heights) <= PAGE_H + 120, JSON.stringify(out.heights));
  assert.ok(out.tables >= 3 && out.heads.every((h) => h === "n"), JSON.stringify(out.heads));
  for (let i = 1; i <= 70; i++) assert.ok(out.text.includes(`строка ${i}`), `пропала строка ${i}`);
  assert.ok(Math.max(...out.widths) - Math.min(...out.widths) <= 2, JSON.stringify(out.widths)); // столбцы на всех частях одной ширины
});

test("широкая таблица со словами: слова и числа не рвутся посреди, таблица остаётся на листе", { skip }, async () => {
  const page = await (await open()).newPage({ viewport: { width: PAGE_W, height: 800 } });
  await page.setContent(pageHtml(["№1\n| Вещество | Молярная масса | Количество | Температура | Давление | Объём |\n| --- | --- | --- | --- | --- | --- |\n| кислород | 32 г/моль | 0,25 моль | 273,15 К | 101325 Па | 5,6 л |\n| водород | 2 г/моль | 1,5 моль | 298,15 К | 101325 Па | 36,7 л |\nОтвет: 5,6 л"], [], "", ""));
  await page.evaluate(PAGINATE);
  const out = await page.evaluate(() => {
    const t = document.querySelector(".tbl") as HTMLElement, s = document.querySelector(".sheet") as HTMLElement;
    // ячейка с числом 101325 занимает одну строку: число не разорвано
    const cell = [...t.querySelectorAll("td")].find((c) => c.textContent === "101325 Па") as HTMLElement;
    const r = document.createRange();
    r.selectNodeContents(cell.firstChild as Node);
    const digits = cell.firstChild as Text;
    const one = document.createRange();
    one.setStart(digits, 0);
    one.setEnd(digits, 6);
    return { right: Math.round(t.getBoundingClientRect().right), sheet: Math.round(s.getBoundingClientRect().right), lines: one.getClientRects().length, font: parseFloat(getComputedStyle(t).fontSize) };
  });
  await page.close();
  assert.ok(out.right <= out.sheet && out.lines === 1 && out.font >= 11, JSON.stringify(out));
});
