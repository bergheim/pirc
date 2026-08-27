/**
 * Dim right-aligned HH:mm:ss after each TUI user/assistant message.
 * After the run settles, a second line shows wall time (tools + retries).
 * Custom entries stay out of model context. Reload keeps them.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CLOCK_TYPE, type ClockData } from "./entry.ts";
import { formatDuration } from "./format.ts";

function stampText(data: ClockData | undefined): string {
    const parts: string[] = [];
    if (Number.isFinite(data?.t)) parts.push(hhmmss(data.t as number));
    if (Number.isFinite(data?.d)) {
        const dur = formatDuration(data.d as number);
        if (dur) parts.push(`took ${dur}`);
    }
    return parts.join(" · ");
}

function hhmmss(t: number): string {
    return new Date(t).toLocaleTimeString("en-GB", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

export default function (pi: ExtensionAPI): void {
    let runStart: number | undefined;

    pi.registerEntryRenderer<ClockData>(CLOCK_TYPE, (entry, _opts, theme) => {
        const raw = stampText(entry.data);
        if (!raw) return undefined;
        const text = theme.fg("dim", raw);
        return {
            render(width: number) {
                return [
                    " ".repeat(Math.max(0, width - visibleWidth(text))) + text,
                ];
            },
            invalidate() {},
        };
    });

    const reset = () => {
        runStart = undefined;
    };

    pi.on("session_start", reset);
    pi.on("session_shutdown", reset);

    pi.on("agent_start", (_event, ctx) => {
        if (ctx.mode === "tui") runStart ??= performance.now();
    });

    pi.on("message_end", (event, ctx) => {
        if (ctx.mode !== "tui") return;
        const { role, timestamp: t } = event.message;
        if (role !== "user" && role !== "assistant") return;
        if (!Number.isFinite(t)) return;
        // message is persisted after this handler; append now and the clock sits above it
        setTimeout(() => pi.appendEntry<ClockData>(CLOCK_TYPE, { t }), 0);
    });

    pi.on("agent_settled", (_event, ctx) => {
        const startedAt = runStart;
        runStart = undefined;
        if (ctx.mode !== "tui" || startedAt === undefined) return;
        pi.appendEntry<ClockData>(CLOCK_TYPE, { d: performance.now() - startedAt });
    });
}
