// Заслон от сырой разметки: как бы модель ни записала формулу, человек не видит ни «$», ни «\frac{…}».
// Проверяется всё, что уходит в чат: запасной текст, подпись с ответами, страница и подписи на рисунках.
import assert from "node:assert/strict";
import { test } from "node:test";
import { pageHtml } from "../src/page.ts";
import { fixSvg } from "../src/svg.ts";
import { normalizeMath, stripTex, texLeak, texToPlain } from "../src/tex.ts";
import { card, compose, plainText, splitAnswer } from "../src/text.ts";

const parts = (text: string) => text.split(/(?:^|\n)[ \t]*@@@[^\n]*(?:\n|$)/).map((t) => t.trim()).filter(Boolean);
// видимый текст страницы: без стилей, рисунков и кода программ
const seen = (html: string) => html.replace(/<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<pre[\s\S]*?<\/pre>/g, " ").replace(/<[^>]+>/g, " ");

// Ответы, записанные не по правилам: другие ограничители, формулы в несколько строк, команды без знаков $
const CROOKED: Record<string, string> = {
  "скобки \\( \\) и \\[ \\]": String.raw`№1
Решение:
\[
x = \frac{-b \pm \sqrt{D}}{2a}
\]
Тогда \(x_1 = 2\), \(x_2 = 3\).
Ответ: \(2; 3\).`,
  "двойные знаки и система в несколько строк": String.raw`№2
$$
\begin{cases}
x + y = 5 \\
x - y = 1
\end{cases}
$$
Складываем: $2x = 6$, $x = 3$.
Ответ: $(3; 2)$.`,
  "команды без знаков $": String.raw`№3
По формуле x = \frac{1}{2} получаем \sqrt{16} = 4, значит \alpha = 30^{\circ}.
Площадь S_{ABC} = \dfrac{1}{2} \cdot a \cdot h = 12 см^{2}.
Ответ: 12 см^{2}.`,
  "формула с переносом строки": String.raw`№4
$\begin{cases}
x > 1 \\
x < 5
\end{cases}$
Ответ: $x \in (1; 5)$`,
  "знак $ без пары": String.raw`№5
Формула оборвана: $x = 5
и ещё одна $y = \frac{a}{b}
Ответ: $5.`,
  "редкие команды": String.raw`№8
$a \xrightarrow{t} b$, $\overset{def}{=}$, $\text{скорость} = \frac{s}{t}$, $\unknowncmd{x}$, $x^{2k+1}$, $A \setminus B$, $\|a\|$
Ответ: $\boxed{42}$.`,
  "окружение без знаков $": String.raw`№9
\begin{align}
a &= b + c \\
d &= e
\end{align}
Ответ: \textbf{готово}, \underline{да}.`,
  "текст латиницей": String.raw`№10
The answer is \frac{1}{2} of the total, so x \le 5 and y \ne 0.
Ответ: \frac{1}{2}.`,
  "выключные формулы в строке": String.raw`№11
$$x^2 + y^2 = r^2$$ и $$ \int_0^1 x\,dx = \frac12 $$
Ответ: $\dfrac{1}{2}$`,
  "физика без знаков $": String.raw`№12
Дано:
$m = 2$ кг
Найти: \( a \)
Решение:
F = ma \Rightarrow a = \frac{F}{m} = \frac{10}{2} = 5 м/с^2
Ответ: 5 м/с².`,
};

test("сырая разметка LaTeX не доходит до человека ни в тексте, ни в подписи, ни на странице", () => {
  for (const [name, raw] of Object.entries(CROOKED)) {
    const { text, svgs } = splitAnswer(raw);
    const all = parts(text);
    const plain = all.map(plainText);
    assert.equal(texLeak(compose(plain, 12000).join("\n")), null, `${name}: запасной текст`);
    assert.equal(texLeak(card(plain)), null, `${name}: подпись`);
    assert.equal(texLeak(seen(pageHtml(all, svgs, "", ""))), null, `${name}: страница`);
  }
});

