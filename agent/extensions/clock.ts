/**
 * Dim right-aligned HH:mm:ss after each TUI user/assistant message.
 * Custom entries stay out of model context. Reload keeps them.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

const TYPE = "clock";

interface ClockData {
    t: number;
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
    pi.registerEntryRenderer<ClockData>(TYPE, (entry, _opts, theme) => {
        const t = entry.data?.t;
        if (!Number.isFinite(t)) return undefined;
        const text = theme.fg("dim", hhmmss(t));
        return {
            render(width: number) {
                return [
                    " ".repeat(Math.max(0, width - visibleWidth(text))) + text,
                ];
            },
            invalidate() {},
        };
    });

    pi.on("message_end", (event, ctx) => {
        if (ctx.mode !== "tui") return;
        const { role, timestamp: t } = event.message;
        if (role !== "user" && role !== "assistant") return;
        if (!Number.isFinite(t)) return;
        // message is persisted after this handler; append now and the clock sits above it
        setTimeout(() => pi.appendEntry<ClockData>(TYPE, { t }), 0);
    });
}
