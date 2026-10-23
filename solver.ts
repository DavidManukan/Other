// Solver: фото задания в WhatsApp -> Claude -> ответ обратно в WhatsApp.
// Val Town, HTTP val. Ключи сюда НЕ писать: они живут в Env vars.
import { blob } from "https://esm.town/v/std/blob/main.ts";

const env = (k: string, d = "") => (Deno.env.get(k) ?? d).trim();
const CLAUDE_KEY = env("ANTHROPIC_API_KEY");
const GREEN_URL = env("GREEN_URL").replace(/\/+$/, "").replace(/^(?!https?:\/\/)(?=.)/i, "https://");
const GREEN_ID = env("GREEN_ID").replace(/\D/g, "");
const GREEN_TOKEN = env("GREEN_TOKEN");
const MODEL = env("MODEL", "claude-opus-5-5");
const EFFORT = env("EFFORT", "medium");
let FAST = env("FAST") === "1"; // быстрый режим Opus: ответ пишется до 2,5 раза быстрее, но дороже
const LIMIT = (Number(env("LIMIT", "57")) || 57) * 1000; // Val Town Free обрывает запрос на 60 с, на Pro можно 590

// Секрет для вебхука: выводится из GREEN_TOKEN, но сам токен не раскрывает
const HOOK_KEY = GREEN_TOKEN
  ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("solver:" + GREEN_TOKEN)))]
    .slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("")
  : "";

// Вал публичный: ключи не должны попасть ни на страницу, ни в чат
const hide = (x: unknown) =>
  [GREEN_TOKEN, CLAUDE_KEY].filter((s) => s.length >= 8).reduce((t, s) => t.split(s).join("***"), String(x ?? ""));

