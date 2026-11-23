// Решение «как в тетради»: готовый ответ модели -> страница HTML с настоящими формулами.
// Страницу снимает браузер Cloudflare (src/shot.ts), человеку приходит картинка.
// Здесь только чистые функции: текст -> HTML.
import katex from "katex";
import { fixSvg } from "./svg.ts";
import { mathSpans, texToPlain } from "./tex.ts";
import { prettyMath } from "./text.ts";
import { esc } from "./util.ts";

export const PAGE_W = 560; // ширина страницы в точках CSS; снимается с плотностью 2, то есть 1120 пикселей
export const PAGE_H = 1000; // выше этого страницу делим: 9:16 занимает экран телефона целиком

const HEAD = /^\s*((Вариант\s+\S+\s*·\s*)?(№|Задание|Задача)\s*\S*|Исправляю\b.*|Вариант\s+\S+.*)$/;
const LABEL = /^(Дано|Найти|Доказать|Решение|Доказательство|Обоснование|Проверка|ОДЗ|Ответ)\s*:\s*(.*)$/;

// Формула: KaTeX пишет готовый HTML. Не разобралась (опечатка модели): показываем её обычным текстом.
export function tex(src: string): string {
  try {
    return katex.renderToString(`\\displaystyle ${src}`, { throwOnError: true, strict: "ignore", output: "html", trust: false, maxExpand: 2000 });
  } catch {
    return `<span class="raw">${esc(texToPlain(src))}</span>`;
  }
}

// Строка с формулами $…$ -> HTML
export function inline(text: string): string {
  return mathSpans(text).map((s) => (s.math ? tex(s.body) : esc(prettyMath(s.body)))).join("");
}

// Пометка справа от преобразования: «выражение | что сделали». Черту ищем только вне формул.
function annotated(line: string): [string, string] | null {
  let depth = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "$") depth = !depth;
    else if (!depth && line[i] === "|" && line[i - 1] === " " && line[i + 1] === " " && i > 1) return [line.slice(0, i).trimEnd(), line.slice(i + 1).trim()];
  }
  return null;
}

const row = (line: string): string => {
  const a = annotated(line);
  return a ? `<div class="b row"><div class="main">${inline(a[0])}</div><div class="note">${inline(a[1])}</div></div>` : `<div class="b line">${inline(line)}</div>`;
};

// Номер задачи, для которой сделан рисунок: первая подпись в левом верхнем углу («№3», «Вариант 2 · №1»)
export function figureLabel(svg: string): string {
  const m = /<text\b[^>]*>([\s\S]*?)<\/text>/i.exec(svg);
  return (m?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
const key = (s: string) => s.toLowerCase().replace(/[\s.:]/g, "");

// own: рисунок стоит в своём задании, номер в его углу повторять незачем
function figure(svg: string, own: boolean): string {
  const clean = fixSvg(own ? svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/i, "") : svg)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/<(image|foreignObject|use)\b[\s\S]*?(\/>|<\/\1>)/gi, "") // страница ничего не тянет из сети
    .replace(/(href|src)="(?!#)[^"]*"/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/url\((?!\s*['"]?#)[^)]*\)/gi, "none");
  return `<div class="b fig">${clean}</div>`;
}

