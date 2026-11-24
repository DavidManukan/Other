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

test("исправление с заголовком «Исправляю №2» тоже считается целым заданием", () => {
  const body = "№1\nОтвет: 4\n\n№2\nОтвет: 5";
  assert.deepEqual(judgeReply({ text: "Исправляю №2\n3 + 4 = 7\nОтвет: 7", cut: false, refused: false }, body), { fix: "Исправляю №2\n3 + 4 = 7\nОтвет: 7" });
});

test("«ДОПОЛНЕНО»: ответ прежний, но в решение добавлен обязательный элемент: это исправление", () => {
  const body = "№1\nx = 4\nОтвет: 4\n\n№2\nF = ma\nОтвет: 5 Н";
  const fix = "№2\nОбоснование:\nсистема отсчёта инерциальная\nF = ma\nОтвет: 5 Н";
  assert.deepEqual(judgeReply({ text: `ДОПОЛНЕНО\n${fix}`, cut: false, refused: false }, body), { fix });
  assert.deepEqual(judgeReply({ text: `**ДОПОЛНЕНО.**\n\n${fix}`, cut: false, refused: false }, body), { fix });
  // без этой строки переписанное задание с прежним ответом исправлением не считается, как и раньше
  assert.deepEqual(judgeReply({ text: fix, cut: false, refused: false }, body), { ok: true });
  // одно слово без задания ничего не значит; оборванный ответ тоже
  assert.equal(judgeReply({ text: "ДОПОЛНЕНО", cut: false, refused: false }, body), null);
  assert.equal(judgeReply({ text: `ДОПОЛНЕНО\n${fix}`, cut: true, refused: false }, body), null);
});

test("«ДОПОЛНЕНО» с заметкой, с заголовком на той же строке и с пересчётом кодом после задания: исправление не теряется", () => {
  const body = "№1\nx = 4\nОтвет: 4\n\n№2\nF = ma\nОтвет: 5 Н";
  const fix = "№2\nОбоснование:\nсистема отсчёта инерциальная\nF = ma\nОтвет: 5 Н";
  for (const head of ["ДОПОЛНЕНО: рисунок сил", "ДОПОЛНЕНО – добавлено обоснование", "Дополнено."]) {
    assert.deepEqual(judgeReply({ text: `${head}\n${fix}`, cut: false, refused: false }, body), { fix }, head);
  }
  // заголовок задания на строке со словом остаётся заголовком
  assert.deepEqual(judgeReply({ text: `ДОПОЛНЕНО ${fix}`, cut: false, refused: false }, body), { fix });
  // после задания модель ещё раз пересчитала кодом: в хвосте только заметка, задание берётся из основного текста
  for (const tail of ["Проверка кодом подтвердила: всё верно.", "Пересчёт сошёлся."]) {
    assert.deepEqual(judgeReply({ text: `ДОПОЛНЕНО\n${fix}`, tail, cut: false, refused: false }, body), { fix }, tail);
  }
  // слово в середине решения меткой не считается: стоит после заголовка задания
  assert.deepEqual(judgeReply({ text: "№2\nДополнено условие: m = 1 кг\nF = ma\nОтвет: 5 Н", cut: false, refused: false }, body), { ok: true });
  // «Дополненоe» внутри другого слова тоже не метка
  assert.deepEqual(judgeReply({ text: `Дополненное решение проверил.\nВСЁ ВЕРНО`, cut: false, refused: false }, body), { ok: true });
});

test("«ДОПОЛНЕНО»: обычная фраза с этим словом меткой не считается, а хвост об ошибке отменяет дополнение", () => {
  const body = "№1\nx = 4\nОтвет: 4\n\n№2\nF = ma\nОтвет: 5 Н";
  const fix = "№2\nрисунок\nF = ma\nОтвет: 5 Н";
  // согласие, в котором есть слово «дополнено»: решение остаётся, платного повтора нет
  for (const text of [
    "Дополнено ничего не требуется: рисунок уже есть.\nВСЁ ВЕРНО",
    "**Дополнено:** решение верно, добавлять нечего.\nВСЁ ВЕРНО",
    "ДОПОЛНЕНО не требуется.\nВСЁ ВЕРНО",
    "Дополнено ли решение обоснованием? Проверю заново.\n№2\nF = ma\nОтвет: 5 Н\nВСЁ ВЕРНО",
    "Дополнено условие: g = 10 м/с².\n№2\nF = ma\nОтвет: 5 Н",
  ]) assert.deepEqual(judgeReply({ text, cut: false, refused: false }, body), { ok: true }, text);
  // после «ДОПОЛНЕНО» пересчёт показал ошибку: старый ответ исправлением не уходит, запрос повторяется
  assert.equal(judgeReply({ text: `ДОПОЛНЕНО\n${fix}`, tail: "Пересчёт кодом показал ошибку: в №2 сила 7 Н, а не 5 Н.", cut: false, refused: false }, body), null);
  // в хвосте сказано, что дополнять нечего: решение остаётся прежним
  assert.deepEqual(judgeReply({ text: `ДОПОЛНЕНО\n${fix}`, tail: "Рисунок уже был, дополнять нечего.\nВСЁ ВЕРНО", cut: false, refused: false }, body), { ok: true });
  // строка согласия после дополненного задания в текст для человека не попадает
  assert.deepEqual(judgeReply({ text: `ДОПОЛНЕНО\n${fix}\nВСЁ ВЕРНО`, cut: false, refused: false }, body), { fix });
});

