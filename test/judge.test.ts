// Решение основной модели по замечаниям второй проверки: пограничные ответы.
// Ложное «исправление» и ложное «всё сходится» одинаково плохи, поэтому неоднозначное должно давать null.
import assert from "node:assert/strict";
import { test } from "node:test";
import { allText, answerText, judgeReply, tailText } from "../src/claude.ts";

const text = (t: string) => ({ type: "text", text: t });
const TOOL = [{ type: "server_tool_use", id: "t1", name: "bash_code_execution", input: {} }, { type: "bash_code_execution_tool_result", tool_use_id: "t1", content: {} }];
// ход модели: куски текста, между ними пересчёт кодом
const turn = (...parts: string[]) => parts.flatMap((p, i) => (i ? [...TOOL, text(p)] : [text(p)])) as never;
const reply = (body: string, blocks: never, cut = false, refused = false) =>
  judgeReply({ text: answerText(blocks, cut), tail: tailText(blocks), all: allText(blocks), cut, refused }, body);

const BODY = "№1\nx = 2\nОтвет: 4 см²\n\n№2\nРешение второго.\nОтвет: 1/2";

test("оборванный ответ и отказ ничего не подтверждают, даже если начинаются с согласия", () => {
  assert.equal(reply(BODY, turn("Пересчитаю №2 кодом.", "В №1 всё верно, а в №2 при пересчёте выходит"), true), null);
  assert.equal(reply(BODY, turn("В №1 всё верно. Пересчитаю №2 кодом."), true), null);
  assert.equal(reply(BODY, turn("Всё верно."), false, true), null);
  assert.equal(reply(BODY, turn("ВСЁ ВЕРНО"), true), null);
});

test("согласие с оговоркой или только по одному заданию согласием не считается", () => {
  for (const t of [
    "Не уверен, что всё верно: в №2 могло быть 7.",
    "Вроде всё верно, но в №2 возможно 7.",
    "Всё верно, кроме №2: там должно быть 7, а не 1/2.",
    "В №1 всё верно.",
    "Почти всё верно.",
  ]) assert.equal(reply(BODY, turn(t)), null, t);
  // а настоящее согласие в разных видах остаётся согласием
  for (const t of ["ВСЁ ВЕРНО", "Всё верно.", "**ВСЁ ВЕРНО**", "Нет, всё верно.", "Замечание ошибочно: ВСЁ ВЕРНО", "Пересчитал оба задания.\nВСЁ ВЕРНО"]) {
    assert.deepEqual(reply(BODY, turn(t)), { ok: true }, t);
  }
});

test("тот же ответ в другой записи это не исправление", () => {
  // согласие и повтор ответа другими знаками
  for (const t of ["ВСЁ ВЕРНО\n№2\nОтвет: 0,5", "ВСЁ ВЕРНО\n№2\nОтвет: $\\frac{1}{2}$", "ВСЁ ВЕРНО\n№1\nОтвет: 4 см^2", "ВСЁ ВЕРНО\n№1\nОтвет: S = 4 см²"]) {
    assert.deepEqual(reply(BODY, turn(t)), { ok: true }, t);
  }
  // задание переписано после пересчёта, ответ тот же: запятая вместо точки, единица опущена
  assert.deepEqual(reply("№2\nv = 0.5\nОтвет: 0.5 м/с", turn("Пересчитаю.", "№2\nv = s/t = 0,5 м/с\nОтвет: 0,5 м/с")), { ok: true });
  assert.deepEqual(reply("№1\nS = 4 см²\nОтвет: 4 см²", turn("№1\nS = 2·2 = 4\nОтвет: 4")), { ok: true });
  // другое число или другая единица это уже другой ответ
  assert.deepEqual(reply("№2\nОтвет: 0.5 м/с", turn("№2\nv = 5 м/с\nОтвет: 5 м/с")), { fix: "№2\nv = 5 м/с\nОтвет: 5 м/с" });
  assert.deepEqual(reply("№2\nОтвет: 5 м", turn("№2\nПереводим в сантиметры.\nОтвет: 5 см")), { fix: "№2\nПереводим в сантиметры.\nОтвет: 5 см" });
  // строка «ВСЁ ВЕРНО» рядом с другим ответом: неясно, чему верить
  assert.equal(reply(BODY, turn("ВСЁ ВЕРНО\n№2\nОтвет: 7")), null);
});

test("исправление нескольких заданий и исправление одного из двух", () => {
  const two = "№1\nx = 3\nОтвет: 9 см²\n@@@\n№2\nПересчёт.\nОтвет: 3/4";
  assert.deepEqual(reply(BODY, turn(two)), { fix: two });
  assert.deepEqual(reply(BODY, turn("В №1 всё верно.\n№2\nПересчёт: 3/4.\nОтвет: 3/4")), { fix: "№2\nПересчёт: 3/4.\nОтвет: 3/4" });
  assert.deepEqual(reply(BODY, turn("Вариант 2 · №2\nПересчёт.\nОтвет: 3/4")), { fix: "Вариант 2 · №2\nПересчёт.\nОтвет: 3/4" });
});
