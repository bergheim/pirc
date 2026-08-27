import assert from "node:assert/strict";
import test from "node:test";
import {
    barColor,
    contextTone,
    cacheRemainingSeconds,
    cells,
    cacheTone,
    currentLineSegments,
    locationLineSegments,
    fitSegments,
    formatDuration,
    formatK,
    formatLocalWhen,
    formatRemaining,
    formatResetWhen,
    promptCacheTtlSeconds,
    renderBar,
    renderCurrentLine,
    renderLocationLine,
    TONE,
    type CurrentSession,
} from "./render.ts";
import {
    parseCodexUsage,
    parseGoogleQuota,
    parseGrokBilling,
} from "./parse.ts";
import {
    extraCwd,
    lastUserSentAtMs,
    quotaProvider,
    quotaSnapshot,
    recentEditedPaths,
    renderFooterLines,
} from "./index.ts";

const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
};

const sample: CurrentSession = {
    provider: "xai",
    modelId: "grok-4.6",
    thinking: "medium",
    dir: "jolo",
    branch: "master",
    dirty: true,
    percent: 42,
    tokens: 120000,
    contextWindow: 500000,
    cost: 1.23,
    cacheRemainingSeconds: null,
    cacheTtlSeconds: null,
    quota: null,
    quotaPercent: null,
};

test("recentEditedPaths prefers latest unique edits", () => {
    const ctx = {
        sessionManager: {
            getBranch: () => [
                {
                    type: "message",
                    message: {
                        role: "assistant",
                        content: [
                            {
                                type: "toolCall",
                                name: "edit",
                                arguments: { path: "/old" },
                            },
                        ],
                    },
                },
                {
                    type: "message",
                    message: {
                        role: "assistant",
                        content: [
                            {
                                type: "toolCall",
                                name: "write",
                                arguments: { path: "/new" },
                            },
                            {
                                type: "toolCall",
                                name: "edit",
                                arguments: { path: "/old" },
                            },
                        ],
                    },
                },
            ],
        },
    };
    assert.deepEqual(recentEditedPaths(ctx as never), ["/old", "/new"]);
});

function branchCtx(entries: unknown[]) {
    return { sessionManager: { getBranch: () => entries } };
}

test("cache clock starts at user send, not assistant finish", () => {
    const ctx = branchCtx([
        {
            type: "message",
            message: { role: "user", timestamp: 1000 },
        },
        {
            type: "message",
            message: { role: "assistant", timestamp: 5000 },
        },
    ]);
    assert.equal(lastUserSentAtMs(ctx as never), 1000);
});

test("new user message restarts the cache clock", () => {
    const ctx = branchCtx([
        {
            type: "message",
            message: { role: "user", timestamp: 1000 },
        },
        {
            type: "message",
            message: { role: "assistant", timestamp: 2000 },
        },
        {
            type: "message",
            message: { role: "user", timestamp: 3000 },
        },
    ]);
    assert.equal(lastUserSentAtMs(ctx as never), 3000);
});

test("model change and compaction invalidate the cache clock", () => {
    assert.equal(
        lastUserSentAtMs(
            branchCtx([
                {
                    type: "message",
                    message: { role: "user", timestamp: 1000 },
                },
                { type: "compaction" },
            ]) as never,
        ),
        null,
    );
    assert.equal(
        lastUserSentAtMs(
            branchCtx([
                {
                    type: "message",
                    message: { role: "user", timestamp: 1000 },
                },
                { type: "model_change" },
            ]) as never,
        ),
        null,
    );
    assert.equal(
        lastUserSentAtMs(
            branchCtx([
                {
                    type: "message",
                    message: { role: "user", timestamp: 1000 },
                },
                { type: "compaction" },
                {
                    type: "message",
                    message: { role: "user", timestamp: 4000 },
                },
            ]) as never,
        ),
        4000,
    );
});

test("cache countdown expires TTL after user send", () => {
    const sent = lastUserSentAtMs(
        branchCtx([
            {
                type: "message",
                message: { role: "user", timestamp: 1000 },
            },
            {
                type: "message",
                message: { role: "assistant", timestamp: 2500 },
            },
        ]) as never,
    );
    assert.equal(sent, 1000);
    assert.equal(cacheRemainingSeconds(sent, 300, 1000 + 299_000), 1);
    assert.equal(cacheRemainingSeconds(sent, 300, 1000 + 300_000), null);
});

