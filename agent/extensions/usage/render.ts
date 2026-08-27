export type Theme = {
    fg(color: string, text: string): string;
    bold(text: string): string;
};

// barColor is silent below 70%; the theme only knows semantic slots.
export const TONE = {
    red: "error",
    yellow: "warning",
} as const;

export type CurrentSession = {
    provider: string;
    modelId: string;
    thinking: string | null;
    cwd?: string | null;
    dir: string;
    branch: string | null;
    dirty: boolean;
    percent: number | null;
    tokens: number | null;
    contextWindow: number | null;
    cost: number;
    cacheRemainingSeconds: number | null;
    cacheTtlSeconds: number | null;
    quota: string | null;
    quotaPercent: number | null;
};

export function renderBar(usedPercent: number, width = 10): string {
    width = Math.max(0, width); // negative layout width would throw in repeat()
    const clamped = Number.isFinite(usedPercent)
        ? Math.max(0, Math.min(100, usedPercent))
        : 0;
    const filled = Math.round((clamped / 100) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
}

export function barColor(usedPercent: number): "yellow" | "red" | null {
    if (usedPercent >= 90) return "red";
    if (usedPercent >= 70) return "yellow";
    return null;
}

export function contextTone(
    tokens: number | null,
    contextWindow: number | null,
): string | null {
    if (
        tokens === null ||
        contextWindow === null ||
        !Number.isFinite(contextWindow) ||
        contextWindow <= 0
    )
        return "dim";
    if (tokens >= contextWindow) return TONE.red;
    if (tokens >= contextWindow * 0.4) return TONE.yellow;
    return null;
}

export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0s"; // untrusted API value: clamp to "resets now" instead of leaking NaN/Infinity/negatives
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    const hours = Math.floor(seconds / 3600);
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
] as const;

function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

function startOfLocalDay(ms: number): number {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Local wall clock: same day is HH:MM, this week is "Sun 12:07", else "24 Aug 12:07".
export function formatLocalWhen(atMs: number, nowMs: number): string {
    if (!Number.isFinite(atMs) || !Number.isFinite(nowMs)) return "0s";
    const at = new Date(atMs);
    const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
    const dayDiff = Math.round(
        (startOfLocalDay(atMs) - startOfLocalDay(nowMs)) / 86_400_000,
    );
    if (dayDiff === 0) return time;
    if (dayDiff > 0 && dayDiff < 7) return `${WEEKDAYS[at.getDay()]} ${time}`;
    return `${pad2(at.getDate())} ${MONTHS[at.getMonth()]} ${time}`;
}

export function formatResetWhen(
    seconds: number,
    measuredAtMs: number,
    nowMs = measuredAtMs,
): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0s";
    const atMs = measuredAtMs + seconds * 1000;
    return `${formatLocalWhen(atMs, nowMs)} (${formatDuration((atMs - nowMs) / 1000)})`;
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

export function cacheTone(
    remainingSeconds: number,
    ttlSeconds: number,
): string {
    const red = Math.min(ttlSeconds * 0.1, 120);
    const yellow = Math.min(ttlSeconds * 0.4, 600);
    if (remainingSeconds < red) return TONE.red;
    if (remainingSeconds < yellow) return TONE.yellow;
    return "dim";
}

// Anthropic: 5m, or 1h when PI_CACHE_RETENTION=long.
// OpenAI GPT-5.6+: 30m only. Older OpenAI/Codex: 5m in-memory floor;
// long 24h retention still typically ~30m, so show 30m not 24h.
// Grok/Gemini: no published implicit TTL.
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
    if (openai) {
        if (/gpt-5\.[6-9]|gpt-[6-9]/.test(id)) return 1800;
        return long ? 1800 : 300;
    }
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
    if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
    return `${Number((n / 1_000_000).toFixed(2))}m`;
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

export function locationLineSegments(session: CurrentSession): Segment[] {
    const segs: Segment[] = [];
    if (session.cwd)
        segs.push({
            key: "cwd",
            plain: ` ${session.cwd}`,
            tone: "accent",
            keep: 70,
        });
    if (session.dir)
        segs.push({
            key: "dir",
            plain: ` ${session.dir}`,
            tone: "accent",
            keep: 90,
        });
    if (session.branch)
        segs.push({
            key: "branch",
            plain: ` ${session.branch}${session.dirty ? " ●" : ""}`,
            tone: null,
            keep: 80,
        });
    const percentLabel =
        session.percent === null ? "?" : `${Math.round(session.percent)}`;
    const usedLabel = session.tokens === null ? "?" : formatK(session.tokens);
    const budgetLabel =
        session.contextWindow === null ? "?" : formatK(session.contextWindow);
    segs.push({
        key: "context",
        plain: `󰍛 ctx ${percentLabel}% ${usedLabel}/${budgetLabel}`,
        tone: contextTone(session.tokens, session.contextWindow),
        keep: 100,
    });
    if (
        session.cacheRemainingSeconds !== null &&
        session.cacheTtlSeconds !== null
    ) {
        segs.push({
            key: "cache",
            plain: `󰒍 cache ${formatRemaining(session.cacheRemainingSeconds)}`,
            tone: cacheTone(
                session.cacheRemainingSeconds,
                session.cacheTtlSeconds,
            ),
            keep: 95,
        });
    }
    return segs;
}

export function currentLineSegments(session: CurrentSession): Segment[] {
    const segs: Segment[] = [
        { key: "model", plain: modelTag(session), tone: "accent", keep: 100 },
    ];
    if (session.thinking)
        segs.push({
            key: "thinking",
            plain: `󰔛 ${session.thinking}`,
            tone: "accent",
            keep: 99,
        });
    if (session.quota) {
        const color = barColor(session.quotaPercent ?? 0);
        segs.push({
            key: "quota",
            plain: session.quota,
            tone: color ? TONE[color] : "dim",
            keep: 95,
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

function renderLine(theme: Theme, segs: Segment[], width: number): string {
    return fitSegments(segs, width)
        .map((s) => paint(theme, s))
        .join(theme.fg("dim", " · "));
}

export function renderLocationLine(
    theme: Theme,
    session: CurrentSession,
    width: number,
): string {
    return renderLine(theme, locationLineSegments(session), width);
}

export function renderCurrentLine(
    theme: Theme,
    session: CurrentSession,
    width: number,
): string {
    return renderLine(theme, currentLineSegments(session), width);
}
