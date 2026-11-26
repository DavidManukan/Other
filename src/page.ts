// Решение «как в тетради»: готовый ответ модели -> страница HTML с настоящими формулами.
// Страницу снимает браузер Cloudflare (src/shot.ts), человеку приходит картинка.
// Здесь только чистые функции: текст -> HTML.
import katex from "katex";
import "katex/contrib/mhchem"; // химическая запись \ce{…}, если модель всё же напишет формулу так
import { fixSvg } from "./svg.ts";
import { mathSpans, stripTex, texToPlain } from "./tex.ts";
import { answerAt, figureLabel, HEAD as TASK_HEAD, prettyMath, sheetContext, tableAt } from "./text.ts";
export { figureLabel };
import { esc } from "./util.ts";

export const PAGE_W = 560; // ширина страницы в точках CSS
export const PAGE_DPR = 3; // плотность снимка: 1680 пикселей в ширину, мелкие индексы читаются и при увеличении
export const PAGE_H = 1000; // обычная высота листа: 9:16 занимает экран телефона целиком
export const MAX_PAGES = 30; // больше страниц картинками не шлём: такой ответ уходит текстом целиком
export const PAGE_TALL = 1800; // до этой высоты задание остаётся на одном листе: один скрин на одно задание; выше текст на телефоне уже мелкий

// (после номера допускается короткая пометка в скобках: «№1 (2 балла)»; номер с буквой без знака №: «A1», «В2.»)
const HEAD = /^\s*(([^·\n]{1,30}·\s*){0,2}(№|Задание|Задача)\s*\S*(\s*\([^()\n]{1,30}\))?[.:]?|Исправляю\b.*|Вариант\s+\S+.*|[A-ZА-ЯЁ]\d{1,2}[.)]?)\s*$/;
const LABEL = /^(Дано|Найти|Доказать|Решение|Доказательство|Обоснование|Проверка|ОДЗ|Ответ)\s*:\s*(.*)$/;

// errorColor: свой цвет-метка. Команду, которой нет (или запрещённую trust: false, вроде \url), KaTeX не бросает,
// а рисует её исходник этим цветом: по метке узнаём такой вывод и показываем формулу обычным текстом.
const KATEX = { throwOnError: true, strict: "ignore", output: "html", trust: false, maxExpand: 2000, errorColor: "#fe0001" } as const;
const sound = (html: string) => {
  if (html.includes("#fe0001")) throw new Error("KaTeX не знает команду");
  return html;
};
const REL = /^(?:=|<|>|\\(?:le|leq|leqslant|ge|geq|geqslant|ne|neq|approx|equiv|sim|Rightarrow|Leftrightarrow|implies|iff)(?![A-Za-z]))/;

// Задание про электронную таблицу: в его строках C2 и A1 это ячейки, индексы у них не ставятся. Выставляется на время разбора задания.
let sheet = false;

// Формулу делим на куски по знакам отношения верхнего уровня (=, <, ≤, ⇒ …): длинная цепочка равенств
// переносится на странице перед знаком, а не посреди скобки или модуля.
export function chunks(src: string): string[] {
  const out: string[] = [];
  let depth = 0, paren = 0, start = 0;
  const cut = (i: number) => {
    const head = src.slice(start, i);
    // внутри круглых скобок не режем («P(X = 2)»), перечёркнутый знак \\not= и «:=» не разрываем
    if (depth === 0 && paren <= 0 && head.trim() && !/(\\not|:)\s*$/.test(head) && REL.test(src.slice(i))) {
      out.push(src.slice(start, i));
      start = i;
    }
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      const m = /^\\([A-Za-z]+|[\s\S])/.exec(src.slice(i));
      if (!m) break;
      if (m[1] === "left" || m[1] === "begin") depth++;
      else if (m[1] === "right" || m[1] === "end") depth--;
      else cut(i);
      i += m[0].length - 1;
    } else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "(") paren++;
    else if (c === ")") paren--;
    else cut(i);
  }
  out.push(src.slice(start));
  return out;
}

// Формула: KaTeX пишет готовый HTML. Не разобралась (опечатка модели): показываем её обычным текстом.
export function tex(src: string): string {
  const clean = src.replace(/\\tag\*?\{[^{}]*\}/g, "") // номера формул на странице не нужны
    .replace(/\\(?:sfrac|nicefrac)(?![A-Za-z])/g, "\\frac") // таких дробей KaTeX не знает, рисуем обычной
    // знак % в формуле для KaTeX начинает комментарий: без черты перед ним остаток формулы пропал бы («r = 10% годовых» -> «r = 10»)
    .replace(/(^|[^\\])%/g, "$1\\%")
    // пробел между разрядами числа в формуле не рисуется: «1 320 000» слиплось бы в «1320000»
    .replace(/(\d) (?=\d{3}(?!\d))/g, "$1\\,");
  const one = (s: string) => sound(katex.renderToString(`\\displaystyle ${s}`, KATEX));
  try {
    // .f: формула целиком. Она не рвётся, пока помещается в строку; не помещается: переносится между кусками .fx
    return `<span class="f">${chunks(clean).map((part, i) => `<span class="fx">${one(i ? `{}${part}` : part)}</span>`).join("<wbr>")}</span>`;
  } catch {
    try {
      return `<span class="f"><span class="fx">${one(clean)}</span></span>`;
    } catch {
      try {
        return sound(katex.renderToString(clean, { ...KATEX, displayMode: true })); // окружения вроде align живут только в выключной формуле
      } catch {
        // знак доллара, написанный в формуле нарочно (\$), помечаем заново: иначе чистка приняла бы его за обрывок разметки
        return `<span class="raw">${esc(prettyMath(stripTex(texToPlain(src).replace(/\$/g, "\\$")), sheet || undefined))}</span>`;
      }
    }
  }
}