// Одно задание -> HTML. figs: рисунки этого задания
export function taskHtml(part: string, figs: Fig[]): string {
  const lines = part.split("\n");
  const out: string[] = [];
  let title = "";
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length && HEAD.test(lines[i]) && lines[i].length <= 60) {
    title = lines[i].trim();
    out.push(`<h2 class="b">${inline(title)}</h2>`);
    i++;
  }
  let placed = false;
  const place = () => {
    if (placed) return;
    placed = true;
    for (const f of figs) out.push(figure(f.svg, f.own));
  };
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^\s*```/.test(line)) { // код программы: моноширинный блок с отступами
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      out.push(`<pre class="b">${esc(code.join("\n"))}</pre>`);
      continue;
    }
    const m = LABEL.exec(line.trim());
    if (m?.[1] === "Дано") { // «Дано» с чертой справа и «Найти» под чертой, как в тетради
      const given: string[] = m[2] ? [m[2]] : [];
      const find: string[] = [];
      let label = "Найти";
      for (i++; i < lines.length; i++) {
        const l = lines[i].trim();
        const n = LABEL.exec(l);
        if (n && (n[1] === "Решение" || n[1] === "Доказательство" || n[1] === "Ответ")) break;
        if (/^\s*```/.test(l)) break;
        if (n && (n[1] === "Найти" || n[1] === "Доказать")) {
          label = n[1];
          if (n[2]) find.push(n[2]);
        } else if (l) (find.length || label !== "Найти" ? find : given).push(l);
      }
      i--;
      out.push(
        `<div class="b given"><div class="lbl">Дано:</div>${given.map((g) => `<div>${inline(g)}</div>`).join("")}` +
          (find.length ? `<div class="find"><span class="lbl">${label}:</span> ${find.map(inline).join("<br>")}</div>` : "") + `</div>`,
      );
      place(); // чертёж сразу под «Дано», до решения
      continue;
    }
    if (m?.[1] === "Ответ") {
      out.push(`<div class="b ans"><span class="lbl">Ответ:</span> ${inline(m[2])}</div>`);
      continue;
    }
    if (m && !m[2]) {
      out.push(`<div class="b lbl">${m[1]}:</div>`);
      continue;
    }
    if (m) {
      const a = annotated(m[2]);
      out.push(a
        ? `<div class="b row"><div class="main"><span class="lbl">${m[1]}:</span> ${inline(a[0])}</div><div class="note">${inline(a[1])}</div></div>`
        : `<div class="b line"><span class="lbl">${m[1]}:</span> ${inline(m[2])}</div>`);
      continue;
    }
    out.push(row(line.trim()));
  }
  place();
  return `<section class="task" data-title="${esc(title)}">${out.join("")}</section>`;
}

export interface Fig {
  svg: string;
  own: boolean; // нашёлся по номеру своего задания
}
// Раскладывает рисунки по заданиям: по номеру в углу рисунка. Рисунок без пары уходит к последнему заданию.
export function assign(parts: string[], svgs: string[]): Fig[][] {
  const heads = parts.map((p) => key((p.split("\n").find((l) => l.trim()) ?? "").trim()));
  const figs: Fig[][] = parts.map(() => []);
  for (const svg of svgs) {
    const label = key(figureLabel(svg));
    let at = label ? heads.findIndex((h) => h === label) : -1;
    if (at < 0 && label) at = heads.findIndex((h) => h.endsWith(label) || (label.endsWith(h) && h.length > 1));
    figs[at >= 0 ? at : Math.max(0, parts.length - 1)].push({ svg, own: at >= 0 });
  }
  return figs;
}

// Чёрный фон, белый текст: так страницу хорошо видно и на очках, и на телефоне
export function pageCss(): string {
  return `*{box-sizing:border-box}html,body{margin:0;padding:0;background:#000}
body{width:${PAGE_W}px;color:#fff;font:21px/1.5 'DejaVu Sans',sans-serif;-webkit-font-smoothing:antialiased}
.sheet{width:${PAGE_W}px;padding:22px 24px 16px;background:#000}
.task{padding:0 0 14px}.task+.task{border-top:2px solid #555;padding-top:10px}
h2{font-size:26px;line-height:1.3;margin:6px 0 8px;font-weight:bold}
.cont{font-size:17px;color:#ccc;margin:0 0 6px}
.b{margin:6px 0;overflow-wrap:anywhere}
.lbl{font-weight:bold}
.given{display:table;border-right:2px solid #fff;padding:0 18px 2px 0;margin:6px 0 10px}
.given .find{border-top:2px solid #fff;margin-top:8px;padding-top:6px}
.row{display:flex;gap:12px;align-items:center}
.row .main{flex:1 1 auto;min-width:0}
.row .note{flex:0 1 auto;max-width:44%;border-left:2px solid #fff;padding-left:10px;color:#ddd;font-size:18px;line-height:1.35}
.ans{margin:12px 0 4px;padding:8px 12px;border:2px solid #fff;border-radius:8px}
pre{font:17px/1.4 'DejaVu Sans Mono','Liberation Mono',monospace;border:1px solid #666;padding:10px 12px;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere}
.fig{margin:10px 0}.fig svg{display:block;width:100%;height:auto}
.raw{font-family:'DejaVu Sans',sans-serif}
.katex{font-size:1.08em}.katex-display{margin:0}
.foot{font-size:14px;color:#ccc;text-align:right;margin-top:6px}`;
}