test("«ДОПОЛНЕНО»: слово не попадает в текст ни одного задания, строки решения не теряются, обычные формы метки приняты", () => {
  const body = "№1\nрешение\nОтвет: 4 см²\n\n№2\nРешение второго.\nОтвет: 1/2";
  const two = judgeReply({ text: "ДОПОЛНЕНО\n№1\nx = 2, рисунок\nОтвет: 4 см²\n@@@\nДОПОЛНЕНО\n№2\nРисунок сил и обоснование.\nОтвет: 1/2", cut: false, refused: false }, body);
  assert.deepEqual(two, { fix: "№1\nx = 2, рисунок\nОтвет: 4 см²\n@@@\n№2\nРисунок сил и обоснование.\nОтвет: 1/2" });
  // исправление одного задания и дополнение другого в одном ответе
  const mixed = judgeReply({ text: "№1\nx = 3\nОтвет: 9 см²\n@@@\nДОПОЛНЕНО\n№2\nРисунок сил и обоснование.\nОтвет: 1/2", cut: false, refused: false }, body);
  assert.deepEqual(mixed, { fix: "№1\nx = 3\nОтвет: 9 см²\n@@@\n№2\nРисунок сил и обоснование.\nОтвет: 1/2" });
  // проверка, ради которой задание дополняли, остаётся в нём
  const checked = judgeReply({ text: "ДОПОЛНЕНО\n№2\nРешение второго.\nПроверка: 2 · 1/2 = 1, всё верно.\nОтвет: 1/2", cut: false, refused: false }, body);
  assert.deepEqual(checked, { fix: "№2\nРешение второго.\nПроверка: 2 · 1/2 = 1, всё верно.\nОтвет: 1/2" });
  const fix = "№2\nРисунок сил и обоснование.\nОтвет: 1/2";
  for (const head of ["Дополнено: добавлен рисунок сил", "ДОПОЛНЕНО (рисунок сил)", "ДОПОЛНЕНО, добавлено обоснование", "**ДОПОЛНЕНО** – рисунок"]) {
    assert.deepEqual(judgeReply({ text: `${head}\n${fix}`, cut: false, refused: false }, body), { fix }, head);
  }
  // после задания модель пересчитала кодом и подтвердила: дополнение принимается
  for (const tail of ["Пересчёт кодом: ошибки нет, ответ 1/2.", "Проверил кодом: неверных значений нет.", "Рисунок исправлен: стрелка вниз.", "Пересчитал без ошибок."]) {
    assert.deepEqual(judgeReply({ text: `ДОПОЛНЕНО\n${fix}`, tail, cut: false, refused: false }, body), { fix }, tail);
  }
  // а после слов об ошибке старый ответ исправлением не уходит
  for (const tail of ["Ошибка в №2, ответ 3.", "Пересчёт показал: ответ неверный."]) {
    assert.equal(judgeReply({ text: `ДОПОЛНЕНО\n${fix}`, tail, cut: false, refused: false }, body), null, tail);
  }
});

test("дописанная буква или индекс это новый ответ, дописанная единица или пояснение нет", () => {
  const ask = (was: string, now: string) => judgeReply({ text: `№1\nрешение заново\nОтвет: ${now}`, cut: false, refused: false }, `№1\nрешение\nОтвет: ${was}`);
  for (const [was, now] of [["CO", "CO₂"], ["А", "АБ"], ["4 см", "4 см²"], ["12", "13"]]) {
    assert.deepEqual(ask(was, now), { fix: `№1\nрешение заново\nОтвет: ${now}` }, `${was} -> ${now}`);
  }
  for (const [was, now] of [["4", "4 см"], ["да", "да, действует"], ["0,5", "0.5"], ["x = 5", "5"]]) {
    assert.deepEqual(ask(was, now), { ok: true }, `${was} -> ${now}`);
  }
});

