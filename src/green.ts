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

  async call(method: string, body?: unknown, ms = 10_000, query = ""): Promise<any> {
    const { greenUrl, greenId, greenToken } = this.c;
    if (!/^https?:\/\//.test(greenUrl)) throw new GreenError("GREEN_URL должен начинаться с https://", 400);
    let r: Response;
    try {
      r = await fetch(`${greenUrl}/waInstance${greenId}/${method}/${greenToken}${query}`, {
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
    return this.retry(() => this.call("sendMessage", { chatId, message: clip(message), linkPreview: false }, ms));
  }

  // Принял ли шлюз сообщение, на отправку которого мы не дождались ответа. Смотрим его журнал исходящих:
  // если сообщение там есть, второй раз его не шлём. Не удалось узнать: считаем, что не принял (лучше дубль, чем потеря).
  // Картинку ищем по подписи (у каждой страницы она своя): имя файла шлюз в журнале для картинок заменяет своим.
  async wasSent(chatId: string, since: number, what: { text: string } | { file: string; caption?: string }): Promise<boolean> {
    try {
      const minutes = Math.min(1440, Math.ceil((Date.now() - since) / 60_000) + 2);
      const list = await this.call("lastOutgoingMessages", undefined, 10_000, `?minutes=${minutes}`);
      if (!Array.isArray(list)) return false;
      const from = Math.floor(since / 1000) - 5;
      const head = (s: unknown) => String(s ?? "").trim().slice(0, 200);
      return list.some((m: any) => {
        if (m?.chatId !== chatId || Number(m.timestamp) < from) return false;
        if ("file" in what) {
          if (m.typeMessage === "documentMessage") return String(m.fileName ?? "") === what.file;
          return /image/i.test(String(m.typeMessage)) && !!what.caption && head(m.caption) === head(what.caption);
        }
        return head(m.textMessage ?? m.extendedTextMessage?.text) === head(clip(what.text));
      });
    } catch (e) {
      console.log("журнал исходящих не открылся:", this.hide(e));
      return false;
    }
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

  // Картинка (страница решения или рисунок). Сначала загружаем файл прямо в шлюз: так сразу видно, принял он его или нет.
  // Если загрузка не удалась, шлюз забирает картинку сам по ссылке на воркер.
  // name: имя файла, своё у каждой картинки: по нему потом видно в журнале шлюза, дошла ли она.
  async sendImage(chatId: string, image: Uint8Array, url: string, name: string, caption = ""): Promise<void> {
    const media = this.mediaUrl();
    const type = /\.jpe?g$/i.test(name) ? "image/jpeg" : "image/png";
    if (media && Date.now() > Green.uploadOffUntil) {
      const at = Date.now();
      let status = 0;
      try {
        const form = new FormData();
        form.append("chatId", chatId);
        form.append("fileName", name);
        if (caption) form.append("caption", caption);
        form.append("file", new Blob([image], { type }), name);
        const r = await fetch(`${media}/waInstance${this.c.greenId}/sendFileByUpload/${this.c.greenToken}`, { method: "POST", body: form, signal: AbortSignal.timeout(45_000) });
        status = r.status;
        const t = await r.text();
        if (!r.ok) throw new Error(`${r.status} ${this.hide(t).slice(0, 150)}`);
        Green.uploadFails = 0;
        return;
      } catch (e: any) {
        // Ответа не дождались: файл мог уйти. По ссылке следом не шлём, иначе картинка придёт дважды.
        if (e?.name === "TimeoutError") throw new GreenError("GREEN-API sendFileByUpload: не ответил за 45 с", undefined, true);
        // Связь оборвалась или шлюз ответил 5xx: файл он мог успеть принять. Смотрим в журнал, прежде чем слать по ссылке.
        if (!(status >= 400 && status < 500) && (await this.wasSent(chatId, at, { file: name, caption }))) return;
        console.log("загрузка картинки не удалась, отправляю по ссылке:", this.hide(e?.message ?? e));
        if (++Green.uploadFails >= 2) Green.uploadOffUntil = Date.now() + 600_000; // не тратим время на заведомо неудачные попытки
      }
    }
    await this.retry(() => this.call("sendFileByUrl", { chatId, urlFile: url, fileName: name, ...(caption ? { caption } : {}) }, 20_000));
  }
  private static uploadFails = 0;
  private static uploadOffUntil = 0;

  // Фото задания. Больше max байт не читаем: огромный файл не должен уронить бота.
  async photo(chatId: string, idMessage: string, url: string | undefined, until: number, max: number): Promise<Uint8Array> {
    const load = async (u: string) => {
      let r: Response;
      try {
        r = await fetch(u, { signal: AbortSignal.timeout(Math.min(20_000, left(until))) });
      } catch (e: any) {
        throw new GreenError("фото не скачалось: нет связи", undefined, e?.name === "TimeoutError");
      }
      if (!r.ok) throw new GreenError(`фото не скачалось: ${r.status}`, r.status);
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
    if (!j?.downloadUrl) throw new GreenError("GREEN-API не дал ссылку на фото", 404);
    return await load(j.downloadUrl);
  }
}

export class TooBig extends Error {}

export const CAPTION_MAX = 1000; // подпись к картинке: у шлюза предел 1024 знака
// Длиннее шлюз не принимает
export const clip = (message: string) => (message.length > 19_000 ? message.slice(0, 19_000) + "\n(обрезано)" : message);
