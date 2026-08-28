import { execFile } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ForkDeps, herdrFork, type RunResult } from "./logic.ts";

function run(cmd: string, args: string[]): Promise<RunResult> {
    return new Promise((resolve) => {
        execFile(
            cmd,
            args,
            { encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024 },
            (error, stdout, stderr) => {
                const status =
                    error && typeof error.code === "number"
                        ? error.code
                        : error
                          ? 127
                          : 0;
                resolve({ status, stdout: stdout ?? "", stderr: stderr ?? "" });
            },
        );
    });
}

function canonical(p: string): string {
    try {
        return realpathSync(p);
    } catch {
        return p;
    }
}

function fileId(p: string): string | undefined {
    try {
        const s = statSync(p);
        return `${s.dev}:${s.ino}`;
    } catch {
        return undefined;
    }
}

function isRegularFile(p: string): boolean {
    try {
        return statSync(p).isFile();
    } catch {
        return false;
    }
}

function inContainer(): boolean {
    return (
        existsSync("/.dockerenv") ||
        !!process.env.DEVCONTAINER ||
        !!process.env.REMOTE_CONTAINERS ||
        !!process.env.CODESPACES
    );
}

let running = false;

export default function (pi: ExtensionAPI) {
    pi.registerCommand("herdr-fork", {
        description:
            "Clone this session into a new Herdr worktree workspace. The optional argument is BOTH the compact prompt for the clone AND the source of the branch slug.",
        handler: async (args, ctx) => {
            if (running) {
                ctx.ui.notify("/herdr-fork is already running.", "error");
                return;
            }
            running = true;
            try {
                await ctx.waitForIdle();
                const entries = ctx.sessionManager.getEntries();
                const deps: ForkDeps = {
                    run,
                    env: process.env,
                    cwd: ctx.cwd,
                    session: {
                        file: ctx.sessionManager.getSessionFile(),
                        leafId: ctx.sessionManager.getLeafId(),
                        lastEntryId: entries[entries.length - 1]?.id ?? null,
                    },
                    canonical,
                    fileId,
                    isRegularFile,
                    piConfigDir: join(homedir(), ".pi"),
                    inContainer: inContainer(),
                    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
                };
                const outcome = await herdrFork(args, deps);
                ctx.ui.notify(outcome.message, outcome.ok ? "info" : "error");
            } finally {
                running = false;
            }
        },
    });
}
