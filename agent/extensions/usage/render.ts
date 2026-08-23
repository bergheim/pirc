export type Theme = {
  fg(color: string, text: string): string;
  bold(text: string): string;
};

// barColor speaks red/yellow/green; the theme only knows semantic slots.
export const TONE = {
  red: "error",
  yellow: "warning",
  green: "success",
} as const;

export type CurrentSession = {
  provider: string;
  modelId: string;
  thinking: string | null;
  dir: string;
  branch: string | null;
  dirty: boolean;
  percent: number | null;
  contextWindow: number;
  cost: number;
  cacheRemainingSeconds: number | null;
};

export function renderBar(usedPercent: number, width = 10): string {
  width = Math.max(0, width); // negative layout width would throw in repeat()
  const clamped = Number.isFinite(usedPercent)
    ? Math.max(0, Math.min(100, usedPercent))
    : 0;
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function barColor(usedPercent: number): "green" | "yellow" | "red" {
  if (usedPercent >= 90) return "red";
  if (usedPercent >= 70) return "yellow";
  return "green";
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0s"; // untrusted API value: clamp to "resets now" instead of leaking NaN/Infinity/negatives
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ccusage-style remaining: keep minutes on an hour so "2h 45m left" isn't flattened to "2h".
export function formatRemaining(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0s";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60);
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function cacheTone(remainingSeconds: number): string {
  if (remainingSeconds < 30) return TONE.red;
  if (remainingSeconds < 120) return TONE.yellow;
  return "dim";
}

// Anthropic short=5m, long=1h. OpenAI short is in-memory (no timer). OpenAI long=24h.
export function promptCacheTtlSeconds(
  provider: string,
  modelId: string,
  retention = process.env.PI_CACHE_RETENTION,
): number | null {
  if (retention === "none") return null;
  const long = retention === "long";
  const id = `${provider}/${modelId}`.toLowerCase();
  const anthropic =
    provider === "anthropic" ||
    provider === "amazon-bedrock" ||
    id.includes("anthropic") ||
    id.includes("claude");
  const openai =
    provider === "openai" ||
    provider === "openai-codex" ||
    provider === "azure-openai-responses" ||
    /(?:^|\/)openai(?:\/|$)|gpt-|codex/.test(id);
  if (anthropic) return long ? 3600 : 300;
  if (openai) return long ? 86400 : null;
  return null;
}

export function cacheRemainingSeconds(
  lastWriteAtMs: number | null,
  ttlSeconds: number | null,
  nowMs: number,
): number | null {
  if (lastWriteAtMs === null || ttlSeconds === null) return null;
  if (!Number.isFinite(lastWriteAtMs) || !Number.isFinite(ttlSeconds))
    return null;
  const left = ttlSeconds - (nowMs - lastWriteAtMs) / 1000;
  if (left <= 0) return null;
  return Math.ceil(left);
}

// Nerd Font glyphs sit above the BMP: one terminal cell, two UTF-16 units.
// Measure and cut by code point so the footer neither under-fills nor slices
// a surrogate pair in half.
export function cells(s: string): number {
  return Array.from(s).length;
}

export function clip(s: string, width: number): string {
  return Array.from(s).slice(0, Math.max(0, width)).join("");
}

export function formatK(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  return `${Math.round(n / 1000)}k`;
}

type Segment = {
  key: string;
  plain: string;
  tone: string | null;
  keep: number;
};

function modelTag(session: CurrentSession): string {
  return `󰚩 ${session.provider}/${session.modelId}`;
}

export function currentLineSegments(session: CurrentSession): Segment[] {
  const percentLabel =
    session.percent === null ? "?" : `${Math.round(session.percent)}`;
  const segs: Segment[] = [
    { key: "model", plain: modelTag(session), tone: "accent", keep: 100 },
  ];
  if (session.thinking)
    segs.push({
      key: "thinking",
      plain: `󰔛 ${session.thinking}`,
      tone: "dim",
      keep: 70,
    });
  if (session.dir)
    segs.push({
      key: "dir",
      plain: ` ${session.dir}`,
      tone: "accent",
      keep: 85,
    });
  if (session.branch)
    segs.push({
      key: "branch",
      plain: ` ${session.branch}${session.dirty ? " ●" : ""}`,
      tone: null,
      keep: 80,
    });
  segs.push({
    key: "context",
    plain: `󰍛 ctx ${percentLabel}%/${formatK(session.contextWindow)}`,
    tone: session.percent === null ? "dim" : TONE[barColor(session.percent)],
    keep: 90,
  });
  if (session.cacheRemainingSeconds !== null) {
    segs.push({
      key: "cache",
      plain: `󰒍 cache ${formatRemaining(session.cacheRemainingSeconds)}`,
      tone: cacheTone(session.cacheRemainingSeconds),
      keep: 55,
    });
  }
  segs.push({
    key: "cost",
    plain: `󰔚 $${session.cost.toFixed(2)}`,
    tone: "warning",
    keep: 5,
  });
  return segs;
}

function segmentsWidth(segs: Segment[]): number {
  if (segs.length === 0) return 0;
  return segs.reduce((n, s) => n + cells(s.plain), 0) + (segs.length - 1) * 3;
}

export function fitSegments(segs: Segment[], width: number): Segment[] {
  const safeWidth = Math.max(0, width);
  const included = segs.slice();
  while (included.length > 1 && segmentsWidth(included) > safeWidth) {
    let dropAt = 0;
    for (let i = 1; i < included.length; i++) {
      if (included[i].keep < included[dropAt].keep) dropAt = i;
    }
    if (included[dropAt].keep >= 100) break;
    included.splice(dropAt, 1);
  }
  if (included.length === 1 && segmentsWidth(included) > safeWidth) {
    included[0] = {
      ...included[0],
      plain: clip(included[0].plain, safeWidth),
    };
  }
  return included;
}

function paint(theme: Theme, seg: Segment): string {
  const text = seg.key === "model" ? theme.bold(seg.plain) : seg.plain;
  return seg.tone ? theme.fg(seg.tone, text) : text;
}

export function renderCurrentLine(
  theme: Theme,
  session: CurrentSession,
  width: number,
): string {
  return fitSegments(currentLineSegments(session), width)
    .map((s) => paint(theme, s))
    .join(theme.fg("dim", " · "));
}
