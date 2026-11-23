// Страница решения: что попадает в HTML и в сценарий раскладки по листам. Сам сценарий проверяется в браузере (test/browser.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { inline, pageHtml, PAGINATE, taskHtml, tex } from "../src/page.ts";

const attr = (html: string) => /data-title="([^"]*)"/.exec(html)?.[1] ?? "";

test("заголовок продолжения на следующих листах без разметки: формула в названии задания переведена в обычные знаки", () => {
  const title = attr(taskHtml("Вариант 2 · №1 ($x^{2} = \\frac{1}{4}$)\nРешение: $x = \\frac{1}{2}$\nОтвет: $\\frac{1}{2}$", []));
  assert.equal(title, "Вариант 2 · №1 (x² = 1/4)");
  const page = pageHtml(["№3 ($\\sqrt{16} = 4$)\nОтвет: 4"], [], "", "");
  assert.doesNotMatch(attr(page), /[$\\{}^_]/);
  assert.equal(attr(taskHtml("№2\nОтвет: 5", [])), "№2"); // простой заголовок не меняется
});

test("команду, которую KaTeX не рисует (\\url, \\includegraphics, \\htmlClass, \\href), страница показывает текстом, а не красным исходником", () => {
  for (const src of ["\\url{x}", "\\includegraphics{a}", "\\htmlClass{a}{b}", "\\href{http://a}{b}", "x + \\url{y} = 2"]) {
    const html = tex(src);
    assert.doesNotMatch(html, /#fe0001|#cc0000/, src);
    assert.match(html, /class="raw"/, src);
    assert.doesNotMatch(html.replace(/<[^>]+>/g, ""), /\\[A-Za-z]/, src);
  }
  const line = inline("Решение: $\\url{x}$ и $\\frac{1}{2}$");
  assert.doesNotMatch(line.replace(/<annotation[\s\S]*?<\/annotation>|<[^>]+>/g, ""), /\\(url|frac)/);
  assert.match(line, /class="katex"/); // обычная формула рядом по-прежнему рисуется KaTeX
  assert.doesNotMatch(tex("\\textcolor{red}{x}"), /class="raw"/); // цвет, заданный моделью, это не ошибка
});

test("сценарий раскладки по листам разбирается как JavaScript: экранирование в шаблоне не ломает регулярные выражения", () => {
  assert.doesNotThrow(() => new Function(`return ${PAGINATE}`));
  // \n и \s внутри сценария должны дойти до браузера как экранирование, а не как настоящий перевод строки
  assert.match(PAGINATE, /\/\\n\(\?=\[\^\\n\]\)\/g/);
  assert.match(PAGINATE, /\/\\s\+\(\?=\\S\)\/g/);
});

test("сценарий раскладки: тонкие линии (оси, сетка) и линии под чёрными фигурами не мешают подписям, высокий блок режется, заголовок не остаётся один", () => {
  assert.match(PAGINATE, /parseFloat\(cs\.strokeWidth\) \* k <= area\.width \/ 800/);
  assert.match(PAGINATE, /isPointInFill/);
  assert.match(PAGINATE, /\.task > pre\.b, \.task > \.b\.line/);
  assert.match(PAGINATE, /page\.length === 1 && last\(\)\.task === task/);
});

test("части разрезанного листинга сходятся без рамки на стыке", () => {
  const html = pageHtml(["№1\n```\nprint(1)\n```"], [], "", "");
  assert.match(html, /pre\.go\{border-bottom:0/);
  assert.match(html, /pre\.on\{border-top:0/);
});
