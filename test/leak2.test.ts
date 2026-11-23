// Заслон от сырой разметки, пограничные случаи: то, что легко сломать, починяя соседнее.
import assert from "node:assert/strict";
import { test } from "node:test";
import { texLeak } from "../src/tex.ts";
import { plainText, splitAnswer } from "../src/text.ts";

const plain = (raw: string) => plainText(splitAnswer(raw).text);

test("команда, которой нет в списках: функция без аргумента сохраняет имя, оформление с аргументом теряет только имя", () => {
  assert.equal(plain(String.raw`$\arccot x = 1$`), "arccot x = 1");
  assert.equal(plain(String.raw`$\lcm(4, 6) = 12$`), "lcm(4, 6) = 12");
  assert.equal(plain(String.raw`$\sech x$`), "sech x");
  assert.equal(plain(String.raw`$x \in \R$`), "x ∈ ℝ");
  assert.equal(plain(String.raw`$a \lessdot b$`), "a ⋖ b");
  assert.equal(plain(String.raw`$\emph{важно}$ и $\foo{x} + 1$`), "важно и x + 1");
});

test("экранирование вне формул: x\\_1, множество \\{…\\} и тонкий пробел 5\\,кг переводятся, даже если формул в строке не осталось", () => {
  assert.equal(plain(String.raw`x\_1 и y\_2`), "x₁ и y₂");
  assert.equal(plain(String.raw`Множество \{1, 2, 3\} и \frac12`), "Множество {1, 2, 3} и 1/2");
  assert.equal(plain(String.raw`Масса m = 5\,кг`), "Масса m = 5 кг");
  assert.equal(plain(String.raw`Скорость 5\,м/с и \alpha`), "Скорость 5 м/с и α");
  for (const s of [String.raw`x\_1 и y\_2`, String.raw`Множество \{1, 2, 3\} и \frac12`, String.raw`Масса m = 5\,кг`]) assert.equal(texLeak(plain(s)), null, s);
  // а рассказ про саму обратную черту остаётся как написан
  const prose = String.raw`В Windows путь пишут через \, в Linux через /.`;
  assert.equal(plain(prose), prose);
});

test("формула без знаков $ с двоеточием не принимается за путь к файлу, а настоящий путь остаётся путём", () => {
  assert.equal(plain(String.raw`Пусть f:\mathbb R \to \mathbb R`), "Пусть f:ℝ → ℝ");
  assert.equal(plain(String.raw`Ответ x:\alpha = 3`), "Ответ x:α = 3");
  assert.equal(plain(String.raw`Отношение a:\sqrt 2 = 1`), "Отношение a:√2 = 1");
  const path = String.raw`Файл D:\Projects\bot\main.py и C:\Users\lim\temp\frac.txt`;
  assert.equal(plain(path), path);
});

test("обратная кавычка как штрих в формуле не открывает код, а знак $ внутри кода не открывает формулу", () => {
  assert.equal(plain("$f`(x) = 2x$ и $g`(x) = 3$"), "f`(x) = 2x и g`(x) = 3");
  assert.equal(plain("Производная: $y` = 2x$, а $z` = 3$"), "Производная: y` = 2x, а z` = 3");
  const regex = "Шаблон `^\\d+$` и `^[a-z]+$` проверяют строку.";
  assert.equal(plain(regex), regex);
});

test("одиночный знак \\| это код (grep), пара \\|a\\| это норма", () => {
  const code = "Команда `grep 'foo\\|bar' file.txt` ищет строки.";
  assert.equal(plain(code), code);
  const bare = "Команда grep 'foo\\|bar' ищет строки.";
  assert.equal(plain(bare), bare);
  assert.equal(plain(String.raw`Норма \|a\| = 5`), "Норма ‖a‖ = 5");
});
