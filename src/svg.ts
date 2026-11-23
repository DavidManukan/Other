// Приведение рисунков модели к одному стилю (без рендера, чистые функции).
import { subscripts } from "./text.ts";

// Все рисунки в одном стиле: чёрный фон, белые линии, нормальные индексы и степени
const SUB_DIGITS = "₀₁₂₃₄₅₆₇₈₉", SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const tsSub = (d: string) => `<tspan baseline-shift="sub" font-size="65%">${d}</tspan>`;
const tsSup = (d: string) => `<tspan baseline-shift="super" font-size="65%">${d}</tspan>`;
function fixSvgText(t: string): string {
  t = t.replace(/\^\(?([−\-+]?[0-9a-z]{1,4})\)?/g, (_m, d) => tsSup(d))
    .replace(/[₀-₉]+/g, (m) => tsSub([...m].map((c) => SUB_DIGITS.indexOf(c)).join("")))
    .replace(/[⁰¹²³⁴-⁹]+/g, (m) => tsSup([...m].map((c) => SUP_DIGITS.indexOf(c)).join("")));
  return subscripts(t, tsSub);
}
const ownPlace = (tspan: string) => /\s[xy]="/.test(tspan.slice(0, tspan.indexOf(">")));
const num = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
// Прямоугольник-фон: стоит в углу и занимает всю ширину холста
function backdrop(rect: string, svg: string): boolean {
  const x = num(rect, "x") ?? "0", y = num(rect, "y") ?? "0", w = num(rect, "width") ?? "";
  if (parseFloat(x) !== 0 || parseFloat(y) !== 0) return false;
  const box = /viewBox="\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)/.exec(svg)?.[1];
  return w === "100%" || (box !== undefined && parseFloat(w) >= parseFloat(box));
}
export function fixSvg(svg: string): string {
  svg = svg
    // индекс через dy сдвигает весь текст после него: меняем на baseline-shift
    // (tspan с x или y это перенос строки в подписи, его не трогаем)
    .replace(/<tspan\b[^>]*\bdy="[\d.]+"[^>]*>([^<]{1,4})<\/tspan>/g, (m, d) => (ownPlace(m) ? m : tsSub(d)))
    .replace(/<tspan\b[^>]*\bdy="-[\d.]+"[^>]*>([^<]{1,4})<\/tspan>/g, (m, d) => (ownPlace(m) ? m : tsSup(d)))
    // фон это прямоугольник во весь холст: он всегда чёрный
    .replace(/<rect\b[^>]*>/gi, (m) => (backdrop(m, svg) ? (/fill="/i.test(m) ? m.replace(/fill="[^"]*"/i, 'fill="#000"') : m.replace(/<rect/i, '<rect fill="#000"')) : m))
    // краски старого стиля: тёмно-серый фон был #171717, цветные линии делаем белыми
    .replace(/#171717/gi, "#000")
    .replace(/#D5643C|#D9D9D0/gi, "#fff")
    // чёрные линии и чёрный текст на чёрном фоне не видны
    .replace(/stroke="(?:black|#000|#000000)"/gi, 'stroke="#fff"')
    .replace(/<g\b[^>]*\bfont-size=[^>]*>/gi, (m) => m.replace(/fill="(?:black|#000|#000000)"/i, 'fill="#fff"'))
    .replace(/<text\b[^>]*>/gi, (m) => (/\sfill="/i.test(m) ? m.replace(/fill="(?:black|#000|#000000)"/i, 'fill="#fff"') : m.replace(/<text/i, '<text fill="#fff"')))
    // текст внутри <text>/<tspan>
    .replace(/(<text\b[^>]*>|<tspan\b[^>]*>|<\/tspan>)([^<]+)/g, (_m, tag, t) => tag + fixSvgText(t));
  if (!/<rect\b[^>]*fill="#000"/i.test(svg)) svg = svg.replace(/(<svg\b[^>]*>)/i, '$1<rect width="100%" height="100%" fill="#000"/>');
  if (!/<svg\b[^>]*font-family=/i.test(svg)) svg = svg.replace(/<svg\b/i, '<svg font-family="DejaVu Sans"');
  return svg;
}
