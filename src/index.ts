// Solver: фото задания в WhatsApp -> Claude -> ответ обратно в WhatsApp.
// Cloudflare Worker. Вход только принимает вебхук и отдаёт задание объекту чата (src/chat.ts),
// поэтому шлюз получает ответ сразу, а решение идёт в фоне сколько нужно.
import { type Env, chatById, chatStub, config, hookKey } from "./config.ts";
import { STATUS } from "./chat.ts";
import { sameSecret } from "./util.ts";

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
      const html = await chatStub(env, STATUS).statusPage(url.origin);
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