test("formatK", () => {
    assert.equal(formatK(0), "0");
    assert.equal(formatK(42), "42");
    assert.equal(formatK(85400), "85k");
    assert.equal(formatK(200000), "200k");
    assert.equal(formatK(1_050_000), "1.05m");
    assert.equal(formatK(Number.NaN), "0");
});

test("barColor is quiet until 70/90", () => {
    assert.equal(barColor(0), null);
    assert.equal(barColor(69.9), null);
    assert.equal(barColor(70), "yellow");
    assert.equal(barColor(89.9), "yellow");
    assert.equal(barColor(90), "red");
});

test("contextTone scales at 40% and 100% of the model window", () => {
    assert.equal(contextTone(199_999, 500_000), null);
    assert.equal(contextTone(200_000, 500_000), TONE.yellow);
    assert.equal(contextTone(499_999, 500_000), TONE.yellow);
    assert.equal(contextTone(500_000, 500_000), TONE.red);
    assert.equal(contextTone(419_999, 1_050_000), null);
    assert.equal(contextTone(420_000, 1_050_000), TONE.yellow);
    assert.equal(contextTone(1_050_000, 1_050_000), TONE.red);
    assert.equal(contextTone(null, 500_000), "dim");
    assert.equal(contextTone(120_000, null), "dim");
});

test("renderBar width", () => {
    assert.equal(renderBar(40, 10), "████░░░░░░");
    assert.equal(renderBar(0, 6), "░░░░░░");
});

test("formatDuration clamps junk", () => {
    assert.equal(formatDuration(-1), "0s");
    assert.equal(formatDuration(45), "45s");
    assert.equal(formatDuration(120), "2m");
    assert.equal(formatDuration(7200), "2h");
    assert.equal(formatDuration(259200), "3d");
});

test("current line is model metadata only", () => {
    const segs = currentLineSegments(sample);
    const plains = segs.map((s) => s.plain);
    assert.equal(plains[0], "󰚩 xai/grok-4.6");
    assert.equal(plains[1], "󰔛 medium");
    assert.equal(segs[1].tone, "accent");
    assert.ok(plains.includes("󰔚 $1.23"));
    assert.ok(!plains.some((p) => p.includes("jolo") || p.includes("master")));
    assert.ok(!plains.some((p) => p.includes("ctx") || p.includes("cache")));
});

test("omits thinking when absent", () => {
    const plains = currentLineSegments({
        ...sample,
        thinking: null,
    }).map((s) => s.plain);
    assert.equal(plains[0], "󰚩 xai/grok-4.6");
    assert.ok(!plains.some((p) => p.includes("medium")));
});

test("location line is worktree and branch", () => {
    const plains = locationLineSegments(sample).map((s) => s.plain);
    assert.deepEqual(plains, [" jolo", " master ●", "󰍛 ctx 42% 120k/500k"]);
});

test("location line uses the active model context window", () => {
    const seg = locationLineSegments({
        ...sample,
        contextWindow: 1_050_000,
    }).find((s) => s.key === "context")!;
    assert.equal(seg.plain, "󰍛 ctx 42% 120k/1.05m");
});

test("location line dims an unknown context window", () => {
    const seg = locationLineSegments({
        ...sample,
        contextWindow: null,
    }).find((s) => s.key === "context")!;
    assert.equal(seg.plain, "󰍛 ctx 42% 120k/?");
    assert.equal(seg.tone, "dim");
});

test("location line puts cache after ctx", () => {
    const plains = locationLineSegments({
        ...sample,
        cacheRemainingSeconds: 272,
        cacheTtlSeconds: 300,
    }).map((s) => s.plain);
    assert.deepEqual(plains, [
        " jolo",
        " master ●",
        "󰍛 ctx 42% 120k/500k",
        "󰒍 cache 4m 32s",
    ]);
});

