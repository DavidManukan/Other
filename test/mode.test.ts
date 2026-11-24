// Вид ответа (страница или текст), краткие задания, таблицы, замена заданий после второй проверки.
import assert from "node:assert/strict";
import { test } from "node:test";
import { taskHtml } from "../src/page.ts";
import { CHECK_PROMPT, judgeText, PROMPT } from "../src/prompt.ts";
import { texLeak } from "../src/tex.ts";
import { brief, card, cells, compose, headOf, lookLine, lookOf, mergeFix, plainText, splitAnswer, tableAt, textTable } from "../src/text.ts";

test("служебная строка «ВИД» читается и убирается из ответа", () => {
  assert.deepEqual(lookOf("ВИД: страница\n№1\nОтвет: 5"), { look: "page", text: "№1\nОтвет: 5" });
  assert.deepEqual(lookOf("ВИД: текст\n\n№1\nОтвет: 5"), { look: "text", text: "№1\nОтвет: 5" });
  assert.deepEqual(lookOf("  ВИД:  текстом.\n№1"), { look: "text", text: "№1" });
  assert.deepEqual(lookOf("ВИД: страницы\n№1"), { look: "page", text: "№1" });
  // строка повторена посреди ответа: в текст она не попадает, считается первая
  assert.deepEqual(lookOf("ВИД: текст\n№1\nОтвет: 1\n@@@\nВИД: страница\n№2\nОтвет: 2"), { look: "text", text: "№1\nОтвет: 1\n@@@\n№2\nОтвет: 2" });
  // без строки ответ не меняется
  assert.deepEqual(lookOf("№1\nОтвет: 5"), { look: null, text: "№1\nОтвет: 5" });
});

test("строка задания, похожая на служебную, остаётся в ответе", () => {
  for (const raw of ["№1\nВид: несовершенный\nОтвет: глагол", "№1\nВид: текст-рассуждение\nОтвет: 2", "№1\nВИД: глагол\nОтвет: 1", "№1\n```\nВИД: текст\n```\nОтвет: 1"]) {
    assert.equal(lookOf(raw).text, raw, raw);
  }
  assert.equal(lookOf("№1\n```\nВИД: текст\n```\nОтвет: 1").look, null);
});

test("строка вида возвращается в память чата такой же", () => {
  assert.equal(lookLine("page"), "ВИД: страница\n");
  assert.equal(lookLine("text"), "ВИД: текст\n");
  assert.equal(lookLine(undefined), "");
  assert.equal(lookOf(lookLine("page") + "№1\nОтвет: 5").look, "page");
});

test("краткое задание: заголовок и строка ответа, ничего больше", () => {
  assert.equal(brief("№1\nОтвет: Б) 12"), true);
  assert.equal(brief("Вариант 2 · №7\nОтвет: 3214"), true);
  assert.equal(brief("№1\nОтвет: при a > 0 два корня,\nпри a = 0 один."), true); // ответ перенесён на вторую строку
  assert.equal(brief("№1\nx = 5\nОтвет: 5"), false);
  assert.equal(brief("№1\nОтвет: 5\nПроверка: 5 + 1 = 6"), false);
  assert.equal(brief("Ответ: 5"), false); // без заголовка это не задание из теста
  assert.equal(brief("№1\nОтвет:"), false);
  assert.equal(brief(`№1\nОтвет: ${"очень длинный ответ ".repeat(10)}`), false); // список ответов такой обрезал бы
  assert.equal(brief("№1\nРешено выше.\nОтвет: 5"), false);
});

