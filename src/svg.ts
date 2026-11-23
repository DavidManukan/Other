// Приведение рисунков модели к одному стилю (без рендера, чистые функции).
import { subscripts } from "./text.ts";

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
export function fixSvg(svg: string): string {
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
