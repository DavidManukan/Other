// Solver: фото задания в WhatsApp -> Claude -> ответ обратно в WhatsApp.
// Cloudflare Worker. Вход только принимает вебхук и отдаёт задание объекту чата (src/chat.ts),
// поэтому шлюз получает ответ сразу, а решение идёт в фоне сколько нужно.
import { type Env, chatById, chatStub, config, hider, hookKey, logKey, publicOrigin } from "./config.ts";
import { STATUS } from "./chat.ts";
import { esc, sameSecret } from "./util.ts";

export { Chat } from "./chat.ts";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = publicOrigin(url); // вебхук и ссылки на рисунки всегда строим на https
    const c = config(env);
    const key = await hookKey(c);
    if (req.method === "GET" || req.method === "HEAD") {
      if (url.protocol === "http:" && origin.startsWith("https:")) return Response.redirect(origin + url.pathname + url.search, 301);
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
        // журнал событий показываем только по личной ссылке (она приходит в ответе на «ping»)
        const mine = await logKey(c);
        const priv = !!mine && sameSecret(url.searchParams.get("k") ?? "", mine);
        html = await chatStub(env, STATUS).statusPage(origin, priv);
      } catch (e) {
        // фоновый объект не поднялся: показываем причину, а не пустую страницу ошибки Cloudflare
        console.log("status:", String(e));
        html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Solver</title><body style="font:18px/1.5 -apple-system,sans-serif;margin:16px"><h2>Solver: проверка</h2><p>❌ Фоновая часть бота не запустилась: ${esc(hider(c)(e)).slice(0, 300)}</p><p>Обнови страницу через минуту. Если не помогло, добавь в Variables and Secrets переменную REGION со значением weur.</p></body>`;
      }
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (req.method !== "POST") return new Response("no", { status: 405 });

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
    await chatStub(env, chatId).onWebhook(h, origin);
    return new Response("ok");
  },
} satisfies ExportedHandler<Env>;
