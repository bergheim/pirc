export type Usage = {
  sessionPercent: number;
  weeklyPercent: number;
  resetsInSeconds: number | null;
  weeklyResetsInSeconds: number | null;
  // Codex primary is usually 5h, but some plans only return a weekly
  // bucket. False hides the footer 5h segment so we don't lie.
  sessionIsFiveHour?: boolean;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Ported from the reference's readPercentCandidate. Providers disagree on
// whether "used" is 0-100 or 0-1; non-integer values in [0,1] are treated as
// fractions and rescaled. 0 and 1 are integers, so they pass through as
// literal 1% (not rescaled to 100%) — the boundary the reference chose for
// the genuinely ambiguous case. Anything outside [0,100] is rejected rather
// than clamped, so a bogus 250 doesn't render as a full bar.
function percent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) {
    return Number.isInteger(value) ? value : value * 100;
  }
  return value >= 0 && value <= 100 ? value : null;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type CodexWindow = {
  percent: number;
  resets: number | null;
  duration: number | null;
};

function readCodexWindow(raw: unknown): CodexWindow | null {
  const window = obj(raw);
  if (!window) return null;
  const used = percent(window.used_percent);
  if (used === null) return null;
  return {
    percent: used,
    resets: num(window.reset_after_seconds),
    duration: num(window.limit_window_seconds),
  };
}

// chatgpt.com/backend-api/wham/usage:
// { rate_limit: { primary_window: { used_percent, reset_after_seconds,
//                                   limit_window_seconds },
//                  secondary_window: { ... } | null } }
// Do not assume primary=5h: some plans only return a weekly primary.
export function parseCodexUsage(payload: unknown): Usage | null {
  const rateLimit = obj(obj(payload)?.rate_limit);
  if (!rateLimit) return null;
  const primary = readCodexWindow(rateLimit.primary_window);
  const secondary = readCodexWindow(rateLimit.secondary_window);
  const windows = [primary, secondary].filter(
    (w): w is CodexWindow => w !== null,
  );
  if (windows.length === 0) return null;

  const short = windows.find(
    (w) => w.duration !== null && w.duration <= 6 * 3600,
  );
  const long = windows.find(
    (w) => w.duration !== null && w.duration > 6 * 3600,
  );
  if (short && long) {
    return {
      sessionPercent: short.percent,
      weeklyPercent: long.percent,
      resetsInSeconds: short.resets,
      weeklyResetsInSeconds: long.resets,
      sessionIsFiveHour: true,
    };
  }
  const only = short ?? long;
  if (only) {
    return {
      sessionPercent: only.percent,
      weeklyPercent: only.percent,
      resetsInSeconds: only.resets,
      weeklyResetsInSeconds: only.resets,
      sessionIsFiveHour: Boolean(short),
    };
  }

  if (!primary) return null;
  return {
    sessionPercent: primary.percent,
    weeklyPercent: secondary?.percent ?? primary.percent,
    resetsInSeconds: primary.resets,
    weeklyResetsInSeconds: secondary?.resets ?? null,
    sessionIsFiveHour: true,
  };
}

function secondsUntil(isoDate: string, nowMs: number): number | null {
  const target = new Date(isoDate).getTime();
  if (!Number.isFinite(target)) return null;
  return Math.max(0, Math.round((target - nowMs) / 1000));
}

// api.anthropic.com/api/oauth/usage:
// { five_hour: { utilization, resets_at (ISO string) },
//   seven_day: { utilization, resets_at } }
// Unrelated to Codex's rate_limit.*_window shape, so this does not delegate
// to parseCodexUsage. resets_at is an absolute timestamp rather than a
// duration, so nowMs is accepted (defaulting live, fixed in tests) to
// convert it to seconds-until-reset.
export function parseAnthropicUsage(
  payload: unknown,
  nowMs = Date.now(),
): Usage | null {
  const body = obj(payload);
  if (!body) return null;
  const fiveHour = obj(body.five_hour);
  const session = percent(fiveHour?.utilization);
  if (session === null) return null;
  const sevenDay = obj(body.seven_day);
  const resetsAt =
    typeof fiveHour?.resets_at === "string" ? fiveHour.resets_at : null;
  const weekResetsAt =
    typeof sevenDay?.resets_at === "string" ? sevenDay.resets_at : null;
  return {
    sessionPercent: session,
    weeklyPercent: percent(sevenDay?.utilization) ?? session,
    resetsInSeconds: resetsAt ? secondsUntil(resetsAt, nowMs) : null,
    weeklyResetsInSeconds: weekResetsAt
      ? secondsUntil(weekResetsAt, nowMs)
      : null,
  };
}

function usedPercent(bucket: unknown): number | null {
  const remaining = num(obj(bucket)?.remainingFraction);
  if (remaining === null) return null;
  return (1 - Math.max(0, Math.min(1, remaining))) * 100;
}

function mostUsed(buckets: unknown[]): number | null {
  let best: number | null = null;
  for (const bucket of buckets) {
    const used = usedPercent(bucket);
    if (used !== null && (best === null || used > best)) best = used;
  }
  return best;
}

// cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota:
// { buckets: [{ tokenType, modelId, remainingFraction }] } — not the
// top-level `quotaBuckets` originally guessed. Buckets are filtered to
// tokenType "REQUESTS" (falling back to all buckets when none match), then
// split into gemini-pro (session) and gemini-flash (weekly) groups,
// mirroring the gemini branch of the reference's per-model bucket
// selection. The antigravity branch also weighs claude-model buckets, which
// needs a provider hint this single-arg parser doesn't take.
export function parseGoogleQuota(payload: unknown): Usage | null {
  const buckets = obj(payload)?.buckets;
  if (!Array.isArray(buckets) || buckets.length === 0) return null;

  const requestBuckets = buckets.filter(
    (b) => String(obj(b)?.tokenType ?? "").toUpperCase() === "REQUESTS",
  );
  const pool = requestBuckets.length ? requestBuckets : buckets;

  const modelId = (b: unknown) => String(obj(b)?.modelId ?? "").toLowerCase();
  const geminiPro = pool.filter(
    (b) => modelId(b).includes("gemini") && modelId(b).includes("pro"),
  );
  const geminiFlash = pool.filter(
    (b) => modelId(b).includes("gemini") && modelId(b).includes("flash"),
  );

  const session =
    mostUsed(geminiPro) ?? mostUsed(geminiFlash) ?? mostUsed(pool);
  if (session === null) return null;
  const weekly =
    mostUsed(geminiFlash) ?? mostUsed(geminiPro) ?? mostUsed(pool) ?? session;

  return {
    sessionPercent: Math.round(session),
    weeklyPercent: Math.round(weekly),
    resetsInSeconds: null,
    weeklyResetsInSeconds: null,
  };
}

// cli-chat-proxy.grok.com/v1/billing?format=credits:
// { config: { creditUsagePercent, currentPeriod: { type, end } } }
// SuperGrok is a weekly credit pool — no 5h window. sessionPercent is
// copied from weekly so the overview bar still has something to draw.
export function parseGrokBilling(
  payload: unknown,
  nowMs = Date.now(),
): Usage | null {
  const config = obj(obj(payload)?.config);
  if (!config) return null;
  const weekly = percent(config.creditUsagePercent);
  if (weekly === null) return null;
  const period = obj(config.currentPeriod);
  const end = typeof period?.end === "string" ? period.end : null;
  return {
    sessionPercent: weekly,
    weeklyPercent: weekly,
    resetsInSeconds: null,
    weeklyResetsInSeconds: end ? secondsUntil(end, nowMs) : null,
  };
}
