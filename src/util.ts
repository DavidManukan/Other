// Мелкие помощники без привязки к платформе.

// Сколько мс осталось до срока (не меньше min)
export const left = (until: number, min = 1_000) => Math.max(min, until - Date.now());

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function imageType(b: Uint8Array): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

// Файл с заданием: картинка или PDF. У PDF подпись «%PDF-» стоит в самом начале (перед ней бывает мусор в несколько байт)
export type FileType = NonNullable<ReturnType<typeof imageType>> | "application/pdf";
export function fileType(b: Uint8Array): FileType | null {
  const img = imageType(b);
  if (img) return img;
  for (let i = 0; i + 4 < Math.min(b.length, 1024); i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return "application/pdf";
  }
  return null;
}

export function base64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

// Сравнение секретов без утечки по времени
export function sameSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Время по Москве для журнала на странице проверки
export const clock = (t: number) =>
  new Date(t).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Размер картинки в пикселях (JPEG и PNG): по нему в журнале видно, в каком качестве приходят фото
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b.length > 24) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: v.getUint32(16), h: v.getUint32(20) };
  }
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    // кадр SOF: в нём высота и ширина (кроме служебных C4, C8, CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

export async function fingerprint(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(d)].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
}