test("тест уходит списком ответов, без повторения каждого задания блоком", () => {
  const parts = ["№1\nОтвет: Б) 12", "№2\nОтвет: x ∈ (2; 5]", "№3\nОтвет: 3214"];
  assert.deepEqual(compose(parts, 12_000), ["✅ Ответы\n№1: Б) 12\n№2: x ∈ (2; 5]\n№3: 3214"]);
  // тест вместе с развёрнутым заданием: краткие только в списке, развёрнутое целиком
  const mixed = compose([...parts, "№4\n2x = 6\nx = 3\nОтвет: 3"], 12_000);
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0], "✅ Ответы\n№1: Б) 12\n№2: x ∈ (2; 5]\n№3: 3214\n№4: 3\n——————————\n№4\n2x = 6\nx = 3\nОтвет: 3");
  // одно задание идёт как есть
  assert.deepEqual(compose(["№1\nОтвет: 42"], 12_000), ["№1\nОтвет: 42"]);
});

test("строка таблицы делится на ячейки, черта внутри формулы ячейку не делит", () => {
  assert.deepEqual(cells("| A | B | F |"), ["A", "B", "F"]);
  assert.deepEqual(cells("  | $|x|$ | $x^2$ |  "), ["$|x|$", "$x^2$"]);
  assert.deepEqual(cells("| a \\| b | c |"), ["a | b", "c"]);
  assert.deepEqual(cells("| --- | :---: |"), ["---", ":---:"]);
  assert.equal(cells("x^2 = 9 | возводим в квадрат"), null); // пометка справа от преобразования
  assert.equal(tableAt(["|x - 2| = |3 - x|", "|x| = 5"], 0), null); // строки с модулями: без черты под шапкой это не таблица
  assert.deepEqual(cells("| $x | y |"), ["$x", "y"]); // знак $ без пары это не формула: ячейки не склеиваются
  assert.equal(cells("|"), null);
});

test("таблица распознаётся по шапке и черте под ней", () => {
  const lines = ["Таблица:", "| A | B | F |", "| --- | --- | --- |", "| 0 | 0 | 1 |", "| 0 | 1 |", "дальше текст"];
  assert.equal(tableAt(lines, 0), null);
  assert.deepEqual(tableAt(lines, 1), { rows: [["A", "B", "F"], ["0", "0", "1"], ["0", "1", ""]], end: 4 });
  // без черты это не таблица: две строки с модулями ею не станут
  assert.equal(tableAt(["|a| + |b| ≥ |a + b|", "|x| = |y|"], 0), null);
  assert.equal(tableAt(["| a | b |", "| --- | --- |"], 0), null); // только шапка
  assert.equal(tableAt(["| --- | --- |", "| --- | --- |", "| 1 | 2 |"], 0), null);
});

test("узкая таблица уходит моноширинным блоком с ровными столбцами, широкая строками", () => {
  assert.equal(textTable([["A", "B", "F"], ["0", "0", "1"], ["1", "10", "0"]]), "```\nA | B  | F\n--+----+--\n0 | 0  | 1\n1 | 10 | 0\n```");
  // широкая таблица: каждая её строка идёт своим блоком «столбец: значение»
  const wide = textTable([["Вещество", "Формула", "Класс соединения"], ["серная кислота", "H₂SO₄", "кислота"], ["гидроксид натрия", "NaOH", ""]]);
  assert.equal(wide, "Вещество: серная кислота\n  Формула: H₂SO₄\n  Класс соединения: кислота\nВещество: гидроксид натрия\n  Формула: NaOH");
  assert.equal(textTable([["", "AB", "Ab"], ["ab", "AaBb желтые гладкие", "Aabb желтые морщинистые"]]), "ab\n  AB: AaBb желтые гладкие\n  Ab: Aabb желтые морщинистые");
  assert.equal(textTable([["Понятие", "Определение из учебника, длинное"], ["рынок", "место обмена"]]), "Понятие | Определение из учебника, длинное\n————————\nрынок | место обмена");
});

