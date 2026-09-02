/**
 * compact-tools — three-level tool density, single knob (ctrl+b)
 *
 * Modes:
 *   title   — custom 1-line header, self-shell (no Box pad), body only on error
 *   preview — stock pi collapsed rendering (delegated verbatim)
 *   full    — stock pi expanded rendering (delegated verbatim)
 *
 * preview/full ARE the stock renderers: ctrl+b drives the app-level
 * toolsExpanded flag and delegates renderCall/renderResult to the stock tool
 * definitions, so those two modes stay pixel-identical to stock pi.
 * app.tools.expand (ctrl+o) is unbound in keybindings.json — ctrl+b is the
 * only knob. Execution stays stock.
 *
 * Covers: bash, read, grep, find, ls, edit, write.
 * Does not affect interactive `!` bang-bash.
 */

import type {
    ExtensionAPI,
    ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
    createBashToolDefinition,
    createEditToolDefinition,
    createFindToolDefinition,
    createGrepToolDefinition,
    createLsToolDefinition,
    createReadToolDefinition,
    createWriteToolDefinition,
    getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { displayPath } from "./paths.ts";

/**
 * Free-text call args — a command, a search pattern — clipped so the title
 * density keeps its one-line promise. truncate() also folds newlines, which
 * is what a heredoc or a multi-line && chain would otherwise smuggle in.
 */
const CALL_ARG_MAX = 100;

type Density = "title" | "preview" | "full";
const DENSITY_ORDER: Density[] = ["title", "preview", "full"];
const DENSITY_LABEL: Record<Density, string> = {
    title: "title (1-line)",
    preview: "preview (stock collapsed)",
    full: "full (stock expanded)",
};

const SETTINGS_KEY = "compactToolsDensity";
const SETTINGS_PATH = join(getAgentDir(), "settings.json");

function loadDensity(): Density {
    try {
        const raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
        const value = raw?.[SETTINGS_KEY];
        if (value === "title" || value === "preview" || value === "full")
            return value;
    } catch {
        // missing or junk settings: keep the built-in default
    }
    return "title";
}

function saveDensity(next: Density): void {
    try {
        const raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
        raw[SETTINGS_KEY] = next;
        writeFileSync(SETTINGS_PATH, `${JSON.stringify(raw, null, 2)}\n`);
    } catch {
        // settings write is best-effort; density still applies this session
    }
}

let density: Density = loadDensity();

type Theme = {
    fg: (key: string, text: string) => string;
    bold: (text: string) => string;
    bg?: (key: string, text: string) => string;
};

const TOOL_ICON = {
    bash: "",
    read: "󰈙",
    grep: "",
    find: "󰈞",
    ls: "󰉋",
    edit: "",
    write: "",
} as const;
type ToolName = keyof typeof TOOL_ICON;

function toolTitle(theme: Theme, name: ToolName): string {
    return theme.fg("toolTitle", theme.bold(`${TOOL_ICON[name]} ${name}`));
}

function truncate(s: string, max: number): string {
    const one = s.replace(/\s+/g, " ").trim();
    if (one.length <= max) return one;
    return one.slice(0, max - 1) + "…";
}

function textContent(result: {
    content: Array<{ type: string; text?: string }>;
}): string {
    return result.content
        .filter(
            (c): c is { type: "text"; text: string } =>
                c.type === "text" && typeof c.text === "string",
        )
        .map((c) => c.text)
        .join("\n");
}

function cwdOf(ctx: { cwd?: string } | undefined): string {
    return ctx?.cwd || process.cwd();
}

/** Stock tool-box bg. Same fn everywhere so ctrl+b doesn't recolor. */
function toolBg(
    theme: Theme,
    context: { isPartial?: boolean; isError?: boolean },
): ((s: string) => string) | undefined {
    if (!theme.bg) return undefined;
    let slot = "toolSuccessBg";
    if (context.isPartial) slot = "toolPendingBg";
    else if (context.isError) slot = "toolErrorBg";
    // theme.bg is a method; must be called on theme to keep `this`.
    return (s) => theme.bg!(slot, s);
}

/** Reuse last Text component like stock renderers. */
function paintedText(
    context: {
        lastComponent?: unknown;
        isPartial?: boolean;
        isError?: boolean;
    },
    theme: Theme,
    line: string,
): Text {
    const text =
        (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
    text.setCustomBgFn(toolBg(theme, context));
    text.setText(line);
    return text;
}

function refreshTools(ctx: ExtensionContext) {
    // setToolsExpanded no-ops when value unchanged; flip to force every tool row to re-render.
    const target = density === "full";
    ctx.ui.setToolsExpanded(!target);
    ctx.ui.setToolsExpanded(target);
    ctx.ui.setStatus(
        "compact-tools",
        ctx.ui.theme.fg("muted", `tools:${density}`),
    );
    ctx.ui.notify(`Tool density: ${DENSITY_LABEL[density]}`, "info");
}

function setDensity(ctx: ExtensionContext, next: Density) {
    density = next;
    saveDensity(next);
    refreshTools(ctx);
}

function cycleDensity(ctx: ExtensionContext) {
    const i = DENSITY_ORDER.indexOf(density);
    setDensity(ctx, DENSITY_ORDER[(i + 1) % DENSITY_ORDER.length]);
}

function parseDensity(raw: string | undefined): Density | undefined {
    const s = raw?.trim().toLowerCase();
    if (!s) return undefined;
    if (s === "title" || s === "1" || s === "one" || s === "line")
        return "title";
    if (s === "preview" || s === "pi" || s === "default" || s === "2")
        return "preview";
    if (s === "full" || s === "all" || s === "3") return "full";
    return undefined;
}

/** Empty result slot — stock header alone is the title line. */
function emptyResult() {
    return new Text("", 0, 0);
}

export default function (pi: ExtensionAPI) {
    pi.registerShortcut("ctrl+b", {
        description: "Cycle tool density (title → preview → full)",
        handler: async (ctx) => {
            cycleDensity(ctx);
        },
    });

    pi.registerCommand("tools-density", {
        description:
            "Set tool density: title | preview | full (or cycle if no arg)",
        handler: async (args, ctx) => {
            const next = parseDensity(args);
            if (!next) {
                if (args?.trim()) {
                    ctx.ui.notify(
                        `Unknown density "${args.trim()}". Use title, preview, or full.`,
                        "warning",
                    );
                    return;
                }
                cycleDensity(ctx);
                return;
            }
            setDensity(ctx, next);
        },
    });

    pi.on("session_start", async (_event, ctx) => {
        density = loadDensity();
        ctx.ui.setToolsExpanded(density === "full");
        ctx.ui.setStatus(
            "compact-tools",
            ctx.ui.theme.fg("muted", `tools:${density}`),
        );
    });

    // biome-ignore lint/suspicious/noExplicitAny: bridging heterogeneous stock tool definitions
    type AnyDef = any;

    const factories: Record<ToolName, (cwd: string) => AnyDef> = {
        bash: createBashToolDefinition,
        read: createReadToolDefinition,
        grep: createGrepToolDefinition,
        find: createFindToolDefinition,
        ls: createLsToolDefinition,
        edit: createEditToolDefinition,
        write: createWriteToolDefinition,
    };

    /** Custom 1-line headers for title mode; preview/full use stock renderCall. */
    const titleCalls: Record<
        ToolName,
        (args: AnyDef, theme: Theme, context: AnyDef) => string
    > = {
        bash(args, theme) {
            const cmd = args?.command == null ? "" : String(args.command);
            let line = theme.fg(
                "toolOutput",
                cmd ? truncate(cmd, CALL_ARG_MAX) : "...",
            );
            if (args?.timeout != null)
                line += theme.fg("muted", ` (timeout ${args.timeout}s)`);
            return line;
        },
        read(args, theme, context) {
            const path = displayPath(
                args?.path ?? args?.file_path,
                cwdOf(context),
            );
            let line = theme.fg("toolOutput", path);
            const parts: string[] = [];
            if (args?.offset != null) parts.push(`offset=${args.offset}`);
            if (args?.limit != null) parts.push(`limit=${args.limit}`);
            if (parts.length)
                line += theme.fg("muted", ` (${parts.join(", ")})`);
            return line;
        },
        grep(args, theme, context) {
            const parts = [
                args?.pattern
                    ? truncate(String(args.pattern), CALL_ARG_MAX)
                    : "...",
            ];
            if (args?.path != null)
                parts.push(displayPath(String(args.path), cwdOf(context)));
            if (args?.glob) parts.push(String(args.glob));
            return theme.fg("toolOutput", parts.join(" "));
        },
        find(args, theme, context) {
            const pattern =
                args?.pattern == null
                    ? "..."
                    : truncate(String(args.pattern), CALL_ARG_MAX);
            const path = displayPath(args?.path, cwdOf(context));
            return theme.fg("toolOutput", `${path} ${pattern}`);
        },
        ls(args, theme, context) {
            const path = displayPath(
                args?.path == null ? "." : String(args.path),
                cwdOf(context),
            );
            let line = theme.fg("toolOutput", path);
            if (args?.limit != null)
                line += theme.fg("muted", ` (limit ${args.limit})`);
            return line;
        },
        edit(args, theme, context) {
            return theme.fg(
                "toolOutput",
                displayPath(args?.path ?? args?.file_path, cwdOf(context)),
            );
        },
        write(args, theme, context) {
            return theme.fg(
                "toolOutput",
                displayPath(args?.path ?? args?.file_path, cwdOf(context)),
            );
        },
    };

    for (const name of Object.keys(factories) as ToolName[]) {
        const factory = factories[name];
        const stock = factory(process.cwd());

        const tool: AnyDef = {
            ...stock,

            async execute(
                toolCallId: string,
                params: AnyDef,
                signal: AbortSignal,
                onUpdate: AnyDef,
                ctx: AnyDef,
            ) {
                return factory(cwdOf(ctx)).execute(
                    toolCallId,
                    params,
                    signal,
                    onUpdate,
                    ctx,
                );
            },

            renderCall(args: AnyDef, theme: Theme, context: AnyDef) {
                if (density !== "title")
                    return stock.renderCall(args, theme, context);
                return paintedText(
                    context,
                    theme,
                    `${toolTitle(theme, name)} ${titleCalls[name](args, theme, context)}`,
                );
            },

            renderResult(
                result: AnyDef,
                options: AnyDef,
                theme: Theme,
                context: AnyDef,
            ) {
                if (density !== "title")
                    return stock.renderResult(result, options, theme, context);
                if (options.isPartial || !context.isError) return emptyResult();

                const output = textContent(result);
                let msg = truncate(output.split("\n")[0] || "error", 80);
                if (name === "bash") {
                    const exit =
                        output.match(/exited with code (\d+)/i) ??
                        output.match(/exit code[: ]+(\d+)/i);
                    if (exit) msg = `exit ${exit[1]}`;
                }
                return paintedText(
                    context,
                    theme,
                    theme.fg("error", `  ✗ ${msg}`),
                );
            },
        };

        /** Title mode drops the Box shell. pi reads renderShell live per render, so it
         * has to stay a getter — a spread would freeze today's value. Outside title
         * mode the stock choice wins: edit already renders its own shell. */
        pi.registerTool(
            Object.defineProperty(tool, "renderShell", {
                get: () =>
                    density === "title"
                        ? "self"
                        : (stock.renderShell ?? "default"),
                configurable: true,
            }),
        );
    }
}