const PROMPT = `Ты решаешь школьные задания (10 класс) по фото. Фото сделано камерой очков, поэтому оно может быть под углом, с бликами или мелким шрифтом. Фото часто плохое: размыто, под углом, в тени, мелкий или рукописный текст. Сначала очень внимательно про себя прочитай всё условие: каждое число, знак, степень, индекс, единицы, буквы на рисунке. Неразборчивое восстанавливай по смыслу задания, по рисунку и по обычным школьным формулировкам. Если число всё равно можно прочитать двумя способами, выбери то, при котором задача решается красиво, и в начале решения напиши «Прочитал как: ...». Решай только школьными методами.

Ответ читают на маленьком экране очков. Пиши по-русски обычным текстом, как SMS. Не используй Markdown (звёздочки, решётки, таблицы) и LaTeX (знаки $, \\frac, \\sqrt). Знаки ^ и _ не используй никогда. WhatsApp умеет маленькие цифры сверху и снизу, пиши ими.
Степени маленькими цифрами сверху: x², x³, a⁴, 10⁻³, 2ⁿ, xⁿ⁺¹, eˣ, (a + b)², sin²x, x⁻¹. Знаки сверху: ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱˣʸᵃᵇᶜᵈᵉᵏᵐᵖᵗ.
Индексы маленькими цифрами снизу: v₀, x₁, x₂, a₁₀, H₂O, CO₂, H₂SO₄, log₂8, A₁B₁. Знаки снизу: ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₙₘₖₜ.
Остальные знаки: √, ∛, ·, ×, ÷, /, ±, ≈, ≠, ≤, ≥, ∞, π, °, ∠, △, ⊥, ∥, ∈, ∅, Δ, α, β, γ, φ, →, ⇒. Дроби пиши через / со скобками: (x + 1)/(x − 2). Корень со скобками: √(x + 3).

Правила ответа:
1. Сразу решение. Без вступлений, без пересказа условия, без советов и без предложений продолжить.
2. Убирай всё, без чего решение остаётся понятным и полным. Не повторяй одну мысль.
3. Простые слова. Нужные школьные термины оставляй, сложных оборотов не используй.
4. Решай задание полностью. Перед отправкой про себя проверь каждое вычисление и ответ (подставь ответ в условие, проверь единицы). В ответ пиши только верное решение.
5. В задачах минимум слов и все нужные вычисления. Каждое преобразование с новой строки. Не пропускай действия, без которых непонятно, откуда взялось число.

Формат для каждого задания. Первая строка: заголовок, какое это задание: «Вариант 1 · №3». Если вариантов нет, просто «№3». Если номера нет, «Задание 1». Дальше решение по шагам: «Дано» и «Найти» коротко, если это задача, потом вычисления, каждое с новой строки. Последняя строка: «Ответ: ...» с единицами измерения. В тесте укажи номер или букву варианта.

Реши ВСЕ задания, которые видно на фото, и все варианты (вариант 1, вариант 2 и так далее), ничего не пропускай. Решай по порядку. Между заданиями ставь отдельную строку @@@ (по ней каждое задание уйдёт отдельным сообщением). Если часть условия не читается, ничего не выдумывай: реши то, что видно, и в конце напиши «Не видно: ... Пересними ближе.». Если на фото нет задания, ответь одной строкой: «Не разобрал фото. Пересними ближе.». Если пришёл текстовый вопрос, ответь по тем же правилам. Учитывай прошлые сообщения этого чата: если просят объяснить шаг, решить задание с прошлого фото или пишут «дальше», продолжай с того места, где остановился.

Рисунки. К каждой задаче по геометрии (и планиметрия, и стереометрия) рисунок нужен обязательно. Ещё рисуй, если помогает картинка (график функции, схема по физике, структурная формула в химии) или тебя просят нарисовать. Сначала напиши решения всех заданий, а все рисунки ставь в самом конце: после последнего задания строка @@@, дальше только рисунки подряд, каждый блоком от <svg до </svg>, в левом верхнем углу номер задачи. Так ответы придут сразу, а картинки следом. Про сам рисунок в тексте не пиши.
Стиль ВСЕХ рисунков (геометрия, графики, физика, химия) один и тот же, как в учебнике, тёмная тема:
- <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 H" font-family="DejaVu Sans">, H от 500 до 1000 по размеру рисунка, первым элементом <rect width="800" height="H" fill="#171717"/>;
- в левом верхнем углу номер задачи: <text x="40" y="50" fill="#fff" font-size="34">№3</text>;
- плоскости: параллелограммы без заливки, stroke="#D9D9D0" stroke-width="2", буква плоскости (α, β) серым у правого края;
- главные отрезки и фигуры из условия (то, что ищем или о чём задача): stroke="#D5643C" stroke-width="4";
- остальные линии: stroke="#fff" stroke-width="2"; невидимые и вспомогательные линии пунктиром stroke-dasharray="8 6";
- точки: белые кружки r="7"; подписи белым font-size="32" рядом с точкой, чтобы не налезали на линии; индексы и степени только так: A<tspan baseline-shift="sub" font-size="65%">1</tspan>, x<tspan baseline-shift="super" font-size="65%">2</tspan>;
- известные длины и углы подписывай серым font-size="26" у отрезка;
- графики: оси и сетка серым #D9D9D0 stroke-width="1", подписи осей x и y, сам график #D5643C stroke-width="4", важные точки белыми кружками с координатами;
- физика: тела белым, силы и скорости стрелками #D5643C с подписью (F, mg, N, v₀);
- стереометрию рисуй в перспективе как в учебнике: плоскости наклонными параллелограммами, параллельные прямые параллельно.
Пример (две параллельные плоскости и отрезки AB и CD между ними):
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 640" font-family="DejaVu Sans"><rect width="800" height="640" fill="#171717"/><text x="40" y="50" fill="#fff" font-size="34">№1</text><polygon points="200,90 700,90 600,190 100,190" fill="none" stroke="#D9D9D0" stroke-width="2"/><text x="650" y="125" fill="#D9D9D0" font-size="30">α</text><polygon points="200,430 700,430 600,530 100,530" fill="none" stroke="#D9D9D0" stroke-width="2"/><text x="650" y="465" fill="#D9D9D0" font-size="30">β</text><line x1="270" y1="140" x2="520" y2="140" stroke="#fff" stroke-width="2" stroke-dasharray="8 6"/><line x1="330" y1="480" x2="580" y2="480" stroke="#fff" stroke-width="2" stroke-dasharray="8 6"/><line x1="270" y1="140" x2="330" y2="480" stroke="#D5643C" stroke-width="4"/><line x1="520" y1="140" x2="580" y2="480" stroke="#D5643C" stroke-width="4"/><g fill="#fff"><circle cx="270" cy="140" r="7"/><circle cx="520" cy="140" r="7"/><circle cx="330" cy="480" r="7"/><circle cx="580" cy="480" r="7"/></g><g fill="#fff" font-size="32"><text x="235" y="125">A</text><text x="535" y="125">C</text><text x="300" y="525">B</text><text x="590" y="525">D</text></g></svg>

Химия. Если в задании есть органическое вещество (назвать вещество, написать формулу по названию, изомеры, гомологи, реакции органики), обязательно нарисуй структурную формулу, как учитель на доске. В том же стиле и тёмной теме:
- группы атомов текстом font-size="34" text-anchor="middle": CH₃, CH₂, CH, C, OH, COOH, Cl; индексы только так: CH<tspan baseline-shift="sub" font-size="65%">3</tspan>, никогда не пиши CH3 обычными цифрами;
- связи линиями между группами: одинарная одна линия, двойная две параллельные, тройная три; линии не налезают на буквы;
- главная цепь (по которой даётся название) и её связи цветом #D5643C stroke-width="4", боковые радикалы белым, связи к ним stroke-width="2";
- над атомами главной цепи номера углерода серым #D9D9D0 font-size="22";
- внизу по центру название вещества серым font-size="28";
- если веществ несколько (изомеры, реакция), рисуй их по очереди сверху вниз или слева направо со стрелкой →.
Пример (2-метилбутан):
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" font-family="DejaVu Sans"><rect width="800" height="520" fill="#171717"/><text x="40" y="50" fill="#fff" font-size="34">№2</text><g font-size="34" text-anchor="middle" fill="#D5643C"><text x="120" y="270">CH<tspan baseline-shift="sub" font-size="65%">3</tspan></text><text x="290" y="270">CH</text><text x="460" y="270">CH<tspan baseline-shift="sub" font-size="65%">2</tspan></text><text x="630" y="270">CH<tspan baseline-shift="sub" font-size="65%">3</tspan></text></g><text x="290" y="400" fill="#fff" font-size="34" text-anchor="middle">CH<tspan baseline-shift="sub" font-size="65%">3</tspan></text><g stroke="#D5643C" stroke-width="4"><line x1="170" y1="258" x2="250" y2="258"/><line x1="335" y1="258" x2="410" y2="258"/><line x1="510" y1="258" x2="580" y2="258"/></g><line x1="290" y1="282" x2="290" y2="365" stroke="#fff" stroke-width="2"/><g fill="#D9D9D0" font-size="22" text-anchor="middle"><text x="120" y="225">1</text><text x="290" y="225">2</text><text x="460" y="225">3</text><text x="630" y="225">4</text></g><text x="400" y="480" fill="#D9D9D0" font-size="28" text-anchor="middle">2-метилбутан</text></svg>
В тексте ответа для органики: название по ИЮПАК и коротко, как его получили (самая длинная цепь, нумерация, радикалы).`;

