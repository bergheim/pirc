export type Cycle = {
    tui: boolean;
    startedAt?: number;
};

export function formatElapsed(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "";
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    if (s < 3600) {
        const m = Math.floor(s / 60);
        const rs = s % 60;
        return rs ? `${m}m ${rs}s` : `${m}m`;
    }
    const h = Math.floor(s / 3600);
    const rm = Math.floor((s % 3600) / 60);
    return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function parseThreshold(raw: string | undefined): number {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 60;
}

export function hostTopic(raw: string | undefined): string {
    const topic = raw?.trim();
    return topic || "pi";
}

export function ntfyUrl(server: string, topic: string): string {
    return `${server.replace(/\/$/, "")}/${encodeURIComponent(topic)}`;
}

export function titleFor(project: string, elapsedSec?: number): string {
    const elapsed =
        elapsedSec === undefined ? "" : ` (${formatElapsed(elapsedSec)})`;
    return `${project} - pi done${elapsed}`;
}

export function onSessionStart(mode: string): Cycle {
    return { tui: mode === "tui" };
}

export function onAgentStart(
    cycle: Cycle,
    now: number,
): { cycle: Cycle; stamp: boolean } {
    if (!cycle.tui || cycle.startedAt !== undefined) {
        return { cycle, stamp: false };
    }
    return { cycle: { ...cycle, startedAt: now }, stamp: true };
}

export function onSettled(
    cycle: Cycle,
    now: number,
    threshold: number,
): { cycle: Cycle; notify: boolean; elapsed?: number } {
    const startedAt = cycle.startedAt;
    const next = { ...cycle, startedAt: undefined };
    if (!cycle.tui || startedAt === undefined) {
        return { cycle: next, notify: false };
    }
    const elapsed = (now - startedAt) / 1000;
    return { cycle: next, notify: elapsed > threshold, elapsed };
}

export function onShutdown(cycle: Cycle, reason: string): boolean {
    return cycle.tui && reason === "quit";
}
