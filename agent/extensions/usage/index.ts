import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import { fetchAll, type ProviderStatus } from "./core.ts";
import {
  renderBar,
  barColor,
  formatDuration,
  renderCurrentLine,
  TONE,
  cacheRemainingSeconds,
  promptCacheTtlSeconds,
  type CurrentSession,
  type Theme,
  type WindowUsage,
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
function plainSegment(status: ProviderStatus): string {
  if ("stale" in status) return `${status.name} —`;
  const bar = renderBar(status.usage.sessionPercent, 6);
  return `${status.name} ${bar}`;
}

function footerLine(theme: Theme, status: ProviderStatus): string {
  const segment = plainSegment(status);
  if ("stale" in status) return theme.fg("dim", segment);
  return theme.fg(TONE[barColor(status.usage.sessionPercent)], segment);
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

function quotaName(provider: string | undefined): string | null {
  switch (provider) {
    case "xai":
      return "grok";
    case "anthropic":
      return "claude";
    case "openai-codex":
      return "codex";
    case "google-antigravity":
      return "antigravity";
    default:
      return null;
  }
}

function windowsFor(
  provider: string | undefined,
  statuses: ProviderStatus[],
): { fiveHour: WindowUsage | null; week: WindowUsage | null } {
  const name = quotaName(provider);
  const status = name ? statuses.find((s) => s.name === name) : undefined;
  if (!status || "stale" in status) return { fiveHour: null, week: null };
  const week: WindowUsage = {
    percent: status.usage.weeklyPercent,
    resetsInSeconds: status.usage.weeklyResetsInSeconds,
  };
  // Grok SuperGrok is a weekly credit pool. Antigravity buckets are request
  // quotas, not 5h/7d windows. Codex may also lack a 5h primary.
  const hideFiveHour =
    name === "grok" ||
    name === "antigravity" ||
    status.usage.sessionIsFiveHour === false;
  if (hideFiveHour) {
    return { fiveHour: null, week: name === "antigravity" ? null : week };
  }
  return {
    fiveHour: {
      percent: status.usage.sessionPercent,
      resetsInSeconds: status.usage.resetsInSeconds,
    },
    week,
  };
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

function snapshotCurrent(
  ctx: ExtensionContext | undefined,
  branch: string | null,
  statuses: ProviderStatus[],
): CurrentSession {
  const model = ctx?.model;
  const usage = ctx?.getContextUsage();
  const thinking =
    model?.reasoning && ctx?.thinkingLevel && ctx.thinkingLevel !== "off"
      ? ctx.thinkingLevel
      : null;
  const windows = windowsFor(model?.provider, statuses);
  return {
    provider: model?.provider ?? "?",
    modelId: model?.id ?? "no-model",
    thinking,
    dir: ctx?.cwd ? basename(ctx.cwd) : "",
    branch,
    percent: usage?.percent ?? null,
    tokens: usage?.tokens ?? null,
    contextWindow: usage?.contextWindow ?? model?.contextWindow ?? 0,
    cost: sessionCost(ctx),
    fiveHour: windows.fiveHour,
    week: windows.week,
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

  if (statuses.length === 0) {
    return [theme.fg("dim", "usage: loading…".slice(0, safeWidth))];
  }

  const sep = "  ";
  const included: ProviderStatus[] = [];
  let used = 0;
  for (const status of statuses) {
    const seg = plainSegment(status);
    const next = used + (included.length > 0 ? sep.length : 0) + seg.length;
    if (next > safeWidth) break;
    included.push(status);
    used = next;
  }

  if (included.length === 0) return [""];

  const parts = included.map((s) => footerLine(theme, s));
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
            footerData.getGitBranch(),
            statuses,
          );
          if (current.cacheRemainingSeconds !== null) {
            if (tick === undefined)
              tick = setInterval(() => tui.requestRender(), 1000);
          } else {
            stopTick();
          }
          return [
            renderCurrentLine(theme, current, width),
            ...renderFooterLines(theme, statuses, width),
          ];
        },
      };
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    paintFooter(ctx);
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