// ---------- красивые степени и индексы, если модель всё же написала ^ или _ ----------
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", k: "ᵏ", m: "ᵐ", p: "ᵖ", t: "ᵗ", " ": "" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", n: "ₙ", m: "ₘ", k: "ₖ", t: "ₜ", " ": "" };
const conv = (t: string, map: Record<string, string>) => [...t].every((c) => c in map) ? [...t].map((c) => map[c]).join("") : null;
// Химические формулы и индексы: CH3 -> CH₃, H2SO4 -> H₂SO₄, A1B1 -> A₁B₁, x1 -> x₁ (коэффициент 2H2O не трогаем)
const CHEM = /(?<![A-Za-z0-9_.,])(\d*)((?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+)(?![A-Za-z0-9])/g;
const IDX = /(?<![A-Za-zА-Яа-я0-9])([a-z])(\d{1,2})(?![\d.,]?\d)/g;
function subscripts(text: string, sub: (d: string) => string): string {
  return text
    .replace(CHEM, (_m: string, k: string, tok: string) => k + (/\d/.test(tok) ? tok.replace(/(?<=[A-Za-z)])\d+/g, sub) : tok))
    .replace(IDX, (_m: string, l: string, d: string) => l + sub(d));
}

function prettyMath(text: string): string {
  const fix = (re: RegExp, map: Record<string, string>) => (m: string, g1?: string, g2?: string) => conv(g1 ?? g2 ?? "", map) ?? m;
  text = subscripts(text, (d) => conv(d, SUB) ?? d)
    .replace(/(?<![А-Яа-я])(мм|см|дм|км|м)([23])(?!\d)/g, (_m, u, d) => u + SUP[d]); // см2 -> см²
  return text
    .replace(/\^\{([^{}]{1,12})\}|\^\(([^()]{1,12})\)/g, (m, a, b) => (b ? conv(`(${b})`, SUP) : conv(a, SUP)) ?? m)
    .replace(/\^([−-]?[0-9]+|[nixyabcdekmpt](?![a-zA-Z]))/g, fix(/./, SUP))
    .replace(/_\{([^{}]{1,12})\}/g, fix(/./, SUB))
    .replace(/(?<=[A-Za-zА-Яа-я)\]])_([0-9]+|[aeoxnmkt](?![a-zA-Z]))/g, fix(/./, SUB));
}

