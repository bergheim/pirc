import type { ClockData } from "./entry.ts";

export function hhmmss(t: number): string {
    return new Date(t).toLocaleTimeString("en-GB", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

export function stampText(
    data: ClockData | undefined,
    liveMs?: number,
): string {
    const parts: string[] = [];
    if (Number.isFinite(data?.t)) parts.push(hhmmss(data.t as number));
    const durMs = Number.isFinite(data?.d) ? (data.d as number) : liveMs;
    if (Number.isFinite(durMs)) {
        const dur = formatDuration(durMs as number);
        if (dur) parts.push(`took ${dur}`);
    }
    return parts.join(" · ");
}

export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return "";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
}
