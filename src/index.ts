// Solver: фото задания в WhatsApp -> Claude -> ответ обратно в WhatsApp.
// Cloudflare Worker. Вход только принимает вебхук и отдаёт задание объекту чата (src/chat.ts),
// поэтому шлюз получает ответ сразу, а решение идёт в фоне сколько нужно.
import { type Env, chatById, chatStub, config, hider, hookKey } from "./config.ts";
import { STATUS } from "./chat.ts";
import { esc, sameSecret } from "./util.ts";

export { Chat } from "./chat.ts";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" || req.method === "HEAD") {
      const img = url.searchParams.get("img");
      if (img) {
        // рисунок: первые 64 знака это объект чата, остальные 32 это сам рисунок
        if (!/^[0-9a-f]{96}$/.test(img)) return new Response("no", { status: 404 });
        const chat = chatById(env, img.slice(0, 64));
        return chat ? await chat.image(img.slice(64)) : new Response("no", { status: 404 });
      }
      if (url.pathname !== "/") return new Response("no", { status: 404 });
      let html: string;
      try {
        html = await chatStub(env, STATUS).statusPage(url.origin);
      } catch (e) {
        // фоновый объект не поднялся: показываем причину, а не пустую страницу ошибки Cloudflare
        console.log("status:", String(e));
        html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Solver</title><body style="font:18px/1.5 -apple-system,sans-serif;margin:16px"><h2>Solver: проверка</h2><p>❌ Фоновая часть бота не запустилась: ${esc(hider(config(env))(e)).slice(0, 300)}</p><p>Обнови страницу через минуту. Если не помогло, добавь в Variables and Secrets переменную REGION со значением weur.</p></body>`;
      }
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (req.method !== "POST") return new Response("no", { status: 405 });

    const c = config(env);
    const key = await hookKey(c);
    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!key || !(sameSecret(url.searchParams.get("k") ?? "", key) || sameSecret(bearer, key))) return new Response("no");
    const h: any = await req.json().catch(() => null);
    if (h?.typeWebhook === "quotaExceeded") {
      console.log("GREEN-API: лимит тарифа исчерпан", JSON.stringify(h));
      await chatStub(env, STATUS).log("GREEN-API: лимит тарифа исчерпан (чаты или сообщения)");
      return new Response("ok");
    }
    if (h?.typeWebhook !== "incomingMessageReceived") return new Response("ok");
    const chatId = String(h.senderData?.chatId ?? "");
    if (!/@(c\.us|lid)$/.test(chatId)) return new Response("ok"); // группы, статусы и каналы пропускаем
    // Если очередь не приняла сообщение, отвечаем ошибкой: шлюз пришлёт его ещё раз
    await chatStub(env, chatId).onWebhook(h, url.origin);
    return new Response("ok");
  },
} satisfies ExportedHandler<Env>;