test("исправление не теряется, если новый ответ совпал с ответом другого задания", () => {
  const body = "№1\nрешение\nОтвет: 2\n\n№2\nрешение\nОтвет: 7\n\n№3\nрешение\nОтвет: 5";
  for (const now of ["2", "7"]) {
    const fix = `№3\nРешение: S = 2 · 1 = ${now}.\nОтвет: ${now}`;
    assert.deepEqual(judgeReply({ text: fix, cut: false, refused: false }, body), { fix }, now);
  }
  // переписанное задание с прежним ответом исправлением не считается
  assert.deepEqual(judgeReply({ text: "№3\nрешение заново\nОтвет: 5", cut: false, refused: false }, body), { ok: true });
  // «да» и «нет» в соседних заданиях
  const yn = "№1\nрешение\nОтвет: да, действует.\n\n№2\nрешение\nОтвет: нет";
  assert.deepEqual(judgeReply({ text: "№1\nрешение заново\nОтвет: нет", cut: false, refused: false }, yn), { fix: "№1\nрешение заново\nОтвет: нет" });
  // разные предметы с одним номером
  const subj = "Физика · №1\nрешение\nОтвет: 6 м\n\nГеометрия · №1\nрешение\nОтвет: 4";
  assert.deepEqual(judgeReply({ text: "Геометрия · №1\nрешение заново\nОтвет: 6", cut: false, refused: false }, subj), { fix: "Геометрия · №1\nрешение заново\nОтвет: 6" });
  // согласие с заметками, где ответы прежние, остаётся согласием
  assert.deepEqual(judgeReply({ text: "ВСЁ ВЕРНО", all: "№1\nпересчёт\nОтвет: 2\n№3\nпересчёт\nОтвет: 5\nВСЁ ВЕРНО", cut: false, refused: false }, body), { ok: true });
  // а если в заметках у задания получился другой ответ, согласие не принимается: запрос повторяется
  assert.equal(judgeReply({ text: "ВСЁ ВЕРНО", all: "№3\nпересчёт\nОтвет: 2\nВСЁ ВЕРНО", cut: false, refused: false }, body), null);
});

test("множитель и второй вариант это новый ответ: «4» и «4π», «А» и «А, В»", () => {
  const ask = (was: string, now: string) => judgeReply({ text: `№1\nрешение заново\nОтвет: ${now}`, cut: false, refused: false }, `№1\nрешение\nОтвет: ${was}`);
  for (const [was, now] of [["4", "4π"], ["4", "4π см²"], ["2", "2i"], ["6", "6%"], ["А", "А, В"], ["1", "1/π"]]) {
    assert.deepEqual(ask(was, now), { fix: `№1\nрешение заново\nОтвет: ${now}` }, `${was} -> ${now}`);
  }
  for (const [was, now] of [["4", "4 см"], ["12", "12 кг"], ["да", "да, действует"], ["да", "да (по закону Ома)"]]) {
    assert.deepEqual(ask(was, now), { ok: true }, `${was} -> ${now}`);
  }
});

test("«ДОПОЛНЕНО» рядом с отзывом о других заданиях: дополнение принято, отзыв в текст не идёт", () => {
  const body = "№1\nx = 4\nОтвет: 4\n\n№2\nF = ma\nОтвет: 5 Н";
  const fix = "№2\nРешение: рисунок сил.\nОтвет: 5 Н";
  for (const head of ["№1 – всё верно.", "№1 верно, дополнять нечего."]) {
    assert.deepEqual(judgeReply({ text: `${head}\nДОПОЛНЕНО\n${fix}`, cut: false, refused: false }, body), { fix }, head);
  }
  assert.deepEqual(judgeReply({ text: `ДОПОЛНЕНО\n${fix}\n\nВ №1 всё верно.`, cut: false, refused: false }, body), { fix });
  // настоящее исправление перед меткой отзывом не считается
  const both = judgeReply({ text: `№1\nx = 3 неверно, x = 5\nОтвет: 5\n@@@\nДОПОЛНЕНО\n${fix}`, cut: false, refused: false }, body);
  assert.deepEqual(both, { fix: `№1\nx = 3 неверно, x = 5\nОтвет: 5\n@@@\n${fix}` });
  // хвост «ошибки не было» после пересчёта это подтверждение
  for (const tail of ["Пересчёт подтвердил ответ, ошибки не было.", "Замечание о неверном ответе не подтвердилось, добавлен рисунок."]) {
    assert.deepEqual(judgeReply({ text: `ДОПОЛНЕНО\n${fix}`, tail, cut: false, refused: false }, body), { fix }, tail);
  }
});
