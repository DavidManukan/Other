// Модульные проверки чистых функций. Запуск: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { Busy, Fatal, activeModel, allText, answerText, claudeProblem, tasks, unavailable } from "../src/claude.ts";
import { config, hider, hookKey, logKey, lower, publicOrigin } from "../src/config.ts";
import { Green, GreenError, permanent } from "../src/green.ts";
import { assign, figureLabel, inline, taskHtml } from "../src/page.ts";
import { fixSvg } from "../src/svg.ts";
import { mathSpans, plainMath, texToPlain } from "../src/tex.ts";
import { RULE, card, compose, plainText, prettyMath, seam, splitAnswer } from "../src/text.ts";
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
  };
  for (const [a, b] of Object.entries(cases)) assert.equal(texToPlain(a), b, a);
  assert.equal(plainMath("Ответ: $x = \\dfrac{2\\sqrt{3}}{3}$ см, цена 5$ и $y$."), "Ответ: x = 2√3/3 см, цена 5$ и y.");
  assert.deepEqual(mathSpans("a $b$ c").map((s) => s.math), [false, true, false]);
});

test("страница решения: формулы набраны, «Дано» блоком, пометки справа, ответ в рамке", () => {
  const html = taskHtml("№2\nДано:\n$AB = 6$ см\nНайти: $SO$\nРешение:\n$x^2 = 4$ | $\\cdot 2$\n|x − 1| = 3\nОтвет: $\\dfrac{4}{3}$.", []);
  assert.match(html, /<section class="task" data-title="№2"><h2 class="b">№2<\/h2>/);
  assert.match(html, /<div class="b given"><div class="lbl">Дано:<\/div><div><span class="katex">/);
  assert.match(html, /<div class="find"><span class="lbl">Найти:<\/span> <span class="katex">/);
  assert.match(html, /<div class="b lbl">Решение:<\/div>/);
  assert.match(html, /<div class="b row"><div class="main"><span class="katex">.*<div class="note"><span class="katex">/);
  assert.match(html, /<div class="b line">\|x − 1\| = 3<\/div>/); // модуль это не пометка
  assert.match(html, /<div class="b ans"><span class="lbl">Ответ:<\/span> <span class="katex">.*mfrac/);
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
  assert.ok(taskHtml(parts[2], figs[2]).includes(">нет такого</text>")); // у чужого рисунка подпись остаётся
});

test("ответ модели: берётся текст после последней проверки в песочнице", () => {
  const text = (t: string) => ({ type: "text", text: t }) as any;
  const tool = { type: "server_tool_use" } as any, result = { type: "code_execution_tool_result" } as any, fb = { type: "fallback" } as any;
  assert.equal(answerText([text("Проверю в песочнице."), tool, result, text("№1\nОтвет: 4")]), "№1\nОтвет: 4");
  assert.equal(answerText([text("старый ответ"), fb, text("Сейчас пересчитаю."), tool, result, text("№1\nОтвет: 4")]), "№1\nОтвет: 4");
  assert.equal(answerText([text("№1\nОтвет: 4"), tool, result]), ""); // после проверки ничего: бот попросит написать ответ
  assert.equal(allText([text("№1\nОтвет: 4"), tool, result]), "№1\nОтвет: 4");
  assert.equal(answerText([{ type: "thinking" } as any, text("№1\n"), text("Ответ: 4")]), "№1\nОтвет: 4");
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
    { chatId: "1@c.us", timestamp: now, typeMessage: "imageMessage", fileName: "reshenie-abc.png" },
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
    assert.equal(await g.wasSent("1@c.us", since, { file: "reshenie-abc.png" }), true);
    assert.equal(await g.wasSent("1@c.us", since, { file: "reshenie-other.png" }), false);
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
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(body), { chatId: "1@c.us", urlFile: "https://w/?img=1", fileName: "p.png", caption: "подпись" });
  } finally {
    globalThis.fetch = real;
  }
});
