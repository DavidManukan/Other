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
  lessdot: "⋖", gtrdot: "⋗", smile: "◡", frown: "⌢", nparallel: "∦", nmid: "∤", therefore: "∴", because: "∵",
  lvert: "|", rvert: "|", lVert: "‖", rVert: "‖", Vert: "‖", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉",
  varkappa: "ϰ", varrho: "ρ", varsigma: "ς", Pi: "Π", Xi: "Ξ", Upsilon: "Υ", supset: "⊃", supseteq: "⊇", nsubseteq: "⊈",
  otimes: "⊗", leqq: "≤", geqq: "≥", rightleftharpoons: "⇄", leftrightarrows: "⇄", triangleq: "≜", bot: "⊥", top: "⊤",
  square: "□", Box: "□", qed: "□", blacksquare: "■", nexists: "∄", vdots: "⋮", ddots: "⋱", iint: "∬", iiint: "∭", oiint: "∯",
  Longleftarrow: "⇐", longleftarrow: "←", longleftrightarrow: "↔", longmapsto: "↦", gets: "←", impliedby: "⇐", Uparrow: "⇑", Downarrow: "⇓",
  updownarrow: "↕", nearrow: "↗", searrow: "↘", nwarrow: "↖", swarrow: "↙", leadsto: "⇝", rightsquigarrow: "⇝", hookrightarrow: "↪", hookleftarrow: "↩",
  nrightarrow: "↛", nleftarrow: "↚", nRightarrow: "⇏", nLeftarrow: "⇍", nLeftrightarrow: "⇎", rightleftarrows: "⇄", leftrightharpoons: "⇋",
  rarr: "→", larr: "←", harr: "↔", Rarr: "⇒", Larr: "⇐", rArr: "⇒", lArr: "⇐", hArr: "⇔", uarr: "↑", darr: "↓",
  nleq: "≰", nleqslant: "≰", ngeq: "≱", ngeqslant: "≱", nless: "≮", ngtr: "≯", lneq: "≨", gneq: "≩", lneqq: "≨", gneqq: "≩",
  lesssim: "≲", gtrsim: "≳", lessgtr: "≶", gtrless: "≷", prec: "≺", succ: "≻", preceq: "⪯", succeq: "⪰", asymp: "≍", doteq: "≐",
  approxeq: "≊", thicksim: "∼", thickapprox: "≈", nsim: "≁", ncong: "≇", coloneqq: "≔", eqqcolon: "≕", varpropto: "∝",
  subsetneq: "⊊", supsetneq: "⊋", subsetneqq: "⊊", supsetneqq: "⊋", nsupseteq: "⊉", notni: "∌", owns: "∋", sqsubseteq: "⊑", sqsupseteq: "⊒",
  odot: "⊙", ominus: "⊖", oslash: "⊘", dagger: "†", ddagger: "‡", dag: "†", ddag: "‡", uplus: "⊎", sqcup: "⊔", sqcap: "⊓", amalg: "⨿",
  bigcup: "⋃", bigcap: "⋂", bigoplus: "⨁", bigotimes: "⨂", bigodot: "⨀", bigvee: "⋁", bigwedge: "⋀", coprod: "∐", ltimes: "⋉", rtimes: "⋊",
  vdash: "⊢", dashv: "⊣", models: "⊨", vDash: "⊨", complement: "∁", aleph: "ℵ", beth: "ℶ", Re: "ℜ", Im: "ℑ", wp: "℘", hslash: "ℏ", imath: "ı", jmath: "ȷ",
  measuredangle: "∡", sphericalangle: "∢", vartriangle: "△", triangledown: "▽", bigtriangleup: "△", bigtriangledown: "▽", blacktriangle: "▲",
  diamond: "⋄", Diamond: "◊", lozenge: "◊", bigstar: "★", checkmark: "✓", surd: "√", backprime: "‵", cdotp: "·", centerdot: "·", ldotp: ".",
  dotsc: "…", dotso: "…", dotsb: "⋯", dotsm: "⋯", dotsi: "⋯", mathellipsis: "…", textdegree: "°", copyright: "©", textcopyright: "©",
  textregistered: "®", circledR: "®", pounds: "£", yen: "¥", textbackslash: "\\", textless: "<", textgreater: ">", textbar: "|", textasciitilde: "~",
  textunderscore: "_", textendash: "–", textemdash: "—", textellipsis: "…", textbullet: "•", And: "&", AA: "Å", angstrom: "Å",
  lbrack: "[", rbrack: "]", lparen: "(", rparen: ")", lgroup: "(", rgroup: ")", llbracket: "⟦", rrbracket: "⟧", lang: "⟨", rang: "⟩",
  upsilon: "υ", iota: "ι", omicron: "ο", varpi: "ϖ", Alpha: "Α", Beta: "Β", Epsilon: "Ε", Zeta: "Ζ", Eta: "Η", Iota: "Ι", Kappa: "Κ", Mu: "Μ", Nu: "Ν",
  Omicron: "Ο", Rho: "Ρ", Tau: "Τ", Chi: "Χ", varGamma: "Γ", varDelta: "Δ", varTheta: "Θ", varLambda: "Λ", varXi: "Ξ", varPi: "Π", varSigma: "Σ",
  varUpsilon: "Υ", varPhi: "Φ", varPsi: "Ψ", varOmega: "Ω", flat: "♭", natural: "♮", sharp: "♯", clubsuit: "♣", diamondsuit: "♢", heartsuit: "♡", spadesuit: "♠",
};
const BB: Record<string, string> = { N: "ℕ", Z: "ℤ", Q: "ℚ", R: "ℝ", C: "ℂ" };
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", k: "ᵏ", m: "ᵐ", p: "ᵖ", t: "ᵗ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", n: "ₙ", m: "ₘ", k: "ₖ", t: "ₜ", i: "ᵢ", j: "ⱼ", ",": ",", ".": "," };
// Команды-обёртки: от них остаётся только то, что внутри
const WRAP = new Set([
  "text", "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "textbf", "textit", "textrm", "textsf", "texttt", "textnormal", "mbox", "hbox",
  "boldsymbol", "bm", "displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle", "mathstrut", "underline", "widehat", "widetilde", "hat", "tilde",
  "boxed", "fbox", "mathcal", "mathfrak", "mathscr", "limits", "nolimits", "cancel", "bcancel", "xcancel", "underbrace", "overbrace", "dot", "ddot", "check",
  "breve", "acute", "grave", "smash", "mathop", "mathrel", "mathbin", "mathord", "mathopen", "mathclose", "mathpunct", "mathinner", "rm", "bf", "it", "sf", "tt",
  "emph", "mathring", "overleftrightarrow", "overparen", "underparen", "textup", "textsl", "textsc", "textmd", "mathnormal", "pmb", "bold", "sout",
  "underbar", "utilde", "widecheck", "dddot", "ddddot", "overgroup", "undergroup", "underleftarrow", "underrightarrow", "underleftrightarrow",
  "mathclap", "mathllap", "mathrlap", "clap", "llap", "rlap", "substack", "ensuremath", "intertext", "url", "textcircled",
]);
const TWO = new Set(["overset", "underset", "stackrel", "textcolor", "colorbox", "href", "raisebox"]); // два аргумента, в текст идёт второй
const THREE = new Set(["multicolumn", "multirow", "fcolorbox"]); // три аргумента, в текст идёт третий
// стрелки с подписью: \xrightarrow{t}
const XARR: Record<string, string> = { xrightarrow: "→", xleftarrow: "←", xRightarrow: "⇒", xLeftarrow: "⇐", xleftrightarrow: "↔", xLeftrightarrow: "⇔", xmapsto: "↦", xrightleftharpoons: "⇄", xhookrightarrow: "↪", xlongequal: "=" };
const GONE = new Set(["phantom", "hphantom", "vphantom", "color", "label", "ref", "hspace", "vspace", "kern", "mkern", "mskip", "hskip", "rule", "cline"]); // аргумент пропадает вместе с командой
const FUNCS = new Set([
  "sin", "cos", "tan", "cot", "tg", "ctg", "sec", "csc", "cosec", "arcsin", "arccos", "arctan", "arctg", "arcctg", "sinh", "cosh", "tanh", "coth", "sh", "ch", "th", "cth",
  "ln", "lg", "log", "exp", "lim", "max", "min", "sup", "inf", "det", "dim", "deg", "gcd", "ker", "arg", "Pr", "hom",
  "cotg", "liminf", "limsup", "argmax", "argmin", "sgn", "arccot", "arcsec", "arccsc", "sech", "csch", "lcm",
]);
const NOT: Record<string, string> = { "=": "≠", "∈": "∉", "⊂": "⊄", "⊆": "⊈", "≡": "≢", "<": "≮", ">": "≯", "|": "∤", "∥": "∦" };
const GLUE = /[\p{L}\p{N})′⁰¹²³⁴-⁹ⁿˣ₀-₉]$/u; // после такого знака имя функции нужно отделить пробелом: «2 sin x cos x»