test("location line adds cwd when it differs", () => {
    const plains = locationLineSegments({
        ...sample,
        cwd: ".pi",
    }).map((s) => s.plain);
    assert.deepEqual(plains, [
        " .pi",
        " jolo",
        " master ●",
        "󰍛 ctx 42% 120k/500k",
    ]);
});

test("location line omits duplicate cwd", () => {
    const plains = locationLineSegments({
        ...sample,
        cwd: null,
        branch: null,
        dirty: false,
    }).map((s) => s.plain);
    assert.deepEqual(plains, [" jolo", "󰍛 ctx 42% 120k/500k"]);
});

test("narrow location keeps ctx and cache before place", () => {
    const session = {
        ...sample,
        cwd: ".pi",
        cacheRemainingSeconds: 272,
        cacheTtlSeconds: 300,
    };
    const segs = locationLineSegments(session);
    const ctx = segs.find((s) => s.key === "context")!;
    const cache = segs.find((s) => s.key === "cache")!;
    const line = renderLocationLine(
        theme,
        session,
        cells(ctx.plain) + 3 + cells(cache.plain),
    );
    assert.equal(line, `${ctx.plain} · ${cache.plain}`);
    assert.ok(!line.includes(".pi"));
    assert.ok(!line.includes("jolo"));
    assert.ok(!line.includes("master"));
});

test("extraCwd only when cwd is outside git root", () => {
    assert.equal(extraCwd("/repo/agent", "/repo"), "");
    assert.equal(extraCwd("/repo", "/repo"), "");
    assert.equal(extraCwd("/other", "/repo"), "other");
    assert.equal(extraCwd("/other", null), "");
});

test("fitSegments drops cost before thinking", () => {
    const segs = currentLineSegments(sample);
    const full = fitSegments(segs, 200);
    assert.ok(full.some((s) => s.key === "cost"));

    const cost = segs.find((s) => s.key === "cost")!;
    const widthWithoutCost =
        segs.reduce((n, s) => n + cells(s.plain), 0) +
        (segs.length - 1) * 3 -
        cells(cost.plain) -
        3;
    const noCost = fitSegments(segs, widthWithoutCost);
    assert.ok(!noCost.some((s) => s.key === "cost"));
    assert.ok(noCost.some((s) => s.key === "thinking"));

    const modelOnly = fitSegments(segs, 10);
    assert.equal(modelOnly.length, 1);
    assert.ok(modelOnly[0].plain.startsWith("󰚩 xai"));
});

test("renderCurrentLine stays within width", () => {
    const line = renderCurrentLine(theme, sample, 40);
    assert.ok(cells(line) <= 40);
    assert.ok(line.includes("󰚩 xai/grok-4.6"));
});

test("cache segment ticks remaining time", () => {
    const plains = locationLineSegments({
        ...sample,
        cacheRemainingSeconds: 272,
        cacheTtlSeconds: 300,
    }).map((s) => s.plain);
    assert.ok(plains.includes("󰒍 cache 4m 32s"));
});

test("cacheTone scales with TTL and caps long windows", () => {
    assert.equal(cacheTone(120, 300), "dim");
    assert.equal(cacheTone(119, 300), TONE.yellow);
    assert.equal(cacheTone(30, 300), TONE.yellow);
    assert.equal(cacheTone(29, 300), TONE.red);
    assert.equal(cacheTone(599, 1800), TONE.yellow);
    assert.equal(cacheTone(119, 1800), TONE.red);
    assert.equal(cacheTone(600, 3600), "dim");
    assert.equal(cacheTone(599, 3600), TONE.yellow);
    assert.equal(cacheTone(119, 3600), TONE.red);
});

test("formatRemaining keeps leftover minutes", () => {
    assert.equal(formatRemaining(45), "45s");
    assert.equal(formatRemaining(272), "4m 32s");
    assert.equal(formatRemaining(7200), "2h");
    assert.equal(formatRemaining(9900), "2h 45m");
});

