// Страница проверки: открой ссылку воркера в браузере. Заодно сама настраивает вебхук GREEN-API.
import Anthropic from "@anthropic-ai/sdk";
import { type Cfg, hider, hookKey } from "./config.ts";
import { claudeProblem, client, unavailable } from "./claude.ts";
import type { Green } from "./green.ts";
import { esc } from "./util.ts";

export interface SelfTest {
  state: "running" | "ok" | "failed";
  at: number;
  tries: number;
  error?: string;
}

// Рисунок для самопроверки: обычный чертёж в стиле бота (две плоскости и отрезки между ними)
export const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 640" font-family="DejaVu Sans"><rect width="800" height="640" fill="#171717"/><text x="40" y="50" fill="#fff" font-size="34">№1</text><polygon points="200,90 700,90 600,190 100,190" fill="none" stroke="#D9D9D0" stroke-width="2"/><text x="650" y="125" fill="#D9D9D0" font-size="30">α</text><polygon points="200,430 700,430 600,530 100,530" fill="none" stroke="#D9D9D0" stroke-width="2"/><text x="650" y="465" fill="#D9D9D0" font-size="30">β</text><line x1="270" y1="140" x2="520" y2="140" stroke="#fff" stroke-width="2" stroke-dasharray="8 6"/><line x1="330" y1="480" x2="580" y2="480" stroke="#fff" stroke-width="2" stroke-dasharray="8 6"/><line x1="270" y1="140" x2="330" y2="480" stroke="#D5643C" stroke-width="4"/><line x1="520" y1="140" x2="580" y2="480" stroke="#D5643C" stroke-width="4"/><g fill="#fff"><circle cx="270" cy="140" r="7"/><circle cx="520" cy="140" r="7"/><circle cx="330" cy="480" r="7"/><circle cx="580" cy="480" r="7"/></g><g fill="#fff" font-size="32"><text x="235" y="125">A1</text><text x="535" y="125">C</text><text x="300" y="525">B1</text><text x="590" y="525">D</text></g></svg>`;

const VAL_TOWN_END = Date.UTC(2027, 0, 11); // после этого Val Town выключен и подсказка про него не нужна

const STATE_HINT: Record<string, string> = {
  starting: "Запускается. Подожди 5 минут и обнови страницу.",
  sleepMode: "Телефон офлайн. Открой WhatsApp Business и подожди 5 минут.",
  notAuthorized: "Привяжи номер заново: «Связать по номеру телефона» в console.green-api.com.",
  blocked: "Номер бота заблокирован WhatsApp.",
  suspended: "WhatsApp временно ограничил номер бота.",
  yellowCard: "WhatsApp временно ограничил отправку с номера бота. Подожди сутки.",
};