// Химическая запись из \ce{…}: индексы, заряды, стрелки
function chem(s: string): string {
  const up: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻" };
  const down = "₀₁₂₃₄₅₆₇₈₉";
  return s
    .replace(/<=>|<-->|<->/g, "⇄").replace(/->/g, "→").replace(/\s+v(?=\s|$)/g, "↓").replace(/\s+\^(?=\s|$)/g, "↑")
    .replace(/\^\{?(\d*[+-])\}?/g, (_m, c: string) => [...c].map((x) => up[x]).join(""))
    .replace(/(?<=[A-Za-z)\]])(\d+)(?![+-](?![A-Za-z(\d]))/g, (d) => [...d].map((x) => down[Number(x)]).join(""))
    .replace(/[{}]/g, "");
}
const DROP = new Set([
  "left", "right", "middle", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "bigm", "Bigl", "Bigr", "Bigm", "biggl", "biggr", "Biggl", "Biggr", "displaystyle", "textstyle", "limits", "nolimits",
  "nonumber", "notag", "hline", "mathstrut", "strut", "small", "large", "Large", "LARGE", "normalsize", "tiny", "huge", "Huge", "footnotesize", "scriptsize", "centering", "noindent", "allowbreak", "nobreak",
  "newline", "par", "hfill", "medskip", "smallskip", "bigskip", "thinspace", "enspace", "negthinspace", "nobreakspace", "space",
  "medspace", "thickspace", "negmedspace", "negthickspace", "enskip", "hfil", "vfill", "vfil", "hdashline", "vline", "cr", "relax", "protect", "displaylimits",
]);
// Все команды, которые понимает этот разбор. Слово после «\», которого здесь нет, командой LaTeX не считаем:
// путь к файлу C:\Users или «\n» в рассказе о программе остаются как были.
const STRUCT = ["frac", "dfrac", "tfrac", "cfrac", "sqrt", "mathbb", "vec", "overrightarrow", "overleftarrow", "ce", "pu", "overline", "bar", "binom", "dbinom", "tbinom", "pmod", "bmod", "mod", "not", "operatorname", "begin", "end", "tag", "abs", "norm", "Bbb", ...Object.keys(XARR)];
const BIG = new Set(["lim", "sum", "prod", "int", "max", "min", "sup", "inf"]);
const KNOWN = new Set<string>([...Object.keys(SYM), ...WRAP, ...TWO, ...THREE, ...GONE, ...FUNCS, ...DROP, ...STRUCT]);

