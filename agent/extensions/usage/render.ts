export type Theme = { fg(color: string, text: string): string };

// barColor speaks red/yellow/green; the theme only knows semantic slots.
export const TONE = { red: "error", yellow: "warning", green: "success" } as const;

export type WindowUsage = {
  percent: number;
  resetsInSeconds: number | null;
};

export type CurrentSession = {
  provider: string;
  modelId: string;
  thinking: string | null;
  dir: string;
  branch: string | null;
  percent: number | null;
  tokens: number | null;
  contextWindow: number;
  cost: number;
  fiveHour: WindowUsage | null;
  week: WindowUsage | null;
};

export function renderBar(usedPercent: number, width = 10): string {
  width = Math.max(0, width); // negative layout width would throw in repeat()
  const clamped = Number.isFinite(usedPercent) ? Math.max(0, Math.min(100, usedPercent)) : 0;
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

export function formatK(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  return `${Math.round(n / 1000)}k`;
}

type Segment = { key: string; plain: string; tone: string | null; keep: number };

function modelTag(session: CurrentSession): string {
  const think = session.thinking ? ` ${session.thinking}` : "";
  return `[${session.provider}/${session.modelId}${think}]`;
}

function windowPlain(label: string, win: WindowUsage): string {
  const reset = win.resetsInSeconds === null ? "" : `→${formatDuration(win.resetsInSeconds)}`;
  return `${label} ${Math.round(win.percent)}%${reset}`;
}

export function currentLineSegments(session: CurrentSession): Segment[] {
  const percentLabel = session.percent === null ? "?" : `${Math.round(session.percent)}`;
  const tokenLabel = session.tokens === null ? "?" : formatK(session.tokens);
  const segs: Segment[] = [
    { key: "model", plain: modelTag(session), tone: "accent", keep: 100 },
  ];
  if (session.dir) segs.push({ key: "dir", plain: session.dir, tone: null, keep: 20 });
  if (session.branch) segs.push({ key: "branch", plain: session.branch, tone: "dim", keep: 10 });
  segs.push({
    key: "bar",
    plain: `${renderBar(session.percent ?? 0)} ${percentLabel}%`,
    tone: session.percent === null ? "dim" : TONE[barColor(session.percent)],
    keep: 80,
  });
  segs.push({
    key: "tokens",
    plain: `(${tokenLabel}/${formatK(session.contextWindow)})`,
    tone: "dim",
    keep: 70,
  });
  if (session.fiveHour) {
    segs.push({
      key: "five",
      plain: windowPlain("5h", session.fiveHour),
      tone: TONE[barColor(session.fiveHour.percent)],
      keep: 60,
    });
  }
  if (session.week) {
    segs.push({
      key: "week",
      plain: windowPlain("7d", session.week),
      tone: TONE[barColor(session.week.percent)],
      keep: 50,
    });
  }
  segs.push({
    key: "cost",
    plain: `$${session.cost.toFixed(2)}`,
    tone: "warning",
    keep: 5,
  });
  return segs;
}

function segmentsWidth(segs: Segment[]): number {
  if (segs.length === 0) return 0;
  return segs.reduce((n, s) => n + s.plain.length, 0) + (segs.length - 1);
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
    included[0] = { ...included[0], plain: included[0].plain.slice(0, safeWidth) };
  }
  return included;
}

function paint(theme: Theme, seg: Segment): string {
  return seg.tone ? theme.fg(seg.tone, seg.plain) : seg.plain;
}

export function renderCurrentLine(
  theme: Theme,
  session: CurrentSession,
  width: number,
): string {
  return fitSegments(currentLineSegments(session), width)
    .map((s) => paint(theme, s))
    .join(" ");
}
