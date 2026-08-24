import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { basename, dirname, resolve } from "node:path";
import { fetchAll, type ProviderStatus } from "./core.ts";
import {
  renderBar,
  barColor,
  cells,
  clip,
  formatDuration,
  renderCurrentLine,
  TONE,
  cacheRemainingSeconds,
  promptCacheTtlSeconds,
  type CurrentSession,
  type Theme,
} from "./render.ts";

function line(status: ProviderStatus): string {
  if ("stale" in status) return `${status.name}: — (${status.stale})`;
  const { sessionPercent, weeklyPercent, resetsInSeconds } = status.usage;
  const reset =
    resetsInSeconds === null
      ? ""
      : `  resets ${formatDuration(resetsInSeconds)}`;
  return (
    `${status.name}: ${renderBar(sessionPercent)} ${Math.round(sessionPercent)}%` +
    `  week ${Math.round(weeklyPercent)}%${reset}`
  );
}

// Uncolored text only: width budgeting (renderFooterLines) measures this,
// never the ANSI-wrapped result, so a color escape sequence can never be
// sliced in half by a width cut.
function providerIcon(name: string): string {
  if (name === "grok") return "𝕏";
  if (name === "antigravity") return "󰊭";
  return "󰚩";
}

// Grok SuperGrok is a weekly credit pool, and some Codex plans report no 5h
// primary — both lead with the weekly number instead of the session one.
function weeklyOnly(status: ProviderStatus): boolean {
  return (
    status.name === "grok" ||
    ("usage" in status && status.usage.sessionIsFiveHour === false)
  );
}

function plainSegment(status: ProviderStatus): string {
  const label = `${providerIcon(status.name)} ${status.name}`;
  if ("stale" in status) return `${label} —`;
  const { sessionPercent, weeklyPercent } = status.usage;
  if (weeklyOnly(status)) return `${label} ${Math.round(weeklyPercent)}% wk`;
  return `${label} ${Math.round(sessionPercent)}% 5h / ${Math.round(weeklyPercent)}% wk`;
}

function footerLine(theme: Theme, status: ProviderStatus): string {
  const segment = plainSegment(status);
  if ("stale" in status) return theme.fg("dim", segment);
  const percent = weeklyOnly(status)
    ? status.usage.weeklyPercent
    : status.usage.sessionPercent;
  const color = barColor(percent);
  return color ? theme.fg(TONE[color], segment) : segment;
}

function sessionCost(ctx: ExtensionContext | undefined): number {
  let cost = 0;
  for (const entry of ctx?.sessionManager.getBranch() ?? []) {
    if (entry.type !== "message" || entry.message.role !== "assistant")
      continue;
    const total = (entry.message as { usage?: { cost?: { total?: number } } })
      .usage?.cost?.total;
    if (typeof total === "number" && Number.isFinite(total)) cost += total;
  }
  return cost;
}

function lastCacheWriteAtMs(ctx: ExtensionContext | undefined): number | null {
  const branch = ctx?.sessionManager.getBranch() ?? [];
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "model_change" || entry.type === "compaction")
      return null;
    if (entry.type !== "message" || entry.message.role !== "assistant")
      continue;
    const ts = entry.message.timestamp;
    return typeof ts === "number" && Number.isFinite(ts) ? ts : null;
  }
  return null;
}

export function recentEditedPaths(ctx: ExtensionContext): string[] {
  const paths: string[] = [];
  const entries = ctx.sessionManager.getBranch();
  for (let i = entries.length - 1; i >= 0 && paths.length < 10; i--) {
    const entry = entries[i];
    if (entry.type !== "message" || entry.message.role !== "assistant")
      continue;
    const content = entry.message.content;
    for (let j = content.length - 1; j >= 0 && paths.length < 10; j--) {
      const item = content[j] as {
        type?: string;
        name?: string;
        arguments?: { path?: unknown };
      };
      if (
        item.type === "toolCall" &&
        (item.name === "edit" || item.name === "write") &&
        typeof item.arguments?.path === "string" &&
        !paths.includes(item.arguments.path)
      )
        paths.push(item.arguments.path);
    }
  }
  return paths;
}

function snapshotCurrent(
  ctx: ExtensionContext | undefined,
  branch: string | null,
  worktree: string,
  dirty: boolean,
): CurrentSession {
  const model = ctx?.model;
  const usage = ctx?.getContextUsage();
  const thinking =
    model?.reasoning && ctx?.thinkingLevel && ctx.thinkingLevel !== "off"
      ? ctx.thinkingLevel
      : null;
  return {
    provider: model?.provider ?? "?",
    modelId: model?.id ?? "no-model",
    thinking,
    dir: worktree,
    branch,
    dirty,
    percent: usage?.percent ?? null,
    tokens: usage?.tokens ?? null,
    cost: sessionCost(ctx),
    cacheRemainingSeconds: cacheRemainingSeconds(
      lastCacheWriteAtMs(ctx),
      promptCacheTtlSeconds(model?.provider ?? "", model?.id ?? ""),
      Date.now(),
    ),
  };
}

