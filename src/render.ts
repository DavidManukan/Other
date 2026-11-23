// Рисунок: SVG от Claude -> PNG. Движок и шрифт лежат внутри воркера, из сети ничего не качаем.
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import font from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf";
import { fixSvg } from "./svg.ts";

let ready: Promise<void> | null = null;

export async function renderPng(svg: string, width = 1200): Promise<Uint8Array> {
  ready ??= initWasm(wasm);
  ready.catch(() => (ready = null));
  await ready;
  const r = new Resvg(fixSvg(svg), {
    font: { fontBuffers: [new Uint8Array(font)], defaultFontFamily: "DejaVu Sans", loadSystemFonts: false },
    fitTo: { mode: "width", value: width },
    background: "#171717",
  });
  try {
    const img = r.render();
    try {
      return img.asPng();
    } finally {
      img.free();
    }
  } finally {
    r.free();
  }
}
