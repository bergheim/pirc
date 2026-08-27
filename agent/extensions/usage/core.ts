import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readCodexCredential,
  readAnthropicCredential,
  readAntigravityCredential,
  readXaiCredential,
} from "./auth.ts";
import {
  parseCodexUsage,
  parseAnthropicUsage,
  parseGoogleQuota,
  parseGrokBilling,
  type Usage,
} from "./parse.ts";

export type ProviderStatus =
  | { name: string; usage: Usage }
  | { name: string; stale: string };

const CACHE_TTL_MS = 60_000;

// turn_start sits inline in pi's sequential turn pipeline (index.ts), so a
// provider request that never settles would wedge every subsequent turn.
// 5s is generous for a quota GET/POST yet short enough that a hang is never
// mistaken for a slow terminal.
const REQUEST_TIMEOUT_MS = 5_000;

// Signals AND races: the AbortSignal asks a well-behaved fetchImpl to cancel
// its connection, but the race against `timeout` is what actually frees the
// caller if fetchImpl ignores the signal or the connection is stuck below
// the point abort can reach — a stalled connection must still degrade to a
// stale marker, not hang fetchOne (and therefore fetchAll) forever.
async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    // Wrapped in .then() so a fetchImpl that throws synchronously (some
    // test doubles do) becomes a rejected promise instead of escaping this
    // try/finally before the timer is armed against Promise.race — an
    // uncleared timer here would reject `timeout` with no handler attached
    // once construction never reached Promise.race, crashing the process
    // five seconds later on an orphaned unhandled rejection.
    const request = Promise.resolve().then(() =>
      fetchImpl(url, { ...init, signal: controller.signal }),
    );
    // Once raced away, a request that eventually settles must not surface
    // as an unhandled rejection.
    request.catch(() => {});
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// tmpdir, never ~/.pi: that mount is shared live with the host and every
// other container, and cache churn does not belong in contended space.
// accountKey is hashed rather than embedded raw: /tmp is world-readable and
// the key is derived from a live credential's tail characters.
export function cachePathFor(provider: string, accountKey: string): string {
  const uid = String(process.getuid?.() ?? "nouid");
  const safe = crypto
    .createHash("sha256")
    .update(accountKey)
    .digest("hex")
    .slice(0, 16);
  return path.join(os.tmpdir(), "pi-usage", uid, provider, `${safe}.json`);
}

function isValidUsage(value: unknown): value is Usage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  return (
    finite(v.sessionPercent) &&
    finite(v.weeklyPercent) &&
    (v.resetsInSeconds === null || finite(v.resetsInSeconds)) &&
    (v.weeklyResetsInSeconds === undefined ||
      v.weeklyResetsInSeconds === null ||
      finite(v.weeklyResetsInSeconds))
  );
}

function readCache(file: string, nowMs: number): Usage | null {
  try {
    const entry = JSON.parse(fs.readFileSync(file, "utf-8"));
    const age = nowMs - entry.at;
    if (age < 0 || age >= CACHE_TTL_MS) return null;
    if (!isValidUsage(entry.usage)) return null;
    return {
      ...entry.usage,
      weeklyResetsInSeconds: entry.usage.weeklyResetsInSeconds ?? null,
    };
  } catch {
    return null;
  }
}

function writeCache(file: string, usage: Usage, nowMs: number): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Write-then-rename so a concurrent reader never sees a truncated file.
    const tmp = `${file}.tmp-${process.pid}-${nowMs}`;
    fs.writeFileSync(tmp, JSON.stringify({ at: nowMs, usage }));
    fs.renameSync(tmp, file);
  } catch {
    // Cache is an optimisation; losing it must never break the bar.
  }
}

// Consumer Antigravity (Google AI Plus) answers retrieveUserQuotaSummary
// with no project id. The old loadCodeAssist + retrieveUserQuota path is
// Gemini Code Assist for individuals and now returns UNSUPPORTED_CLIENT.
function googleHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "antigravity/1.1.13 linux/amd64",
    "X-Goog-Api-Client": "gl-node/22.17.0",
    "Client-Metadata": JSON.stringify({
      ideType: "ANTIGRAVITY",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    }),
  };
}

const GOOGLE_QUOTA_ENDPOINT =
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary";

async function requestCodex(
  token: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchWithTimeout(
    fetchImpl,
    "https://chatgpt.com/backend-api/wham/usage",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

async function requestClaude(
  token: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchWithTimeout(
    fetchImpl,
    "https://api.anthropic.com/api/oauth/usage",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    },
  );
}

async function requestGrok(
  token: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchWithTimeout(
    fetchImpl,
    "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    },
  );
}

async function requestAntigravity(
  token: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchWithTimeout(fetchImpl, GOOGLE_QUOTA_ENDPOINT, {
    method: "POST",
    headers: googleHeaders(token),
    body: "{}",
  });
}

const PROVIDERS = [
  {
    name: "grok",
    read: (nowMs: number) => readXaiCredential(undefined, nowMs),
    request: requestGrok,
    parse: (payload: unknown, nowMs: number) =>
      parseGrokBilling(payload, nowMs),
  },
  {
    name: "claude",
    read: (nowMs: number) => readAnthropicCredential(undefined, nowMs),
    request: requestClaude,
    parse: (payload: unknown, nowMs: number) =>
      parseAnthropicUsage(payload, nowMs),
  },
  {
    name: "codex",
    read: (nowMs: number) => readCodexCredential(undefined, nowMs),
    request: requestCodex,
    parse: (payload: unknown) => parseCodexUsage(payload),
  },
  {
    name: "antigravity",
    read: (nowMs: number) =>
      readAntigravityCredential(undefined, undefined, nowMs),
    request: requestAntigravity,
    parse: (payload: unknown, nowMs: number) =>
      parseGoogleQuota(payload, nowMs),
  },
] as const;

async function fetchOne(
  provider: (typeof PROVIDERS)[number],
  nowMs: number,
  fetchImpl: typeof fetch,
): Promise<ProviderStatus> {
  const credential = provider.read(nowMs);
  if ("stale" in credential) {
    return { name: provider.name, stale: credential.stale };
  }

  const cacheFile = cachePathFor(provider.name, credential.token.slice(-12));
  const cached = readCache(cacheFile, nowMs);
  if (cached) return { name: provider.name, usage: cached };

  let response: Response;
  try {
    response = await provider.request(credential.token, fetchImpl);
    if (!response.ok) {
      return { name: provider.name, stale: `http ${response.status}` };
    }
  } catch (error) {
    // Preserve the real reason (e.g. "missing projectId (try /login
    // again)") instead of flattening every failure into "unreachable".
    return {
      name: provider.name,
      stale: error instanceof Error ? error.message : "unreachable",
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { name: provider.name, stale: "unparseable body" };
  }

  let usage: Usage | null;
  try {
    usage = provider.parse(body, nowMs);
  } catch {
    usage = null;
  }
  if (!usage) return { name: provider.name, stale: "unrecognised payload" };

  writeCache(cacheFile, usage, nowMs);
  return { name: provider.name, usage };
}

export async function fetchAll(
  nowMs = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderStatus[]> {
  return Promise.all(PROVIDERS.map((p) => fetchOne(p, nowMs, fetchImpl)));
}
