// Чистые функции оформления текста: степени, индексы, разбор ответа модели.
import { plainMath } from "./tex.ts";

// ---------- красивые степени и индексы, если модель всё же написала ^ или _ ----------
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", k: "ᵏ", m: "ᵐ", p: "ᵖ", t: "ᵗ", " ": "" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", n: "ₙ", m: "ₘ", k: "ₖ", t: "ₜ", " ": "" };
const conv = (t: string, map: Record<string, string>) => [...t].every((c) => c in map) ? [...t].map((c) => map[c]).join("") : null;
// Химические формулы и индексы: CH3 -> CH₃, H2SO4 -> H₂SO₄, A1B1 -> A₁B₁, x1 -> x₁ (коэффициент 2H2O не трогаем).
// Формулу, за которой стоит знак заряда (SO42-), не трогаем: где индекс, а где заряд, по записи не понять.
const CHEM = /(?<![A-Za-z0-9_.,])(\d*)((?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+)(?![A-Za-z0-9]|[+−-](?![A-Za-z0-9(]))/g;
const ION = /(?<![A-Za-z0-9])([A-Z][a-z]?)(\d)([+−-])(?![A-Za-z0-9(])/g; // Fe3+ -> Fe³⁺: заряд простого иона
const IDX = /(?<![A-Za-zА-Яа-я0-9])([a-z])(\d{1,2})(?![\d.,]?\d)/g;
export function subscripts(text: string, sub: (d: string) => string): string {
  return text
    .replace(CHEM, (_m: string, k: string, tok: string) => k + (/\d/.test(tok) ? tok.replace(/(?<=[A-Za-z)])\d+/g, sub) : tok))
    .replace(IDX, (_m: string, l: string, d: string) => l + sub(d));
}

export function prettyMath(text: string): string {
  const fix = (map: Record<string, string>) => (m: string, g1?: string, g2?: string) => conv(g1 ?? g2 ?? "", map) ?? m;
  // адреса сайтов не трогаем: в них цифры после букв значат своё
  return text.split(/(https?:\/\/\S+)/).map((piece, i) => {
    if (i % 2) return piece;
    const t = subscripts(piece.replace(ION, (_m, el: string, d: string, sign: string) => el + SUP[d] + SUP[sign]), (d) => conv(d, SUB) ?? d)
      .replace(/(?<![А-Яа-я])(мм|см|дм|км|м)([23])(?!\d)/g, (_m, u, d) => u + SUP[d]); // см2 -> см²
    return t
      .replace(/\^\{([^{}]{1,12})\}|\^\(([^()]{1,12})\)/g, (m, a, b) => (b ? conv(`(${b})`, SUP) : conv(a, SUP)) ?? m)
      .replace(/\^([−-]?[0-9]+|[nixyabcdekmpt](?![a-zA-Z]))/g, fix(SUP))
      .replace(/_\{([^{}]{1,12})\}/g, fix(SUB))
      .replace(/(?<=[A-Za-zА-Яа-я)\]])_([0-9]+|[aeoxnmkt](?![a-zA-Z]))/g, fix(SUB));
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
    return t.replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "");
  }).join("").replace(/\n{3,}/g, "\n\n").trim();
  return { text, svgs };
}

// Текст с формулами LaTeX -> текст для WhatsApp: формулы знаками Юникода, код программ как есть
export function plainText(text: string): string {
  return text.split(/(```[\s\S]*?```)/).map((piece, i) => (i % 2 ? piece : prettyMath(plainMath(piece)))).join("");
}

export const RULE = "——————————"; // черта между заданиями: длинное тире есть в любом шрифте
const HEAD = /^\s*((Вариант\s+\S+\s*·\s*)?(№|Задание|Задача)|Исправляю|Вариант\s)/;

// Короткий список ответов: в начале сообщения или подписью к картинке. На маленьком экране видно прежде всего его.
export function card(parts: string[]): string {
  const lines = parts.map((p) => {
    const rows = p.replace(/```[\s\S]*?```/g, "").split("\n").map((l) => l.trim());
    const head = (rows.find((l) => HEAD.test(l)) ?? rows.find(Boolean) ?? "").slice(0, 40);
    const answers: string[] = [];
    rows.forEach((l, i) => {
      if (!/^Ответ:/.test(l)) return;
      const next = rows.slice(i + 1).find(Boolean) ?? "";
      const value = l.slice(6).trim() || (HEAD.test(next) || /^Ответ:/.test(next) ? "" : next); // ответ мог уйти на следующую строку
      if (value) answers.push(value);
    });
    let answer = answers.length ? answers.join("; ") : "см. решение";
    if (answer.length > 140) {
      const cut = answer.slice(0, 139);
      const at = Math.max(cut.lastIndexOf("; "), cut.lastIndexOf(" "));
      answer = (at > 70 ? cut.slice(0, at) : cut) + "…";
    }
    return `${head}: ${answer}`;
  });
  return `✅ Ответы\n${lines.join("\n")}`;
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
export function compose(parts: string[], max: number): string[] {
  if (!parts.length) return [];
  const blocks = parts.length > 1 ? [card(parts), ...parts] : [...parts];
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
