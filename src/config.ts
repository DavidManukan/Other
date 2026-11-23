// Настройки из Variables and Secrets воркера. Ключи в код не пишем.
import type { Chat } from "./chat.ts";

export interface Env {
  CHAT: DurableObjectNamespace<Chat>;
  ANTHROPIC_API_KEY?: string;
  GREEN_URL?: string;
  GREEN_ID?: string;
  GREEN_TOKEN?: string;
  GREEN_MEDIA_URL?: string; // необязательно: mediaUrl из консоли GREEN-API, если бот не угадал его сам
  MODEL?: string;
  FALLBACK_MODEL?: string; // запасная модель, если основная недоступна на этом ключе
  CODE?: string; // CODE=0 выключает пересчёт вычислений в песочнице Anthropic
  EFFORT?: string;
  FAST?: string;
  AUTO_MAX?: string;
  REGION?: string;
  OWNER?: string; // необязательно: чаты хозяина через запятую (номер или id чата), только они меняют режим
  ANTHROPIC_BASE_URL?: string; // только для локальных тестов
  TIME_SCALE?: string; // только для локальных тестов: во сколько раз ускорить таймеры
}

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
export const isEffort = (e: unknown): e is Effort => EFFORTS.includes(e as Effort);
// На ступень ниже: когда модель думала слишком долго и ничего не написала
export const lower = (e: Effort): Effort => EFFORTS[Math.max(0, EFFORTS.indexOf(e) - 1)];

export interface Cfg {
  claudeKey: string;
  claudeBase?: string;
  greenUrl: string;
  greenId: string;
  greenToken: string;
  greenMedia: string;
  model: string;
  fallbackModel: string;
  code: boolean;
  effort: Effort;
  fast: boolean;
  autoMax: number;
  region: string;
  owners: string[];
  missing: string[];
}

export function config(env: Env): Cfg {
  const v = (k: keyof Env, d = "") => String(env[k] ?? d).trim();
  const effort = v("EFFORT", "high").toLowerCase();
  const autoMax = Number(v("AUTO_MAX", "5"));
  return {
    claudeKey: v("ANTHROPIC_API_KEY"),
    claudeBase: v("ANTHROPIC_BASE_URL") || undefined,
    greenUrl: v("GREEN_URL").replace(/\/+$/, "").replace(/^(?!https?:\/\/)(?=.)/i, "https://"),
    greenId: v("GREEN_ID").replace(/\D/g, ""),
    greenToken: v("GREEN_TOKEN"),
    greenMedia: v("GREEN_MEDIA_URL").replace(/\/+$/, ""),
    model: v("MODEL", "claude-fable-5-2"),
    fallbackModel: v("FALLBACK_MODEL", "claude-opus-5-5"),
    code: v("CODE") !== "0",
    effort: isEffort(effort) ? effort : "high",
    fast: v("FAST") === "1",
    autoMax: Number.isFinite(autoMax) && autoMax >= 0 ? Math.min(autoMax, 20) : 5,
    region: v("REGION", "eu").toLowerCase(),
    owners: v("OWNER").split(/[,;\s]+/).filter(Boolean),
    missing: (["ANTHROPIC_API_KEY", "GREEN_URL", "GREEN_ID", "GREEN_TOKEN"] as const).filter((k) => !v(k)),
  };
}

// Адрес воркера для вебхука и ссылок на рисунки: всегда https (кроме локального запуска)
export const publicOrigin = (url: URL): string => (/^(localhost|127\.0\.0\.1)$/.test(url.hostname) ? url.origin : `https://${url.host}`);

// Ключи не должны попасть ни на страницу проверки, ни в чат, ни в логи
export const hider = (c: Cfg) => (x: unknown): string =>
  [c.greenToken, c.claudeKey].filter((s) => s.length >= 8).reduce((t, s) => t.split(s).join("***"), String(x ?? ""));

// Секрет вебхука: выводится из GREEN_TOKEN, но сам токен не раскрывает
export async function hookKey(c: Cfg): Promise<string> {
  if (!c.greenToken) return "";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("solver:" + c.greenToken));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Объект чата живёт в выбранном регионе, чтобы запросы к Claude шли из поддерживаемой страны.
// REGION: eu (по умолчанию) или us закрепляют регион жёстко, weur/enam/... только подсказка.
const HINTS = ["wnam", "enam", "sam", "weur", "eeur", "apac", "oc", "afr", "me"];
let pinned: boolean | undefined; // жёсткое закрепление региона доступно? решаем один раз, чтобы чат не раздвоился

function chatNamespace(env: Env): { ns: DurableObjectNamespace<Chat>; hint?: DurableObjectLocationHint } {
  const region = config(env).region;
  if ((region === "eu" || region === "us" || region === "fedramp") && pinned !== false) {
    try {
      const ns = env.CHAT.jurisdiction(region as DurableObjectJurisdiction);
      pinned = true;
      return { ns };
    } catch (e) {
      if (pinned) throw e;
      pinned = false; // локальный запуск: там закрепления нет
      console.log("закрепление региона недоступно, работаю с подсказкой региона:", String(e));
    }
  }
  const hint = (HINTS.includes(region) ? region : region === "us" ? "enam" : "weur") as DurableObjectLocationHint;
  return { ns: env.CHAT, hint };
}

export function chatStub(env: Env, name: string): DurableObjectStub<Chat> {
  const { ns, hint } = chatNamespace(env);
  const id = ns.idFromName(name);
  return hint ? ns.get(id, { locationHint: hint }) : ns.get(id);
}

// Тот же объект по его id (id стоит в ссылке на рисунок, номер телефона в ссылку не попадает)
export function chatById(env: Env, hex: string): DurableObjectStub<Chat> | null {
  try {
    const { ns } = chatNamespace(env);
    return ns.get(ns.idFromString(hex));
  } catch {
    return null;
  }
}
