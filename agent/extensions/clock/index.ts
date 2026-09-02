/**
 * Dim right-aligned HH:mm:ss after each TUI user/assistant message, plus a final
 * duration at settle. Elapsed time ticks on the working line, not in the transcript:
 * changing a transcript line above the viewport makes pi-tui clear and repaint the
 * whole screen, which visibly flashes. Custom entries stay out of model context.
 */
import type {
    ExtensionAPI,
    ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CLOCK_TYPE, type ClockData } from "./entry.ts";
import { CLOCK_LIVE, formatDuration, stampText } from "./format.ts";

function rightAlign(text: string, width: number): string {
    return " ".repeat(Math.max(0, width - visibleWidth(text))) + text;
}

export default function (pi: ExtensionAPI): void {
    let runStart: number | undefined;
    let ticker: ReturnType<typeof setInterval> | undefined;

    pi.registerEntryRenderer<ClockData>(CLOCK_TYPE, (entry, _opts, theme) => {
        return {
            render(width: number) {
                const raw = stampText(entry.data);
                if (!raw) return [];
                return [rightAlign(theme.fg("dim", raw), width)];
            },
            invalidate() {},
        };
    });

    const stopTicker = (ctx: ExtensionContext) => {
        if (ticker !== undefined) clearInterval(ticker);
        ticker = undefined;
        if (ctx.hasUI) ctx.ui.setWorkingMessage();
    };

    const reset = (_event: unknown, ctx: ExtensionContext) => {
        runStart = undefined;
        stopTicker(ctx);
    };

    pi.on("session_start", reset);
    pi.on("session_shutdown", reset);

    pi.on("agent_start", (_event, ctx) => {
        if (ctx.mode !== "tui" || runStart !== undefined) return;
        const startedAt = performance.now();
        runStart = startedAt;
        const paint = () => {
            const secs = Math.floor((performance.now() - startedAt) / 1000);
            const elapsed = secs ? formatDuration(secs * 1000) : "0s";
            ctx.ui.setWorkingMessage(`Working... ${CLOCK_LIVE} ${elapsed}`);
        };
        paint();
        ticker = setInterval(paint, 1000);
    });

    pi.on("message_end", (event, ctx) => {
        if (ctx.mode !== "tui") return;
        const { role, timestamp: t } = event.message;
        if (role !== "user" && role !== "assistant") return;
        if (!Number.isFinite(t)) return;
        // Persistence happens after message_end; defer so this entry stays below it.
        setTimeout(() => pi.appendEntry<ClockData>(CLOCK_TYPE, { t }), 0);
    });

    pi.on("agent_settled", (_event, ctx) => {
        const startedAt = runStart;
        runStart = undefined;
        stopTicker(ctx);
        if (ctx.mode !== "tui" || startedAt === undefined) return;
        pi.appendEntry<ClockData>(CLOCK_TYPE, {
            d: performance.now() - startedAt,
        });
    });
}