test("promptCacheTtlSeconds matches provider docs", () => {
    assert.equal(
        promptCacheTtlSeconds("anthropic", "claude-opus-4", undefined),
        300,
    );
    assert.equal(
        promptCacheTtlSeconds("anthropic", "claude-opus-4", "long"),
        3600,
    );
    assert.equal(
        promptCacheTtlSeconds("openai-codex", "gpt-5.6", undefined),
        1800,
    );
    assert.equal(
        promptCacheTtlSeconds("openai-codex", "gpt-5.6", "long"),
        1800,
    );
    assert.equal(
        promptCacheTtlSeconds("openai-codex", "gpt-5.5", undefined),
        300,
    );
    assert.equal(
        promptCacheTtlSeconds("openai-codex", "gpt-5.5", "long"),
        1800,
    );
    assert.equal(
        promptCacheTtlSeconds(
            "gateway",
            "openrouter/anthropic/claude-opus-5",
            undefined,
        ),
        300,
    );
    assert.equal(
        promptCacheTtlSeconds(
            "gateway",
            "openrouter/openai/gpt-5.5",
            undefined,
        ),
        300,
    );
    assert.equal(
        promptCacheTtlSeconds(
            "gateway",
            "openrouter/openai/gpt-5.6",
            undefined,
        ),
        1800,
    );
    assert.equal(promptCacheTtlSeconds("xai", "grok-4.6", undefined), null);
    assert.equal(
        promptCacheTtlSeconds("agy", "gemini-3.1-pro", undefined),
        null,
    );
    assert.equal(promptCacheTtlSeconds("llama", "bot-fast", undefined), null);
});

test("cacheRemainingSeconds expires", () => {
    assert.equal(cacheRemainingSeconds(1000, 300, 1000), 300);
    assert.equal(cacheRemainingSeconds(1000, 300, 1000 + 300_000), null);
    assert.equal(cacheRemainingSeconds(null, 300, 1000), null);
});

test("parseCodexUsage classifies 5h vs weekly by duration", () => {
    const both = parseCodexUsage({
        rate_limit: {
            primary_window: {
                used_percent: 24,
                reset_after_seconds: 7200,
                limit_window_seconds: 18000,
            },
            secondary_window: {
                used_percent: 41,
                reset_after_seconds: 259200,
                limit_window_seconds: 604800,
            },
        },
    });
    assert.ok(both);
    assert.equal(both.sessionPercent, 24);
    assert.equal(both.weeklyPercent, 41);
    assert.equal(both.sessionIsFiveHour, true);

    const weeklyOnly = parseCodexUsage({
        rate_limit: {
            primary_window: {
                used_percent: 74,
                reset_after_seconds: 400000,
                limit_window_seconds: 604800,
            },
            secondary_window: null,
        },
    });
    assert.ok(weeklyOnly);
    assert.equal(weeklyOnly.sessionIsFiveHour, false);
    assert.equal(weeklyOnly.weeklyPercent, 74);
});

test("parseGoogleQuota reads weekly-only summary groups", () => {
    const now = Date.parse("2026-08-24T21:01:14Z");
    const usage = parseGoogleQuota(
        {
            groups: [
                {
                    buckets: [
                        {
                            bucketId: "gemini-weekly",
                            window: "weekly",
                            resetTime: "2026-08-31T06:26:55Z",
                            remainingFraction: 0.9884992,
                        },
                    ],
                },
                {
                    buckets: [
                        {
                            bucketId: "3p-weekly",
                            window: "weekly",
                            resetTime: "2026-08-31T21:01:15Z",
                            remainingFraction: 1,
                        },
                    ],
                },
            ],
        },
        now,
    );
    assert.ok(usage);
    assert.equal(usage.sessionIsFiveHour, false);
    assert.ok(usage.weeklyPercent > 1 && usage.weeklyPercent < 2);
    assert.equal(usage.weeklyPercent, usage.sessionPercent);
});

test("parseGoogleQuota keeps 5h when a group reports it", () => {
    const usage = parseGoogleQuota({
        groups: [
            {
                buckets: [
                    {
                        window: "5h",
                        remainingFraction: 0.5,
                        resetTime: "2026-08-24T22:00:00Z",
                    },
                    {
                        window: "weekly",
                        remainingFraction: 0.75,
                        resetTime: "2026-08-31T06:00:00Z",
                    },
                ],
            },
        ],
    });
    assert.ok(usage);
    assert.equal(usage.sessionIsFiveHour, true);
    assert.equal(usage.sessionPercent, 50);
    assert.equal(usage.weeklyPercent, 25);
});

