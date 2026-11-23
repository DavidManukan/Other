// GREEN-API: шлюз в WhatsApp бота.
import { type Cfg, hider } from "./config.ts";
import { left } from "./util.ts";

export class Green {
  private c: Cfg;
  private hide: (x: unknown) => string;
  constructor(c: Cfg) {
    this.c = c;
    this.hide = hider(c);
  }

  async call(method: string, body?: unknown, ms = 10_000): Promise<any> {
    const { greenUrl, greenId, greenToken } = this.c;
    if (!/^https?:\/\//.test(greenUrl)) throw new Error("GREEN_URL должен начинаться с https://");
    let r: Response;
    try {
      r = await fetch(`${greenUrl}/waInstance${greenId}/${method}/${greenToken}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(ms),
      });
    } catch (e: any) {
      if (e?.name === "TimeoutError") throw new Error(`GREEN-API ${method}: не ответил за ${Math.round(ms / 1000)} с`);
      throw new Error(`GREEN-API ${method}: нет связи`); // текст ошибки fetch содержит токен, его не показываем
    }
    const t = await r.text();
    if (!r.ok) throw new Error(`GREEN-API ${method}: ${r.status} ${this.hide(t).slice(0, 150)}`);
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }

  // Короткий сбой сети или 5xx не должен терять сообщение: одна повторная попытка
  private async retry<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (e: any) {
      if (/: 4(?!29)\d\d /.test(String(e?.message))) throw e; // ошибка в самом запросе, повтор не поможет
      await new Promise((r) => setTimeout(r, 1_500));
      return await f();
    }
  }

  send(chatId: string, message: string, ms = 15_000): Promise<any> {
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
        const r = await fetch(`${media}/waInstance${this.c.greenId}/sendFileByUpload/${this.c.greenToken}`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
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

  async photo(chatId: string, idMessage: string, url: string | undefined, until: number): Promise<Uint8Array> {
    const load = async (u: string) => {
      const r = await fetch(u, { signal: AbortSignal.timeout(Math.min(20_000, left(until))) });
      if (!r.ok) throw new Error(`фото не скачалось: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    };
    if (url) {
      try {
        return await load(url);
      } catch (e) {
        console.log("downloadUrl не сработал, пробую downloadFile:", this.hide(e));
      }
    }
    const j = await this.call("downloadFile", { chatId, idMessage }, Math.min(15_000, left(until)));
    if (!j?.downloadUrl) throw new Error("GREEN-API не дал ссылку на фото");
    return await load(j.downloadUrl);
  }
}