// Строка с формулами $…$ -> HTML
export function inline(text: string): string {
  // вне формул разметки быть не должно: что осталось (знак $ без пары, команда без $), переводится в обычные знаки
  const segs = mathSpans(text);
  const out: string[] = [];
  // «4-го» не рвётся по дефису, а знак между словами («пуля + брусок») не начинает строку
  const words = (t: string) => esc(prettyMath(stripTex(t), sheet || undefined))
    .replace(/(?<![\p{L}\d])(\d+-[а-яё]{1,3})(?![а-яё])/giu, '<span class="nb">$1</span>')
    .replace(/(?<=[\p{L}\d)]) ([+=]) (?=[\p{L}\d(])/gu, "\u00a0$1 ")
    // единица с косой чертой («м/с²», «км/ч», «Дж/(кг·°C)») не рвётся после черты
    .replace(/(?<![\p{L}\d/])([\p{L}°]{1,4}\/[\p{L}°(][\p{L}°·()]{0,7}[²³]?)(?![\p{L}\d/])/gu, '<span class="nb">$1</span>');
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    if (!s.math) {
      out.push(s.lit ? esc(s.body) : words(s.body));
      continue;
    }
    // Короткий хвост сразу за формулой (единица «см.», «Н,», знак препинания) не уходит на новую строку один
    const next = segs[k + 1];
    const m = next && !next.math && !next.lit ? /^(\s?)([^\s$]{1,9})(?=\s|$)/.exec(next.body) : null;
    // (и окончание порядкового сразу за формулой: «$n$-й член»)
    // (и единица с косой чертой: «$a = 2{,}8$ м/с²»)
    if (m && (/^[\p{L}]{0,3}[.,;:!?)»]*$/u.test(m[2]) || /^[\p{L}°]{1,3}\/[\p{L}°]{1,3}[²³]?[.,;:!?)»]*$/u.test(m[2]) || (!m[1] && /^-[а-яё]{1,3}[.,;:!?)»]*$/iu.test(m[2])))) {
      out.push(`<span class="glue">${tex(s.body)}${m[1] ? "\u00a0" : ""}${words(m[2])}</span>`);
      segs[k + 1] = { ...next, body: next.body.slice(m[0].length) };
    } else out.push(tex(s.body));
  }
  return out.join("");
}

// Пометка справа от преобразования: «выражение | что сделали». Черту ищем только вне формул.
function annotated(line: string): [string, string] | null {
  let depth = false, at = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "$") depth = !depth;
    else if (!depth && line[i] === "|" && line[i - 1] === " " && line[i + 1] === " " && i > 1) {
      if (at >= 0) return null; // черт несколько: это строка таблицы («x | y | F»), а не пометка
      at = i;
    }
  }
  if (at < 0) return null;
  const left = line.slice(0, at).trimEnd(), right = line.slice(at + 1).trim();
  // Пометка справа короткая («·2», «раскрываем скобки»). Длинный хвост или черта внутри скобок («P(A | B)») это обычный текст:
  // строкой с пометкой он стал бы узкой колонкой, которую нельзя разрезать по листам
  if (right.length > 70 || left.split("(").length > left.split(")").length) return null;
  return [left, right];
}

// Таблица: настоящая, с линиями; формулы в ячейках набраны
const table = (rows: string[][]): string => {
  const tr = (r: string[], tag: string) => `<tr>${r.map((c) => `<${tag}>${inline(c)}</${tag}>`).join("")}</tr>`;
  return `<table class="tbl">${tr(rows[0], "th")}${rows.slice(1).map((r) => tr(r, "td")).join("")}</table>`;
};

const row = (line: string): string => {
  const a = annotated(line);
  return a ? `<div class="b row"><div class="main">${inline(a[0])}</div><div class="note">${inline(a[1])}</div></div>` : `<div class="b line">${inline(line)}</div>`;
};

