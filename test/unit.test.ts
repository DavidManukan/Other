// Модульные проверки чистых функций. Запуск: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { Busy, Fatal, activeModel, allText, answerText, claudeProblem, tasks, thinkGuess, unavailable } from "../src/claude.ts";
import { config, hider, hookKey, logKey, lower, publicOrigin } from "../src/config.ts";
import { Green, GreenError, permanent } from "../src/green.ts";
import { assign, chunks, figureLabel, inline, pageHtml, taskHtml, tex } from "../src/page.ts";
import { fixSvg } from "../src/svg.ts";
import { mathSpans, plainMath, texToPlain } from "../src/tex.ts";
import { RULE, card, compose, plainText, prettyMath, seam, splitAnswer, tidy } from "../src/text.ts";
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
  const pic = (n: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><text>${n}</text></svg>`;
  const r = splitAnswer(`№1\nОтвет: 4\n\n\n\n\`\`\`svg\n${pic(1)}\n\`\`\`\nхвост <svg viewBox="0 0 1 1"><line недописан`);
  assert.deepEqual(r, { text: "№1\nОтвет: 4\n\nхвост", svgs: [pic(1)] });
  assert.deepEqual(splitAnswer(pic(1) + pic(2)), { text: "", svgs: [pic(1), pic(2)] });
  // блок с рисунком оборвался до закрывающих ```
  assert.deepEqual(splitAnswer(`№1\nОтвет: 1\n@@@\n\`\`\`svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect`), { text: "№1\nОтвет: 1\n@@@", svgs: [] });
});

test("слово <svg> в тексте и SVG внутри кода программы рисунком не считаются", () => {
  const a = splitAnswer("№1\nКакой тег рисует графику?\nОтвет: <svg>\n@@@\n№2\nОтвет: 5");
  assert.deepEqual(a, { text: "№1\nКакой тег рисует графику?\nОтвет: <svg>\n@@@\n№2\nОтвет: 5", svgs: [] });
  const code = '```html\n<html><body>\n<svg width="100" height="100"><circle r="40"/></svg>\n</body></html>\n```';
  const b = splitAnswer(`№1\n${code}\nОтвет: круг`);
  assert.equal(b.text, `№1\n${code}\nОтвет: круг`);
  assert.deepEqual(b.svgs, []);
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
});

test("список ответов: все строки «Ответ:» задания, ответ со следующей строки, заголовок по номеру", () => {
  assert.equal(card(["№3\nрешение\nОтвет: а) 1\nещё\nОтвет: б) 2", "№4\nОтвет:   \n7"]), "✅ Ответы\n№3: а) 1; б) 2\n№4: 7");
  assert.equal(card(["Проверю вычисления.\n\n№1\nx = 5\nОтвет: 5"]), "✅ Ответы\n№1: 5");
  assert.equal(card(["№1\n```\nОтвет: не этот\n```\nОтвет: 35"]), "✅ Ответы\n№1: 35");
  assert.equal(card(["№2\nдоказательство\nч.т.д."]), "✅ Ответы\n№2: см. решение");
  // ответ перенесён на следующую строку: в список идёт целиком; чужая строка после законченного ответа не цепляется
  assert.equal(card(["№1\nОтвет: 1380 год (8 сентября), войско возглавлял\nДмитрий Иванович Донской.", "№2\nОтвет: мера стоимости, средство обращения,\nсредство накопления."]), "✅ Ответы\n№1: 1380 год (8 сентября), войско возглавлял Дмитрий Иванович Донской.\n№2: мера стоимости, средство обращения, средство накопления.");
  // два прочтения неразборчивого числа: у каждого ответа видно, к какому прочтению он относится
  assert.equal(card(["№1\nЕсли в условии 28:\nx = 5\nОтвет: 5\nЕсли в условии 23:\nОтвет: 4"]), "✅ Ответы\n№1: при 28: 5; при 23: 4");
  assert.equal(card(["№2\nРешение:\nНе видно: конец условия. Пересними ближе."]), "✅ Ответы\n№2: не видно условия, пересними ближе");
  // после ответа идёт другая метка или второй ответ: чужая строка к ответу не приклеивается
  assert.equal(card(["№2\nОтвет: 12 см\nПроверка: 3 + 4 + 5 = 12."]), "✅ Ответы\n№2: 12 см");
  assert.equal(card(["№1\nа) x = 2\nОтвет: а) 2;\nб) y = 3\nОтвет: б) 3."]), "✅ Ответы\n№1: а) 2; б) 3.");
  assert.equal(card(["№5\nОтвет: растёт\nПравило: всегда так."]), "✅ Ответы\n№5: растёт");
  // ответ содержит цифры прочтения: пометка «при 28» всё равно ставится; точка перед «;» убирается
  assert.equal(card(["№2\nЕсли в условии 28:\nОтвет: s = 280 м.\nЕсли в условии 23:\nОтвет: s = 230 м."]), "✅ Ответы\n№2: при 28: s = 280 м; при 23: s = 230 м.");
  // у задания нет заголовка: в списке оно идёт по номеру, а не по первой попавшейся строке
  assert.equal(card(["Дано:\n$a = 1$\nОтвет: 1", "№3\nРешено выше."]), "✅ Ответы\nЗадание 1: 1\n№3: решено выше");
  const long = card([`№1\nОтвет: ${"слово ".repeat(60)}`]);
  assert.ok(long.length < 160 && long.endsWith("…") && !long.endsWith(" …"));
});