// Целая страница. fonts: готовые правила @font-face (шрифт текста и шрифты формул), css: стили KaTeX.
export function pageHtml(parts: string[], svgs: string[], fonts: string, css: string): string {
  const figs = assign(parts, svgs);
  const body = parts.map((p, i) => taskHtml(p, figs[i])).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}${css}${pageCss()}</style></head><body><div id="flow" class="sheet">${body}</div></body></html>`;
}

// Выполняется внутри страницы в браузере: делит поток на листы не выше PAGE_H и возвращает их число.
// Задание целиком переносится на новый лист, если помещается на нём; длинное задание делится между строками.
export const PAGINATE = `(() => {
  const H = ${PAGE_H};
  const flow = document.getElementById("flow");
  const top = flow.getBoundingClientRect().top;
  const tasks = [...flow.querySelectorAll(".task")];
  const pages = [[]];
  let start = null;
  for (const task of tasks) {
    const r = task.getBoundingClientRect();
    const blocks = [...task.children];
    const cur = pages[pages.length - 1];
    if (start !== null && cur.length && r.bottom - top - start > H - 60 && r.height <= H - 90) { pages.push([]); start = null; }
    for (const b of blocks) {
      const br = b.getBoundingClientRect();
      const page = pages[pages.length - 1];
      if (start === null) start = br.top - top;
      else if (br.bottom - top - start > H - 60 && page.length) {
        // заголовок задания не оставляем одного внизу листа: забираем его на новый лист
        const prev = page[page.length - 1];
        const moved = prev.task === task && prev.b.tagName === "H2" && page.length > 1 ? [page.pop()] : [];
        pages.push(moved);
        start = (moved.length ? moved[0].b.getBoundingClientRect().top : br.top) - top;
      }
      pages[pages.length - 1].push({ b, task });
    }
  }
  const total = pages.filter((p) => p.length).length;
  let n = 0;
  for (const page of pages) {
    if (!page.length) continue;
    n++;
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.id = "p" + n;
    let sec = null, last = null;
    for (const { b, task } of page) {
      if (task !== last) {
        sec = document.createElement("section");
        sec.className = "task";
        const cut = b !== task.firstElementChild && task.dataset.title;
        if (cut) { const c = document.createElement("div"); c.className = "cont"; c.textContent = task.dataset.title + " (продолжение)"; sec.appendChild(c); }
        sheet.appendChild(sec);
        last = task;
      }
      sec.appendChild(b);
    }
    if (total > 1) { const f = document.createElement("div"); f.className = "foot"; f.textContent = n + " / " + total; sheet.appendChild(f); }
    document.body.appendChild(sheet);
  }
  flow.remove();
  return total;
})()`;

// Стили KaTeX со шрифтами внутри: страница ничего не качает из сети. font(имя) -> base64 файла woff2.
export function katexCss(css: string, font: (name: string) => string | undefined): string {
  return css.replace(/src:url\(fonts\/([\w-]+)\.woff2\) format\("woff2"\)[^;}]*/g, (m, name: string) => {
    const data = font(name);
    return data ? `src:url(data:font/woff2;base64,${data}) format("woff2")` : m;
  });
}
export const textFont = (base64: string) => `@font-face{font-family:'DejaVu Sans';src:url(data:font/ttf;base64,${base64}) format("truetype");font-weight:normal;font-style:normal}`;