// Все рисунки в одном стиле: тёмный фон, светлые линии, нормальные индексы и степени
const SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉", SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const tsSub = (d: string) => `<tspan baseline-shift="sub" font-size="65%">${d}</tspan>`;
const tsSup = (d: string) => `<tspan baseline-shift="super" font-size="65%">${d}</tspan>`;
function fixSvgText(t: string): string {
  t = t.replace(/\^\(?([−\-+]?[0-9a-z]{1,4})\)?/g, (_m, d) => tsSup(d))
    .replace(/[₀-₉]+/g, (m) => tsSub([...m].map((c) => SUB_DIGITS.indexOf(c)).join("")))
    .replace(/[⁰¹²³⁴-⁹]+/g, (m) => tsSup([...m].map((c) => SUP_DIGITS.indexOf(c)).join("")));
  return subscripts(t, tsSub);
}
function fixSvg(svg: string): string {
  svg = svg
    // индекс через dy сдвигает весь текст после него: меняем на baseline-shift
    .replace(/<tspan\b[^>]*\bdy="[\d.]+"[^>]*>([^<]{1,4})<\/tspan>/g, (_m, d) => tsSub(d))
    .replace(/<tspan\b[^>]*\bdy="-[\d.]+"[^>]*>([^<]{1,4})<\/tspan>/g, (_m, d) => tsSup(d))
    // чёрное на тёмном фоне не видно
    .replace(/(stroke|fill)="(?:black|#000|#000000)"/gi, '$1="#fff"')
    .replace(/(<rect\b[^>]*fill=")(?:white|#fff|#ffffff)(")/i, "$1#171717$2")
    // текст внутри <text>/<tspan>
    .replace(/(<text\b[^>]*>|<tspan\b[^>]*>|<\/tspan>)([^<]+)/g, (_m, tag, t) => tag + fixSvgText(t));
  if (!/fill="#171717"/i.test(svg)) svg = svg.replace(/(<svg\b[^>]*>)/i, '$1<rect width="100%" height="100%" fill="#171717"/>');
  if (!/<svg\b[^>]*font-family=/i.test(svg)) svg = svg.replace(/<svg\b/i, '<svg font-family="DejaVu Sans"');
  return svg;
}

// ---------- память чата (Val Town Blob) ----------
const HISTORY_TTL = 2 * 3600_000; // через 2 часа без сообщений чат начинается заново
const HISTORY_MAX = 12; // последние 6 вопросов и ответов
const histKey = (chatId: string) => `solver_hist_${chatId.replace(/\W/g, "_")}`;

async function loadHistory(chatId: string): Promise<any[]> {
  try {
    const h: any = await blob.getJSON(histKey(chatId));
    return h && Date.now() - h.at < HISTORY_TTL && Array.isArray(h.turns) ? h.turns : [];
  } catch (e) {
    console.log("history load:", e);
    return [];
  }
}

async function saveHistory(chatId: string, turns: any[]) {
  // фото храним только последнее, старые заменяем пометкой
  let seenImage = false;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (!Array.isArray(turns[i].content)) continue;
    turns[i] = {
      ...turns[i],
      content: turns[i].content.map((b: any) => {
        if (b.type !== "image") return b;
        if (!seenImage) return (seenImage = true, b);
        return { type: "text", text: "[фото задания]" };
      }),
    };
  }
  let t = turns.slice(-HISTORY_MAX);
  while (t.length && t[0].role !== "user") t = t.slice(1);
  try {
    await blob.setJSON(histKey(chatId), { at: Date.now(), turns: t });
  } catch (e) {
    console.log("history save:", e);
  }
}

