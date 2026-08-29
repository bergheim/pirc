import {
    DynamicBorder,
    type ExtensionAPI,
    type ExtensionContext,
    truncateHead,
} from "@earendil-works/pi-coding-agent";
import {
    Container,
    type SelectItem,
    SelectList,
    Text,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

type JobState = "queued" | "running" | "done" | "error";

interface JobStatus {
    id: string;
    label: string;
    state: JobState;
    phase?: string;
    current?: number;
    total?: number;
    unit?: string;
    message?: string;
    result?: unknown;
}

interface Watch {
    id: string;
    label: string;
    program: string;
    args: string[];
    intervalMs: number;
    timer?: ReturnType<typeof setInterval>;
    ctx: ExtensionContext;
    lastNoticeAt: number;
    line?: string;
    failures: number;
    inFlight: boolean;
    terminal: boolean;
}

// Same timer glyph the clock extension uses; duplicated to keep the extensions independent.
const TIMER_ICON = "󰔛";

// A wake message rides straight into context, so a job that returns a huge blob
// gets clipped well below the 50KB tool-output ceiling.
const MAX_RESULT_BYTES = 4_000;
const MAX_RESULT_LINES = 40;

const STATES = new Set<JobState>(["queued", "running", "done", "error"]);

function parseStatus(stdout: string, expectedId: string): JobStatus {
    const value: unknown = JSON.parse(stdout);
    if (!value || typeof value !== "object")
        throw new Error("probe output is not an object");

    const status = value as Record<string, unknown>;
    if (status.id !== expectedId) {
        throw new Error(
            `stale/wrong run: expected ${expectedId}, got ${String(status.id)}`,
        );
    }
    if (
        typeof status.label !== "string" ||
        !STATES.has(status.state as JobState)
    ) {
        throw new Error("probe output requires a label and valid state");
    }
    return status as unknown as JobStatus;
}

function resultText(status: JobStatus): string {
    const raw = JSON.stringify(status.result ?? status.message ?? null);
    const clipped = truncateHead(raw, {
        maxBytes: MAX_RESULT_BYTES,
        maxLines: MAX_RESULT_LINES,
    });
    return clipped.truncated
        ? `${clipped.content}\n[result truncated; re-run the probe for the full value]`
        : clipped.content;
}

function display(status: JobStatus): string {
    const progress =
        status.current !== undefined && status.total !== undefined
            ? `${TIMER_ICON} ${status.current}/${status.total}${status.unit ? ` ${status.unit}` : ""}`
            : "";
    return [
        status.label,
        status.state,
        status.phase,
        progress.trim(),
        status.message,
    ]
        .filter(Boolean)
        .join(" · ");
}

const WIDGET_KEY = "job-watch";

export default function jobWatch(pi: ExtensionAPI) {
    const watches = new Map<string, Watch>();

    let requestRender: (() => void) | undefined;

    function widgetLines(): string[] {
        return [...watches.values()]
            .map((watch) => watch.line)
            .filter((line): line is string => line !== undefined);
    }

    // The footer is unusable here: an extension that calls setFooter replaces it
    // wholesale and drops every extension status, so progress goes in a widget.
    // The widget renders from the live map and asks for a repaint on every poll,
    // because an idle agent draws no frames on its own.
    function paintWidget(ctx: ExtensionContext): void {
        if (!ctx.hasUI) return;
        if (widgetLines().length === 0) {
            ctx.ui.setWidget(WIDGET_KEY, undefined);
            requestRender = undefined;
            return;
        }
        if (!requestRender) {
            ctx.ui.setWidget(WIDGET_KEY, (tui) => {
                requestRender = () => tui.requestRender();
                return {
                    render: () => widgetLines(),
                    invalidate: () => {},
                };
            });
            return;
        }
        requestRender();
    }

    function stopWatch(id: string, ctx: ExtensionContext): boolean {
        const watch = watches.get(id);
        if (!watch) return false;
        watch.terminal = true;
        if (watch.timer) clearInterval(watch.timer);
        watches.delete(id);
        paintWidget(ctx);
        return true;
    }

    async function poll(watch: Watch, initial = false): Promise<void> {
        if (watch.terminal || watch.inFlight) return;
        watch.inFlight = true;

        try {
            const probe = await pi.exec(watch.program, watch.args, {
                timeout: 5_000,
            });
            if (watch.terminal) return;
            if (probe.code !== 0)
                throw new Error(`probe exit ${probe.code}: ${probe.stderr}`);

            const status = parseStatus(probe.stdout, watch.id);
            watch.failures = 0;
            watch.line = display(status);
            paintWidget(watch.ctx);

            const now = Date.now();
            if (now - watch.lastNoticeAt >= 120_000 && watch.ctx.hasUI) {
                watch.ctx.ui.notify(display(status), "info");
                watch.lastNoticeAt = now;
            }

            if (status.state === "done" || status.state === "error") {
                watch.terminal = true;
                if (watch.timer) clearInterval(watch.timer);
                watches.delete(watch.id);
                paintWidget(watch.ctx);

                pi.sendMessage(
                    {
                        customType: "job-watch",
                        display: true,
                        content:
                            `Watched job ${status.state}: ${status.label}\n` +
                            `Result: ${resultText(status)}\n` +
                            "Report this immediately. Do not relaunch the job. Obey any human judgment gate.",
                        details: status,
                    },
                    { triggerTurn: true, deliverAs: "followUp" },
                );
            }
        } catch (error) {
            watch.failures += 1;
            if (initial) {
                watches.delete(watch.id);
                throw error;
            }
            if (watch.failures === 3 && watch.ctx.hasUI) {
                watch.ctx.ui.notify(
                    `Job watcher probe failing for ${watch.label}: ${String(error)}`,
                    "warning",
                );
            }
        } finally {
            watch.inFlight = false;
        }
    }

    pi.registerTool({
        name: "watch_job",
        label: "Watch Job",
        description:
            "Watch an already-running job through an executable that prints one JobStatus JSON object. " +
            "This monitors only; it never launches or retries the job.",
        promptSnippet:
            "Watch a long-running external job and wake on completion or error",
        promptGuidelines: [
            "After launching an asynchronous job, immediately call watch_job so the user does not have to request status.",
            "watch_job monitors only; never use it to retry or relaunch a job.",
        ],
        parameters: Type.Object({
            id: Type.String(),
            label: Type.String(),
            program: Type.String({
                description: "Executable, not a shell command",
            }),
            args: Type.Array(Type.String()),
            intervalSeconds: Type.Optional(
                Type.Integer({ minimum: 5, maximum: 300 }),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            if (watches.has(params.id)) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Already watching ${params.id}`,
                        },
                    ],
                    details: { id: params.id, alreadyWatching: true },
                };
            }

            const watch: Watch = {
                id: params.id,
                label: params.label,
                program: params.program,
                args: params.args,
                intervalMs: (params.intervalSeconds ?? 10) * 1_000,
                ctx,
                lastNoticeAt: Date.now(),
                failures: 0,
                inFlight: false,
                terminal: false,
            };
            watches.set(watch.id, watch);
            await poll(watch, true);
            if (!watch.terminal)
                watch.timer = setInterval(
                    () => void poll(watch),
                    watch.intervalMs,
                );

            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Watching ${watch.label} (${watch.id})`,
                    },
                ],
                details: {
                    id: watch.id,
                    label: watch.label,
                    terminal: watch.terminal,
                },
            };
        },
    });

    pi.registerTool({
        name: "unwatch_job",
        label: "Unwatch Job",
        description:
            "Stop watching a job. The underlying job keeps running; only monitoring stops.",
        parameters: Type.Object({ id: Type.String() }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const stopped = stopWatch(params.id, ctx);
            return {
                content: [
                    {
                        type: "text" as const,
                        text: stopped
                            ? `Stopped watching ${params.id}; the job keeps running`
                            : `No watch for ${params.id}`,
                    },
                ],
                details: { id: params.id, stopped },
            };
        },
    });

    pi.registerCommand("unwatch", {
        description: "Stop watching a job without stopping the job",
        handler: async (_args, ctx) => {
            if (!ctx.hasUI) return;
            const items: SelectItem[] = [...watches.values()].map((watch) => ({
                value: watch.id,
                label: watch.label,
                description: watch.line ?? watch.id,
            }));
            if (items.length === 0) {
                ctx.ui.notify("No watched jobs", "info");
                return;
            }

            const id = await ctx.ui.custom<string | null>(
                (tui, theme, _keybindings, done) => {
                    const container = new Container();
                    const border = () =>
                        new DynamicBorder((s: string) => theme.fg("accent", s));
                    container.addChild(border());
                    container.addChild(
                        new Text(
                            theme.fg("accent", theme.bold("Stop watching")),
                            1,
                            0,
                        ),
                    );
                    const list = new SelectList(
                        items,
                        Math.min(items.length, 10),
                        {
                            selectedPrefix: (t: string) =>
                                theme.fg("accent", t),
                            selectedText: (t: string) => theme.fg("accent", t),
                            description: (t: string) => theme.fg("muted", t),
                            scrollInfo: (t: string) => theme.fg("dim", t),
                            noMatch: (t: string) => theme.fg("warning", t),
                        },
                    );
                    list.onSelect = (item) => done(item.value);
                    list.onCancel = () => done(null);
                    container.addChild(list);
                    container.addChild(
                        new Text(
                            theme.fg(
                                "dim",
                                "the job keeps running; only monitoring stops",
                            ),
                            1,
                            0,
                        ),
                    );
                    container.addChild(border());
                    return {
                        render: (width: number) => container.render(width),
                        invalidate: () => container.invalidate(),
                        handleInput: (data: string) => {
                            list.handleInput(data);
                            tui.requestRender();
                        },
                    };
                },
            );
            if (!id) return;
            ctx.ui.notify(
                stopWatch(id, ctx)
                    ? `Stopped watching ${id}; the job keeps running`
                    : `No watch for ${id}`,
                "info",
            );
        },
    });

    pi.registerCommand("jobs", {
        description: "List jobs watched by this Pi session",
        handler: async (_args, ctx) => {
            const lines = [...watches.values()].map(
                (watch) => `- ${watch.label} (${watch.id})`,
            );
            if (ctx.hasUI)
                ctx.ui.notify(
                    lines.length ? lines.join("\n") : "No watched jobs",
                    "info",
                );
        },
    });

    pi.on("session_shutdown", async (_event, ctx) => {
        for (const watch of watches.values()) {
            watch.terminal = true;
            if (watch.timer) clearInterval(watch.timer);
        }
        watches.clear();
        paintWidget(ctx);
    });
}
