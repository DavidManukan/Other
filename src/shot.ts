// Снимок страницы с решением: HTML -> картинки. Снимает браузер Cloudflare (Browser Rendering).
// На бесплатном тарифе у него 10 минут работы в сутки и не больше одного запуска раз в 20 секунд;
// одно решение занимает несколько секунд. Не вышло: бот отвечает обычным текстом.
import puppeteer from "@cloudflare/puppeteer";
import katexStyles from "katex/dist/katex.min.css";
import textFontFile from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf";
import ams from "katex/dist/fonts/KaTeX_AMS-Regular.woff2";
import cal from "katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2";
import mainBold from "katex/dist/fonts/KaTeX_Main-Bold.woff2";
import mainBoldItalic from "katex/dist/fonts/KaTeX_Main-BoldItalic.woff2";
import mainItalic from "katex/dist/fonts/KaTeX_Main-Italic.woff2";
import mainRegular from "katex/dist/fonts/KaTeX_Main-Regular.woff2";
import mathBoldItalic from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff2";
import mathItalic from "katex/dist/fonts/KaTeX_Math-Italic.woff2";
import script from "katex/dist/fonts/KaTeX_Script-Regular.woff2";
import size1 from "katex/dist/fonts/KaTeX_Size1-Regular.woff2";
import size2 from "katex/dist/fonts/KaTeX_Size2-Regular.woff2";
import size3 from "katex/dist/fonts/KaTeX_Size3-Regular.woff2";
import size4 from "katex/dist/fonts/KaTeX_Size4-Regular.woff2";
import { katexCss, PAGE_DPR, PAGE_W, pageHtml, PAGINATE, textFont } from "./page.ts";
import { base64 } from "./util.ts";

const FONTS: Record<string, ArrayBuffer> = {
  "KaTeX_AMS-Regular": ams, "KaTeX_Caligraphic-Regular": cal, "KaTeX_Main-Bold": mainBold, "KaTeX_Main-BoldItalic": mainBoldItalic,
  "KaTeX_Main-Italic": mainItalic, "KaTeX_Main-Regular": mainRegular, "KaTeX_Math-BoldItalic": mathBoldItalic, "KaTeX_Math-Italic": mathItalic,
  "KaTeX_Script-Regular": script, "KaTeX_Size1-Regular": size1, "KaTeX_Size2-Regular": size2, "KaTeX_Size3-Regular": size3, "KaTeX_Size4-Regular": size4,
};
export const MAX_PAGES = 30; // больше страниц картинками не шлём: такой ответ уходит текстом целиком
const SHOT_LIMIT = 60_000; // столько даём браузеру на всё решение

// Браузер сегодня больше не даст снимков (кончились бесплатные минуты): до полуночи UTC не пробуем
export class NoBrowser extends Error {
  until: number;
  constructor(message: string, until: number) {
    super(message);
    this.until = until;
  }
}

let assets: { fonts: string; css: string } | null = null;
function styles(): { fonts: string; css: string } {
  assets ??= {
    fonts: textFont(base64(new Uint8Array(textFontFile))),
    css: katexCss(katexStyles, (name) => (FONTS[name] ? base64(new Uint8Array(FONTS[name])) : undefined)),
  };
  return assets;
}

export function sheet(parts: string[], svgs: string[]): string {
  const { fonts, css } = styles();
  return pageHtml(parts, svgs, fonts, css);
}

// Локальные тесты идут без браузера: вместо снимков готовые картинки, по одной на два задания.
// Слова SHOT_FAIL и SHOT_QUOTA в ответе изображают поломку браузера и конец его бесплатных минут.
const DOT = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (ch) => ch.charCodeAt(0));
export function fakeShots(parts: string[]): Uint8Array[] {
  const all = parts.join("\n");
  if (all.includes("SHOT_QUOTA")) throw new NoBrowser("кончились бесплатные минуты браузера на сегодня", Date.now() + 3_600_000);
  if (all.includes("SHOT_FAIL")) throw new Error("браузер не запустился");
  return Array.from({ length: Math.ceil(parts.length / 2) }, () => DOT);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Возвращает картинки страниц по порядку. PNG; если страница вышла тяжелее 1,9 МБ, JPEG.
export async function shoot(binding: Fetcher, html: string): Promise<Uint8Array[]> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  for (let i = 0; !browser; i++) {
    try {
      browser = await puppeteer.launch(binding);
    } catch (e: any) {
      const why = String(e?.message ?? e);
      if (/time limit exceeded/i.test(why)) {
        const now = new Date();
        throw new NoBrowser("кончились бесплатные минуты браузера на сегодня", Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      }
      // «не чаще одного запуска раз в 20 секунд»: ждём и пробуем ещё раз
      if (i < 2 && /429|too many|rate/i.test(why)) await wait(21_000);
      else throw new Error(`браузер не запустился: ${why.slice(0, 160)}`);
    }
  }
  const b = browser;
  const work = async () => {
    const page = await b.newPage();
    await page.setViewport({ width: PAGE_W, height: 800, deviceScaleFactor: PAGE_DPR });
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate("document.fonts.ready.then(() => true)");
    const n = Number(await page.evaluate(PAGINATE)) || 0;
    if (n > MAX_PAGES) throw new Error(`ответ занял ${n} страниц, это слишком много для картинок`);
    const out: Uint8Array[] = [];
    for (let i = 1; i <= n; i++) {
      const el = await page.$(`#p${i}`);
      if (!el) throw new Error(`страница ${i} не нашлась`); // без неё ответ был бы неполным
      let img = (await el.screenshot({ type: "png" })) as Uint8Array;
      if (img.length > 1_900_000) img = (await el.screenshot({ type: "jpeg", quality: 88 })) as Uint8Array;
      out.push(new Uint8Array(img));
    }
    if (!out.length) throw new Error("браузер не снял ни одной страницы");
    return out;
  };
  try {
    return await Promise.race([work(), wait(SHOT_LIMIT).then(() => Promise.reject(new Error("браузер не уложился в минуту")))]);
  } finally {
    await b.close().catch(() => {}); // незакрытый браузер тратит бесплатные минуты, пока сам не уснёт
  }
}