// ---------- рисунки: SVG от Claude -> PNG ----------
let renderer: Promise<(svg: string) => Uint8Array> | null = null;
function getRenderer() {
  renderer ??= (async () => {
    const { initWasm, Resvg } = await import("npm:@resvg/resvg-wasm@2.6.2");
    const [, font] = await Promise.all([
      initWasm(fetch("https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm")),
      fetch("https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf").then((r) => r.arrayBuffer()),
    ]);
    const fontBuffers = [new Uint8Array(font)];
    return (svg: string) =>
      new Resvg(svg, {
        font: { fontBuffers, defaultFontFamily: "DejaVu Sans" },
        fitTo: { mode: "width", value: 1200 },
        background: "#171717",
      }).render().asPng();
  })();
  renderer.catch(() => (renderer = null));
  return renderer;
}

// Рисунок кладём в Blob и отдаём по ссылке /?img=..., GREEN-API забирает его сам
async function sendDrawings(chatId: string, svgs: string[], origin: string, end: number) {
  let failed = 0;
  for (const svg of svgs.slice(0, 8)) {
    try {
      const png = (await getRenderer())(fixSvg(svg));
      const id = crypto.randomUUID().replace(/-/g, "");
      await blob.set(`solver_img_${id}`, new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }));
      await green("sendFileByUrl", { chatId, urlFile: `${origin}/?img=${id}`, fileName: "risunok.png" }, left(end, 2_000));
    } catch (e) {
      console.log("drawing:", hide(e));
      failed++;
    }
  }
  if (failed) await send(chatId, `(рисунков не получилось: ${failed})`, 3_000).catch(() => {});
  try { // старые рисунки (старше суток) удаляем
    const old = (await blob.list("solver_img_")).filter((b) => Date.now() - Date.parse(b.lastModified) > 86_400_000);
    await Promise.all(old.map((b) => blob.delete(b.key)));
  } catch (e) {
    console.log("cleanup:", e);
  }
}