// pi's Component.render(width) contract requires every returned line to fit
// the viewport; a narrow terminal can't always show all providers. We drop
// whole columns rather than wrap (footer must stay one line) or truncate
// inside a colored segment (would cut an ANSI escape in half and corrupt the
// terminal). Included/omitted is decided on the plain, uncolored text, then
// theme.fg is applied only to segments already known to fit.
export function renderFooterLines(
  theme: Theme,
  statuses: ProviderStatus[],
  width: number,
): string[] {
  const safeWidth = Math.max(0, width);

  const title = "󰐱 limits";
  if (statuses.length === 0) {
    return [theme.fg("dim", clip(`${title} · loading…`, safeWidth))];
  }

  if (safeWidth <= cells(title))
    return [theme.fg("accent", theme.bold(clip(title, safeWidth)))];

  const sep = " · ";
  const included: ProviderStatus[] = [];
  let used = cells(title);
  for (const status of statuses) {
    const seg = plainSegment(status);
    const next = used + sep.length + cells(seg);
    if (next > safeWidth) break;
    included.push(status);
    used = next;
  }

  const parts = [
    theme.fg("accent", theme.bold(title)),
    ...included.map((s) => footerLine(theme, s)),
  ];
  const omitted = statuses.length - included.length;
  if (omitted > 0) {
    const marker = `+${omitted}`;
    if (used + sep.length + marker.length <= safeWidth) {
      parts.push(theme.fg("dim", marker));
    }
  }
  return [parts.join(sep)];
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("usage", {
    description: "Show provider quota for Grok, Claude, Codex, and Antigravity",
    handler: async (_args, ctx) => {
      const statuses = await fetchAll();
      ctx.ui.notify(statuses.map(line).join("\n"), "info");
    },
  });

  // fetchAll degrades every failure to a stale marker, so the footer never
  // has to distinguish "not fetched yet" from "provider unreachable" beyond
  // this initial empty-array loading state.
  let statuses: ProviderStatus[] = [];
  let requestRender: (() => void) | undefined;
  let ctxRef: ExtensionContext | undefined;
  let worktree = "";
  let gitBranch: string | null = null;
  let gitRoot: string | null = null;
  let gitDirty = false;

  async function updateRepo(directory: string): Promise<boolean> {
    const result = await pi.exec(
      "git",
      ["-C", directory, "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"],
      { timeout: 2000 },
    );
    if (result.code !== 0) return false;
    const [root, branch] = result.stdout.trim().split("\n");
    if (!root || !branch) return false;
    gitRoot = root;
    gitBranch = branch;
    worktree = basename(root);
    const status = await pi.exec("git", ["-C", root, "status", "--porcelain"], {
      timeout: 2000,
    });
    gitDirty = status.code === 0 && status.stdout.trim().length > 0;
    requestRender?.();
    return true;
  }

  async function refresh(): Promise<void> {
    statuses = await fetchAll();
    requestRender?.();
  }

  function paintFooter(ctx: ExtensionContext): void {
    ctxRef = ctx;
    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsub = footerData.onBranchChange(() => tui.requestRender());
      let tick: ReturnType<typeof setInterval> | undefined;
      const stopTick = () => {
        if (tick !== undefined) {
          clearInterval(tick);
          tick = undefined;
        }
      };
      return {
        dispose() {
          stopTick();
          unsub();
        },
        invalidate() {},
        render(width: number): string[] {
          const current = snapshotCurrent(
            ctxRef,
            gitBranch ?? footerData.getGitBranch(),
            worktree,
            gitDirty,
          );
          if (current.cacheRemainingSeconds === null) {
            stopTick();
          } else if (tick === undefined)
            tick = setInterval(() => tui.requestRender(), 1000);
          return [
            "",
            renderCurrentLine(theme, current, width),
            ...renderFooterLines(theme, statuses, width),
          ];
        },
      };
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    worktree = basename(ctx.cwd);
    gitBranch = null;
    gitRoot = null;
    gitDirty = false;
    paintFooter(ctx);
    if (!(await updateRepo(ctx.cwd))) {
      for (const path of recentEditedPaths(ctx)) {
        if (await updateRepo(dirname(resolve(ctx.cwd, path)))) break;
      }
    }
    await refresh();
  });

  pi.on("model_select", (_event, ctx) => {
    ctxRef = ctx;
    requestRender?.();
  });
  pi.on("thinking_level_select", (_event, ctx) => {
    ctxRef = ctx;
    requestRender?.();
  });
  pi.on("turn_end", (_event, ctx) => {
    ctxRef = ctx;
    requestRender?.();
  });
  pi.on("tool_result", async (event, ctx) => {
    if (event.isError) return;
    const path = (event.input as { path?: unknown }).path;
    if (
      (event.toolName === "edit" || event.toolName === "write") &&
      typeof path === "string"
    ) {
      await updateRepo(dirname(resolve(ctx.cwd, path)));
      return;
    }
    const command = (event.input as { command?: unknown }).command;
    if (
      event.toolName === "bash" &&
      gitRoot &&
      typeof command === "string" &&
      /(?:^|[;&|\s])git(?:\s|$)/.test(command)
    )
      await updateRepo(gitRoot);
  });

  // Quota moves as turns run; re-fetch before each one. fetchAll's own
  // cache (core.ts, 60s TTL) keeps this from hammering provider APIs.
  // turn_start sits inline in pi's sequential turn pipeline, so this must
  // not await: the footer already repaints itself via requestRender() once
  // refresh() lands. fetchAll degrades every failure internally, but the
  // catch here is cheap insurance against an unhandled rejection wedging
  // the process if that guarantee is ever broken.
  pi.on("turn_start", () => {
    refresh().catch(() => {});
  });
}
