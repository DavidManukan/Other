// Чистые функции оформления текста: степени, индексы, разбор ответа модели.
import { normalizeMath, plainMath, stripTex } from "./tex.ts";

// ---------- красивые степени и индексы, если модель всё же написала ^ или _ ----------
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", k: "ᵏ", m: "ᵐ", p: "ᵖ", t: "ᵗ", " ": "" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", n: "ₙ", m: "ₘ", k: "ₖ", t: "ₜ", " ": "" };
const conv = (t: string, map: Record<string, string>) => [...t].every((c) => c in map) ? [...t].map((c) => map[c]).join("") : null;
// Химические формулы и индексы: CH3 -> CH₃, H2SO4 -> H₂SO₄, A1B1 -> A₁B₁, x1 -> x₁ (коэффициент 2H2O не трогаем).
// Формулу, за которой стоит знак заряда (SO42-), не трогаем: где индекс, а где заряд, по записи не понять.
// Номер задания с буквой («№A1», «Задание B2», «Часть C1») это не формула: цифра в нём остаётся цифрой.
const CHEM = /(?<![A-Za-z0-9_.,№]|№\s|[Зз]адани[ея]\s|[Зз]адач[аи]\s|[Вв]ариант\s|[Чч]аст[ьи]\s)(\d*)((?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+)(?![A-Za-z0-9₀-₉]|[+−-](?![A-Za-z0-9(]))/g;
const ION = /(?<![A-Za-z0-9])([A-Z][a-z]?)(\d)([+−-])(?![A-Za-z0-9(])/g; // Fe3+ -> Fe³⁺: заряд простого иона
const IDX = /(?<![A-Za-zА-Яа-я0-9])([a-z])(\d{1,2})(?![\d.,]?\d|[₀-₉])/g; // 1A2₁₆ и a1₁₆ это числа в другой системе счисления
export function subscripts(text: string, sub: (d: string) => string): string {
  return text
    .replace(CHEM, (_m: string, k: string, tok: string) => k + (/\d/.test(tok) ? tok.replace(/(?<=[A-Za-z)])\d+/g, sub) : tok))
    .replace(IDX, (_m: string, l: string, d: string) => l + sub(d));
}

// Признаки задания про электронную таблицу: слово «ячейка», формула «=A1*B2», ссылка со знаком $ ($A$1, C$3).
// В таком задании C2 и A1 это ячейки, а не углерод с индексом: индексы там не ставим.
const SHEET = /ячейк|[Ээ]лектронн\S* таблиц|Excel|(?<![^\s"'«(`])=\$?[A-Z]{1,3}\$?\d|\$[A-Z]{1,3}\$\d|[A-Z]{1,3}\$\d/;
export const sheetContext = (text: string): boolean => SHEET.test(text);
// sheet: текст из задания про электронную таблицу (по умолчанию определяется по самому тексту)
export function prettyMath(text: string, sheet = sheetContext(text)): string {
  const fix = (map: Record<string, string>) => (m: string, g1?: string, g2?: string) => conv(g1 ?? g2 ?? "", map) ?? m;
  // адреса сайтов и код в `…` не трогаем: в них цифры после букв и знак ^ значат своё
  return text.split(/(https?:\/\/\S+|`[^`\n]+`)/).map((piece, i) => {
    if (i % 2) return piece;
    const t = (sheet ? piece : subscripts(piece.replace(ION, (_m, el: string, d: string, sign: string) => el + SUP[d] + SUP[sign]), (d) => conv(d, SUB) ?? d))
      .replace(/(?<![А-Яа-я])(мм|см|дм|км|м)([23])(?!\d)/g, (_m, u, d) => u + SUP[d]); // см2 -> см²
    return t
      .replace(/\^\{([^{}]{1,12})\}|\^\(([^()]{1,12})\)/g, (m, a, b) => (b ? conv(`(${b})`, SUP) : conv(a, SUP)) ?? m)
      .replace(/\^([−-]?[0-9]+|[nixyabcdekmpt](?![a-zA-Z]))/g, fix(SUP))
      .replace(/_\{([^{}]{1,12})\}/g, fix(SUB))
      .replace(/(?<=[A-Za-zА-Яа-я)\]])_([0-9]+|[aeoxnmkt](?![a-zA-Z]))/g, fix(SUB))
      .replace(/([\^_])\{([^{}\n]*)\}/g, "$1($2)"); // степень без надстрочных знаков: «x^(2k+1)», фигурных скобок в тексте не остаётся
  }).join("");
}

// Рисунок модели: <svg> с xmlns или viewBox. Голое слово «<svg>» в тексте рисунком не считаем.
const DRAWING = "<svg\\s[^>]*\\b(?:xmlns|viewBox)\\b[^>]*>";
const drawn = () => new RegExp(`${DRAWING}[\\s\\S]*?<\\/svg>`, "gi");

// Сырой ответ модели -> текст (формулы LaTeX остаются как есть) + рисунки отдельно.
// Код программ (между строками ```) не трогаем вовсе.
export function splitAnswer(raw: string): { text: string; svgs: string[] } {
  const svgs: string[] = [];
  const src = raw
    .replace(new RegExp("```[a-z]*\\s*(" + DRAWING + "[\\s\\S]*?<\\/svg>)\\s*```", "gi"), "$1") // рисунок, завёрнутый в блок кода
    .replace(new RegExp("```[a-z]*\\s*(" + DRAWING + "[\\s\\S]*)$", "i"), (_m, tail: string) => (/<\/svg>/i.test(tail) ? tail : "")); // блок с рисунком оборван
  const pieces = src.split(/(```[\s\S]*?```)/);
  const last = pieces.length - 1 - ((pieces.length - 1) % 2); // последний кусок обычного текста
  const text = pieces.map((piece, i) => {
    if (i % 2) return piece;
    let t = piece.replace(drawn(), (m) => (svgs.push(m), ""));
    if (i === last) t = t.replace(new RegExp(`${DRAWING}[\\s\\S]*$`, "i"), ""); // недописанный рисунок в самом конце
    // запись формул приводим к одному виду («$…$» в одной строке) здесь, один раз для страниц, подписи и текста
    return normalizeMath(t.replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, ""));
  }).join("").replace(/\n{3,}/g, "\n\n").trim();
  return { text, svgs };
}

// Первая строка ответа служебная: «ВИД: страница» или «ВИД: текст». Модель видит предмет и решает, чем отправить ответ;
// читателю строка не показывается. Вне блоков кода убираем все такие строки, считается первая.
export type Look = "page" | "text";
// Самая первая строка ответа читается терпимо: модель может написать «**ВИД: страница**», «Вид: текст (химия)»,
// «ВИД — страница». Дальше по тексту убирается только точная запись: строка задания вроде «Вид: несовершенный» остаётся.
const LOOK_FIRST = /^\s*[*_#>`«"]*\s*вид(?:\s+ответа)?\s*[*_`]*\s*[:—–-]\s*[*_`«"]*\s*(страниц|текст)[^\n]*(?:\n|$)/iu;
const LOOK_LINE = /^[ \t]*ВИД:[ \t]*([\p{L}-]+)[ \t.]*(?:\n|$)/gmu;
export function lookOf(raw: string): { look: Look | null; text: string } {
  let look: Look | null = null;
  const first = LOOK_FIRST.exec(raw);
  let src = raw;
  if (first) {
    look = first[1].toLowerCase() === "текст" ? "text" : "page";
    src = raw.slice(first[0].length);
  }
  let cut = Boolean(first);
  const text = src.split(/(```[\s\S]*?```)/).map((piece, i) => (i % 2 ? piece : piece.replace(LOOK_LINE, (m, w: string) => {
    const kind: Look | null = /^страниц/i.test(w) ? "page" : /^текст(ом|овый|овая)?$/i.test(w) ? "text" : null;
    if (!kind) return m;
    look ??= kind;
    cut = true;
    return "";
  }))).join("");
  return { look, text: cut ? text.replace(/^\s*\n/, "") : raw };
}
export const lookLine = (look: Look | null | undefined): string => (look ? `ВИД: ${look === "page" ? "страница" : "текст"}\n` : "");

// ---------- таблицы ----------
// Таблицу модель пишет строками «| a | b |» с чертой «|---|---|» под шапкой. В тексте она уходит моноширинным блоком
// с выровненными столбцами (ровнять пробелами модель не умеет, это делает код), на странице рисуется настоящей таблицей.
// Строка таблицы -> ячейки. Черта внутри формулы $…$ (модуль) ячейки не делит. null: это не строка таблицы
export function cells(line: string): string[] | null {
  const t = line.trim();
  if (t.length < 3 || !t.startsWith("|") || !t.endsWith("|")) return null;
  const out: string[] = [];
  let cur = "", math = false;
  for (let i = 1; i < t.length - 1; i++) {
    const ch = t[i];
    if (ch === "\\" && i + 1 < t.length - 1) cur += t[++i] === "|" && !math ? "|" : ch + t[i];
    else if (ch === "|" && !math) (out.push(cur.trim()), (cur = ""));
    else {
      // знак $ без пары дальше по строке это не формула («Цена, $»): ячейки он не склеивает
      if (ch === "$" && (math || t.indexOf("$", i + 1) > 0)) math = !math;
      cur += ch;
    }
  }
  out.push(cur.trim());
  return math || out.length < 2 ? null : out;
}
const ruleRow = (c: string[]) => c.every((x) => /^:?-{2,}:?$/.test(x));
// Таблица, которая начинается в строке i: шапка, черта, хотя бы одна строка. Черта обязательна:
// по ней таблицу не спутать с двумя строками вида «|x| = |y|»
export function tableAt(lines: string[], i: number): { rows: string[][]; end: number } | null {
  const head = cells(lines[i] ?? ""), rule = cells(lines[i + 1] ?? "");
  if (!head || !rule || ruleRow(head) || !ruleRow(rule)) return null;
  const rows = [head];
  let end = i + 1;
  for (let k = i + 2; k < lines.length; k++) {
    const row = cells(lines[k]);
    if (!row) break;
    if (!ruleRow(row)) rows.push(row);
    end = k;
  }
  if (rows.length < 2) return null;
  const n = Math.max(...rows.map((r) => r.length));
  return { rows: rows.map((r) => Array.from({ length: n }, (_, j) => r[j] ?? "")), end };
}
export const TABLE_W = 30; // столько знаков моноширинного шрифта помещается в строку сообщения на телефоне
// Ширина в знакоместах: комбинируемые знаки (черта над AB, стрелка вектора) места не занимают, эмодзи и иероглифы занимают два
const wide = (s: string) => [...s.normalize("NFC")].reduce((n, ch) => n + (/\p{M}|[\u200B-\u200D\u2060\uFE0F]/u.test(ch) ? 0 : /\p{Extended_Pictographic}|[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFF00-\uFF60]/u.test(ch) ? 2 : 1), 0);
// Таблица для сообщения. Узкая: блок с ровными столбцами. Широкая строка в блоке перенеслась бы и столбцы рассыпались бы,
// поэтому широкая таблица идёт строками через черту, без выравнивания.
export function textTable(rows: string[][]): string {
  const w = rows[0].map((_, j) => Math.max(...rows.map((r) => wide(r[j]))));
  if (w.reduce((a, b) => a + b, 0) + 3 * (w.length - 1) > TABLE_W || rows.some((r) => r.some((c) => c.includes("`")))) {
    // два столбца: строки через черту. Больше: каждая строка таблицы идёт своим блоком «столбец: значение»,
    // иначе длинная строка через черты переносится где попало и столбцы уже не прочитать
    if (rows[0].length < 3) return [rows[0].join(" | "), "—".repeat(8), ...rows.slice(1).map((r) => r.join(" | "))].join("\n");
    const head = rows[0];
    return rows.slice(1).map((r) => [head[0] && r[0] ? `${head[0]}: ${r[0]}` : r[0] || head[0], ...r.slice(1).flatMap((c, j) => (c ? [`  ${head[j + 1] ? `${head[j + 1]}: ` : ""}${c}`] : []))].filter(Boolean).join("\n")).join("\n");
  }
  const line = (r: string[]) => r.map((c, j) => c + " ".repeat(w[j] - wide(c))).join(" | ").trimEnd();
  return ["```", line(rows[0]), w.map((x) => "-".repeat(x)).join("-+-"), ...rows.slice(1).map(line), "```"].join("\n");
}

// Текст с формулами LaTeX -> текст для WhatsApp: формулы знаками Юникода, код программ как есть, таблицы блоком
export function plainText(text: string): string {
  // признак задания про электронную таблицу считаем один раз по всему тексту: слово «ячейка» стоит до таблицы,
  // а адреса A1 и C2 в ней самой и после неё
  const sheet = sheetContext(text);
  const plain = (t: string) => prettyMath(stripTex(plainMath(t)), sheet);
  return text.split(/(```[\s\S]*?```)/).map((piece, i) => {
    if (i % 2) return piece;
    if (!/^[ \t]*\|.*\|[ \t]*$/m.test(piece)) return plain(piece);
    const lines = piece.split("\n");
    const out: string[] = [];
    let buf: string[] = [];
    const flush = () => {
      if (buf.length) out.push(plain(buf.join("\n")));
      buf = [];
    };
    for (let k = 0; k < lines.length; k++) {
      const t = tableAt(lines, k);
      if (!t) {
        buf.push(lines[k]);
        continue;
      }
      flush();
      out.push(textTable(t.rows.map((r) => r.map((c) => plain(c).replace(/\s+/g, " ").trim()))));
      k = t.end;
    }
    flush();
    return out.join("\n");
  }).join("");
}

export const RULE = "——————————"; // черта между заданиями: длинное тире есть в любом шрифте
export const HEAD = /^\s*(([^·\n]{1,30}·\s*){0,2}(№|Задание|Задача)|Исправляю|Вариант\s)/; // «№3», «Вариант 1 · №3», «Физика · №1»
// (граница слова \b кириллицу не понимает, поэтому конец слова проверяем сами)
const OTHER = /^(Ответ|Дано|Найти|Доказать|Решение|Доказательство|Обоснование|Проверка|ОДЗ|Если|Не видно|Прочитал|Прочитано|Правило)(?![\p{L}\p{N}])|^\d+\)|^[а-я]\)|^```|^@@@/u;

// Ответ, начатый в строке i («Ответ: …»). Модель иногда переносит его на следующую строку:
// хвост присоединяем, иначе в рамке и в списке ответов осталась бы половина.
// Возвращает сам ответ и номер последней строки, которая в него вошла.
export function answerAt(rows: string[], i: number): { value: string; last: number } {
  let value = rows[i].trim().replace(/^Ответ:\s*/, "");
  let last = i;
  const tail = rows.reduce((k, r, n) => (r.trim() ? n : k), -1); // последняя непустая строка задания
  for (let k = i + 1; k < rows.length && k <= i + 3; k++) {
    const next = rows[k].trim();
    if (!next || OTHER.test(next) || HEAD.test(next)) break;
    // хвост берём, только когда ответ явно не закончен: строка пустая, оборвана на запятой или тире,
    // либо следом идёт последняя строка задания, которая и заканчивает фразу
    const open = !value || /[,;:—–(]$/.test(value);
    const closes = !/[.!?…]$/.test(value) && k === tail && /[.!?…]$/.test(next);
    if (!open && !closes) break;
    value = value ? `${value} ${next}` : next;
    last = k;
  }
  return { value, last };
}

// Задание из одного заголовка и строки ответа (тест, краткий ответ): в списке ответов оно видно целиком,
// отдельным блоком его не повторяем. Длинный ответ список обрезал бы, поэтому такое задание кратким не считается.
export function brief(part: string): boolean {
  if (part.includes("```")) return false;
  const rows = part.split("\n").map((l) => l.trim()).filter(Boolean);
  if (rows.length < 2 || rows.length > 4 || !HEAD.test(rows[0]) || rows[0].replace(/[:.]+$/, "").length > 40 || !/^Ответ:/.test(rows[1])) return false;
  const a = answerAt(rows, 1);
  return a.last === rows.length - 1 && a.value.length > 0 && a.value.length <= 140;
}

// Заголовок задания в виде ключа: по нему исправленное задание встаёт на место прежнего, а рисунок находит своё задание
// (точка внутри номера остаётся: «№1.2» и «№12» это разные задания)
export const headKey = (s: string): string => s.toLowerCase().replace(/^\s*исправляю\s*/, "").replace(/\s/g, "").replace(/[.:]+$/, "");
export function headOf(part: string): string {
  const top = part.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3);
  return headKey(top.find((l) => HEAD.test(l) && l.length <= 60) ?? "");
}
// Номер задачи, для которой сделан рисунок: первая подпись в левом верхнем углу («№3», «Вариант 2 · №1»)
export function figureLabel(svg: string): string {
  const m = /<text\b[^>]*>([\s\S]*?)<\/text>/i.exec(svg);
  return (m?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// Вторая проверка нашла ошибку, и основная модель переписала эти задания: ставим их на место прежних.
// Задание с тем же заголовком заменяется; единственное задание заменяется и без совпадения заголовка;
// задание, которого в ответе не было (пропущенное), добавляется в конец. Рисунок с тем же номером заменяет старый.
// Заголовок сверяется сначала точно, потом по номеру задания: «№1 (2 балла)» и «№1», «Задание 5» и «№5» это одно задание.
// Вариант и предмет сужают выбор, только если они названы в исправлении: «№3» подходит и к «Вариант 1 · №3», и к «Вариант 2 · №3».
// lost: исправления, для которых подходит несколько заданий или у которых нет заголовка. Ставить их наугад нельзя:
// рядом с исправленным осталось бы ошибочное решение.
function taskId(part: string): { num: string; variant: string; subject: string } | null {
  const top = part.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3);
  const line = (top.find((l) => HEAD.test(l) && l.length <= 60) ?? "").toLowerCase().replace(/^исправляю\s*/, "");
  const num = /(?:№\s*|задани[ея]\s+|задач[аи]\s+)([\p{L}\p{N}]+(?:\.\p{N}+)*)/u.exec(line)?.[1];
  if (!num) return null;
  const segs = line.split("·").map((x) => x.trim());
  const subject = segs.length > 1 && !/^вариант/.test(segs[0]) && !/^(№|задани|задач)/.test(segs[0]) ? segs[0] : "";
  return { num, variant: /вариант\s*([\p{L}\p{N}]+)/u.exec(line)?.[1] ?? "", subject };
}
export function mergeFix(parts: string[], svgs: string[], fix: { parts: string[]; svgs: string[] }): { parts: string[]; svgs: string[]; changed: string[]; lost: string[] } {
  const out = [...parts];
  const keys = out.map(headOf);
  const taken = new Set<number>();
  const changed: string[] = [], lost: string[] = [];
  for (const p of fix.parts) {
    const k = headOf(p);
    const name = (p.split("\n").map((l) => l.trim()).find(Boolean) ?? "").slice(0, 40);
    const free = (ok: (i: number) => boolean) => keys.flatMap((_h, i) => (!taken.has(i) && ok(i) ? [i] : []));
    let hit = k ? free((i) => keys[i] === k) : [];
    const id = taskId(p);
    if (hit.length !== 1 && id) {
      hit = free((i) => {
        const x = taskId(out[i]);
        return !!x && x.num === id.num && (!id.variant || !x.variant || x.variant === id.variant) && (!id.subject || !x.subject || x.subject === id.subject);
      });
    }
    let at = hit.length === 1 ? hit[0] : -1;
    if (at < 0 && out.length === 1 && fix.parts.length === 1) at = 0; // задание одно: заменяется и без совпадения заголовка
    if (at < 0 && (hit.length > 1 || !k)) {
      lost.push(name);
      continue;
    }
    // слово «Исправляю» в заголовке читателю не нужно: он получает один готовый ответ, а не историю правок
    const clean = p.replace(/^(\s*)Исправляю\s+(?=\S)/, "$1");
    if (at >= 0) out[at] = clean;
    else at = out.push(clean) - 1; // задания с таким номером в ответе не было: оно было пропущено
    keys[at] = headOf(clean);
    taken.add(at);
    changed.push(name.replace(/^Исправляю\s+/, ""));
  }
  // Рисунок из исправления заменяет прежний рисунок своего задания. Задание ищем так же мягко, как само исправление:
  // точное совпадение подписи, потом номер. Рисунок без подписи относим к единственному исправленному заданию.
  const owner = (svg: string, list: string[]): number => {
    const label = figureLabel(svg), k = headKey(label), id = taskId(label);
    const exact = list.findIndex((x) => k !== "" && headOf(x) === k);
    if (exact >= 0) return exact;
    const hit = id ? list.flatMap((x, i) => {
      const t = taskId(x);
      return t && t.num === id.num && (!id.variant || !t.variant || t.variant === id.variant) && (!id.subject || !t.subject || t.subject === id.subject) ? [i] : [];
    }) : [];
    return hit.length === 1 ? hit[0] : -1;
  };
  const redone = new Set<number>();
  for (const s of fix.svgs) {
    const at = owner(s, out);
    if (at >= 0) redone.add(at);
    else if (taken.size === 1) redone.add([...taken][0]);
  }
  return { parts: out, svgs: [...svgs.filter((s) => !redone.has(owner(s, out))), ...fix.svgs], changed, lost };
}

// Короткий список ответов: в начале сообщения или подписью к первой странице. На маленьком экране видно прежде всего его.
export function card(parts: string[], title = "✅ Ответы"): string {
  const lines = parts.map((p, n) => {
    const rows = p.replace(/```[\s\S]*?```/g, "").split("\n").map((l) => l.trim());
    const head = (rows.find((l) => HEAD.test(l) && l.length <= 60) ?? `Задание ${n + 1}`).replace(/[:.]+$/, "").slice(0, 40);
    const answers: string[] = [];
    let branch = ""; // прочтение неразборчивого условия («Если в условии 28:»), к которому относится следующий ответ
    for (let i = 0; i < rows.length; i++) {
      const b = /^Если в условии\s+(.+?):/.exec(rows[i]);
      if (b) branch = b[1];
      if (!/^Ответ:/.test(rows[i])) continue;
      const a = answerAt(rows, i);
      if (a.value) answers.push(branch && !a.value.startsWith(`при ${branch}`) ? `при ${branch}: ${a.value}` : a.value);
      branch = "";
      i = a.last;
    }
    // задания без ответа: условие не видно целиком (нужно переснять) или это доказательство
    // несколько ответов идут через «;», точка в конце каждого перед ним не нужна
    let answer = answers.length > 1 ? answers.map((a, k) => (k < answers.length - 1 ? a.replace(/[.;]+$/, "") : a)).join("; ") : answers[0]
      ?? (rows.some((l) => /^Не видно:/.test(l)) ? "не видно условия, пересними ближе" : rows.some((l) => /решено выше/i.test(l)) ? "решено выше" : "см. решение");
    if (answer.length > 140) {
      const cut = answer.slice(0, 139);
      const at = Math.max(cut.lastIndexOf("; "), cut.lastIndexOf(" "));
      answer = (at > 70 ? cut.slice(0, at) : cut) + "…";
    }
    return `${head}: ${answer}`;
  });
  return `${title}\n${lines.join("\n")}`;
}

// Делит одно длинное задание по строкам. Блок кода, попавший на границу, закрываем и открываем заново:
// иначе WhatsApp покажет голые ``` и потеряет отступы.
function pieces(block: string, max: number): string[] {
  const out: string[] = [];
  let piece = "";
  let fence = ""; // открывающая строка блока кода, внутри которого мы сейчас
  const push = () => {
    out.push(fence && piece ? `${piece}\n\`\`\`` : piece);
    piece = fence;
  };
  for (const whole of block.split("\n")) {
    // строка длиннее сообщения: режем на куски, ничего не теряя
    for (let s = 0; s === 0 || s < whole.length; s += max - 8) {
      const line = whole.slice(s, s + max - 8);
      const closing = fence !== "" && /^\s*```/.test(whole); // закрывающая строка блока всегда остаётся в своём куске
      if (piece && !closing && piece.length + line.length + 1 + (fence ? 4 : 0) > max) push();
      piece = piece ? `${piece}\n${line}` : line;
    }
    if (/^\s*```/.test(whole)) fence = fence ? "" : whole.trim();
  }
  if (piece && piece !== fence) out.push(piece);
  return out;
}

// Собирает ответ в одно сообщение: сверху список ответов, ниже решения по порядку.
// Если всё не помещается в max знаков, делит на несколько сообщений по границам заданий.
// title: свой заголовок списка ответов («Исправление…»); с ним список стоит сверху, даже если задание одно.
export function compose(parts: string[], max: number, title?: string): string[] {
  if (!parts.length) return [];
  // краткие задания (тест) целиком видны в списке ответов: отдельными блоками их не повторяем
  const blocks = parts.length > 1 || title ? [card(parts, title), ...parts.filter((p) => !brief(p))] : [...parts];
  const whole = blocks.join(`\n${RULE}\n`);
  if (whole.length <= max) return [whole];
  const out: string[] = [];
  let cur = "";
  for (const block of blocks) {
    const next = cur ? `${cur}\n${RULE}\n${block}` : block;
    if (next.length <= max) {
      cur = next;
      continue;
    }
    if (cur) out.push(cur);
    const cut = pieces(block, max);
    cur = cut.pop() ?? "";
    out.push(...cut);
  }
  if (cur) out.push(cur);
  return out.length > 1 ? out.map((m, i) => `(${i + 1}/${out.length})\n${m}`) : out;
}

// Оборванный ответ продолжается со следующей строки: недописанную строку и недорисованный рисунок убираем,
// иначе на стыке получится каша из обрывка и его повтора
export function seam(text: string): string {
  const open = text.lastIndexOf("<svg");
  if (open >= 0 && open > text.lastIndexOf("</svg>")) return text.slice(0, open).trimEnd();
  const nl = text.lastIndexOf("\n");
  return nl > 0 ? text.slice(0, nl).trimEnd() : "";
}

// Ответ проверяющей модели: «ВЕРДИКТ: ВЕРНО» или «ВЕРДИКТ: ОШИБКА» и список замечаний. null: ответ не по форме.
// Считается последний вердикт хода: строка «ВЕРДИКТ:» в ранней заметке («напишу ВЕРДИКТ: ВЕРНО, если…») итогом не является.
export function verdict(text: string): { ok: true } | { ok: false; issues: string } | null {
  const m = [...text.matchAll(/ВЕРДИКТ:\s*(ВЕРНО|ОШИБКА)/gi)].at(-1);
  if (!m || m.index === undefined) return null;
  if (m[1].toUpperCase() === "ВЕРНО") return { ok: true };
  const issues = text.slice(m.index + m[0].length).trim();
  return issues ? { ok: false, issues } : null;
}