test("длинное задание с кодом: блок кода закрывается и открывается заново, длинная строка не теряется", () => {
  const code = Array.from({ length: 120 }, (_, i) => `    print(${i})  # строка программы номер ${i}`).join("\n");
  const msgs = compose([`№1\n\`\`\`python\n${code}\n\`\`\`\nОтвет: 1`, "№2\nОтвет: 2"], 1500);
  assert.ok(msgs.length > 2);
  for (const m of msgs) assert.equal((m.match(/```/g) ?? []).length % 2, 0, m.slice(0, 80)); // в каждом сообщении блоки закрыты
  assert.ok(msgs.every((m) => m.length <= 1520), String(msgs.map((m) => m.length)));
  for (let i = 0; i < 120; i++) assert.ok(msgs.some((m) => m.includes(`print(${i})  #`)));
  const digits = "7".repeat(4000);
  const cut = compose([`№1\nОтвет: ${digits}`, "№2\nОтвет: 2"], 1500);
  assert.equal(cut.join("").split("7").length - 1 >= 4000, true); // все цифры на месте
});

test("оборванный ответ обрезается до целой строки, недорисованный рисунок убирается", () => {
  assert.equal(seam("№1\nx = 3\nПодставим x = 3 в урав"), "№1\nx = 3");
  assert.equal(seam('№1\nОтвет: 2\n@@@\n<svg xmlns="x" viewBox="0 0 1 1"><line x1="0"'), "№1\nОтвет: 2\n@@@");
  assert.equal(seam('№1\n<svg viewBox="0 0 1 1"></svg>\nдальше текст\nобрыв'), '№1\n<svg viewBox="0 0 1 1"></svg>\nдальше текст');
  assert.equal(seam("одна недописанная строка"), "");
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
  const r = splitAnswer("№1\nx^2 и my_var, **важно**\n```\nfor i in range(3):\n    x_1 = a ** 2  # x^2\n```\nH2O\nОтвет: $\\dfrac{9}{2}$");
  assert.equal(r.text, "№1\nx^2 и my_var, важно\n```\nfor i in range(3):\n    x_1 = a ** 2  # x^2\n```\nH2O\nОтвет: $\\dfrac{9}{2}$"); // формулы остаются как есть: их набирает страница
  assert.equal(plainText(r.text), "№1\nx² и my_var, важно\n```\nfor i in range(3):\n    x_1 = a ** 2  # x^2\n```\nH₂O\nОтвет: 9/2");
  assert.equal(splitAnswer("## №1\nОтвет: 1").text, "№1\nОтвет: 1");
});

test("заряды ионов и адреса сайтов не портятся", () => {
  assert.equal(prettyMath("ионы Fe3+ и Al3+, Cu2+ + 2OH- = Cu(OH)2"), "ионы Fe³⁺ и Al³⁺, Cu²⁺ + 2OH- = Cu(OH)₂");
  assert.equal(prettyMath("SO42- и CH3-CH2-OH"), "SO42- и CH₃-CH₂-OH");
  assert.equal(prettyMath("см. https://example.com/a1/B2 и x1"), "см. https://example.com/a1/B2 и x₁");
});

test("формулы LaTeX переводятся в обычный текст для подписи и запасного ответа", () => {
  const cases: Record<string, string> = {
    "\\dfrac{4}{3}": "4/3",
    "x = \\frac{-b \\pm \\sqrt{D}}{2a}": "x = (−b ± √D)/(2a)",
    "x_{1,2} = \\dfrac{5 \\pm 1}{2}": "x₁,₂ = (5 ± 1)/2",
    "\\operatorname{tg}\\alpha = \\dfrac{SO}{OM}": "tg α = SO/OM",
    "\\log_{0{,}5}(2x-4) \\geq -2": "log₀,₅(2x−4) ≥ −2",
    "x \\in (-\\infty; 2) \\cup [4; +\\infty)": "x ∈ (−∞; 2) ∪ [4; +∞)",
    "x = \\dfrac{\\pi}{2} + 2\\pi k,\\ k \\in \\mathbb{Z}": "x = π/2 + 2πk, k ∈ ℤ",
    "\\angle SMO = 90^\\circ": "∠SMO = 90°",
    "F_{\\text{тр}} = \\mu N": "Fтр = μN",
    "\\int_0^1 x e^x\\,dx = 1": "∫₀¹ x eˣ dx = 1",
    "\\lim_{x \\to 0} \\dfrac{1 - \\cos 2x}{x^2} = 2": "lim(x → 0) (1 − cos 2x)/x² = 2",
    "\\begin{cases} x + y = 5 \\\\ xy = 6 \\end{cases}": "система: x + y = 5; xy = 6",
    "S = \\dfrac{1}{2} \\cdot 10 \\cdot 24 = 120\\ \\text{см}^2": "S = 1/2 · 10 · 24 = 120 см²",
    "\\sqrt{2x+3} = x": "√(2x+3) = x",
    "\\dfrac{2\\sqrt{3}}{3}": "2√3/3",
    "y = 3e^{x^2}": "y = 3e^(x²)",
    "\\sqrt[3]{x+1}": "∛(x+1)",
    "(A \\lor B) \\to \\neg C": "(A ∨ B) → ¬C",
    // дробь перед множителем берётся в скобки, иначе читалась бы как деление на произведение
    "\\Delta U = \\dfrac{3}{2}\\nu R \\Delta T": "ΔU = (3/2)νR ΔT",
    "\\dfrac{1}{2}(a+b)": "(1/2)(a+b)",
    "\\dfrac{3}{2} \\cdot 5": "3/2 · 5",
    "S = \\dfrac{1}{2}ab\\sin\\gamma": "S = (1/2)ab sin γ",
    "V = \\dfrac{1}{3} S_{ABD} \\cdot AA_1": "V = (1/3) S(ABD) · AA₁",
    "\\dfrac{V}{V_m}": "V/Vₘ",
    "\\dfrac{dy}{dx} = 2xy": "dy/dx = 2xy",
    "\\dfrac{m(\\text{Zn})}{m(\\text{смеси})}": "m(Zn)/m(смеси)",
    "\\smile AB = 70^\\circ": "◡AB = 70°",
    "\\begin{vmatrix} -1 & 4 \\\\ 2 & 5 \\end{vmatrix} - 0": "|−1 4; 2 5| − 0",
    // смешанное число, множитель после дроби и корня, функция после буквы: запись не должна менять смысл
    "2\\dfrac{1}{3}": "2 1/3",
    "2\\frac{a}{b}": "2a/b",
    "y = \\dfrac{1}{2}x + 3": "y = (1/2)x + 3",
    "V = \\dfrac{4}{3}\\pi R^3": "V = (4/3)πR³",
    "x = \\dfrac{\\pi}{4} + \\dfrac{\\pi}{2}k": "x = π/4 + (π/2)k",
    "\\frac{a}{b}^{2}": "(a/b)²",
    "\\sin^2\\dfrac{x}{2}": "sin²(x/2)",
    "\\dfrac{1}{2}\\text{ см}": "1/2 см",
    "\\sqrt{2}x": "√2·x",
    "\\sqrt{2x}": "√2x",
    "4\\sqrt{3}\\text{ см}": "4√3 см",
    "2\\sin x\\cos x": "2 sin x cos x",
    "x\\ln x": "x ln x",
    "2^{\\pi}x": "2^(π)x",
    "x^\\pi": "x^π",
    "\\binom{5}{2} = 10": "C(5, 2) = 10",
    "a \\not= b": "a ≠ b",
    "0{,}\\overline{3}": "0,(3)",
    "\\left.\\dfrac{x^2}{2}\\right|_0^1": "x²/2|₀¹",
    "\\ce{2H2 + O2 -> 2H2O}": "2H₂ + O₂ → 2H₂O",
    "\\ce{SO4^{2-}}": "SO₄²⁻",
    "\\sqrt{3}\\geqslant 1": "√3≥ 1",
    "\\sqrt{3}\\sin x": "√3·sin x",
    "\\sin\\alpha\\cos\\beta + \\cos\\alpha\\sin\\beta": "sin α cos β + cos α sin β",
    "\\omega t": "ωt",
  };
  for (const [a, b] of Object.entries(cases)) assert.equal(texToPlain(a), b, a);
  assert.equal(plainMath("Ответ: $x = \\dfrac{2\\sqrt{3}}{3}$ см, цена 5$ и $y$."), "Ответ: x = 2√3/3 см, цена 5$ и y.");
  assert.deepEqual(mathSpans("a $b$ c").map((s) => s.math), [false, true, false]);
  // числа в другой системе счисления после перевода формулы не принимаются за химическую формулу
  assert.equal(plainText("Ответ: $1A2_{16}$ и $a1_{16}$, H2SO4"), "Ответ: 1A2₁₆ и a1₁₆, H₂SO₄");
});

test("страница решения: формулы набраны, «Дано» блоком, пометки справа, ответ в рамке", () => {
  const html = taskHtml("№2\nДано:\n$AB = 6$ см\nНайти: $SO$\nРешение:\n$x^2 = 4$ | $\\cdot 2$\n|x − 1| = 3\nОтвет: $\\dfrac{4}{3}$.", []);
  assert.match(html, /<section class="task" data-title="№2"><h2 class="b">№2<\/h2>/);
  // единица после формулы склеена с ней: «6 см» не разорвётся по строкам
  assert.match(html, /<div class="b given"><div class="lbl">Дано:<\/div><div><span class="glue"><span class="f"><span class="fx"><span class="katex">.*<\/span>\u00a0см<\/span><\/div>/);
  assert.match(html, /<div class="find"><span class="lbl">Найти:<\/span> <span class="f"><span class="fx"><span class="katex">/);
  assert.match(html, /<div class="b lbl">Решение:<\/div>/);
  assert.match(html, /<div class="b row"><div class="main"><span class="f"><span class="fx"><span class="katex">.*<div class="note"><span class="f"><span class="fx"><span class="katex">/);
  assert.match(html, /<div class="b line">\|x − 1\| = 3<\/div>/); // модуль это не пометка
  assert.match(html, /<div class="b ans"><span class="lbl">Ответ:<\/span> <span class="glue"><span class="f"><span class="fx"><span class="katex">.*mfrac.*<\/span>\.<\/span><\/div>/);
  // цепочка равенств делится на куски по знакам верхнего уровня: на странице она переносится перед знаком, а не посреди скобки
  assert.deepEqual(chunks("S = \\dfrac{a = b}{2} = \\left(x = 1\\right) \\le 54"), ["S ", "= \\dfrac{a = b}{2} ", "= \\left(x = 1\\right) ", "\\le 54"]);
  assert.deepEqual(chunks("P(X = 2) = 0{,}3"), ["P(X = 2) ", "= 0{,}3"]); // внутри скобок не режем
  assert.deepEqual(chunks("a \\not= b"), ["a \\not= b"]); // перечёркнутый знак не отрывается от черты
  assert.deepEqual(chunks("x := 5"), ["x := 5"]);
  assert.equal(inline("$30(x-2) = 8(x^2-4)$").split('<span class="fx">').length - 1, 2);
  // ответ, перенесённый на вторую строку, целиком попадает в рамку; рисунок задания без «Дано» стоит перед ответом
  const two = taskHtml("№1\nрешение\nОтвет: 1380 год, войско возглавлял\nДмитрий Донской.", [{ svg: '<svg xmlns="x" viewBox="0 0 8 8"><text>№1</text></svg>', own: true }]);
  assert.match(two, /class="b fig">.*<div class="b ans"><span class="lbl">Ответ:<\/span> 1380 год, войско возглавлял Дмитрий Донской\.<\/div><\/section>$/);
  // строка таблицы с несколькими чертами это не пометка; запись электронного баланса с одной чертой остаётся пометкой
  assert.match(taskHtml("№1\nx | y | F\n0 | 1 | 1\nОтвет: 1", []), /<div class="b line">x \| y \| F<\/div><div class="b line">0 \| 1 \| 1<\/div>/);
  assert.match(taskHtml("№1\nMn⁺⁷ + 5e⁻ → Mn⁺² | 2\nОтвет: 1", []), /<div class="main">Mn⁺⁷ \+ 5e⁻ → Mn⁺²<\/div><div class="note">2<\/div>/);
  // «Найти:» отдельной строкой: искомое не попадает в данные; решение без строки «Решение:» не попадает в блок «Дано»
  const bare = taskHtml("№3\nДано:\n$m = 1$ кг\nНайти:\n$F$ — ?\nОбоснование:\nтело точка\n$F = ma$ | закон\nОтвет: 1", []);
  assert.match(bare, /Дано:<\/div><div><span class="glue"><span class="f"><span class="fx">[^]*?<\/div><div class="find"><span class="lbl">Найти:<\/span> <span class="f"><span class="fx">[^]*? — \?<\/div><\/div><div class="b lbl">Обоснование:<\/div><div class="b line">тело точка<\/div><div class="b row">/);
  const noLabel = taskHtml("№3\nДано: $v = 2$\nНайти: $t$\nРешение.\n$t = 1$ | делим\nОтвет: 1", []);
  assert.match(noLabel, /<\/div><\/div><div class="b line">Решение\.<\/div><div class="b row">/);
  // формула с опечаткой показывается текстом, страница не ломается; разметка из текста не исполняется
  assert.match(inline("$\\frac{1}{$ и <b>x</b>"), /class="raw".*&lt;b&gt;x&lt;\/b&gt;/);
});

test("рисунок попадает в своё задание по номеру в углу и чистится от всего лишнего", () => {
  const pic = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#000"/><text x="40" y="50" fill="#fff" font-size="34">${label}</text><script>alert(1)</script><image href="https://x/y.png"/><line stroke="#fff" onclick="x()"/></svg>`;
  assert.equal(figureLabel(pic("Вариант 1 · №2")), "Вариант 1 · №2");
  const parts = ["Вариант 1 · №1\nОтвет: 1", "Вариант 1 · №2\nДано:\n$a = 1$\nРешение:\nтекст\nОтвет: 2", "№7\nОтвет: 3"];
  const figs = assign(parts, [pic("Вариант 1 · №2"), pic("№7"), pic("нет такого")]);
  assert.deepEqual(figs.map((f) => f.length), [0, 1, 2]); // рисунок без пары уходит к последнему заданию
  const html = taskHtml(parts[1], figs[1]);
  assert.ok(html.indexOf('class="b fig"') > html.indexOf('class="b given"') && html.indexOf('class="b fig"') < html.indexOf("Решение:")); // чертёж сразу под «Дано»
  assert.ok(!/script|onclick|<image|https:\/\/x/.test(html));
  assert.ok(!html.includes(">Вариант 1 · №2</text>")); // номер в углу своего рисунка на странице не повторяется
  // подпись деления оси «1» не принимается за заголовок «№1»; две работы со своим №1 получают каждая свой рисунок
  assert.deepEqual(assign(["№1\nОтвет: 4", "№2\nграфик"], [pic("1")]).map((f) => f.map((x) => x.own)), [[], [false]]);
  assert.deepEqual(assign(["Геометрия · №1\nОтвет: 1", "Физика · №1\nОтвет: 2"], [pic("Геометрия · №1"), pic("Физика · №1")]).map((f) => f.length), [1, 1]);
  assert.deepEqual(assign(["Геометрия\n№1\nОтвет: 1", "Физика\n№1\nОтвет: 2"], [pic("№1"), pic("№1")]).map((f) => f.length), [1, 1]);
  // кавычка в заголовке не выходит из атрибута, страница запрещает скрипты и загрузку из сети
  assert.ok(taskHtml('Вариант 1" style="color:red\nОтвет: 1', []).includes('data-title="Вариант 1&quot; style=&quot;color:red"'));
  assert.ok(pageHtml(["№1\nОтвет: 1"], [], "", "").includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">`));
  assert.ok(taskHtml(parts[2], figs[2]).includes(">нет такого</text>")); // у чужого рисунка подпись остаётся
});

test("ответ модели: берётся решение, а не заметки между проверками в песочнице", () => {
  const text = (t: string) => ({ type: "text", text: t }) as any;
  const tool = { type: "server_tool_use" } as any, result = { type: "code_execution_tool_result" } as any, fb = { type: "fallback" } as any;
  assert.equal(answerText([text("Проверю в песочнице."), tool, result, text("№1\nОтвет: 4")]), "№1\nОтвет: 4");
  // решение написано до проверки, после неё только заметка: уходит решение
  assert.equal(answerText([text("№1\nx = 4\nОтвет: 4\n@@@\n№2\nОтвет: 7"), tool, result, text("Проверка подтвердила оба ответа.")]), "№1\nx = 4\nОтвет: 4\n@@@\n№2\nОтвет: 7");
  assert.equal(answerText([text("№1\nОтвет: 4"), tool, result]), "№1\nОтвет: 4");
  // после проверки модель переписала ответ целиком: берётся новый
  assert.equal(answerText([text("№1\nОтвет: 5"), tool, result, text("№1\nОтвет: 4")]), "№1\nОтвет: 4");
  // ход подхватила запасная модель: она продолжает с того же места, начало ответа не теряется
  assert.equal(answerText([text("№1\nОтвет: 4\n@@@\n№2\nРеакция идёт "), fb, text("с выделением газа.\nОтвет: 22,4 л")]), "№1\nОтвет: 4\n@@@\n№2\nРеакция идёт с выделением газа.\nОтвет: 22,4 л");
  assert.equal(answerText([text("Сейчас пересчитаю."), tool, result]), ""); // решения нет вовсе: бот попросит модель его написать
  assert.equal(allText([text("заметка"), tool, result, text("итог")]), "заметка\n\nитог");
  assert.equal(answerText([{ type: "thinking" } as any, text("№1\n"), text("Ответ: 4")]), "№1\nОтвет: 4");
  // ход оборван, пока модель переписывала решение после проверки: берётся новый текст, старое решение не подклеивается
  const rewrite = [text("№1\nОтвет: 5"), tool, result, text("№1\nпересчёт: x = ")];
  assert.equal(answerText(rewrite), "№1\nОтвет: 5");
  assert.equal(answerText(rewrite, true), "№1\nпересчёт: x = ");
});

test("рисунок приводится к одному стилю: чёрный фон, белые линии и подписи, шрифт, индексы", () => {
  const out = fixSvg('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="white"/><text fill="black">CH3 x^2 A₁</text><text>без цвета</text><line stroke="#000"/><line stroke="#D5643C"/></svg>');
  assert.match(out, /^<svg font-family="DejaVu Sans"/);
  assert.match(out, /<rect width="10" height="10" fill="#000"\/>/);
  assert.ok(!/black|D5643C|stroke="#000"/.test(out));
  assert.equal(out.split('<line stroke="#fff"/>').length, 3);
  assert.match(out, /<text fill="#fff">без цвета/);
  assert.match(out, /CH<tspan baseline-shift="sub" font-size="65%">3<\/tspan>/);
  assert.match(out, /x<tspan baseline-shift="super" font-size="65%">2<\/tspan>/);
  assert.match(out, /A<tspan baseline-shift="sub" font-size="65%">1<\/tspan>/);
  // рисунок без фона получает чёрную подложку, старый серый фон становится чёрным
  assert.match(fixSvg('<svg viewBox="0 0 1 1"><circle r="1"/></svg>'), /<rect width="100%" height="100%" fill="#000"\/>/);
  assert.match(fixSvg('<svg viewBox="0 0 800 500"><rect width="800" height="500" fill="#171717"/></svg>'), /<rect width="800" height="500" fill="#000"\/>/);
  // белый брусок на чертеже остаётся белым, фигура с чёрной заливкой остаётся чёрной
  const body = fixSvg('<svg viewBox="0 0 800 500"><rect width="800" height="500" fill="#000"/><rect x="300" y="250" width="160" height="80" fill="#fff"/><circle r="5" fill="#000" stroke="#fff"/></svg>');
  assert.match(body, /<rect x="300" y="250" width="160" height="80" fill="#fff"\/>/);
  assert.match(body, /<circle r="5" fill="#000" stroke="#fff"\/>/);
  // перенос строки в подписи (tspan с x и dy) не превращается в индекс
  const lines = '<text x="10" y="40" fill="#fff">Дано:<tspan x="10" dy="40">AB=5</tspan></text>';
  assert.ok(fixSvg(`<svg viewBox="0 0 8 8">${lines}</svg>`).includes('<tspan x="10" dy="40">AB=5</tspan>'));
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
  const log = await logKey(c); // ссылка на журнал открывается своим ключом: вебхук по ней не подделать
  assert.ok(/^[0-9a-f]{32}$/.test(log) && log !== key);
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

test("шлюз не ответил на отправку: по журналу исходящих видно, ушло ли сообщение", async () => {
  const c = config({ ANTHROPIC_API_KEY: "k", GREEN_URL: "https://7103.api.greenapi.com", GREEN_ID: "7103", GREEN_TOKEN: "secret-token-123" } as any);
  const real = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const journal = [
    { chatId: "1@c.us", timestamp: now, typeMessage: "extendedTextMessage", textMessage: "✅ Ответы\n№1: 4" },
    { chatId: "1@c.us", timestamp: now, typeMessage: "imageMessage", fileName: "b89ded5e-1a3b-4168-895a-540123456789.png", caption: "2 / 3" },
    { chatId: "1@c.us", timestamp: now, typeMessage: "documentMessage", fileName: "reshenie-doc.png" },
    { chatId: "2@c.us", timestamp: now, typeMessage: "textMessage", textMessage: "чужой чат" },
    { chatId: "1@c.us", timestamp: now - 900, typeMessage: "textMessage", textMessage: "старое" },
  ];
  let url = "";
  globalThis.fetch = (async (u: any) => ((url = String(u)), new Response(JSON.stringify(journal)))) as typeof fetch;
  try {
    const g = new Green(c);
    const since = Date.now() - 20_000;
    assert.equal(await g.wasSent("1@c.us", since, { text: "✅ Ответы\n№1: 4" }), true);
    assert.match(url, /lastOutgoingMessages\/secret-token-123\?minutes=\d+$/);
    // шлюз даёт картинке своё имя файла: страницу узнаём по подписи
    assert.equal(await g.wasSent("1@c.us", since, { file: "reshenie-abc.png", caption: "2 / 3" }), true);
    assert.equal(await g.wasSent("1@c.us", since, { file: "reshenie-abc.png", caption: "3 / 3" }), false);
    assert.equal(await g.wasSent("1@c.us", since, { file: "reshenie-abc.png" }), false); // без подписи картинку не опознать: шлём ещё раз
    assert.equal(await g.wasSent("1@c.us", since, { file: "reshenie-doc.png" }), true);
    assert.equal(await g.wasSent("1@c.us", since, { text: "чужой чат" }), false);
    assert.equal(await g.wasSent("1@c.us", since, { text: "старое" }), false); // было до этой отправки
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    assert.equal(await g.wasSent("1@c.us", since, { text: "✅ Ответы\n№1: 4" }), false); // не узнали: шлём ещё раз
  } finally {
    globalThis.fetch = real;
  }
});

test("картинка: после таймаута загрузки по ссылке следом не шлём, после отказа шлём", async () => {
  const c = config({ ANTHROPIC_API_KEY: "k", GREEN_URL: "https://7103.api.greenapi.com", GREEN_ID: "7103", GREEN_TOKEN: "secret-token-123" } as any);
  const real = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = (async (u: any) => {
      calls.push(String(u));
      if (String(u).includes("sendFileByUpload")) throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      return new Response("{}");
    }) as typeof fetch;
    const err = await new Green(c).sendImage("1@c.us", new Uint8Array([1]), "https://w/?img=1", "p.png", "подпись").then(() => null, (e) => e);
    assert.ok(err instanceof GreenError && err.timeout);
    assert.equal(calls.length, 1); // файл мог уйти: вторая отправка задвоила бы картинку
    calls.length = 0;
    let body = "";
    globalThis.fetch = (async (u: any, init: any) => {
      calls.push(String(u));
      if (String(u).includes("sendFileByUpload")) return new Response("bad", { status: 500 });
      body = String(init?.body ?? "");
      return new Response("{}");
    }) as typeof fetch;
    await new Green(c).sendImage("1@c.us", new Uint8Array([1]), "https://w/?img=1", "p.png", "подпись");
    // шлюз ответил 500: файл он мог успеть принять, поэтому перед отправкой по ссылке бот смотрит в журнал исходящих
    assert.equal(calls.length, 3);
    assert.match(calls[1], /lastOutgoingMessages/);
    assert.deepEqual(JSON.parse(body), { chatId: "1@c.us", urlFile: "https://w/?img=1", fileName: "p.png", caption: "подпись" });
    // картинка в журнале уже есть: по ссылке второй раз не шлём
    calls.length = 0;
    const now = Math.floor(Date.now() / 1000);
    globalThis.fetch = (async (u: any) => {
      calls.push(String(u));
      if (String(u).includes("sendFileByUpload")) return new Response("bad gateway", { status: 502 });
      return new Response(JSON.stringify([{ chatId: "1@c.us", timestamp: now, typeMessage: "imageMessage", fileName: "auto.png", caption: "подпись" }]));
    }) as typeof fetch;
    await new Green(c).sendImage("1@c.us", new Uint8Array([1]), "https://w/?img=1", "p.png", "подпись");
    assert.ok(calls.length === 2 && !calls.some((u) => u.includes("sendFileByUrl")), String(calls.length));
    // ясный отказ 4xx: в журнал не ходим, сразу по ссылке
    calls.length = 0;
    globalThis.fetch = (async (u: any) => (calls.push(String(u)), String(u).includes("sendFileByUpload") ? new Response("too big", { status: 413 }) : new Response("{}"))) as typeof fetch;
    await new Green(c).sendImage("1@c.us", new Uint8Array([1]), "https://w/?img=1", "p2.png", "подпись");
    assert.ok(calls.length === 2 && calls[1].includes("sendFileByUrl"));
  } finally {
    globalThis.fetch = real;
  }
});

test("знак процента и разряды числа в формуле не пропадают на странице; единица не отрывается от формулы", () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, "");
  assert.equal(text(tex("12% + 3 = 15")), "12%+3=15"); // без черты перед % KaTeX счёл бы остаток комментарием
  assert.equal(text(tex("r = 10\\%")), "r=10%"); // уже с чертой: вторая не добавляется
  assert.equal((tex("S = 1 320 000").match(/margin-right:0\.1667em/g) ?? []).length, 2); // между разрядами стоит тонкий пробел
  assert.equal((tex("S = 1320000").match(/margin-right:0\.1667em/g) ?? []).length, 0);
  assert.equal(text(tex("x = 5 + 3")), "x=5+3"); // обычные пробелы в формуле по-прежнему ничего не значат
  assert.match(inline("Итого $AC = 12$ см."), /<span class="glue"><span class="f">.*<\/span>\u00a0см\.<\/span>$/);
  assert.ok(!inline("Здесь $x = 5$ получается при подстановке.").includes('class="glue"')); // длинное слово не приклеивается
  assert.ok(!inline("$x = 5$ и $y = 6$").includes('class="glue"') || inline("$x = 5$ и $y = 6$").includes("\u00a0и")); // союз из одной буквы можно приклеить, формулы при этом целы
});

test("текст для тетради: строка «Ответ: сочинение, N слов» уходит в заголовок, отсылка «в решении» убирается", () => {
  assert.equal(tidy("№27\nТекст сочинения. Второе предложение.\nОтвет: сочинение, 250 слов."), "№27 · 250 слов\nТекст сочинения. Второе предложение.");
  assert.equal(tidy("№1\n1) CH₃–CH₃ + Cl₂ → CH₃–CH₂Cl + HCl\n2) ещё уравнение\nОтвет: уравнения 1)–2) в решении."), "№1\n1) CH₃–CH₃ + Cl₂ → CH₃–CH₂Cl + HCl\n2) ещё уравнение");
  // обычный ответ, ответ с полезным хвостом и код остаются как есть
  for (const p of ["№3\nx = 5\nОтвет: 5", "№9\nтекст\nОтвет: программа в решении; нужен файл 17.txt.", "№2\n```\nprint(1)\n```\nОтвет: программа в решении."]) assert.equal(tidy(p), p);
  assert.deepEqual(compose(["№1\nРешение первого.\nОтвет: 4", "№27\nТекст сочинения. Ещё.\nОтвет: сочинение, 250 слов."], 12_000), ["✅ Ответы\n№1: 4\n№27: сочинение, 250 слов.\n——————————\n№1\nРешение первого.\nОтвет: 4\n——————————\n№27 · 250 слов\nТекст сочинения. Ещё."]);
  assert.equal(card(["№1\n1) уравнение\nОтвет: уравнения 1)–4) в решении."]), "✅ Ответы\n№1: см. решение");
  // длинный ответ в списке режется после целого пункта, а не посреди слова
  const long = card([`№2\nОтвет: ${"да, действует; "}${"невесомость возникает потому что космонавт и станция свободно падают вместе с одинаковым ускорением, ".repeat(2)}конец`]);
  assert.ok(/[а-яё]…$/.test(long) && !/[,;]…$/.test(long) && long.length < 170, long);
});

test("ответ со значением не пропадает из-за слов «в решении»: убирается только отсылка", () => {
  // значение остаётся и в тексте, и в списке ответов
  assert.equal(tidy("№2\nS = 3 · 4\nОтвет: 12 см² – расчёт в решении."), "№2\nS = 3 · 4\nОтвет: 12 см².");
  assert.equal(tidy("№3\nD > 0\nОтвет: 2 корня, они найдены в решении."), "№3\nD > 0\nОтвет: 2 корня.");
  assert.equal(tidy("№4\nподстановка\nОтвет: x = 5 (проверка в решении)"), "№4\nподстановка\nОтвет: x = 5");
  assert.equal(card(["№1\nОтвет: 4", "№2\nS = 3 · 4\nОтвет: 12 см² – расчёт в решении."]), "✅ Ответы\n№1: 4\n№2: 12 см².");
  assert.equal(card(["№3\nD > 0\nОтвет: 2 корня, они найдены в решении."]), "✅ Ответы\n№3: 2 корня.");
  assert.deepEqual(compose(["№3\nD > 0\nОтвет: 2 корня, они найдены в решении."], 12_000), ["№3\nD > 0\nОтвет: 2 корня."]);
  // чистая отсылка по-прежнему убирается из текста, а в списке стоит «см. решение»
  assert.equal(tidy("№5\n```python\nprint(1)\n```".replace(/```/g, "'''") + "\nещё строка\nОтвет: программа в решении."), "№5\n'''python\nprint(1)\n'''\nещё строка");
  assert.equal(card(["№5\nкод\nОтвет: программа в решении."]), "✅ Ответы\n№5: см. решение");
});

test("объём сочинения в заголовке согласован с числом: слово, слова, слов", () => {
  const head = (n: number) => tidy(`№27\nТекст сочинения. Ещё предложение.\nОтвет: сочинение, ${n} слов.`).split("\n")[0];
  assert.equal(head(271), "№27 · 271 слово");
  assert.equal(head(202), "№27 · 202 слова");
  assert.equal(head(250), "№27 · 250 слов");
  assert.equal(head(211), "№27 · 211 слов");
  assert.equal(head(214), "№27 · 214 слов");
  assert.equal(head(183), "№27 · 183 слова");
});

test("403 от Claude: человеку понятная причина без сырого текста API", () => {
  const raw = "Your organization does not have access to this resource in region X";
  const e = Anthropic.APIError.generate(403, { type: "error", error: { type: "permission_error", message: raw } }, raw, new Headers());
  const p = claudeProblem({ model: "claude-fable-5-2" } as any, e);
  assert.ok(p instanceof Fatal);
  assert.ok(!p.message.includes("organization") && !/[a-z]{6,} [a-z]{4,} [a-z]{4,}/.test(p.message), p.message);
  assert.match(p.message, /403/);
});

test("оборванный поток: размышления оцениваются по времени молчания и не больше max_tokens", () => {
  assert.equal(thinkGuess(0, true, 64_000), 0);
  assert.equal(thinkGuess(60_000, false, 64_000), 3_000);
  assert.equal(thinkGuess(60_000, true, 64_000), 6_000);
  assert.equal(thinkGuess(780_000, true, 64_000), 64_000); // весь кусок в быстром режиме: упираемся в предел запроса
});

test("в тексте листа «4-го» не рвётся по дефису, знак между словами не начинает строку", () => {
  assert.match(inline("среднее 4-го и 5-го членов"), /<span class="nb">4-го<\/span> и <span class="nb">5-го<\/span>/);
  assert.ok(inline("система пуля + брусок замкнута").includes("пуля\u00a0+ брусок"));
  assert.ok(!inline("x-ось и y-ось").includes('class="nb"'));
  assert.ok(!inline("в 1990-х годах").includes("<span class=\"nb\">1990-х годах"));
});

test("отсылка «в решении»: значение не обрезается и не пропадает, чистая отсылка убирается", () => {
  const list = (line: string) => card([`№1\nрешение\nещё строка\nОтвет: ${line}`]).split("\n")[1].replace("№1: ", "");
  const kept = (line: string) => tidy(`№1\nрешение\nещё строка\nОтвет: ${line}`).split("\n").at(-1);
  // хвост срезается, значение целое
  for (const [line, value] of [
    ["x = 0,5 - проверка в решении", "x = 0,5"],
    ["А-3, Б-1, В-2 - пояснения в решении.", "А-3, Б-1, В-2."],
    ["x = 3, x = -2 - проверка в решении.", "x = 3, x = -2."],
    ["программа выводит 15, код в решении.", "программа выводит 15."],
    ["решение имеет 2 корня, они в решении.", "решение имеет 2 корня."],
    ["рисунок 2, объяснение в решении.", "рисунок 2."],
    ["текст относится к публицистическому стилю, разбор в решении.", "текст относится к публицистическому стилю."],
    ["таблица истинности: 3 набора дают 1, таблица в решении.", "таблица истинности: 3 набора дают 1."],
    ["цепочка: Fe → FeCl₂ → Fe(OH)₂ — уравнения в решении.", "цепочка: Fe → FeCl₂ → Fe(OH)₂."],
    ["А, Б, В - пояснения в решении", "А, Б, В"],
    ["да, объяснение в решении.", "да."],
  ]) {
    assert.equal(list(line), value, line);
    assert.equal(kept(line), `Ответ: ${value}`, line);
  }
  // чистого хвоста нет: строка остаётся как есть
  for (const line of ["корни 1, 4 и 9 найдены в решении.", "2,5 в решении", "x₁ = 1 и x₂ = 4 найдены в решении.", "перевод: «Я люблю читать», полный перевод в решении."]) {
    assert.equal(list(line), line, line);
    assert.equal(kept(line), `Ответ: ${line}`, line);
  }
  // значения нет совсем: в списке «см. решение», из текста строка уходит
  for (const line of ["в решении.", "см. в решении.", "все ответы в решении.", "уравнения 1)–4) в решении.", "уравнения 1)-3) в решении.", "уравнения реакций 1), 2) и 3) в решении.", "программа на Python в решении.", "доказательство в решении.", "электронный баланс и уравнение — в решении.", "структурные формулы в решении."]) {
    assert.equal(list(line), "см. решение", line);
    assert.equal(kept(line), "ещё строка", line);
  }
  // одно задание: списка ответов нет, поэтому ответ обязан остаться в тексте
  assert.deepEqual(compose(["№1\nрешение\nещё строка\nОтвет: программа выводит 15, код в решении."], 12_000), ["№1\nрешение\nещё строка\nОтвет: программа выводит 15."]);
});

test("отсылка «в решении»: перечисление и словесный ответ остаются целыми", () => {
  const list = (line: string) => card([`№1\nрешение\nещё строка\nОтвет: ${line}`]).split("\n")[1].replace("№1: ", "");
  const kept = (line: string) => tidy(`№1\nрешение\nещё строка\nОтвет: ${line}`).split("\n").at(-1);
  // последний пункт перечисления не отсылка: строка не меняется
  for (const line of ["подлежащее, сказуемое, дополнение подчёркнуты в решении.", "А, Б, В отмечены в решении.", "Пушкин, Лермонтов в решении.", "1861–1874 гг. — реформы в решении."]) {
    assert.equal(list(line), line, line);
    assert.equal(kept(line), `Ответ: ${line}`, line);
  }
  // словесный ответ с пустой отсылкой остаётся ответом
  for (const [line, value] of [
    ["Наполеон (в решении)", "Наполеон"],
    ["да (в решении)", "да"],
    ["Пушкин — в решении.", "Пушкин."],
    ["Куликовская битва — в решении.", "Куликовская битва."],
    ["да, в решении.", "да."],
    ["1812 год, причины в решении.", "1812 год."],
    ["1861–1874 гг. — подробно в решении.", "1861–1874 гг."],
  ]) {
    assert.equal(list(line), value, line);
    assert.equal(kept(line), `Ответ: ${value}`, line);
  }
  // два ответа в задании, второй только отсылает к решению: первый остаётся в списке
  assert.equal(card(["№3\nпервая часть\nОтвет: да.\nвторая часть\nОтвет: в решении."]), "✅ Ответы\n№3: да.");
  assert.equal(card(["№3\nкод\nОтвет: программа в решении."]), "✅ Ответы\n№3: см. решение");
});

test("окончание порядкового сразу за формулой приклеено к ней: «$n$-й член»", () => {
  assert.match(inline("Получаем $n$-й член"), /<span class="glue"><span class="f">.*<\/span>-й<\/span> член$/);
  assert.match(inline("для $k$-го, а не"), /<span class="glue">.*-го,<\/span> а не$/);
  assert.ok(!inline("разность $a$ - $b$").includes('class="glue"'));
});

test("отсылка «в решении»: второе предложение ответа и пометка о неполноте не срезаются", () => {
  const list = (line: string) => card([`№1\nрешение\nещё строка\nОтвет: ${line}`]).split("\n")[1].replace("№1: ", "");
  const kept = (line: string) => tidy(`№1\nрешение\nещё строка\nОтвет: ${line}`).split("\n").at(-1);
  // отсылка отдельным предложением: уходит только она
  for (const [line, value] of [
    ["да, она увеличится вдвое. Расчёт в решении.", "да, она увеличится вдвое."],
    ["нет, граф не является деревом. Обоснование в решении.", "нет, граф не является деревом."],
    ["да, это оксид. Уравнения в решении.", "да, это оксид."],
    ["x = 5, см. в решении.", "x = 5."],
  ]) {
    assert.equal(list(line), value, line);
    assert.equal(kept(line), `Ответ: ${value}`, line);
  }
  // «остальные», «все», «полный» говорят, что ответ в строке неполный: строка остаётся целой
  for (const line of ["x = ±1, остальные корни в решении.", "А – 2, Б – 3, остальные в решении.", "мера стоимости; средство обращения, остальные функции в решении.", "x = 1, все корни в решении.", "5 см. Расчёт в решении."]) {
    assert.equal(list(line), line, line);
    assert.equal(kept(line), `Ответ: ${line}`, line);
  }
  // название документа не «код в решении»
  assert.equal(list("Гражданский кодекс – в решении."), "Гражданский кодекс.");
  assert.equal(list("точная формулировка – в решении."), "точная формулировка.");
  assert.equal(list("код – в решении."), "см. решение");
});

test("отсылка «в решении»: знак вопроса остаётся, сокращение с точкой не конец предложения", () => {
  const list = (line: string) => card([`№1\nрешение\nещё строка\nОтвет: ${line}`]).split("\n")[1].replace("№1: ", "");
  const kept = (line: string) => tidy(`№1\nрешение\nещё строка\nОтвет: ${line}`).split("\n").at(-1);
  for (const [line, value] of [
    ["Where does he live? Перевод в решении.", "Where does he live?"],
    ["Hello! Перевод в решении.", "Hello!"],
    ["Как дела? Перевод в решении.", "Как дела?"],
  ]) {
    assert.equal(list(line), value, line);
    assert.equal(kept(line), `Ответ: ${value}`, line);
  }
  for (const line of ["нет, т. к. он не проводит ток в решении.", "нет, т. к. это показано в решении.", "5, т. е. это видно в решении.", "в 1861 г. Подробно в решении."]) {
    assert.equal(list(line), line, line);
    assert.equal(kept(line), `Ответ: ${line}`, line);
  }
});
