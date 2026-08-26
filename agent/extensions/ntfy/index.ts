/**
 * TUI settle: CSI 5 t + BEL (WM urgent). ntfy if the turn is slow, or on quit.
 * Jolo: AGENT=pi notify. Host: POST $NTFY_SERVER / $PI_NTFY_TOPIC (default pi).
 */
import { spawn, spawnSync } from "node:child_process";
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    type Cycle,
    hostTopic,
    ntfyUrl,
    onAgentStart,
    onSessionStart,
    onSettled,
    onShutdown,
    parseThreshold,
    titleFor,
} from "./logic.ts";

const hasNotify =
    spawnSync("sh", ["-c", "command -v notify"], { stdio: "ignore" }).status ===
    0;

function runNotify(args: string[]): Promise<void> {
    return new Promise((resolve) => {
        const child = spawn("notify", args, {
            env: { ...process.env, AGENT: "pi" },
            stdio: "ignore",
            timeout: 8000,
        });
        child.on("error", () => resolve());
        child.on("close", () => resolve());
    });
}

function gitSubject(): string {
    const result = spawnSync("git", ["log", "-1", "--pretty=%s"], {
        encoding: "utf8",
        timeout: 2000,
    });
    return result.status === 0 ? result.stdout.trim() : "";
}

async function postHost(elapsedSec?: number): Promise<void> {
    const server = process.env.NTFY_SERVER;
    if (!server) return;
    const title = titleFor(basename(process.cwd()), elapsedSec);
    try {
        await fetch(ntfyUrl(server, hostTopic(process.env.PI_NTFY_TOPIC)), {
            method: "POST",
            headers: {
                Title: title,
                Priority: "default",
                Tags: "robot,checkmark",
            },
            body: gitSubject(),
            signal: AbortSignal.timeout(5000),
        });
    } catch {
        // ntfy is best-effort
    }
}

export default function (pi: ExtensionAPI): void {
    let cycle: Cycle = { tui: false };

    pi.on("session_start", (_event, ctx) => {
        cycle = onSessionStart(ctx.mode);
    });

    pi.on("agent_start", () => {
        const next = onAgentStart(cycle, Date.now());
        cycle = next.cycle;
        if (next.stamp && hasNotify) void runNotify(["stamp"]);
    });

    pi.on("agent_settled", async () => {
        const threshold = parseThreshold(process.env.PI_NTFY_THRESHOLD);
        const wasTui = cycle.tui;
        const next = onSettled(cycle, Date.now(), threshold);
        cycle = next.cycle;
        if (!wasTui) return;
        if (process.stdout.isTTY) process.stdout.write("\x1b[5t\x07");
        if (hasNotify) {
            void runNotify(["--if-slow", String(threshold)]);
            return;
        }
        if (next.notify) await postHost(next.elapsed);
    });

    pi.on("session_shutdown", async (event) => {
        const quit = onShutdown(cycle, event.reason);
        cycle = { tui: cycle.tui };
        if (!quit) return;
        if (hasNotify) await runNotify([]);
        else await postHost();
    });
}
