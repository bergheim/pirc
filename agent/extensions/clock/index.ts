/**
 * Dim right-aligned HH:mm:ss after each TUI user/assistant message.
 * During a run, a live `took` line ticks on TUI redraws (working indicator).
 * After settle, a final wall-time line. Custom entries stay out of model context.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
    CLOCK_TYPE,
    clockDataForMessage,
    type ClockData,
} from "./entry.ts";
import { stampText } from "./format.ts";

export default function (pi: ExtensionAPI): void {
    let runStart: number | undefined;
    let liveEntryPending = false;

    pi.registerEntryRenderer<ClockData>(CLOCK_TYPE, (entry, _opts, theme) => {
        return {
            render(width: number) {
                const liveMs =
                    entry.data?.live && runStart !== undefined
                        ? performance.now() - runStart
                        : undefined;
                const raw = stampText(entry.data, liveMs);
                if (!raw) return [];
                const text = theme.fg("dim", raw);
                return [
                    " ".repeat(Math.max(0, width - visibleWidth(text))) + text,
                ];
            },
            invalidate() {},
        };
    });

    const reset = () => {
        runStart = undefined;
        liveEntryPending = false;
    };

    pi.on("session_start", reset);
    pi.on("session_shutdown", reset);

    pi.on("agent_start", (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        if (runStart === undefined) {
            runStart = performance.now();
            liveEntryPending = true;
        }
    });

    pi.on("message_end", (event, ctx) => {
        if (ctx.mode !== "tui") return;
        const { role, timestamp: t } = event.message;
        if (role !== "user" && role !== "assistant") return;
        if (!Number.isFinite(t)) return;
        const next = clockDataForMessage(role, t, liveEntryPending);
        liveEntryPending = next.liveEntryPending;
        // Persistence happens after message_end; defer so this entry stays below it.
        setTimeout(
            () => pi.appendEntry<ClockData>(CLOCK_TYPE, next.data),
            0,
        );
    });

    pi.on("agent_settled", (_event, ctx) => {
        const startedAt = runStart;
        runStart = undefined;
        liveEntryPending = false;
        if (ctx.mode !== "tui" || startedAt === undefined) return;
        pi.appendEntry<ClockData>(CLOCK_TYPE, {
            d: performance.now() - startedAt,
        });
    });
}