const map = (s: string, m: Record<string, string>) => [...s].every((c) => c in m) ? [...s].map((c) => m[c]).join("") : null;
const simple = (s: string) => /^[\p{L}\p{N}.,°′√∞π⁰¹²³⁴-⁹₀-₉ₐₑₒₓₙₘₖₜᵢⱼⁿ]*$/u.test(s) || /^\([^()]*\)$/.test(s) || /^√\([^()]*\)$/.test(s) || /^\p{L}+\([^()]*\)$/u.test(s);
const paren = (s: string) => (simple(s) ? s : `(${s})`);
// Знаменатель без скобок только если это одно число, одна буква или имя отрезка: a/2a читалось бы неверно
const below = (s: string) => (/^(\d+(,\d+)?|\p{Lu}+[₀-₉]*|\p{L}[⁰¹²³⁴-⁹₀-₉ₐₑₒₓₙₘₖₜᵢⱼⁿ]*|d\p{Ll}|\p{L}+\([^()]*\)|√\d+|π)$/u.test(s) || /^\([^()]*\)$/.test(s) ? s : `(${s})`);
// После дроби сразу идёт множитель (буква, число, скобка, корень, степень): без скобок «1/2x» читалось бы как деление на 2x
const NOT_FACTOR = new Set(["in", "notin", "ni", "subset", "subseteq", "cup", "cap", "setminus", "to", "mid", "vert", "land", "wedge", "lor", "vee", "neg", "lnot", "right", "end", "quad", "qquad"]);
function factorNext(rest: string): boolean {
  const t = rest.trimStart();
  if (/^[\p{L}\p{N}(^]/u.test(t)) return true;
  const m = /^\\([A-Za-z]+)/.exec(t);
  if (!m) return false;
  const n = m[1];
  if (n === "left") return true;
  if (NOT_FACTOR.has(n) || DROP.has(n)) return false;
  if (n in SYM) return /[\p{L}∞∂∇√]/u.test(SYM[n]);
  return n !== "text" && n !== "mathrm"; // sqrt, frac, sin… это множители; единицы измерения в \text нет
}
// Сразу за корнем идёт множитель: без точки «√2x» читалось бы как корень из 2x
const afterRoot = (rest: string): boolean => /^(?:[A-Za-z\p{N}({]|\s*[A-Za-z(])/u.test(rest) || (/^\\(?!operatorname(?![A-Za-z]))[A-Za-z]/.test(rest) && factorNext(rest));
// Перед дробью стоит функция (sin², log₃): аргумент берём в скобки, «sin²(x/2)»
const AFTER_FN = /(?:sin|cos|tg|ctg|tan|cot|ln|lg|log[₀-₉,]*)[⁰¹²³⁴-⁹⁻]*\s*$/;

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
    if (mark === "_" && /^[A-Z][A-Z₀-₉]+$/.test(raw)) return `(${raw})`; // S_{ABD}: «SABD» читалось бы как произведение
    if (mark === "_") return BIG.has(after) ? `(${raw})` : /^[\p{L}\p{N}\s,]+$/u.test(raw) ? raw.replace(/\s/g, "") : `_(${raw})`;
    // одиночный знак без надстрочного вида (π, ∞, λ): в скобки, если следом идёт множитель, иначе «2^πx» читалось бы как 2 в степени πx
    return `^${[...raw].length === 1 && !/^\s*[\p{L}\p{N}\\({]/u.test(s.slice(i)) ? raw : `(${raw})`}`;
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
      if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") {
        const fn = AFTER_FN.test(out);
        const a = group(), b = group();
        const f = `${paren(a)}/${below(b)}`;
        // смешанное число: 2\dfrac{1}{3} это «2 1/3», а не «21/3»
        out += (/\d$/.test(out) && /^\d/.test(f) ? " " : "") + (fn || factorNext(s.slice(i)) ? `(${f})` : f);
      }
      else if (name === "sqrt") { const n = optional(), x = group(); out += (n === null || n === "2" ? "√" : n === "3" ? "∛" : n === "4" ? "∜" : (map(n, SUP) ?? `(${n})`) + "√") + (/^[\p{L}\p{N},]+$/u.test(x) ? x + (afterRoot(s.slice(i)) ? "·" : "") : `(${x})`); }
      else if (name === "mathbb" || name === "Bbb") { const x = group(); out += BB[x] ?? x; }
      else if (name === "vec" || name === "overrightarrow" || name === "overleftarrow") out += group() + "⃗";
      else if (TWO.has(name)) { group(); out += group(); }
      else if (THREE.has(name)) { optional(); group(); group(); out += group(); }
      else if (name === "abs") out += `|${group()}|`;
      else if (name === "norm") out += `‖${group()}‖`;
      else if (GONE.has(name)) { if (s[i] === "{") group(); }
      else if (name === "tag") out += ` (${group()})`;
      else if (name in XARR) { optional(); const over = group(); out += over ? ` —(${over})${XARR[name]} ` : ` ${XARR[name]} `; }
      else if (name === "|") out += "‖";
      else if (name === "ce" || name === "pu") { const from = i; group(); out += chem(s.slice(from, i).trim().replace(/^\{|\}$/g, "")); }
      else if (name === "overline" || name === "bar") { const x = group(); out += /^\d+$/.test(x) ? `(${x})` : [...x].map((ch) => ch + "\u0305").join(""); } // 0,(3): период дроби
      else if (name === "binom" || name === "dbinom" || name === "tbinom") { const n = group(), k = group(); out += `C(${n}, ${k})`; }
      else if (name === "pmod") out += ` (mod ${group()})`;
      else if (name === "bmod" || name === "mod") out += " mod ";
      else if (name === "not") { const x = group(); out += NOT[x] ?? x + "\u0338"; }
      else if (name === "operatorname") { const w = group(); out += (/^[A-Za-z]/.test(w) && GLUE.test(out) ? " " : "") + w; }
      else if ((name === "left" || name === "right") && s[i] === ".") i++; // невидимая скобка
      else if (name === "begin" || name === "end") {
        const env = takeRaw().replace(/[{}]/g, "");
        const edge = /[pb]matrix/.test(env) ? "()" : /vmatrix/.test(env) ? "||" : "";
        if (name === "begin") {
          if (/array|aligned|tabular/.test(env) && s[i] === "{") takeRaw();
          out += /cases/.test(env) ? "система: " : edge.slice(0, 1);
          while (edge && s[i] === " ") i++;
        } else out = edge ? out.replace(/[\s;]+$/, "") + edge.slice(1) : out;
      }
      else if (name === "\\") out += "; ";
      else if (name === "," || name === ";" || name === ":" || name === " " || name === ">") out += " ";
      else if (name === "!") out += "";
      else if (DROP.has(name)) out += "";
      else if (WRAP.has(name)) out += group();
      else if (name in SYM) out += SYM[name];
      else if (FUNCS.has(name)) out += (GLUE.test(out) ? " " : "") + name; // sin, cos, tg, log
      else if (!/^[A-Za-z]+$/.test(name)) out += name; // \%, \{, \$ …
      else if (name.length === 1 && name in BB) out += BB[name]; // \R, \N, \Z: множества чисел
      // Команда, которой нет в списках. С аргументом (\emph{важно}) это оформление: имя не нужно, аргумент остаётся.
      // Без аргумента это чаще всего функция (\arccot x, \lcm(4, 6)): без имени формула потеряла бы смысл
      else if (/^ *\{/.test(s.slice(i))) out += group();
      else out += (GLUE.test(out) ? " " : "") + name;
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
    .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")")
    .replace(/([∠△¬√◡⌢]) (?=\S)/g, "$1")
    .replace(/([α-ωΑ-Ω]) (?!(?:arcsin|arccos|arctg|arcctg|sin|cos|tg|ctg|ln|lg|exp|log)(?![a-z]))(?=[A-Za-zα-ωΑ-Ω])/g, "$1")
    .replace(/(^|[=≠<>≤≥(,;] ?)± (?=[\d\p{L}])/gu, "$1±")
    .replace(/(?<![A-Za-z])(arcsin|arccos|arctg|arcctg|sin|cos|tg|ctg|ln|lg|exp|log[₀-₉,]*)(?=[A-Za-zα-ωΑ-Ω\d√])/g, "$1 ")
    .trim();
}

// Делит строку на обычный текст и формулы: $…$ и $$…$$. Непарный знак $ остаётся текстом.
// Код в `…` и путь к файлу формулой не бывают: знак $ в них (`^\d+$`) ни с чем не спаривается.
export function mathSpans(text: string): { math: boolean; body: string }[] {
  const out: { math: boolean; body: string }[] = [];
  const re = /\$\$([^$]+?)\$\$|\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$/g;
  for (const [part, lit] of pieces(text)) {
    if (lit) { out.push({ math: false, body: part }); continue; }
    let at = 0;
    for (let m = re.exec(part); m; m = re.exec(part)) {
      if (m.index > at) out.push({ math: false, body: part.slice(at, m.index) });
      out.push({ math: true, body: (m[1] ?? m[2]).trim() });
      at = m.index + m[0].length;
    }
    if (at < part.length) out.push({ math: false, body: part.slice(at) });
  }
  return out;
}

// Текст с формулами -> текст без LaTeX. Знак доллара из формулы ($\$5$) снова экранируем, иначе stripTex принял бы его за мусор
export const plainMath = (text: string): string => mathSpans(text).map((s) => (s.math ? texToPlain(s.body).replace(/\$/g, "\\$") : s.body)).join("");

// ---------- заслон от сырой разметки ----------
// Человек не должен увидеть ни «$», ни «\frac{…}», как бы модель ни записала формулу.
// normalizeMath приводит запись к одному виду ещё до разбора ответа, stripTex дочищает всё, что уходит текстом.

const isCommand = (name: string) => KNOWN.has(name);
const MARKUP = /[\\$]|[\^_]\{/; // без этих знаков разметки LaTeX в тексте быть не может
// \имя{…} с именем из двух букв и больше это LaTeX, даже если команды нет в списках; \d{3} из регулярного выражения нет
// Норма \|a\| это пара знаков; одиночный «\|» встречается в коде (grep 'foo\|bar') и разметкой не считается
const NORM = /\\\|[^|\n]*?\\\|/;
const hot = (t: string): boolean => {
  for (const m of t.matchAll(/\\([A-Za-z]+)(\{)?|[\^_]\{/g)) if (m[1] === undefined || isCommand(m[1]) || (m[2] && m[1].length > 1)) return true;
  return NORM.test(t);
};
// Путь к файлу (C:\data\in\input.txt) и код в `…` разметкой не считаем и не трогаем: в них обратная черта, $ и скобки значат своё.
// Код в `…` всё же разбираем, если в нём команда LaTeX или пара $…$: так модель иногда пишет формулы,
// а случайная пара обратных кавычек в тексте не должна прятать формулу между ними.
// Путь стоит отдельным словом и кончается пробелом или знаком препинания: «f:\mathbb{R}\to\mathbb{R}» в формуле путём не считается.
const SAFE = /`[^`\n]+`|(?<![^\s"'«(\[])[A-Za-z]:\\[^\s$`{}]*(?![^\s,;.!?)»"'\]])/g;
// У настоящего пути есть хотя бы одна папка или файл, чьё имя не команда LaTeX: «f:\mathbb R» и «x:\alpha» это формулы без знаков $
const pathLike = (s: string) => s.slice(3).split("\\").some((seg) => seg !== "" && (!/^[A-Za-z]+$/.test(seg) || (seg.length > 1 && !isCommand(seg))));
const literal = (s: string) => (s[0] === "`" ? !hot(s) && !/\$(?!\s)[^$\n]+(?<!\s)\$/.test(s) : pathLike(s));
// Что началось раньше, то и считается: в «$f`(x) = 2x$ и $g`(x) = 3$» обратная кавычка это штрих внутри формулы, а не начало кода,
// а в «`^\d+$` и `^[a-z]+$`» знак $ стоит внутри кода и формулу не открывает
const SPANS = new RegExp(`(\\$\\$[^$]+?\\$\\$|\\$(?!\\s)(?:\\\\.|[^$\\\\\\n])+?(?<!\\s)\\$)|${SAFE.source}`, "g");
function pieces(text: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  let at = 0;
  for (const m of text.matchAll(SPANS)) {
    if (m[1] !== undefined || !literal(m[0])) continue;
    out.push([text.slice(at, m.index), false], [m[0], true]);
    at = m.index! + m[0].length;
  }
  out.push([text.slice(at), false]);
  return out;
}
const keep = (text: string, fn: (t: string) => string) => pieces(text).map(([s, lit]) => (lit ? s : fn(s))).join("");
// Слово похоже на часть формулы: в нём нет русских букв и нет длинного слова латиницей (кроме команд и имён функций)
function mathy(tok: string): boolean {
  const rest = tok.replace(/\\(?:text|mathrm|textbf|textit|operatorname)\*?\s*\{[^{}]*\}/g, "").replace(/\\[A-Za-z]+\*?/g, "");
  if (/[А-Яа-яЁё]/.test(rest)) return false;
  return !(rest.match(/[A-Za-z]{3,}/g) ?? []).some((w) => /[a-z]{3}/.test(w) && !FUNCS.has(w));
}
// Формула, записанная без знаков $: находит такой кусок строки и отдаёт его в fn вместе со словами-соседями («x = \frac{1}{2}»)
function bare(seg: string, fn: (core: string) => string): string {
  if (!hot(seg)) return seg;
  const toks: string[] = []; // слова и пробелы по очереди; пробел внутри {…} слово не делит
  let cur = "", depth = 0;
  for (const ch of seg) {
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (cur) toks.push(cur);
      toks.push(ch);
      cur = "";
    } else cur += ch;
  }
  if (cur) toks.push(cur);
  const space = (t: string) => /^\s$/.test(t);
  const inRun = toks.map(() => false);
  toks.forEach((t, i) => {
    if (!hot(t)) return;
    inRun[i] = true;
    for (let k = i - 1; k >= 0 && !inRun[k] && (space(toks[k]) || mathy(toks[k])); k--) inRun[k] = true;
    for (let k = i + 1; k < toks.length && !inRun[k] && (space(toks[k]) || mathy(toks[k])); k++) inRun[k] = true;
  });
  let out = "";
  for (let i = 0; i < toks.length; i++) {
    if (!inRun[i]) {
      out += toks[i];
      continue;
    }
    let run = "";
    for (; i < toks.length && inRun[i]; i++) run += toks[i];
    i--;
    // пробелы и знаки препинания по краям остаются в тексте, как и скобка без пары
    let head = /^[\s,;:.]*/.exec(run)![0];
    let tail = /[\s,;:.]*$/.exec(run.slice(head.length))![0];
    let core = run.slice(head.length, run.length - tail.length);
    const count = (c: string) => core.split(c).length - 1;
    if (core.startsWith("(") && count("(") > count(")")) { head += "("; core = core.slice(1).trimStart(); }
    if (core.endsWith(")") && count(")") > count("(")) { tail = ")" + tail; core = core.slice(0, -1).trimEnd(); }
    out += head + (core ? fn(core.replace(/(?<!\\)\$/g, "")) : "") + tail;
  }
  return out;
}

const flat = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();
const dollars = (line: string) => line.replace(/\\\$/g, "").split("$").length - 1;

// Запись формул к одному виду: «$…$» в одной строке. Модель может написать и \( … \), и \[ … \], и $$ … $$,
// и систему в несколько строк, и команду вовсе без знаков $. Код программ сюда не попадает.
export function normalizeMath(text: string): string {
  return MARKUP.test(text) ? keep(text, normalize) : text;
}
// Склеить можно только то, что похоже на формулу: русские слова вне \text{…} и код в `…` формулой не бывают
const formulaLike = (body: string) => !/[А-Яа-яЁё`]/.test(body.replace(/\\(?:text|textrm|textbf|textit|mbox|mathrm|operatorname)\*?\s*\{[^{}]*\}/g, ""));
function normalize(text: string): string {
  if (!MARKUP.test(text)) return text;
  const wrap = (_m: string, body: string) => (flat(body) ? `$${flat(body)}$` : "");
  const t = text
    .replace(/\\begin\{([a-zA-Z]+\*?)\}[\s\S]*?\\end\{\1\}/g, flat) // окружение в несколько строк собираем в одну
    .replace(/(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]/g, wrap)
    .replace(/(?<!\\)\\\(([\s\S]+?)(?<!\\)\\\)/g, wrap)
    .replace(/\$\$([\s\S]*?)\$\$/g, wrap)
    // $x$ внутри \text{…} формулы: такие знаки $ сбили бы пары, и в тексте осталась бы лишняя «}»
    .replace(/\\(text|textrm|textbf|textit|mbox|mathrm)\s*\{([^{}\n]*)\}/g, (m, c: string, b: string) => (b.includes("$") ? `\\${c}{${b.replace(/(?<!\\)\$/g, "")}}` : m));
  // формула, начатая на одной строке и законченная на другой: строки склеиваем.
  // Одинокий знак $ (цена «3$») строки не склеивает: нужна формула, которая переходит через перенос
  const lines = t.split("\n");
  const inside = (l: string | undefined) => l !== undefined && l.trim() !== "" && !/^\s*@@@/.test(l);
  for (let i = 0; i < lines.length; i++) {
    if (dollars(lines[i]) % 2 === 0) continue;
    let j = i + 1;
    while (j <= i + 8 && inside(lines[j]) && dollars(lines[j]) % 2 === 0) j++;
    if (j > i + 8 || !inside(lines[j])) continue;
    const rows = lines.slice(i, j + 1).map((l, k) => (k ? l.trim() : l.trimEnd()));
    const across = mathSpans(rows.join(" \u0001 ")).filter((s) => s.math && s.body.includes("\u0001"));
    if (across.length && across.every((s) => formulaLike(s.body))) lines.splice(i, j - i + 1, rows.join(" "));
  }
  return lines.map((line) => mathSpans(line).map((s) => (s.math ? `$${s.body}$` : bare(s.body, (core) => `$${core}$`))).join("")).join("\n");
}

// Последняя чистка текста, который уходит человеку: всё, что осталось от LaTeX, переводится в обычные знаки или убирается.
export function stripTex(text: string): string {
  return MARKUP.test(text) ? keep(text, strip) : text;
}
function strip(text: string): string {
  return text.split("\n").map((line) => {
    if (!MARKUP.test(line)) return line;
    const l = line.replace(/\\\$/g, ""); // \$ это настоящий знак доллара
    // Строка без формул (рассказ про обратную черту в Windows): остальное в ней остаётся как было, меняем только то,
    // что обычным текстом быть не может: \% \& \#, пару \{ … \}, «x\_1» и тонкий пробел между числом и единицей «5\,кг»
    if (!hot(l) && !/\$|\\[()[\]]/.test(l)) {
      return l.replace(/\\([%&#])/g, "$1")
        .replace(/\\\{([^{}\\\n]*)\\\}/g, "{$1}")
        .replace(/(?<=[\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu, "_")
        .replace(/(?<=[^\s\\])\\[,;:](?=[^\s\\])/g, " ")
        .replace(/(?<=[^\s\\])\\!(?=[^\s\\])/g, "")
        .replace(//g, "$");
    }
    return bare(l, texToPlain)
      .replace(/\\([A-Za-z]+)\*?/g, (m, n: string) => (!isCommand(n) ? m : n in SYM ? SYM[n] : FUNCS.has(n) ? n : ""))
      .replace(/\\\\(?![A-Za-zА-Яа-яЁё])/g, " ")
      .replace(/\\([,;:!> ])/g, " ")
      .replace(/\\([%&#_{}])/g, "$1")
      .replace(/\\\|([^|\n]*?)\\\|/g, "‖$1‖")
      .replace(/\\[()[\]]/g, "")
      .replace(/([\^_])\{([^{}\n]*)\}/g, "$1($2)")
      .replace(/\$/g, "") // знак $ без пары: формулы тут нет, а знак остался бы мусором
      .replace(//g, "$")
      .replace(/(\S)[ \t]{2,}/g, "$1 ");
  }).join("\n");
}

// Проверка для тестов: первый кусок сырой разметки LaTeX в тексте, готовом к отправке. Код программ и пути к файлам не смотрим.
// \имя{…} считается разметкой, даже если такой команды нет в списках: так тесты заметят пробел в списках.
export function texLeak(text: string): string | null {
  for (const block of text.split(/```[\s\S]*?```/)) {
    const piece = keep(block, (s) => s).replace(SAFE, (m) => (literal(m) ? " " : m));
    for (const m of piece.matchAll(/\\([A-Za-z]+)(\{)?|\\[()[\]\\{}%&#_]|\\\|[^|\n]*?\\\||(?<=[^\s\\])\\[,;:!](?=[^\s\\])|\$|[\^_]\{/g)) {
      if (m[1] !== undefined && !isCommand(m[1]) && !(m[2] && m[1].length > 1)) continue;
      return piece.slice(Math.max(0, m.index! - 12), m.index! + 24);
    }
  }
  return null;
}
