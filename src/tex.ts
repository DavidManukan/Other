// Формулы LaTeX -> обычный текст с символами Юникода.
// Нужен там, где картинки нет: подпись с ответами и запасной текстовый ответ в WhatsApp.

const SYM: Record<string, string> = {
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤", leqslant: "≤", ge: "≥", geq: "≥", geqslant: "≥",
  ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼", infty: "∞", partial: "∂", nabla: "∇", forall: "∀", exists: "∃",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "θ",
  kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", chi: "χ",
  psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩", setminus: "∖", varnothing: "∅", emptyset: "∅",
  Rightarrow: "⇒", Longrightarrow: "⇒", implies: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", Longleftrightarrow: "⇔", iff: "⇔",
  to: "→", rightarrow: "→", longrightarrow: "→", leftarrow: "←", leftrightarrow: "↔", uparrow: "↑", downarrow: "↓", mapsto: "↦",
  angle: "∠", triangle: "△", perp: "⊥", parallel: "∥", circ: "∘", degree: "°", bullet: "•", ldots: "…", dots: "…", cdots: "…",
  land: "∧", wedge: "∧", lor: "∨", vee: "∨", neg: "¬", lnot: "¬", oplus: "⊕", sum: "Σ", prod: "∏", int: "∫", oint: "∮",
  ell: "ℓ", hbar: "ħ", prime: "′", quad: " ", qquad: "  ", lbrace: "{", rbrace: "}", langle: "⟨", rangle: "⟩", mid: "|", vert: "|",
  backslash: "\\", colon: ":", lt: "<", gt: ">", ast: "∗", star: "⋆", propto: "∝", cong: "≅", ll: "≪", gg: "≫", simeq: "≃",
};
const BB: Record<string, string> = { N: "ℕ", Z: "ℤ", Q: "ℚ", R: "ℝ", C: "ℂ" };
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", k: "ᵏ", m: "ᵐ", p: "ᵖ", t: "ᵗ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", n: "ₙ", m: "ₘ", k: "ₖ", t: "ₜ", i: "ᵢ", j: "ⱼ", ",": ",", ".": "," };
const WRAP = new Set(["text", "mathrm", "mathbf", "mathit", "mathsf", "textbf", "textit", "operatorname", "boldsymbol", "bm", "displaystyle", "textstyle", "mathstrut", "overline", "underline", "widehat", "hat", "bar", "tilde", "boxed", "mathcal", "limits", "nolimits"]);
const DROP = new Set(["left", "right", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "displaystyle", "textstyle", "limits", "nolimits", "nonumber", "hline", "mathstrut"]);
const BIG = new Set(["lim", "sum", "prod", "int", "max", "min", "sup", "inf"]);

const map = (s: string, m: Record<string, string>) => [...s].every((c) => c in m) ? [...s].map((c) => m[c]).join("") : null;
const simple = (s: string) => /^[\p{L}\p{N}.,°′√∞π⁰¹²³⁴-⁹₀-₉ⁿ]*$/u.test(s) || /^\([^()]*\)$/.test(s) || /^√\([^()]*\)$/.test(s);
const paren = (s: string) => (simple(s) ? s : `(${s})`);
// Знаменатель без скобок только если это одно число, одна буква или имя отрезка: a/2a читалось бы неверно
const below = (s: string) => (/^(\d+(,\d+)?|\p{Lu}+[₀-₉]*|\p{L}[⁰¹²³⁴-⁹₀-₉ⁿ]*|√\d+|π)$/u.test(s) || /^\([^()]*\)$/.test(s) ? s : `(${s})`);

