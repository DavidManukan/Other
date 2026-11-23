// Чистые функции оформления текста: степени, индексы, разбор ответа модели.

// ---------- красивые степени и индексы, если модель всё же написала ^ или _ ----------
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", k: "ᵏ", m: "ᵐ", p: "ᵖ", t: "ᵗ", " ": "" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", n: "ₙ", m: "ₘ", k: "ₖ", t: "ₜ", " ": "" };
const conv = (t: string, map: Record<string, string>) => [...t].every((c) => c in map) ? [...t].map((c) => map[c]).join("") : null;
// Химические формулы и индексы: CH3 -> CH₃, H2SO4 -> H₂SO₄, A1B1 -> A₁B₁, x1 -> x₁ (коэффициент 2H2O не трогаем)
const CHEM = /(?<![A-Za-z0-9_.,])(\d*)((?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+)(?![A-Za-z0-9])/g;
const IDX = /(?<![A-Za-zА-Яа-я0-9])([a-z])(\d{1,2})(?![\d.,]?\d)/g;
export function subscripts(text: string, sub: (d: string) => string): string {
  return text
    .replace(CHEM, (_m: string, k: string, tok: string) => k + (/\d/.test(tok) ? tok.replace(/(?<=[A-Za-z)])\d+/g, sub) : tok))
    .replace(IDX, (_m: string, l: string, d: string) => l + sub(d));
}

export function prettyMath(text: string): string {
  const fix = (re: RegExp, map: Record<string, string>) => (m: string, g1?: string, g2?: string) => conv(g1 ?? g2 ?? "", map) ?? m;
  text = subscripts(text, (d) => conv(d, SUB) ?? d)
    .replace(/(?<![А-Яа-я])(мм|см|дм|км|м)([23])(?!\d)/g, (_m, u, d) => u + SUP[d]); // см2 -> см²
  return text
    .replace(/\^\{([^{}]{1,12})\}|\^\(([^()]{1,12})\)/g, (m, a, b) => (b ? conv(`(${b})`, SUP) : conv(a, SUP)) ?? m)
    .replace(/\^([−-]?[0-9]+|[nixyabcdekmpt](?![a-zA-Z]))/g, fix(/./, SUP))
    .replace(/_\{([^{}]{1,12})\}/g, fix(/./, SUB))
    .replace(/(?<=[A-Za-zА-Яа-я)\]])_([0-9]+|[aeoxnmkt](?![a-zA-Z]))/g, fix(/./, SUB));
}

// Текст ответа модели -> чистый текст для WhatsApp + рисунки отдельно.
// Код программ (между строками ```) не трогаем: в нём ^, _ и цифры после букв значат своё.
export function splitAnswer(raw: string): { text: string; svgs: string[] } {
  const svgs = raw.match(/<svg[\s\S]*?<\/svg>/gi) ?? [];
  const noDrawings = raw
    .replace(/```[a-z]*\s*(<svg[\s\S]*?<\/svg>)\s*```/gi, "$1")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/(```[a-z]*\s*)?<svg[\s\S]*$/i, ""); // недописанный рисунок
  const text = noDrawings
    .split(/(```[\s\S]*?```)/)
    .map((piece, i) => (i % 2 ? piece : prettyMath(piece).replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "")))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, svgs };
}

export const RULE = "——————————"; // черта между заданиями: длинное тире есть в любом шрифте

// Короткий список ответов для начала сообщения: на маленьком экране видно прежде всего начало
function card(parts: string[]): string {
  const lines = parts.map((p) => {
    const head = (p.split("\n", 1)[0] ?? "").trim().slice(0, 40);
    const answers = [...p.matchAll(/^Ответ:[ \t]*(.+)$/gm)];
    const answer = answers.length ? answers[answers.length - 1][1].trim() : "см. решение";
    return `${head}: ${answer.length > 140 ? answer.slice(0, 139) + "…" : answer}`;
  });
  return `✅ Ответы\n${lines.join("\n")}`;
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
  const push = (block: string) => {
    const next = cur ? `${cur}\n${RULE}\n${block}` : block;
    if (next.length <= max) return void (cur = next);
    if (cur) out.push(cur);
    cur = "";
    // одно задание длиннее сообщения: режем по строкам
    let piece = "";
    for (const line of block.split("\n")) {
      if (piece && piece.length + line.length + 1 > max) {
        out.push(piece);
        piece = "";
      }
      piece = piece ? `${piece}\n${line}` : line.slice(0, max);
    }
    cur = piece;
  };
  for (const b of blocks) push(b);
  if (cur) out.push(cur);
  return out.length > 1 ? out.map((m, i) => `(${i + 1}/${out.length})\n${m}`) : out;
}