// ---------- GREEN-API (WhatsApp бота) ----------
async function green(method: string, body?: unknown, ms = 10_000): Promise<any> {
  if (!/^https:\/\//.test(GREEN_URL)) throw new Error("GREEN_URL должен начинаться с https://");
  let r: Response;
  try {
    r = await fetch(`${GREEN_URL}/waInstance${GREEN_ID}/${method}/${GREEN_TOKEN}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
  } catch (e: any) {
    if (e?.name === "TimeoutError") throw e;
    throw new Error(`GREEN-API ${method}: нет связи`); // текст ошибки fetch содержит токен, его не показываем
  }
  const t = await r.text();
  if (!r.ok) throw new Error(`GREEN-API ${method}: ${r.status} ${hide(t).slice(0, 150)}`);
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

const send = (chatId: string, message: string, ms = 10_000) =>
  green("sendMessage", {
    chatId,
    message: message.length > 19_000 ? message.slice(0, 19_000) + "\n(обрезано)" : message,
    linkPreview: false,
  }, ms);

// Сколько мс осталось до срока (не меньше min)
const left = (until: number, min = 1_000) => Math.max(min, until - Date.now());

async function getPhoto(chatId: string, idMessage: string, url: string | undefined, until: number): Promise<Uint8Array> {
  const load = async (u: string) => {
    const r = await fetch(u, { signal: AbortSignal.timeout(Math.min(10_000, left(until))) });
    if (!r.ok) throw new Error(`фото не скачалось: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  };
  if (url) {
    try {
      return await load(url);
    } catch (e) {
      console.log("downloadUrl не сработал, пробую downloadFile:", hide(e));
    }
  }
  const j = await green("downloadFile", { chatId, idMessage }, Math.min(10_000, left(until)));
  if (!j?.downloadUrl) throw new Error("GREEN-API не дал ссылку на фото");
  return await load(j.downloadUrl);
}

function imageType(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

function base64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- Claude ----------
function claudeError(status: number, msg: string, retryAfter: string | null = "1"): string {
  if (status === 401) return "Неверный ключ Claude. Проверь ANTHROPIC_API_KEY.";
  if (status === 404) return `Нет модели ${MODEL}. Исправь MODEL.`;
  if (status === 402 || /credit|balance/i.test(msg)) return "На балансе Claude кончились деньги (platform.claude.com → Billing).";
  if (status === 429 && !retryAfter) return "Claude: достигнут месячный лимит трат (platform.claude.com → Limits).";
  if (status === 429 || status >= 500) return "Claude занят. Пришли ещё раз через минуту.";
  return `Ошибка Claude ${status}: ${msg.slice(0, 120)}`;
}

// Ответ идёт потоком: если время кончается, отдаём то, что успело написаться
// onChunk получает каждое готовое задание сразу, как только модель его дописала (разделитель @@@)
async function askClaude(
  messages: unknown[],
  until: number,
  onChunk?: (t: string) => Promise<void>,
  effort = EFFORT,
): Promise<string> {
  const body: any = { model: MODEL, max_tokens: 64000, system: PROMPT, messages, stream: true };
  if (effort) body.output_config = { effort };
  if (FAST) body.speed = "fast";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), left(until, 3_000));
  const timeout = () => new DOMException("время вышло", "TimeoutError");
  try {
    let r: Response;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": CLAUDE_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          ...(FAST ? { "anthropic-beta": "fast-mode-2026-02-01" } : {}),
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw ctrl.signal.aborted ? timeout() : e;
    }
    if (!r.ok) {
      let j: any = {};
      try {
        j = JSON.parse(await r.text());
      } catch { /* не JSON */ }
      const msg = String(j?.error?.message ?? "");
      if (r.status === 400 && effort && /output_config|effort/i.test(msg)) {
        clearTimeout(timer);
        return askClaude(messages, until, onChunk, ""); // модель не знает effort
      }
      if (FAST && r.status === 400 && /speed|fast/i.test(msg)) {
        clearTimeout(timer);
        FAST = false; // быстрый режим недоступен: дальше работаем обычным
        return askClaude(messages, until, onChunk, effort);
      }
      throw new Error(claudeError(r.status, msg, r.headers.get("retry-after")));
    }
    let text = "", stop = "", buf = "", pending = "", sentAny = false;
    const SPLIT = /(?:^|\n)\s*@@@[^\n]*\n/;
    try {
      const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader();
      ctrl.signal.addEventListener("abort", () => reader.cancel().catch(() => {}));
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          let ev: any;
          try {
            ev = JSON.parse(line.slice(5));
          } catch {
            continue;
          }
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            text += ev.delta.text;
            if (!onChunk) continue;
            pending += ev.delta.text;
            let m;
            while ((m = pending.match(SPLIT))) {
              const chunk = pending.slice(0, m.index);
              pending = pending.slice(m.index! + m[0].length);
              if (chunk.trim()) {
                await onChunk(chunk);
                sentAny = true;
              }
            }
          } else if (ev.type === "message_delta" && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
          else if (ev.type === "error") {
            throw new Error(claudeError(ev.error?.type === "overloaded_error" ? 529 : 500, String(ev.error?.message ?? "")));
          }
        }
      }
    } catch (e) {
      if (!text.trim()) throw ctrl.signal.aborted ? timeout() : e;
      stop = "cut";
    }
    if (ctrl.signal.aborted && !stop) {
      if (!text.trim()) throw timeout();
      stop = "cut";
    }
    const rest = (onChunk ? pending : text).replace(/\n\s*@@@\s*$/, "").trim();
    const cut = stop === "cut" || stop === "max_tokens";
    if (stop === "refusal" && !sentAny) return "Модель не стала это решать. Пересними задание.";
    if (!rest && !sentAny) {
      return stop === "max_tokens" ? "Задание слишком длинное. Сфоткай одно задание." : "Пустой ответ. Пришли фото ещё раз.";
    }
    if (cut) return `${rest}\n\n(не успел дописать, напиши «дальше»)`.trim();
    return rest;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- сообщение из WhatsApp ----------
const NUDGE = new Set(["videoMessage", "audioMessage", "documentMessage", "stickerMessage", "locationMessage", "contactMessage"]);