const key = (s: string) => s.toLowerCase().replace(/\s/g, "").replace(/[.:]+$/, ""); // точка внутри номера остаётся: «№1.2» это не «№12»

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
  sheet = sheetContext(part);
  try {
    return taskBody(part, figs);
  } finally {
    sheet = false;
  }
}
function taskBody(part: string, figs: Fig[]): string {
  const lines = part.split("\n");
  const out: string[] = [];
  let title = "";
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i + 1 < lines.length && !HEAD.test(lines[i]) && lines[i].trim().length <= 30 && HEAD.test(lines[i + 1])) {
    out.push(`<div class="b cont">${inline(lines[i].trim())}</div>`); // название предмета над заданием
    i++;
  }
  if (i < lines.length && HEAD.test(lines[i]) && lines[i].length <= 60) {
    title = lines[i].trim();
    // в заголовке буква с цифрой это номер задания («№B1»), а не формула: индексы в нём не ставим
    const was = sheet;
    sheet = true;
    out.push(`<h2 class="b">${inline(title)}</h2>`);
    sheet = was;
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
    const tb = tableAt(lines, i);
    if (tb) { // таблица: настоящая, с линиями; формулы в ячейках набраны
      out.push(`<div class="b">${table(tb.rows)}</div>`);
      i = tb.end;
      continue;
    }
    const m = LABEL.exec(line.trim());
    if (m?.[1] === "Дано") { // «Дано» с чертой справа и «Найти» под чертой, как в тетради
      const given: string[] = m[2] ? [`<div>${inline(m[2])}</div>`] : []; // строки блока уже в HTML: среди них бывает таблица с данными опыта
      // под чертой стоит «Найти» или «Доказать», а в задаче из двух пунктов обе строки подряд: чертёж встаёт после них, а не между ними
      const finds: { label: string; lines: string[] }[] = [];
      for (i++; i < lines.length; i++) {
        const l = lines[i].trim();
        const n = LABEL.exec(l);
        const cur = finds.at(-1);
        if (/^\s*```/.test(l)) break;
        const tbl = cur ? null : tableAt(lines, i);
        if (tbl) {
          given.push(table(tbl.rows));
          i = tbl.end;
          continue;
        }
        if (n) {
          if ((n[1] !== "Найти" && n[1] !== "Доказать") || finds.some((f) => f.label === n[1]) || (cur && !cur.lines.length)) break; // любая другая метка закрывает блок
          finds.push({ label: n[1], lines: n[2] ? [n[2]] : [] });
        } else if (!l) continue;
        else if (!cur) given.push(`<div>${inline(l)}</div>`);
        else if (!cur.lines.length) cur.lines.push(l); // «Найти:» отдельной строкой: искомое стоит на следующей
        else break; // дальше уже решение, даже если строки «Решение:» нет
      }
      i--;
      out.push(
        `<div class="b given"><div class="lbl">Дано:</div>${given.join("")}` +
          finds.map((f) => `<div class="find"><span class="lbl">${f.label}:</span> ${f.lines.map(inline).join("<br>")}</div>`).join("") + `</div>`,
      );
      place(); // чертёж сразу под «Дано», до решения
      continue;
    }
    if (m?.[1] === "Ответ") {
      place(); // рисунок задания без «Дано» стоит перед ответом, а не после него
      const a = answerAt(lines, i);
      i = a.last;
      out.push(`<div class="b ans"><span class="lbl">Ответ:</span> ${inline(a.value)}</div>`);
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
  // заголовок продолжения на следующих листах PAGINATE пишет текстом: формулы в нём уже переведены в обычные знаки
  return `<section class="task" data-title="${esc(prettyMath(stripTex(texToPlain(title)), true))}">${out.join("")}</section>`;
}

export interface Fig {
  svg: string;
  own: boolean; // нашёлся по номеру своего задания
}
// Раскладывает рисунки по заданиям: по номеру в углу рисунка. Рисунок без пары уходит к последнему заданию.
export function assign(parts: string[], svgs: string[]): Fig[][] {
  // заголовок задания: первая из трёх верхних строк, похожая на заголовок (над ним может стоять название предмета)
  const heads = parts.map((p) => {
    const top = p.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3);
    return key(top.find((l) => TASK_HEAD.test(l) && l.length <= 60) ?? top[0] ?? "");
  });
  const used = parts.map(() => false);
  // среди заданий с одинаковым заголовком (две работы, в каждой свой №1) берём первое ещё без рисунка
  const find = (ok: (h: string) => boolean) => {
    const free = heads.findIndex((h, j) => !used[j] && ok(h));
    return free >= 0 ? free : heads.findIndex(ok);
  };
  const figs: Fig[][] = parts.map(() => []);
  if (!parts.length) return figs; // рисунок без единого задания ставить некуда
  for (const svg of svgs) {
    const label = key(figureLabel(svg));
    let at = label ? find((h) => h === label) : -1;
    // неполное совпадение только для настоящего заголовка: подпись деления оси «1» это не «№1»
    if (at < 0 && label.includes("№")) at = find((h) => h.endsWith(label) || (label.endsWith(h) && h.length > 1));
    if (at >= 0) used[at] = true;
    figs[at >= 0 ? at : Math.max(0, parts.length - 1)].push({ svg, own: at >= 0 });
  }
  return figs;
}

// «Фильтр» листа: полутона на краях букв и линий подтягиваются к белому. Тонкие штрихи формул и чертежей
// перестают выглядеть серыми, чёрный фон остаётся чёрным.
const INK = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="ink" color-interpolation-filters="sRGB"><feComponentTransfer>${
  ["R", "G", "B"].map((c) => `<feFunc${c} type="gamma" exponent="0.6" amplitude="1.1"/>`).join("")
}</feComponentTransfer></filter></svg>`;

// Чёрный фон, белый текст: так страницу хорошо видно и на очках, и на телефоне.
// Буквам добавлена тонкая обводка: у шрифта формул штрихи волосяные, без неё формулы тусклее текста.
export function pageCss(): string {
  return `*{box-sizing:border-box}html,body{margin:0;padding:0;background:#000}
body{width:${PAGE_W}px;color:#fff;font:21px/1.5 'DejaVu Sans',sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-stroke:.2px #fff}
.sheet{width:${PAGE_W}px;padding:22px 24px 16px;background:#000;filter:url(#ink)}
.task{padding:0 0 14px}.task+.task{border-top:2px solid #555;padding-top:10px}
h2{font-size:26px;line-height:1.3;margin:6px 0 8px;font-weight:bold}
.cont{font-size:17px;margin:0 0 6px}
.b{margin:6px 0;overflow-wrap:anywhere}.b:has(.mfrac){margin:11px 0}
.b.line{padding-left:.9em;text-indent:-.9em}.b.line.more{text-indent:0}.b.line,.row .main,.ans,.given>div{text-wrap:pretty}
.glue{white-space:nowrap}.nb{white-space:nowrap}
.glue.loose{white-space:normal}
.lbl{font-weight:bold}
.given{width:fit-content;max-width:100%;border-right:2px solid #fff;padding:0 18px 2px 0;margin:6px 0 10px}
.given .tbl{margin:4px 0}.given .find{border-top:2px solid #fff;margin-top:8px;padding-top:6px}.given .find+.find{border-top:0;margin-top:2px;padding-top:0}
.row{display:flex;flex-wrap:wrap;gap:2px 14px;align-items:center}
.row .main{flex:0 1 auto;min-width:0;max-width:100%}
.row .note{flex:0 1 auto;min-width:0;max-width:100%;border-left:2px solid #fff;padding-left:10px;font-size:18px;line-height:1.35}
.row.under{margin-bottom:14px}.row.under .note{margin-left:30px;max-width:calc(100% - 30px)}
.tbl{border-collapse:collapse;font-size:18px;line-height:1.35}.tbl th,.tbl td{border:1.5px solid #fff;padding:4px 9px;text-align:left;vertical-align:top;overflow-wrap:normal;word-break:normal}.tbl th{font-weight:bold}
.tbl.tight th,.tbl.tight td{overflow-wrap:anywhere;padding:3px 5px}
.ans{margin:12px 0 4px;padding:8px 12px;border:2px solid #fff;border-radius:8px}
pre{font:17px/1.4 'DejaVu Sans Mono','Liberation Mono',monospace;border:1px solid #666;padding:10px 12px;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere}
pre.go{border-bottom:0;border-radius:6px 6px 0 0;padding-bottom:0;margin-bottom:0}pre.on{border-top:0;border-radius:0 0 6px 6px;padding-top:0;margin-top:0}pre.go.on{border-radius:0}
.fig{margin:10px 0}.fig svg{display:block;width:100%;height:auto}
.raw{font-family:'DejaVu Sans',sans-serif}
.f{white-space:nowrap}.f wbr{display:none}.f.brk{white-space:normal}.f.brk wbr{display:inline}.fx{white-space:nowrap}.fx.wide{white-space:normal}
.f.brk .base{margin:4px 0}
.katex{font-size:1.08em;-webkit-text-stroke:.35px #fff}.katex svg{stroke:#fff;stroke-width:14px}
.katex .text{font-family:'DejaVu Sans',sans-serif;font-size:.926em;-webkit-text-stroke:0}
.katex .frac-line,.katex .overline-line,.katex .underline-line{border-bottom-width:.06em}.katex-display{margin:0;text-align:left}.katex-display>.katex{text-align:left}
.foot{font-size:14px;text-align:right;margin-top:6px}`;
}

// Целая страница. fonts: готовые правила @font-face (шрифт текста и шрифты формул), css: стили KaTeX.
export function pageHtml(parts: string[], svgs: string[], fonts: string, css: string): string {
  const figs = assign(parts, svgs);
  const body = parts.map((p, i) => taskHtml(p, figs[i])).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"><style>${fonts}${css}${pageCss()}</style></head><body>${INK}<div id="flow" class="sheet">${body}</div></body></html>`;
}

// Выполняется внутри страницы в браузере: кладёт каждое задание на свой лист (не выше PAGE_TALL) и возвращает их число.
// Задание целиком переносится на новый лист, если помещается на нём; длинное задание делится между строками.
export const PAGINATE = `(() => {
  const H = ${PAGE_H};
  const TALL = ${PAGE_TALL};
  const MANY = ${MAX_PAGES};
  const flow = document.getElementById("flow");
  // 0. Таблица шире листа: уменьшаем её шрифт, пока не поместится (иначе правый край обрежется). Слова и числа в ячейках
  // при этом не рвутся. Не помогло и самое мелкое читаемое письмо: тогда разрешаем перенос внутри слова.
  for (const t of flow.querySelectorAll(".tbl")) {
    const avail = t.parentElement.clientWidth;
    for (let k = 0; k < 4 && t.offsetWidth > avail + 1; k++) t.style.fontSize = Math.max(11, Math.floor(parseFloat(getComputedStyle(t).fontSize) * avail / t.offsetWidth * 0.98)) + "px";
    if (t.offsetWidth > avail + 1) t.classList.add("tight");
    // Ячейку распирает длинная формула: разрешаем ей перенос, иначе край листа обрежет конец значения и рамку таблицы
    if (t.offsetWidth > avail + 1) {
      for (const f of t.querySelectorAll(".f")) f.classList.add("brk");
      for (const fx of t.querySelectorAll(".fx")) fx.classList.add("wide");
    }
  }
  // 1. Формула шире строки: разрешаем перенос между её кусками (перед знаком отношения), а слишком широкому куску и внутри него
  const room = (el) => {
    const box = el.closest("td, th, .main, .note, .ans, .given, .b");
    if (!box) return 0;
    const cs = getComputedStyle(box);
    return box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
  for (const f of flow.querySelectorAll(".f")) if (f.getBoundingClientRect().width > room(f) + 1) f.classList.add("brk");
  for (const fx of flow.querySelectorAll(".fx")) if (fx.getBoundingClientRect().width > room(fx) + 1) fx.classList.add("wide");
  // Формула с приклеенным хвостом («кДж.») шире строки: хвост отпускаем на следующую строку, иначе край листа его обрежет
  // Хвост из одного знака препинания один на строку не уходит: он остаётся при формуле, а место под него учитывается при её ужатии.
  for (const g of flow.querySelectorAll(".glue")) if (g.getBoundingClientRect().width > room(g) + 1) {
    // Формула из нескольких кусков переносится сама, перед знаком отношения: тогда «≈ 2,8 м/с²» остаётся вместе на новой строке
    const f = g.querySelector(".f");
    if (f && f.querySelector("wbr") && !f.classList.contains("brk")) {
      f.classList.add("brk");
      if ([...g.getClientRects()].every((r) => r.width <= room(g) + 1)) continue;
    }
    const tail = [...g.childNodes].filter((t) => t.nodeType === 3);
    if (/^[\\s\u00a0]*[.,;:!?)»]+$/.test(tail.map((t) => t.data).join(""))) {
      const r = document.createRange();
      r.setStartBefore(tail[0]);
      r.setEndAfter(tail[tail.length - 1]);
      g.dataset.tail = String(Math.ceil(r.getBoundingClientRect().width) + 1);
      continue;
    }
    g.classList.add("loose");
    for (const t of tail) t.data = t.data.replace(/\u00a0/g, " ");
  }
  // Дробь, корень или матрицу перенести нельзя: если такой кусок шире строки, уменьшаем формулу, чтобы её не обрезало краем листа
  for (const k of flow.querySelectorAll(".katex")) {
    const kept = k.closest(".glue:not(.loose)");
    const avail = room(k) - Number((kept && kept.dataset.tail) || 0);
    let w = 0;
    for (const b of k.querySelectorAll(".base")) w = Math.max(w, b.getBoundingClientRect().width);
    if (w > avail && avail > 0) k.style.fontSize = Math.max(0.45, Math.floor((1.08 * avail / w) * 100) / 100) + "em";
  }
  // 2. Пометка «| ·4» стоит сразу за своим преобразованием (так её пишут в тетради), а не колонкой у правого края.
  //    Не помещается рядом: встаёт строкой ниже, прямо под ним, а формула остаётся целой. Это делает сама вёрстка строки (.row);
  //    здесь пометке под формулой добавляется отступ, чтобы её не приняли за пометку к следующей строке.
  for (const r of flow.querySelectorAll(".row")) {
    const main = r.querySelector(".main"), note = r.querySelector(".note");
    if (main && note && note.getBoundingClientRect().top >= main.getBoundingClientRect().bottom - 2) r.classList.add("under");
  }
  // 3. Подписи на рисунке. Буква, которая легла на линию или на соседнюю подпись, сдвигается на ближайшее свободное место.
  for (const svg of flow.querySelectorAll(".fig svg")) {
   try { // рисунок с вырожденным преобразованием (scale(0)) оставляем как есть: ошибка здесь стоила бы всех страниц ответа
    const area = svg.getBoundingClientRect();
    if (!area.width || !area.height) continue;
    const aside = (el) => el.closest("defs, marker, clipPath, mask, pattern, symbol");
    const backdrop = (r) => r.width >= area.width * 0.98 && r.height >= area.height * 0.98;
    let pts = []; // точки всех линий рисунка на экране: x, y, половина толщины линии и номер фигуры по порядку рисования
    const plates = []; // закрашенные прямоугольники: подпись на такой подложке стоит там нарочно
    // фигуры с чёрной заливкой (цвет листа): закрывают линии, нарисованные до них, а буква на таком кружке
    // (прибор V в цепи, группа атомов на конце связи) стоит там нарочно
    const covers = [];
    let order = 0;
    for (const el of svg.querySelectorAll("line, path, polyline, polygon, circle, ellipse, rect")) {
      order++;
      if (aside(el)) continue;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el), m = el.getScreenCTM();
      const rect = el.tagName.toLowerCase() === "rect";
      if (!m || cs.display === "none" || cs.visibility === "hidden" || (rect && backdrop(r))) continue;
      const stroke = cs.stroke !== "none" && parseFloat(cs.strokeWidth) > 0;
      if (rect && cs.fill !== "none") plates.push(r);
      // Чёрная заливка считается, только если её задали явно: у кривой без fill="none" заливка чёрная сама собой,
      // её никто не задумывал, и подпись, попавшая под такую кривую, двигать всё равно нужно
      const named = el.hasAttribute("fill") || !!el.style.fill || (el.parentElement !== svg && el.parentElement.hasAttribute("fill"));
      if (!rect && named && cs.fill === "rgb(0, 0, 0)" && typeof el.isPointInFill === "function") covers.push({ el, inv: m.inverse(), order, r });
      const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
      // оси и сетка графика (толщина 1 на холсте шириной 800): числа делений стоят на них нарочно, двигать их с делений нельзя
      if (stroke && !rect && parseFloat(cs.strokeWidth) * k <= area.width / 800 * 1.05) continue;
      if (!stroke && cs.fill === "none") continue;
      let len = 0;
      try { len = el.getTotalLength(); } catch (e) {}
      if (!len) continue;
      const hw = stroke ? parseFloat(cs.strokeWidth) * k / 2 : 0;
      const n = Math.min(3000, Math.max(1, Math.ceil(len * k / 3)));
      for (let i = 0; i <= n; i++) {
        const p = el.getPointAtLength(len * i / n);
        pts.push([m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f, hw, order]);
      }
    }
    if (!pts.length) continue;
    // точка (x, y) экрана внутри заливки фигуры
    const inFill = (c, x, y) => x >= c.r.left && x <= c.r.right && y >= c.r.top && y <= c.r.bottom &&
      c.el.isPointInFill(new DOMPoint(c.inv.a * x + c.inv.c * y + c.inv.e, c.inv.b * x + c.inv.d * y + c.inv.f));
    // линия под чёрной фигурой, нарисованной позже, не видна: на ней буква не мешает
    try { if (covers.length) pts = pts.filter((p) => !covers.some((c) => c.order > p[3] && inFill(c, p[0], p[1]))); } catch (e) {}
    // рамка самих букв: у строки текста сверху и снизу есть пустые поля
    const glyphs = (t) => { const r = t.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top + r.height * 0.16, b: r.bottom - r.height * 0.14 }; };
    const texts = [...svg.querySelectorAll("text")].filter((t) => !aside(t) && t.textContent.trim() && t.getBoundingClientRect().width > 0);
    const boxes = texts.map(glyphs);
    // floor: линии, нарисованные не позже фигуры с этим номером, не считаются
    const hitsFrom = (b, pad, floor) => {
      let n = 0;
      for (const p of pts) if (p[3] > floor && p[0] > b.l - pad - p[2] && p[0] < b.r + pad + p[2] && p[1] > b.t - pad - p[2] && p[1] < b.b + pad + p[2]) n++;
      return n;
    };
    const over = (b, i, pad) => {
      let sum = 0;
      boxes.forEach((o, j) => {
        const w = Math.min(b.r, o.r) - Math.max(b.l, o.l) + pad, h = Math.min(b.b, o.b) - Math.max(b.t, o.t) + pad;
        if (j !== i && w > 0 && h > 0) sum += w * h;
      });
      return sum;
    };
    texts.forEach((t, i) => {
      const b = boxes[i], cs = getComputedStyle(t);
      // Буква на чёрной фигуре (прибор V в цепи, группа атомов на конце связи) стоит там нарочно: линии, нарисованные до фигуры,
      // ей не мешают, даже где широкая подпись выходит за край кружка. Мешает только линия, проведённая поверх фигуры позже
      // (радиус в закрашенном круге).
      let floor = 0;
      try { for (const c of covers) if (c.order > floor && inFill(c, (b.l + b.r) / 2, (b.t + b.b) / 2)) floor = c.order; } catch (e) {}
      const hits = (box, pad) => hitsFrom(box, pad, floor);
      const now = hits(b, -1) + over(b, i, 0) / 9;
      // три точки это около сантиметра линии под буквой; касание краем (связь в формуле, выноска) не в счёт
      if (hits(b, -1) < 3 && over(b, i, 0) < (b.r - b.l) * (b.b - b.t) * 0.15) return;
      if (cs.paintOrder.indexOf("stroke") === 0 && cs.stroke !== "none") return; // у подписи своя обводка, линия под ней закрыта
      if (plates.some((r) => r.left <= b.l + 1 && r.right >= b.r - 1 && r.top <= b.t + 1 && r.bottom >= b.b - 1)) return;
      let best = null;
      for (const d of [5, 8, 12, 16, 21, 27]) {
        for (let a = 0; a < 16; a++) {
          const dx = d * Math.cos(a * Math.PI / 8), dy = d * Math.sin(a * Math.PI / 8);
          const c = { l: b.l + dx, r: b.r + dx, t: b.t + dy, b: b.b + dy };
          if (c.l < area.left + 2 || c.r > area.right - 2 || c.t < area.top + 2 || c.b > area.bottom - 2) continue;
          const cost = hits(c, 2) + over(c, i, 2) / 9, crowd = hits(c, 8);
          if (!best || cost < best.cost || (cost === best.cost && d === best.d && crowd < best.crowd)) best = { cost, crowd, d, dx, dy };
        }
        if (best && best.cost === 0) break;
      }
      if (!best || (best.cost > 0 && best.cost > now / 2)) return;
      const parent = t.parentNode.getScreenCTM && t.parentNode.getScreenCTM();
      if (!parent) return;
      const inv = parent.inverse();
      const ux = inv.a * best.dx + inv.c * best.dy, uy = inv.b * best.dx + inv.d * best.dy;
      t.setAttribute("transform", "translate(" + ux.toFixed(2) + " " + uy.toFixed(2) + ") " + (t.getAttribute("transform") || ""));
      t.setAttribute("data-moved", "1");
      boxes[i] = glyphs(t);
    });
   } catch (e) {}
  }
  // 4. У рисунка убираем пустые полосы сверху и снизу: холст обрезается по тому, что на нём нарисовано
  for (const svg of flow.querySelectorAll(".fig svg")) {
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const box = svg.getBoundingClientRect();
    if (!vb || !vb.width || !vb.height || !box.height) continue;
    const k = vb.height / box.height;
    let top = Infinity, bottom = -Infinity;
    for (const el of svg.children) {
      const tag = el.tagName.toLowerCase();
      if (tag === "defs" || tag === "title" || tag === "desc") continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (tag === "rect" && r.width >= box.width * 0.98 && r.height >= box.height * 0.98) continue; // фон
      top = Math.min(top, vb.y + (r.top - box.top) * k);
      bottom = Math.max(bottom, vb.y + (r.bottom - box.top) * k);
    }
    if (top === Infinity) continue;
    const y0 = Math.max(vb.y, top - 28), y1 = Math.min(vb.y + vb.height, bottom + 28);
    if (y1 - y0 > 40 && y1 - y0 < vb.height - 20) svg.setAttribute("viewBox", vb.x + " " + y0 + " " + vb.width + " " + (y1 - y0));
  }
  // 5. Блок намного выше листа (длинный абзац, листинг программы) режем на части: между блоками листы делятся,
  // а целый такой блок дал бы лист во много экранов и картинку тяжелее, чем принимает чат.
  // Листинг режем между строками, абзац между предложениями (если их нет, между словами); формула .f не режется.
  const piece = Math.round((H - 60) / 3); // мелкие части плотнее заполняют листы
  for (const b of [...flow.querySelectorAll(".task > pre.b, .task > .b.line")]) {
    try {
      const box = b.getBoundingClientRect();
      if (box.height <= H - 120) continue;
      const pre = b.tagName === "PRE";
      const at = []; // места разреза по порядку: где начинается следующая часть, верх её строки, конец предложения ли
      const range = document.createRange();
      const topOf = (rs) => (rs.length && rs[0].height > 0 ? rs[0].top : null);
      let stop = false; // перед этим узлом кончилось предложение
      for (const node of [...b.childNodes]) {
        if (node.nodeType === 1) {
          const y = stop && node.classList.contains("f") ? topOf(node.getClientRects()) : null;
          if (y !== null) at.push({ node, off: -1, y, s: true });
          stop = false;
          continue;
        }
        if (node.nodeType !== 3) continue;
        const text = node.data;
        const re = pre ? /\\n(?=[^\\n])|[ \\t]+(?=\\S)/g : /\\s+(?=\\S)/g;
        for (let m; (m = re.exec(text)); ) {
          const off = m.index + m[0].length;
          const s = pre ? m[0][0] === "\\n" : (off === m[0].length ? stop : /[.!?…;]$/.test(text.slice(0, m.index)));
          range.setStart(node, off);
          range.setEnd(node, off + 1);
          const y = topOf(range.getClientRects());
          if (y !== null) at.push({ node, off, y, s });
        }
        stop = pre ? false : /[.!?…;]\\s*$/.test(text);
      }
      const cuts = [];
      let from = box.top, sent = null, word = null;
      for (const c of at) {
        if (c.y - from > piece) {
          const cut = sent || (c.y - from > H - 160 ? word : null);
          if (cut) { cuts.push(cut); from = cut.y; sent = word = null; }
        }
        if (c.y > from + 1) { word = c; if (c.s) sent = c; }
      }
      for (const c of cuts.reverse()) {
        const nb = b.cloneNode(false);
        b.after(nb);
        if (c.off < 0) range.setStartBefore(c.node); else range.setStart(c.node, c.off);
        range.setEndAfter(b.lastChild);
        nb.appendChild(range.extractContents());
        if (!pre) nb.classList.add("more"); // продолжение абзаца, а не новый шаг: первая строка без выступа
        if (pre) {
          // перевод строки на стыке остался в конце первой части: в листинге он дал бы пустую строку
          const t = b.lastChild;
          if (t && t.nodeType === 3) t.data = t.data.replace(/\\n$/, "");
          b.classList.add("go");
          nb.classList.add("on");
        }
      }
    } catch (e) {}
  }
  // 5а. Таблица выше листа режется между строками, шапка повторяется на каждой части, ширина столбцов сохраняется
  for (const t of [...flow.querySelectorAll(".task > .b > table.tbl")]) {
    try {
      const limit = H - 160;
      if (t.getBoundingClientRect().height <= limit) continue;
      const rows = [...t.rows];
      if (rows.length < 3) continue;
      const head = rows[0], headH = head.getBoundingClientRect().height;
      const widths = [...head.cells].map((c) => c.getBoundingClientRect().width);
      const heights = rows.map((r) => r.getBoundingClientRect().height);
      const groups = [[]]; // строки каждой части, без шапки
      let used = headH;
      for (let i = 1; i < rows.length; i++) {
        if (used + heights[i] > limit && groups[groups.length - 1].length) { groups.push([]); used = headH; }
        groups[groups.length - 1].push(rows[i]);
        used += heights[i];
      }
      if (groups.length < 2) continue;
      const fix = (table) => { [...table.rows[0].cells].forEach((c, j) => { c.style.width = widths[j] + "px"; }); table.style.width = t.getBoundingClientRect().width + "px"; };
      let after = t.parentElement;
      for (const g of groups.slice(1)) {
        const box = after.cloneNode(false), nt = t.cloneNode(false), body = document.createElement("tbody");
        body.appendChild(head.cloneNode(true));
        for (const r of g) body.appendChild(r);
        nt.appendChild(body);
        box.appendChild(nt);
        after.after(box);
        after = box;
        fix(nt);
      }
      fix(t);
    } catch (e) {}
  }
  // 6. Делим поток на листы
  const top = flow.getBoundingClientRect().top;
  const tasks = [...flow.querySelectorAll(".task")];
  const solo = tasks.length <= MANY;
  const pages = [[]];
  let start = null;
  // строка, после которой сразу идёт её продолжение: заголовок, «Решение:», «3) Площадь через …:»
  const leads = (b) => b.tagName === "H2" || (b.classList.contains("lbl") && !b.classList.contains("ans")) || /:\\s*$/.test(b.textContent || "");
  for (const task of tasks) {
    const r = task.getBoundingClientRect();
    const blocks = [...task.children];
    // Одно задание = один лист: чужое задание на лист не попадает, а своё не уходит на второй, пока оно не выше TALL.
    // Задание выше TALL делится на равные части, а не на полный лист и огрызок.
    // Заданий больше, чем бот шлёт картинок: короткие снова делят лист между собой, иначе весь ответ ушёл бы текстом.
    if (solo) {
      if (pages[pages.length - 1].length) pages.push([]);
      start = null;
    } else if (start !== null && pages[pages.length - 1].length && r.bottom - top - start > H - 60 && r.height <= H - 90) {
      pages.push([]);
      start = null;
    }
    const count = Math.ceil(r.height / (TALL - 60));
    // (запас сверх равной доли нужен на то, что блоки не делятся: иначе хвост ушёл бы на лишний лист)
    const limit = !solo ? H - 60 : count <= 1 ? Infinity : Math.min(TALL - 60, Math.max(H - 60, r.height / count + 160));
    for (const b of blocks) {
      const br = b.getBoundingClientRect();
      const page = pages[pages.length - 1];
      if (start === null) start = br.top - top;
      else if (br.bottom - top - start > limit && page.length) {
        const moved = [];
        const last = () => page[page.length - 1];
        const take = () => moved.unshift(page.pop());
        // рамку ответа не отрываем от последней строки решения
        if (b.classList.contains("ans") && page.length > 1 && last().task === task && last().b.getBoundingClientRect().height < 260) take();
        // заголовок и вводную строку не оставляем внизу листа одних
        while (page.length > 1 && last().task === task && leads(last().b) && moved.length < 4) take();
        // заголовок (или название предмета над ним) один на листе, следующий блок выше листа: уходит вместе с блоком,
        // пустой лист не снимается
        if (page.length === 1 && last().task === task && (leads(last().b) || last().b.classList.contains("cont"))) take();
        pages.push(moved);
        start = (moved.length ? moved[0].b.getBoundingClientRect().top : br.top) - top;
      }
      pages[pages.length - 1].push({ b, task, first: b === task.firstElementChild });
    }
  }
  // Лист-огрызок того же задания (две-три строки и рамка ответа) не идёт отдельной картинкой, если помещается под предыдущим листом
  const edge = (p, last) => p[last ? p.length - 1 : 0].b.getBoundingClientRect();
  for (let i = pages.length - 1; i > 0; i--) {
    const cur = pages[i], prev = pages[i - 1];
    if (!cur.length || !prev.length || (solo && cur[0].task !== prev[prev.length - 1].task)) continue;
    if (edge(cur, true).bottom - edge(cur, false).top < 260 && edge(cur, true).bottom - edge(prev, false).top <= (solo ? TALL : H) - 45) {
      prev.push(...cur);
      pages.splice(i, 1);
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
    for (const { b, task, first } of page) {
      if (task !== last) {
        sec = document.createElement("section");
        sec.className = "task";
        const cut = !first && task.dataset.title;
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