// Разбор по символам: группы {…} раскрываются рекурсивно
function conv(s: string): string {
  let out = "";
  let i = 0;
  const group = (): string => { // следующий аргумент: {…}, \команда или один символ
    while (s[i] === " ") i++;
    if (s[i] === "{") {
      let depth = 0;
      const start = i + 1;
      for (; i < s.length; i++) {
        if (s[i] === "\\") i++;
        else if (s[i] === "{") depth++;
        else if (s[i] === "}" && --depth === 0) break;
      }
      return conv(s.slice(start, i++));
    }
    if (s[i] === "\\") {
      const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
      if (!m) return "";
      i += m[0].length;
      return conv(m[0] + (WRAP.has(m[1]) || m[1] === "frac" || m[1] === "sqrt" ? takeRaw() : ""));
    }
    return i < s.length ? s[i++] : "";
  };
  const takeRaw = (): string => { // сырой текст следующей группы вместе со скобками
    const from = i;
    group();
    return s.slice(from, i);
  };
  const optional = (): string | null => {
    if (s[i] !== "[") return null;
    const end = s.indexOf("]", i);
    if (end < 0) return null;
    const v = s.slice(i + 1, end);
    i = end + 1;
    return conv(v);
  };
  const script = (m: Record<string, string>, mark: string, after: string): string => {
    const raw = group();
    if (mark === "^" && (raw === "∘" || raw === "°")) return "°";
    if (mark === "^" && raw === "′") return "′";
    const u = map(raw.replace(/\s/g, ""), m);
    if (u !== null) return u;
    if (mark === "_") return BIG.has(after) ? `(${raw})` : /^[\p{L}\p{N}\s,]+$/u.test(raw) ? raw.replace(/\s/g, "") : `_(${raw})`;
    return `^${[...raw].length === 1 ? raw : `(${raw})`}`;
  };
  let last = ""; // имя последней команды: от него зависит вид индекса (lim, sum, int)
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const m = /^\\([A-Za-z]+|.)/s.exec(s.slice(i));
      if (!m) { i++; continue; }
      i += m[0].length;
      const name = m[1];
      last = name;
      if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") { const a = group(), b = group(); out += `${paren(a)}/${below(b)}`; }
      else if (name === "sqrt") { const n = optional(), x = group(); out += (n === null || n === "2" ? "√" : n === "3" ? "∛" : n === "4" ? "∜" : (map(n, SUP) ?? `(${n})`) + "√") + (/^[\p{L}\p{N},]+$/u.test(x) ? x : `(${x})`); }
      else if (name === "mathbb") { const x = group(); out += BB[x] ?? x; }
      else if (name === "vec" || name === "overrightarrow") out += group() + "⃗";
      else if (name === "begin" || name === "end") {
        const env = takeRaw().replace(/[{}]/g, "");
        if (name === "begin") { if (/array|aligned|tabular/.test(env) && s[i] === "{") takeRaw(); out += /cases/.test(env) ? "система: " : /[pb]matrix/.test(env) ? "(" : /vmatrix/.test(env) ? "|" : ""; }
        else out += /[pb]matrix/.test(env) ? ")" : /vmatrix/.test(env) ? "|" : "";
      }
      else if (name === "\\") out += "; ";
      else if (name === "," || name === ";" || name === ":" || name === " " || name === ">") out += " ";
      else if (name === "!") out += "";
      else if (DROP.has(name)) out += "";
      else if (WRAP.has(name)) out += group();
      else if (name in SYM) out += SYM[name];
      else out += /^[A-Za-z]+$/.test(name) ? name : name; // sin, cos, tg, log, \%, \{ …
      continue;
    }
    last = c === " " ? last : c === "^" || c === "_" ? last : "";
    if (c === "^") { i++; out += script(SUP, "^", ""); }
    else if (c === "_") { i++; const after = lastWord(out); out += script(SUB, "_", after); }
    else if (c === "{") out += group();
    else if (c === "}") i++;
    else if (c === "&") { out += " "; i++; }
    else if (c === "~") { out += " "; i++; }
    else if (c === "-") { out += "−"; i++; }
    else if (c === "*") { out += "·"; i++; }
    else if (c === "'") { out += "′"; i++; }
    else { out += c; i++; }
  }
  return out;
}
const lastWord = (out: string) => (/(lim|Σ|∏|∫|max|min|sup|inf)$/.exec(out)?.[1] ?? "").replace("Σ", "sum").replace("∏", "prod").replace("∫", "int");

export function texToPlain(tex: string): string {
  return conv(tex)
    .replace(/\s*;\s*(?=\)|\||$)/g, "") // лишний разделитель строк перед концом матрицы
    .replace(/[ \t]+;/g, ";")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\|\s+(?=[^|]*\|)/, "|").replace(/\s+\|$/, "|")
    .replace(/([∠△¬√]) (?=\S)/g, "$1")
    .replace(/([α-ωΑ-Ω]) (?=[A-Za-zα-ωΑ-Ω])/g, "$1")
    .replace(/(^|[=≠<>≤≥(,;] ?)± (?=[\d\p{L}])/gu, "$1±")
    .replace(/(?<![A-Za-z])(arcsin|arccos|arctg|arcctg|sin|cos|tg|ctg|ln|lg|exp|log[₀-₉,]*)(?=[A-Za-zα-ωΑ-Ω\d√])/g, "$1 ")
    .trim();
}

// Делит строку на обычный текст и формулы: $…$ и $$…$$. Непарный знак $ остаётся текстом.
export function mathSpans(text: string): { math: boolean; body: string }[] {
  const out: { math: boolean; body: string }[] = [];
  const re = /\$\$([^$]+?)\$\$|\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ math: false, body: text.slice(at, m.index) });
    out.push({ math: true, body: (m[1] ?? m[2]).trim() });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ math: false, body: text.slice(at) });
  return out;
}

// Текст с формулами -> текст без LaTeX
export const plainMath = (text: string): string => mathSpans(text).map((s) => (s.math ? texToPlain(s.body) : s.body)).join("");