test("parseGrokBilling reads weekly credits", () => {
    const now = Date.parse("2026-08-17T12:07:37.089603+00:00");
    const usage = parseGrokBilling(
        {
            config: {
                creditUsagePercent: 1.0,
                currentPeriod: {
                    type: "USAGE_PERIOD_TYPE_WEEKLY",
                    end: "2026-08-24T12:07:37.089603+00:00",
                },
            },
        },
        now,
    );
    assert.ok(usage);
    assert.equal(usage.sessionPercent, 1);
    assert.equal(usage.weeklyPercent, 1);
    assert.equal(usage.resetsInSeconds, null);
    assert.equal(usage.weeklyResetsInSeconds, 7 * 24 * 3600);
});

test("formatLocalWhen is local wall clock", () => {
    const now = new Date(2026, 7, 17, 12, 7, 0).getTime();
    assert.equal(
        formatLocalWhen(new Date(2026, 7, 17, 14, 7, 0).getTime(), now),
        "14:07",
    );
    assert.equal(
        formatLocalWhen(new Date(2026, 7, 20, 12, 7, 0).getTime(), now),
        "Thu 12:07",
    );
    assert.equal(
        formatLocalWhen(new Date(2026, 7, 31, 6, 26, 0).getTime(), now),
        "31 Aug 06:26",
    );
});

test("formatResetWhen is absolute (relative)", () => {
    const now = new Date(2026, 7, 17, 12, 7, 0).getTime();
    assert.equal(formatResetWhen(7200, now), "14:07 (2h)");
    assert.equal(formatResetWhen(3 * 86400, now), "Thu 12:07 (3d)");
    assert.equal(formatResetWhen(7200, now, now + 3600_000), "14:07 (1h)");
});

test("quotaProvider maps direct accounts only", () => {
    assert.equal(quotaProvider("xai"), "grok");
    assert.equal(quotaProvider("anthropic"), "claude");
    assert.equal(quotaProvider("openai-codex"), "codex");
    assert.equal(quotaProvider("agy"), "antigravity");
    assert.equal(quotaProvider("gateway"), null);
    assert.equal(quotaProvider("claude-bridge"), null);
});

test("current line shows quota reset", () => {
    const now = new Date(2026, 7, 17, 12, 7, 0).getTime();
    const quota = `79% wk · ${formatResetWhen(3 * 86400, now)}`;
    const plains = currentLineSegments({
        ...sample,
        quota,
        quotaPercent: 79,
    }).map((s) => s.plain);
    assert.equal(plains[2], quota);
});

test("footer still lists every provider, without reset times", () => {
    const grok = {
        name: "grok",
        usage: {
            sessionPercent: 79,
            weeklyPercent: 79,
            resetsInSeconds: null,
            weeklyResetsInSeconds: 3 * 86400,
        },
    };
    const claude = {
        name: "claude",
        usage: {
            sessionPercent: 24,
            weeklyPercent: 41,
            resetsInSeconds: 7200,
            weeklyResetsInSeconds: 259200,
            sessionIsFiveHour: true,
        },
    };
    const line = renderFooterLines(theme, [grok, claude], 200)[0];
    assert.match(line, /grok 79% wk/);
    assert.match(line, /claude 24% 5h \/ 41% wk/);
    assert.ok(!line.includes("14:07"));
    assert.ok(!line.includes("resets"));
});

test("quotaSnapshot pins wall clock to fetch time", () => {
    const now = new Date(2026, 7, 17, 12, 7, 0).getTime();
    const grok = {
        name: "grok",
        usage: {
            sessionPercent: 79,
            weeklyPercent: 79,
            resetsInSeconds: null,
            weeklyResetsInSeconds: 7200,
        },
    };
    const later = quotaSnapshot([grok], "xai", now, now + 3600_000);
    assert.equal(later.quotaPercent, 79);
    assert.equal(later.quota, "79% wk · 14:07 (1h)");
    assert.equal(quotaSnapshot([grok], "gateway", now, now).quota, null);
});
