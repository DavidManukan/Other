// Проверка настоящего браузера (npm run e2e:browser -- папка): локальный воркер снимает страницы решения через привязку BROWSER.
// При первом запуске wrangler сам скачивает браузер. Снимки сохраняются в папку, если она указана.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls, start } from "./mock.mjs";
const MOCK = 8788, PORT = 8787, TOKEN = "testtoken-1234567890abcdef";
const BASE = `http://127.0.0.1:${PORT}`, OUT = process.argv[2];
const KEY = createHash("sha256").update("solver:" + TOKEN).digest("hex").slice(0, 32);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await start(MOCK);
const VARS = { ANTHROPIC_API_KEY: "sk-ant-test-1234567890", GREEN_URL: `http://127.0.0.1:${MOCK}/green`, GREEN_ID: "1101000001", GREEN_TOKEN: TOKEN, ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK}/anthropic`, GREEN_MEDIA_URL: `http://127.0.0.1:${MOCK}/media`, TIME_SCALE: "20" };
let log = "";
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", mkdtempSync(join(tmpdir(), "solver-real-")), ...Object.entries(VARS).flatMap(([k, v]) => ["--var", `${k}:${v}`])], { env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));
const done = (code) => { try { process.kill(-dev.pid, "SIGTERM"); } catch {} console.log(log.split("\n").filter((l) => !/wrangler:info|explorer|^\s*$|Environment Variable|Binding|Useful|OpenAPI/.test(l)).join("\n").slice(-3500)); setTimeout(() => process.exit(code), 500); };
for (let i = 0; i < 600; i++) { if ((await fetch(`${BASE}/ready`).catch(() => null))?.status === 404) break; await sleep(150); }
await fetch(`${BASE}/?k=${KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ typeWebhook: "incomingMessageReceived", idMessage: "R1", senderData: { chatId: "700@c.us" }, messageData: { typeMessage: "imageMessage", fileMessageData: { downloadUrl: `http://127.0.0.1:${MOCK}/photo.jpg`, caption: "S_TEX", mimeType: "image/jpeg" } } }) });
const t0 = Date.now();
let got = [];
while (Date.now() - t0 < 150_000) {
  got = calls.filter((c) => c.chatId === "700@c.us" && c.method !== "sendMessage");
  const txt = calls.filter((c) => c.chatId === "700@c.us" && c.method === "sendMessage" && !/^(📥|➕)/.test(c.text));
  if (got.length || txt.length) { await sleep(4000); break; }
  await sleep(300);
}
got = calls.filter((c) => c.chatId === "700@c.us");
for (const [i, c] of got.entries()) {
  console.log(i, c.method, c.fileName ?? "", c.bytes ?? "", JSON.stringify(c.caption ?? c.text ?? "").slice(0, 200));
  if (c.body && OUT) writeFileSync(`${OUT}/page-${i}.png`, c.body);
}
const pages = got.filter((c) => c.png && /^reshenie-/.test(c.fileName ?? ""));
const good = pages.length === 2 && pages[0].bytes > 20_000 && (pages[0].caption ?? "").startsWith("✅ Ответы");
console.log(good ? "✅ браузер снял страницы решения" : "❌ страниц нет: бот ответил текстом", "| секунд:", Math.round((Date.now() - t0) / 1000));
done(good ? 0 : 1);