test("таблица в ответе: в тексте блок, формулы в ячейках обычными знаками, разметки не остаётся", () => {
  const raw = "№2\n$F = (A \\lor B) \\land \\neg C$\n| $x$ | $x^2$ |\n| --- | --- |\n| $-2$ | $4$ |\n| $\\dfrac{1}{2}$ | $\\dfrac{1}{4}$ |\nОтвет: $4$";
  const text = plainText(splitAnswer(raw).text);
  assert.equal(text, "№2\nF = (A ∨ B) ∧ ¬C\n```\nx   | x²\n----+----\n−2  | 4\n1/2 | 1/4\n```\nОтвет: 4");
  assert.equal(texLeak(text.replace(/```/g, "")), null);
  assert.equal(card([text]), "✅ Ответы\n№2: 4");
});

test("таблица на странице: настоящая, с набранными формулами; пометка справа таблицей не становится", () => {
  const html = taskHtml("№2\n| $x$ | $y$ |\n| --- | --- |\n| $\\dfrac{1}{2}$ | 4 |\nОтвет: 4", []);
  assert.match(html, /<table class="tbl"><tr><th><span class="f">.*<\/th><th>.*<\/th><\/tr><tr><td><span class="f">.*<\/td><td>4<\/td><\/tr><\/table>/);
  assert.ok(!html.includes("---") && !html.includes("| "), html);
  const row = taskHtml("№1\n$x^2 = 9$ | $\\cdot 4$\nОтвет: 3", []);
  assert.ok(row.includes('class="b row"') && !row.includes("<table"), row);
});

test("заголовок задания как ключ: предмет, вариант, слово «Исправляю»", () => {
  assert.equal(headOf("№3\nрешение\nОтвет: 1"), "№3");
  assert.equal(headOf("Вариант 1 · №3.\nОтвет: 1"), "вариант1·№3");
  assert.equal(headOf("Исправляю №3\nОтвет: 1"), "№3");
  assert.equal(headOf("просто текст"), "");
});

test("исправленное задание встаёт на место прежнего, остальные не меняются", () => {
  const parts = ["№1\nx = 4\nОтвет: 4", "№2\ny = 5\nОтвет: 5", "№3\nОтвет: А"];
  const svg = (label: string, mark: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><text x="1" y="1">${label}</text><!--${mark}--></svg>`;
  const m = mergeFix(parts, [svg("№1", "old1"), svg("№2", "old2")], { parts: ["№2\ny = 3 + 4 = 7\nОтвет: 7"], svgs: [svg("№2", "new2")] });
  assert.deepEqual(m.parts, ["№1\nx = 4\nОтвет: 4", "№2\ny = 3 + 4 = 7\nОтвет: 7", "№3\nОтвет: А"]);
  assert.deepEqual(m.changed, ["№2"]);
  assert.deepEqual(m.svgs.map((s) => /<!--(\w+)-->/.exec(s)![1]), ["old1", "new2"]);
  // пропущенное задание добавляется, единственное заменяется и без совпадения заголовка
  assert.deepEqual(mergeFix(parts, [], { parts: ["№4\nОтвет: 9"], svgs: [] }).parts.at(-1), "№4\nОтвет: 9");
  assert.deepEqual(mergeFix(["Задание 1\nОтвет: 5"], [], { parts: ["№1\nОтвет: 7"], svgs: [] }).parts, ["№1\nОтвет: 7"]);
  assert.deepEqual(mergeFix(parts, [], { parts: [], svgs: [] }).changed, []);
});

test("исправление находит своё задание и при другой записи заголовка; двусмысленное не ставится наугад", () => {
  const two = ["Вариант 1 · №3\nОтвет: 1", "Вариант 2 · №3\nОтвет: 2", "Задание 5\nОтвет: 5", "№13\nОтвет: 13"];
  // «№5» это «Задание 5», а не «№13»; предмет в заголовке исправления не мешает
  assert.deepEqual(mergeFix(two, [], { parts: ["№5\nОтвет: 55"], svgs: [] }).parts[2], "№5\nОтвет: 55");
  const again = mergeFix(two, [], { parts: ["Исправляю №13\nОтвет: 31"], svgs: [] });
  assert.equal(again.parts[3], "№13\nОтвет: 31"); // слово «Исправляю» в готовый ответ не идёт
  assert.ok(!card(again.parts).includes("Исправляю") && again.changed[0] === "№13");
  assert.deepEqual(mergeFix(["№1\nОтвет: 1", "№2\nОтвет: 2"], [], { parts: ["Физика · №2\nОтвет: 7"], svgs: [] }).parts, ["№1\nОтвет: 1", "Физика · №2\nОтвет: 7"]);
  // «№3» подходит к двум вариантам: наугад не ставим
  const amb = mergeFix(two, [], { parts: ["№3\nОтвет: 9"], svgs: [] });
  assert.deepEqual([amb.changed, amb.lost, amb.parts], [[], ["№3"], two]);
  // с вариантом в заголовке всё однозначно
  assert.equal(mergeFix(two, [], { parts: ["Вариант 2 · №3\nОтвет: 9"], svgs: [] }).parts[1], "Вариант 2 · №3\nОтвет: 9");
  // исправление без заголовка среди нескольких заданий ставить некуда
  assert.deepEqual(mergeFix(two, [], { parts: ["Пересчитал, получается 9.\nОтвет: 9"], svgs: [] }).lost, ["Пересчитал, получается 9."]);
  // два исправления одного заголовка в разных работах: каждое занимает своё место по порядку, второе на первое не садится
  const twice = mergeFix(["№1\nОтвет: 1", "№2\nОтвет: 2"], [], { parts: ["№1\nОтвет: 10", "№2\nОтвет: 20"], svgs: [] });
  assert.deepEqual([twice.parts, twice.lost], [["№1\nОтвет: 10", "№2\nОтвет: 20"], []]);
});

test("инструкция: вид ответа, таблицы, тест списком, живой текст, работа только по фото", () => {
  for (const must of ["ВИД: страница", "ВИД: текст", "| --- | --- |", "без решения", "<живой текст>", "вопросов ему не задавай", "реши оба прочтения", "олимпиад", "ЕГЭ", "Букву «ё» в своих словах не ставь"]) {
    assert.ok(PROMPT.includes(must), must);
  }
  assert.ok(!PROMPT.includes("—"), "в инструкции осталось длинное тире");
  assert.ok(CHECK_PROMPT.includes("до того, как его увидит ученик") && CHECK_PROMPT.includes("ВЕРДИКТ: ВЕРНО"));
  assert.ok(judgeText("№2: 7").includes("заголовок задания в точности тот же") && judgeText("№2: 7").includes("ВСЁ ВЕРНО") && judgeText("№2: 7").includes("«ВИД» не пиши"));
});

test("служебная строка в другой записи тоже читается, если она первая в ответе", () => {
  for (const [raw, look] of [["**ВИД: страница**\n№1\nОтвет: 5", "page"], ["Вид: текст (химия)\n№1\nОтвет: 5", "text"], ["ВИД — страница, математика\n\n№1\nОтвет: 5", "page"], ["ВИД: **текст**\n№1\nОтвет: 5", "text"], ["Вид ответа: страница\n№1\nОтвет: 5", "page"]] as const) {
    assert.deepEqual(lookOf(raw), { look, text: "№1\nОтвет: 5" }, raw);
  }
  // не первая строка: убирается только точная запись, строка задания остаётся
  assert.equal(lookOf("№1\nВид: текст (рассуждение)\nОтвет: 2").text, "№1\nВид: текст (рассуждение)\nОтвет: 2");
  assert.equal(lookOf("№1\nВидим, что текст верен.\nОтвет: 2").look, null);
});

test("исправление находит задание по номеру, даже если в заголовке есть что-то ещё", () => {
  const parts = ["№1 (2 балла)\nОтвет: 1", "№2. Решите уравнение 2x = 4\nОтвет: 2", "Задача 3\nОтвет: 3"];
  assert.equal(mergeFix(parts, [], { parts: ["№1\nОтвет: 10"], svgs: [] }).parts[0], "№1\nОтвет: 10");
  assert.equal(mergeFix(parts, [], { parts: ["№2\nОтвет: 20"], svgs: [] }).parts[1], "№2\nОтвет: 20");
  assert.equal(mergeFix(parts, [], { parts: ["№3\nОтвет: 30"], svgs: [] }).parts[2], "№3\nОтвет: 30");
  // предмет сужает выбор, когда номера совпадают в двух работах
  const two = ["Физика · №1\nОтвет: 1", "Геометрия · №1\nОтвет: 2"];
  assert.deepEqual(mergeFix(two, [], { parts: ["Геометрия · №1\nОтвет: 9"], svgs: [] }).parts, ["Физика · №1\nОтвет: 1", "Геометрия · №1\nОтвет: 9"]);
  assert.deepEqual(mergeFix(two, [], { parts: ["№1\nОтвет: 9"], svgs: [] }).lost, ["№1"]);
});

test("таблица: знак $ без пары, ширина комбинируемых знаков, адреса ячеек электронной таблицы", () => {
  assert.deepEqual(cells("| Товар | Цена, $ |"), ["Товар", "Цена, $"]);
  assert.equal(textTable([["A̅B̅", "x"], ["CD", "y"]]), "```\nA̅B̅ | x\n---+--\nCD | y\n```");
  const sheet = plainText("№1\nВ ячейке C2 записана формула.\n| Ячейка | Формула |\n| --- | --- |\n| C2 | =A1+B1 |\n| D2 | =C2*2 |\nПосле копирования в C3 получится =A2+B2.\nОтвет: 7");
  assert.ok(sheet.includes("C2     | =A1+B1") && sheet.includes("в C3 получится =A2+B2") && !/[₀-₉]/.test(sheet), sheet);
});

test("«№1.2» не путается с «№12»; исправленный рисунок заменяет прежний и при другой записи подписи", () => {
  assert.notEqual(headOf("№1.2\nОтвет: 1"), headOf("№12\nОтвет: 1"));
  assert.equal(headOf("№3.\nОтвет: 1"), "№3");
  const m = mergeFix(["№12\nОтвет: 12", "№1.1\nОтвет: 1"], [], { parts: ["№1.2\nОтвет: 2"], svgs: [] });
  assert.deepEqual(m.parts, ["№12\nОтвет: 12", "№1.1\nОтвет: 1", "№1.2\nОтвет: 2"]); // пропущенный подпункт добавлен, №12 цел
  const svg = (label: string, mark: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><text x="1" y="1">${label}</text><!--${mark}--></svg>`;
  const marks = (list: string[]) => list.map((x) => /<!--(\w+)-->/.exec(x)![1]);
  const parts = ["Вариант 1 · №3\nОтвет: 1", "Вариант 1 · №4\nОтвет: 2"];
  // подпись нового рисунка короче заголовка: прежний рисунок этого задания всё равно уходит
  assert.deepEqual(marks(mergeFix(parts, [svg("Вариант 1 · №3", "old3"), svg("Вариант 1 · №4", "old4")], { parts: ["Вариант 1 · №3\nОтвет: 9"], svgs: [svg("№3", "new3")] }).svgs), ["old4", "new3"]);
  // рисунок без подписи относится к единственному исправленному заданию
  assert.deepEqual(marks(mergeFix(parts, [svg("Вариант 1 · №3", "old3"), svg("Вариант 1 · №4", "old4")], { parts: ["Вариант 1 · №4\nОтвет: 9"], svgs: [svg("", "new4")] }).svgs), ["old3", "new4"]);
  // исправление без рисунка прежний рисунок не трогает
  assert.deepEqual(marks(mergeFix(parts, [svg("Вариант 1 · №3", "old3")], { parts: ["Вариант 1 · №3\nОтвет: 9"], svgs: [] }).svgs), ["old3"]);
});

test("номер задания с буквой остаётся как на листе; «Доказать» и «Найти» стоят под чертой вместе, чертёж после них", () => {
  assert.equal(plainText("№A1\nОтвет: 2) Н"), "№A1\nОтвет: 2) Н");
  assert.equal(card([plainText("№B1\nОтвет: 4 м/с"), plainText("Задание C2\nОтвет: 5")]), "✅ Ответы\n№B1: 4 м/с\nЗадание C2: 5");
  assert.equal(plainText("№1\nточки A1 и B1, вещество H2O\nОтвет: 1"), "№1\nточки A₁ и B₁, вещество H₂O\nОтвет: 1"); // в самом решении индексы ставятся как раньше
  assert.ok(taskHtml("№B1\nОтвет: 4", []).includes('<h2 class="b">№B1</h2>'));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><text x="1" y="1">№14</text></svg>';
  const html = taskHtml("№14\nДано:\n$AB = 6$\nДоказать: $BD \\perp SC$\nНайти: угол между $SA$ и $(ABC)$\nДоказательство:\n1) текст\nОтвет: 1", [{ svg, own: true }]);
  const given = html.indexOf('class="b given"'), prove = html.indexOf("Доказать:"), find = html.indexOf("Найти:"), fig = html.indexOf('class="b fig"'), proof = html.indexOf("Доказательство:");
  assert.ok(given < prove && prove < find && find < fig && fig < proof, html);
  assert.equal(html.split('class="find"').length, 3); // обе строки внутри блока «Дано»
});

test("две таблицы подряд остаются двумя; таблица в «Дано» рисуется таблицей; пропущенное задание не затирает единственное", () => {
  const lines = ["| a | b |", "| --- | --- |", "| 1 | 2 |", "| x | y |", "| --- | --- |", "| 3 | 4 |"];
  assert.deepEqual(tableAt(lines, 0), { rows: [["a", "b"], ["1", "2"]], end: 2 });
  assert.deepEqual(tableAt(lines, 3), { rows: [["x", "y"], ["3", "4"]], end: 5 });
  assert.equal(plainText(lines.join("\n")), "```\na | b\n--+--\n1 | 2\n```\n```\nx | y\n--+--\n3 | 4\n```");
  const html = taskHtml("№1\nДано:\n$m = 2$ кг\n| $t$, с | 0 | 1 |\n| --- | --- | --- |\n| $v$, м/с | 0 | 5 |\nНайти: $a$\nРешение:\n$a = 5$\nОтвет: 5", []);
  assert.ok(/class="b given">.*<table class="tbl">.*<\/table><div class="find">/.test(html) && !html.includes("---") && !html.includes("| 0"), html);
  // исправление с другим номером при единственном задании: это пропущенное задание, решённое остаётся
  assert.deepEqual(mergeFix(["№1\nx = 4\nОтвет: 4"], [], { parts: ["№2\nОтвет: 7"], svgs: [] }).parts, ["№1\nx = 4\nОтвет: 4", "№2\nОтвет: 7"]);
  assert.deepEqual(mergeFix(["№1\nx = 4\nОтвет: 4"], [], { parts: ["Пересчитал.\nОтвет: 7"], svgs: [] }).parts, ["Пересчитал.\nОтвет: 7"]);
});

test("в заголовке задания индексы не ставятся нигде, в решении ставятся как раньше", () => {
  assert.equal(plainText("Задание B1 (C3)\nточка A1\nОтвет: 1"), "Задание B1 (C3)\nточка A₁\nОтвет: 1");
  assert.equal(plainText("Вариант 2 · №A1\nH2O\nОтвет: 1"), "Вариант 2 · №A1\nH₂O\nОтвет: 1");
  const html = taskHtml("№B1 (C3)\nточка A1\nОтвет: 4", []);
  assert.ok(html.includes('<h2 class="b">№B1 (C3)</h2>') && html.includes('data-title="№B1 (C3)"') && html.includes("точка A₁"), html);
});
