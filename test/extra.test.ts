// Модульные проверки новых функций: цена запроса, вердикт второй проверки, файлы PDF, заголовок исправления.
import assert from "node:assert/strict";
import { test } from "node:test";
import { price } from "../src/claude.ts";
import { config } from "../src/config.ts";
import { CHECK_PROMPT, judgeText, PROMPT } from "../src/prompt.ts";
import { card, compose, plainText, verdict } from "../src/text.ts";
import { fileType } from "../src/util.ts";

const near = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} вместо ${b}`);

test("цена запроса: вход, выход, чтение и запись кэша по ценам модели; fast вдвое дороже", () => {
  const u = { in: 1200, out: 345, read: 5000, write: 400 };
  near(price("claude-fable-5-2", u, false), (1200 * 8 + 345 * 40 + 5000 * 0.2 + 400 * 10) / 1e6);
  near(price("claude-fable-5-2", u, true), (2 * (1200 * 8 + 345 * 40 + 5000 * 0.2 + 400 * 10)) / 1e6);
  near(price("claude-opus-5-5", u, false), (1200 * 4 + 345 * 20 + 5000 * 0.2 + 400 * 5) / 1e6);
  near(price("claude-fable-5-2-20261001", { in: 1_000_000, out: 0, read: 0, write: 0 }, false), 8); // имя модели с датой
  assert.equal(price("some-other-model", u, false), null); // цену чужой модели не выдумываем
});

test("вердикт второй проверки: верно, ошибка с замечаниями, ответ не по форме", () => {
  assert.deepEqual(verdict("ВЕРДИКТ: ВЕРНО"), { ok: true });
  assert.deepEqual(verdict("Проверил.\nВЕРДИКТ: верно\n"), { ok: true });
  assert.deepEqual(verdict("ВЕРДИКТ: ОШИБКА\n№2: в решении 5, а получается 7\n№3: потерян корень"), { ok: false, issues: "№2: в решении 5, а получается 7\n№3: потерян корень" });
  assert.equal(verdict("ВЕРДИКТ: ОШИБКА"), null); // ошибка без единого замечания: исправлять нечего, это ответ не по форме
  assert.equal(verdict("Мне кажется, тут всё хорошо."), null);
  assert.equal(verdict(""), null);
});

test("файл с заданием: фото и PDF определяются по содержимому", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  assert.equal(fileType(bytes("%PDF-1.7\n...")), "application/pdf");
  assert.equal(fileType(bytes("\n\n  %PDF-1.4 начинается не с первого байта")), "application/pdf");
  assert.equal(fileType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(fileType(bytes("это текст, а не файл с заданием")), null);
  assert.equal(fileType(bytes("PK\u0003\u0004 docx")), null);
  assert.equal(fileType(new Uint8Array(0)), null);
});

test("исправление после второй проверки подписано своим заголовком и в подписи, и в тексте", () => {
  const fix = [plainText("№2\nПересчёт: $3 + 4 = 7$\nОтвет: $7$")];
  const title = "⚠️ Исправление после перепроверки";
  assert.equal(card(fix, title), `${title}\n№2: 7`);
  assert.equal(compose(fix, 12000, title).join("\n"), `${title}\n№2: 7\n——————————\n№2\nПересчёт: 3 + 4 = 7\nОтвет: 7`);
  assert.equal(compose(fix, 12000).join("\n"), "№2\nПересчёт: 3 + 4 = 7\nОтвет: 7"); // обычный ответ из одного задания идёт без списка
  assert.ok(card(fix).startsWith("✅ Ответы\n"));
});

test("настройки второй проверки: включена по умолчанию, идёт на запасной модели", () => {
  const base = { CHAT: {} as never };
  assert.equal(config(base).check, true);
  assert.equal(config(base).checkModel, "claude-opus-5-5");
  assert.equal(config({ ...base, CHECK: "0" }).check, false);
  assert.equal(config({ ...base, CHECK_MODEL: "claude-sonnet-5-5" }).checkModel, "claude-sonnet-5-5");
  assert.equal(config({ ...base, FALLBACK_MODEL: "claude-fable-5-2" }).checkModel, "claude-fable-5-2");
});

test("инструкции второй проверки: строгая форма ответа, замечания доходят до основной модели", () => {
  assert.ok(CHECK_PROMPT.includes("ВЕРДИКТ: ВЕРНО") && CHECK_PROMPT.includes("ВЕРДИКТ: ОШИБКА"));
  assert.ok(CHECK_PROMPT.startsWith("Ты проверяешь готовое решение"));
  const j = judgeText("№2: в решении 5, а получается 7");
  assert.ok(j.startsWith("Независимая перепроверка") && j.includes("№2: в решении 5, а получается 7") && j.includes("ВСЁ ВЕРНО") && j.includes("@@@"));
  assert.ok(PROMPT.includes("файл PDF")); // основная инструкция знает, что вместо фото может прийти файл
});