// Вопрос + память чата -> Claude -> текст и (если есть) рисунок
async function solve(chatId: string, content: unknown[], origin: string, end: number) {
  const history = await loadHistory(chatId);
  const turns = [...history, { role: "user", content }];
  const parts: string[] = [];
  const drawings: string[] = []; // картинки рисуем после всех ответов
  const deliver = async (raw: string) => {
    const svgs = raw.match(/<svg[\s\S]*?<\/svg>/gi) ?? [];
    const text = prettyMath(raw)
      .replace(/```[a-z]*\s*(<svg[\s\S]*?<\/svg>)\s*```/gi, "$1")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/(```[a-z]*\s*)?<svg[\s\S]*$/i, "") // недописанный рисунок
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text) await send(chatId, text, left(end, 2_000));
    drawings.push(...svgs);
    if (text) parts.push(text);
  };
  const rest = await askClaude(turns, end - 9_000, deliver);
  if (rest) await deliver(rest);
  if (drawings.length) await sendDrawings(chatId, drawings, origin, end);
  await saveHistory(chatId, [...turns, { role: "assistant", content: parts.join("\n\n") || "…" }]);
}

// GREEN-API ждёт ответ 180 с, потом шлёт то же сообщение ещё раз: повторы пропускаем
async function alreadySeen(id: string): Promise<boolean> {
  if (!id) return false;
  try {
    const seen: string[] = ((await blob.getJSON("solver_seen")) as string[] | undefined) ?? [];
    if (seen.includes(id)) return true;
    await blob.setJSON("solver_seen", [...seen, id].slice(-200));
  } catch (e) {
    console.log("seen:", e);
  }
  return false;
}

async function handle(h: any, t0: number, origin: string) {
  if (h?.typeWebhook === "quotaExceeded") return console.log("GREEN-API: лимит чатов тарифа исчерпан", JSON.stringify(h));
  if (h?.typeWebhook !== "incomingMessageReceived") return;
  const chatId = String(h.senderData?.chatId ?? "");
  if (!/@(c\.us|lid)$/.test(chatId)) return; // группы, статусы и каналы пропускаем
  if (await alreadySeen(String(h.idMessage ?? ""))) return;
  const end = t0 + LIMIT;
  const md = h.messageData ?? {};
  const type = String(md.typeMessage ?? "");
  const fd = md.fileMessageData ?? {};
  try {
    if (type === "imageMessage" || (type === "documentMessage" && /^image\//.test(String(fd.mimeType ?? "")))) {
      const bytes = await getPhoto(chatId, String(h.idMessage ?? ""), fd.downloadUrl, t0 + 20_000);
      const media_type = imageType(bytes);
      if (!media_type) return await send(chatId, "Не понял формат фото. Пришли обычное фото.");
      const caption = String(fd.caption ?? "").trim();
      await solve(chatId, [
        { type: "image", source: { type: "base64", media_type, data: base64(bytes) } },
        { type: "text", text: caption ? `Реши задания на фото. Подпись: ${caption}` : "Реши задания на фото." },
      ], origin, end);
    } else if (type === "textMessage" || type === "extendedTextMessage" || type === "quotedMessage") {
      const text = String(md.textMessageData?.textMessage ?? md.extendedTextMessageData?.text ?? "").trim();
      if (!text) return;
      if (/^(ping|пинг)$/i.test(text)) return await send(chatId, `pong ✅ модель ${MODEL}`);
      if (/^(сброс|новое|reset)$/i.test(text)) {
        await saveHistory(chatId, []);
        return await send(chatId, "Память чата очищена ✅");
      }
      await solve(chatId, [{ type: "text", text }], origin, end);
    } else if (NUDGE.has(type)) {
      await send(chatId, "Пришли фото задания.");
    } // реакции, правки, удаления: молча пропускаем
  } catch (e: any) {
    console.log(hide(e?.stack ?? e));
    const why = e?.name === "TimeoutError" ? "Не успел решить. Пришли фото ещё раз (лучше одно задание)." : String(e?.message ?? e);
    await send(chatId, `⚠️ ${hide(why)}`, left(end, 2_000)).catch((e2) => console.log(hide(e2)));
  }
}

// ---------- страница настройки: открой ссылку вала в Safari ----------
const STATE_HINT: Record<string, string> = {
  starting: "Запускается. Подожди 5 минут и обнови страницу.",
  sleepMode: "Телефон офлайн. Открой WhatsApp Business и подожди 5 минут.",
  notAuthorized: "Привяжи номер заново: «Связать по номеру телефона» в console.green-api.com.",
  blocked: "Номер бота заблокирован WhatsApp.",
  suspended: "WhatsApp временно ограничил номер бота.",
};

async function setupPage(url: URL): Promise<Response> {
  const hook = `${url.origin}/?k=${HOOK_KEY}`;
  const rows: string[] = [];
  const miss = ["ANTHROPIC_API_KEY", "GREEN_URL", "GREEN_ID", "GREEN_TOKEN"].filter((k) => !env(k));
  if (miss.length) {
    rows.push(`❌ Не заполнено: ${miss.join(", ")}`);
  } else {
    try {
      const s = String((await green("getStateInstance"))?.stateInstance);
      rows.push(s === "authorized" ? "✅ WhatsApp бота подключён" : `❌ WhatsApp бота не подключён (${s}). ${STATE_HINT[s] ?? "Привяжи номер заново."}`);
    } catch (e: any) {
      rows.push(`❌ ${e.message}. Проверь GREEN_URL, GREEN_ID, GREEN_TOKEN.`);
    }
    try {
      const s = await green("getSettings");
      const cur = String(s?.webhookUrl ?? "");
      if (/^https:\/\/[^/]+\.val\.run\/\?k=/.test(cur) && cur.endsWith(`?k=${HOOK_KEY}`) && s?.incomingWebhook === "yes") {
        rows.push("✅ Вебхук настроен");
      } else {
        await green("setSettings", {
          webhookUrl: hook,
          webhookUrlToken: HOOK_KEY,
          incomingWebhook: "yes",
          outgoingWebhook: "no",
          outgoingMessageWebhook: "no",
          outgoingAPIMessageWebhook: "no",
          stateWebhook: "no",
          incomingCallWebhook: "no",
          editedMessageWebhook: "no",
          deletedMessageWebhook: "no",
          pollMessageWebhook: "no",
        });
        rows.push("⏳ Вебхук только что настроен. Подожди 5 минут и обнови страницу.");
      }
    } catch (e: any) {
      rows.push(`❌ Не смог настроить вебхук: ${e.message}`);
    }
    const r = await fetch(`https://api.anthropic.com/v1/models/${MODEL}`, {
      headers: { "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const mj: any = r ? await r.json().catch(() => ({})) : {};
    if (!r) rows.push("❌ Claude не отвечает");
    else if (!r.ok) rows.push(`❌ ${claudeError(r.status, String(mj?.error?.message ?? ""), r.headers.get("retry-after"))}`);
    else if (mj?.lifecycle === "retired") rows.push(`❌ Модель ${MODEL} больше не работает. Исправь MODEL.`);
    else rows.push(`✅ Ключ Claude принят, модель ${MODEL}. Баланс смотри на platform.claude.com`);
  }
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Solver</title><body style="font:18px/1.5 -apple-system,sans-serif;margin:16px">
<h2>Solver: проверка</h2>${rows.map((r) => `<p>${hide(r).replace(/</g, "&lt;")}</p>`).join("")}
<p><a href="?">Проверить ещё раз</a></p></body>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// ---------- вход ----------
export default async function (req: Request): Promise<Response> {
  const t0 = Date.now();
  const url = new URL(req.url);
  const img = url.searchParams.get("img");
  if (req.method === "GET" && img) {
    if (!/^[0-9a-f]{32}$/.test(img)) return new Response("no", { status: 404 });
    try {
      const r = await blob.get(`solver_img_${img}`);
      return new Response(r.body, { headers: { "content-type": "image/png" } });
    } catch {
      return new Response("no", { status: 404 });
    }
  }
  if (req.method === "GET") return await setupPage(url);
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!HOOK_KEY || (url.searchParams.get("k") !== HOOK_KEY && bearer !== HOOK_KEY)) return new Response("no");
  const h = await req.json().catch(() => null);
  await handle(h, t0, url.origin);
  return new Response("ok"); // всегда 200, иначе GREEN-API пришлёт то же сообщение ещё раз
}