test("формулы, записанные не по правилам, всё равно читаются верно", () => {
  const plain = (raw: string) => parts(splitAnswer(raw).text).map(plainText).join("\n");
  assert.equal(plain(CROOKED["скобки \\( \\) и \\[ \\]"]), "№1\nРешение:\nx = (−b ± √D)/(2a)\nТогда x₁ = 2, x₂ = 3.\nОтвет: 2; 3.");
  assert.equal(plain(CROOKED["двойные знаки и система в несколько строк"]), "№2\nсистема: x + y = 5; x − y = 1\nСкладываем: 2x = 6, x = 3.\nОтвет: (3; 2).");
  assert.equal(plain(CROOKED["команды без знаков $"]), "№3\nПо формуле x = 1/2 получаем √16 = 4, значит α = 30°.\nПлощадь S(ABC) = 1/2 · a · h = 12 см².\nОтвет: 12 см².");
  assert.equal(plain(CROOKED["формула с переносом строки"]), "№4\nсистема: x > 1; x < 5\nОтвет: x ∈ (1; 5)");
  assert.equal(plain(CROOKED["знак $ без пары"]), "№5\nФормула оборвана: x = 5 и ещё одна y = a/b\nОтвет: 5.");
  assert.equal(plain(CROOKED["окружение без знаков $"]), "№9\na = b + c; d = e\nОтвет: готово, да.");
  assert.equal(plain(CROOKED["физика без знаков $"]), "№12\nДано:\nm = 2 кг\nНайти: a\nРешение:\nF = ma ⇒ a = F/m = 10/2 = 5 м/с²\nОтвет: 5 м/с².");
  // на странице такие формулы набраны по-настоящему, а не показаны текстом
  const html = pageHtml(parts(splitAnswer(CROOKED["команды без знаков $"]).text), [], "", "");
  assert.ok((html.match(/class="katex"/g) ?? []).length >= 4, html);
  assert.ok(!html.includes('class="raw"'));
});

test("запись формул приводится к одному виду: пара знаков $ в одной строке", () => {
  assert.equal(normalizeMath(String.raw`\(a\) и \[b\]`), "$a$ и $b$");
  assert.equal(normalizeMath("$$\nx = 1\n$$"), "$x = 1$");
  assert.equal(normalizeMath(String.raw`x = \frac{1}{2}, значит`), String.raw`$x = \frac{1}{2}$, значит`);
  assert.equal(normalizeMath(String.raw`масса \text{тела} m_{1}`), String.raw`масса $\text{тела} m_{1}$`);
  assert.equal(normalizeMath(String.raw`(где \alpha = 30^\circ)`), String.raw`(где $\alpha = 30^\circ$)`);
  assert.equal(normalizeMath(String.raw`$a = b +` + "\n" + String.raw`c$`), "$a = b + c$");
  // матрица со сдвигом строки \\[2pt] это не начало формулы \[
  assert.equal(normalizeMath(String.raw`$\begin{pmatrix} 1 \\[2pt] 2 \end{pmatrix}$`), String.raw`$\begin{pmatrix} 1 \\[2pt] 2 \end{pmatrix}$`);
  // верно записанный текст не меняется
  const good = String.raw`$x^2 - 5x + 6 = 0$ | $\cdot 2$` + "\nОтвет: $x = 2$, $x = 3$.";
  assert.equal(normalizeMath(good), good);
});

test("обычный текст с обратной чертой и код программ заслон не портит", () => {
  const raw = "№7\nПуть C:\\Users\\name\\file.txt, в строке символ \\n переводит строку.\n```python\nprint(\"a\\nb\")  # $x$ и \\frac тут код\n```\nОтвет: 3.";
  const out = parts(splitAnswer(raw).text).map(plainText).join("\n");
  assert.equal(out, raw);
  assert.equal(texLeak(out), null);
  assert.equal(stripTex("скидка 5\\%, это 20\\% от цены"), "скидка 5%, это 20% от цены");
  assert.equal(stripTex("цена \\$100"), "цена $100"); // знак доллара, написанный нарочно, остаётся
  assert.equal(stripTex("x = 5$ и $ y"), "x = 5 и y");
});

test("подписи на рисунке: разметка LaTeX переводится в обычные знаки и не ломает рисунок", () => {
  const svg = String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#000"/><text x="40" y="50">№1</text><text x="100" y="100">$\alpha$ = 30^{\circ}</text><text x="100" y="200">\vec{F}_{тр}, x &lt; 5, $a &lt; b$</text></svg>`;
  const fixed = fixSvg(svg);
  assert.equal(texLeak(fixed.replace(/<[^>]+>/g, " ")), null, fixed);
  assert.ok(fixed.includes(">α = 30°<"), fixed);
  assert.ok(fixed.includes("x &lt; 5, a &lt; b"), fixed);
  assert.ok(!/<(?!\/?(svg|rect|text|tspan)\b)/.test(fixed), fixed); // знак «<» из формулы не стал тегом
});

test("редкие команды в формулах переводятся в текст без мусора", () => {
  const cases: Record<string, string> = {
    [String.raw`a \xrightarrow{t} b`]: "a —(t)→ b",
    [String.raw`\overset{def}{=}`]: "=",
    [String.raw`\underset{x \to 0}{\lim} f`]: "lim f",
    [String.raw`\textcolor{red}{x} + \phantom{0}1`]: "x + 1",
    [String.raw`\|a\| = 5 \tag{1}`]: "‖a‖ = 5 (1)",
    [String.raw`\cancel{2}x \Big/ \bigl(3\bigr)`]: "2x / (3)",
    [String.raw`{\rm d}x`]: "dx",
  };
  for (const [a, b] of Object.entries(cases)) assert.equal(texToPlain(a), b, a);
});
