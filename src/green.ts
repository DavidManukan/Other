// GREEN-API: шлюз в WhatsApp бота.
import { type Cfg, hider } from "./config.ts";
import { left } from "./util.ts";

// Ошибка шлюза. status есть, если шлюз ответил; timeout: ответа не дождались (запрос мог дойти)
export class GreenError extends Error {
  status?: number;
  timeout: boolean;
  constructor(message: string, status?: number, timeout = false) {
    super(message);
    this.status = status;
    this.timeout = timeout;
  }
}
// Шлюз отказал по существу (неверный запрос, квота тарифа, нет доступа): повторять бесполезно
export const permanent = (e: unknown) => e instanceof GreenError && e.status !== undefined && e.status >= 400 && e.status < 500 && e.status !== 429;

export class Green {
  private c: Cfg;
  private hide: (x: unknown) => string;
  constructor(c: Cfg) {
    this.c = c;
    this.hide = hider(c);
  }

  async call(method: string, body?: unknown, ms = 10_000): Promise<any> {
    const { greenUrl, greenId, greenToken } = this.c;
    if (!/^https?:\/\//.test(greenUrl)) throw new GreenError("GREEN_URL должен начинаться с https://", 400);
    let r: Response;
    try {
      r = await fetch(`${greenUrl}/waInstance${greenId}/${method}/${greenToken}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(ms),
      });
    } catch (e: any) {
      if (e?.name === "TimeoutError") throw new GreenError(`GREEN-API ${method}: не ответил за ${Math.round(ms / 1000)} с`, undefined, true);
      throw new GreenError(`GREEN-API ${method}: нет связи`); // текст ошибки fetch содержит токен, его не показываем
    }
    const t = await r.text();
    if (!r.ok) throw new GreenError(`GREEN-API ${method}: ${r.status} ${this.hide(t).slice(0, 150)}`, r.status);
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }

  // Одна повторная попытка, только когда запрос точно не был принят: связи не было или шлюз ответил 5xx / 429.
  // После таймаута не повторяем: сообщение могло дойти, и повтор задвоил бы его.
  private async retry<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (e) {
      if (!(e instanceof GreenError) || e.timeout || permanent(e)) throw e;
      await new Promise((r) => setTimeout(r, 1_500));
      return await f();
    }
  }

  send(chatId: string, message: string, ms = 30_000): Promise<any> {
    const text = message.length > 19_000 ? message.slice(0, 19_000) + "\n(обрезано)" : message;
    return this.retry(() => this.call("sendMessage", { chatId, message: text, linkPreview: false }, ms));
  }

  // Адрес для загрузки файлов: в консоли GREEN-API это mediaUrl (apiUrl с «media» вместо «api»)
  private mediaUrl(): string | null {
    if (this.c.greenMedia) return this.c.greenMedia;
    try {
      const u = new URL(this.c.greenUrl);
      const host = u.host.replace(/(^|\.)api\./, "$1media.");
      return host === u.host ? null : `${u.protocol}//${host}`;
    } catch {
      return null;
    }
  }

  // Рисунок. Сначала загружаем файл прямо в шлюз: так сразу видно, принял он его или нет.
  // Если загрузка не удалась, шлюз забирает картинку сам по ссылке на воркер.
  async sendImage(chatId: string, png: Uint8Array, url: string): Promise<void> {
    const media = this.mediaUrl();
    if (media && Date.now() > Green.uploadOffUntil) {
      try {
        const form = new FormData();
        form.append("chatId", chatId);
        form.append("fileName", "risunok.png");
        form.append("file", new Blob([png], { type: "image/png" }), "risunok.png");
        const r = await fetch(`${media}/waInstance${this.c.greenId}/sendFileByUpload/${this.c.greenToken}`, { method: "POST", body: form, signal: AbortSignal.timeout(45_000) });
        const t = await r.text();
        if (!r.ok) throw new Error(`${r.status} ${this.hide(t).slice(0, 150)}`);
        Green.uploadFails = 0;
        return;
      } catch (e: any) {
        console.log("загрузка рисунка не удалась, отправляю по ссылке:", this.hide(e?.message ?? e));
        if (++Green.uploadFails >= 2) Green.uploadOffUntil = Date.now() + 600_000; // не тратим время на заведомо неудачные попытки
      }
    }
    await this.retry(() => this.call("sendFileByUrl", { chatId, urlFile: url, fileName: "risunok.png" }, 20_000));
  }
  private static uploadFails = 0;
  private static uploadOffUntil = 0;

  // Фото задания. Больше max байт не читаем: огромный файл не должен уронить бота.
  async photo(chatId: string, idMessage: string, url: string | undefined, until: number, max: number): Promise<Uint8Array> {
    const load = async (u: string) => {
      const r = await fetch(u, { signal: AbortSignal.timeout(Math.min(20_000, left(until))) });
      if (!r.ok) throw new Error(`фото не скачалось: ${r.status}`);
      if (Number(r.headers.get("content-length")) > max) throw new TooBig();
      const parts: Uint8Array[] = [];
      let size = 0;
      for await (const part of r.body as unknown as AsyncIterable<Uint8Array>) {
        size += part.length;
        if (size > max) throw new TooBig();
        parts.push(part);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const part of parts) (bytes.set(part, at), (at += part.length));
      return bytes;
    };
    if (url) {
      try {
        return await load(url);
      } catch (e) {
        if (e instanceof TooBig) throw e;
        console.log("downloadUrl не сработал, пробую downloadFile:", this.hide(e));
      }
    }
    const j = await this.call("downloadFile", { chatId, idMessage }, Math.min(15_000, left(until)));
    if (!j?.downloadUrl) throw new Error("GREEN-API не дал ссылку на фото");
    return await load(j.downloadUrl);
  }
}

export class TooBig extends Error {}