// log === null: страницу открыли по общей ссылке, журнал событий не показываем
export async function status(c: Cfg, green: Green, origin: string, log: string[] | null, test: SelfTest): Promise<string> {
  const hide = hider(c);
  const rows: string[] = [];
  const cpu = test.state === "ok"
    ? "✅ Рисунки рендерятся, мощности Cloudflare хватает"
    : test.state === "running"
    ? "⏳ Проверяю рендер рисунков… страница обновится сама"
    : `❌ Cloudflare оборвал рендер рисунка${test.error ? ` (${test.error})` : ""}. Бесплатного тарифа не хватает: включи Workers Paid (5 $/мес) в панели Cloudflare и обнови страницу`;
  if (c.missing.length) {
    rows.push(`❌ Не заполнено: ${c.missing.join(", ")}. Cloudflare → воркер → Settings → Variables and Secrets.`, cpu);
  } else {
    const [state, hook, claude] = await Promise.all([greenState(green), webhook(c, green, origin, test), claudeCheck(c)]);
    rows.push(state, claude, cpu, hook);
  }
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${test.state === "running" ? '<meta http-equiv="refresh" content="4">' : ""}<title>Solver</title><body style="font:18px/1.5 -apple-system,sans-serif;margin:16px">
<h2>Solver: проверка</h2>${rows.map((r) => `<p>${esc(hide(r))}</p>`).join("")}
<p>Бот думает столько, сколько нужно: потолка в 60 секунд больше нет.</p>
<p><a href="">Проверить ещё раз</a></p>
${Date.now() < VAL_TOWN_END ? '<p style="font-size:15px;color:#666">Старую страницу бота на Val Town больше не открывай: она вернёт сообщения на старого бота. Лучше удали там val.</p>' : ""}
${log === null
    ? '<p style="font-size:15px;color:#666">Журнал событий: напиши боту ping, в ответе придёт личная ссылка.</p>'
    : `<h3>Последние события</h3>${log.length ? [...log].reverse().map((l) => `<p style="font-size:15px;margin:4px 0">${esc(hide(l))}</p>`).join("") : "<p>Пока пусто.</p>"}`}</body>`;
}

async function greenState(green: Green): Promise<string> {
  try {
    const s = String((await green.call("getStateInstance"))?.stateInstance);
    return s === "authorized" ? "✅ WhatsApp бота подключён" : `❌ WhatsApp бота не подключён (${s}). ${STATE_HINT[s] ?? "Привяжи номер заново."}`;
  } catch (e: any) {
    return `❌ ${e.message}. Проверь GREEN_URL, GREEN_ID, GREEN_TOKEN.`;
  }
}

// Вебхук переключаем на этот адрес только после удачной самопроверки:
// пока новый хостинг не доказал, что справляется, сообщения идут на старый адрес.
async function webhook(c: Cfg, green: Green, origin: string, test: SelfTest): Promise<string> {
  try {
    const key = await hookKey(c);
    const hook = `${origin}/?k=${key}`;
    const s = await green.call("getSettings");
    if (String(s?.webhookUrl ?? "") === hook && s?.incomingWebhook === "yes" && s?.outgoingAPIMessageWebhook !== "yes") return "✅ Вебхук настроен: сообщения идут сюда";
    if (test.state === "running") return "⏳ Вебхук переключу сюда, как только пройдёт проверка рисунков";
    if (test.state === "failed") return "⏸ Вебхук не трогаю: сообщения по-прежнему идут на старый адрес";
    await green.call("setSettings", {
      webhookUrl: hook,
      webhookUrlToken: key,
      incomingWebhook: "yes",
      outgoingWebhook: "no",
      outgoingMessageWebhook: "no",
      outgoingAPIMessageWebhook: "no",
      stateWebhook: "no",
      incomingCallWebhook: "no",
      editedMessageWebhook: "no",
      deletedMessageWebhook: "no",
      pollMessageWebhook: "no",
      delaySendMessagesMilliseconds: 1000, // рисунки идут следом за текстом без долгих пауз
    });
    return "⏳ Вебхук только что переключён на этот адрес. Подожди 5 минут и обнови страницу.";
  } catch (e: any) {
    return `❌ Не смог настроить вебхук: ${e.message}`;
  }
}

async function claudeCheck(c: Cfg): Promise<string> {
  const look = (model: string) => client(c).models.retrieve(model, {}, { timeout: 10_000, maxRetries: 0 });
  try {
    await look(c.model);
    return `✅ Ключ Claude принят, модель ${c.model}. Баланс смотри на platform.claude.com`;
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionError) return "❌ Claude не отвечает";
    // основной модели на этом ключе нет: бот сам работает на запасной
    if (unavailable(e) && c.fallbackModel && c.fallbackModel !== c.model) {
      try {
        await look(c.fallbackModel);
        return `⚠️ Модель ${c.model} на этом ключе недоступна. Бот работает на запасной: ${c.fallbackModel}`;
      } catch { /* покажем ошибку основной модели */ }
    }
    return `❌ ${claudeProblem(c, e).message}`;
  }
}
