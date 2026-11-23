// Заслон от сырой разметки и информатика: электронные таблицы, код со знаками $, grep, редкие дроби и множества.
import assert from "node:assert/strict";
import { test } from "node:test";
import { pageHtml } from "../src/page.ts";
import { texLeak } from "../src/tex.ts";
import { plainText, splitAnswer } from "../src/text.ts";

const plain = (raw: string) => plainText(splitAnswer(raw).text);
const seen = (raw: string) => pageHtml([splitAnswer(raw).text], [], "", "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "");

test("электронная таблица: ссылки $A$1, C$3 и имена ячеек остаются как написаны", () => {
  for (const s of [
    "Формулу =$B2+C$3 скопировали в ячейку D4",
    "Абсолютная ссылка =$A$1 в Excel",
    "В ячейке C2 записана формула =A1*B2. Её скопировали в C3.",
    "№3\nВ ячейке B2 формула =$A2*B$1.\nПосле копирования в C3 получится =$A3*C$1.\nОтвет: =$A3*C$1",
  ]) {
    assert.equal(plain(s), s);
    assert.ok(seen(s).includes(s.split("\n").at(-1)!.replace(/^Ответ: /, "")), s);
    assert.doesNotMatch(pageHtml([splitAnswer(s).text], [], "", ""), /class="katex"/, s);
  }
  // а химия и индексы в обычных заданиях работают по-прежнему
  assert.equal(plain("H2SO4 и CO2, x1 + x2 = 5"), "H₂SO₄ и CO₂, x₁ + x₂ = 5");
  // формула рядом с ячейками набирается как формула
  assert.equal(plain("В ячейке A1 число $x^2$"), "В ячейке A1 число x²");
});

test("код в `…` со знаками $ остаётся кодом, одна формула в `…` остаётся формулой", () => {
  for (const s of ["Регулярка `^(a|b)$|^c$` подходит", "Шаблон `^\\d+$|^-\\d+$` для целых", "PHP: `$x=$y;`", "Строка `${a}+${b}`", "`=$A$1+B1`"]) assert.equal(plain(s), s);
  assert.equal(plain("Запишем `$x^2$`"), "Запишем `x²`");
});

test("grep с несколькими \\| это код, норма \\|a\\| отделена от слов", () => {
  for (const s of ["grep 'foo\\|bar\\|baz' file", "grep 'a\\|b' и 'c\\|d'"]) assert.equal(plain(s), s);
  assert.equal(plain(String.raw`Норма \|x\| = 1`), "Норма ‖x‖ = 1");
  assert.equal(plain(String.raw`$\|\vec a\| = 5$`), "‖a⃗‖ = 5");
});

test("редкие дроби и множества чисел: \\sfrac, \\nicefrac, \\R и короткие имена KaTeX", () => {
  assert.equal(plain(String.raw`Ответ: $\sfrac{1}{2}$`), "Ответ: 1/2");
  assert.equal(plain(String.raw`Ответ: $\nicefrac{3}{4}$ часа`), "Ответ: 3/4 часа");
  assert.match(pageHtml([String.raw`Ответ: $\sfrac{1}{2}$`], [], "", ""), /class="katex"/); // на странице это обычная дробь
  assert.equal(plain(String.raw`D(y) = \R`), "D(y) = ℝ");
  assert.equal(plain(String.raw`Числа \R и \N`), "Числа ℝ и ℕ");
  assert.equal(plain(String.raw`Ответ: x = 5 и \infin тут`), "Ответ: x = 5 и ∞ тут");
  for (const s of [String.raw`D(y) = \R`, String.raw`Числа \R и \N`]) assert.equal(texLeak(plain(s)), null);
});
