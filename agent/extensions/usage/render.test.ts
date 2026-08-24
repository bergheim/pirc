import assert from "node:assert/strict";
import test from "node:test";
import {
  barColor,
  contextTone,
  cacheRemainingSeconds,
  cells,
  cacheTone,
  currentLineSegments,
  fitSegments,
  formatDuration,
  formatK,
  formatRemaining,
  promptCacheTtlSeconds,
  renderBar,
  renderCurrentLine,
  TONE,
  type CurrentSession,
} from "./render.ts";
import {
  parseCodexUsage,
  parseGoogleQuota,
  parseGrokBilling,
} from "./parse.ts";
import { recentEditedPaths } from "./index.ts";

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
  cost: 1.23,
  cacheRemainingSeconds: null,
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
              { type: "toolCall", name: "edit", arguments: { path: "/old" } },
            ],
          },
        },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "toolCall", name: "write", arguments: { path: "/new" } },
              { type: "toolCall", name: "edit", arguments: { path: "/old" } },
            ],
          },
        },
      ],
    },
  };
  assert.deepEqual(recentEditedPaths(ctx as never), ["/old", "/new"]);
});

test("formatK", () => {
  assert.equal(formatK(0), "0");
  assert.equal(formatK(42), "42");
  assert.equal(formatK(85400), "85k");
  assert.equal(formatK(200000), "200k");
  assert.equal(formatK(Number.NaN), "0");
});

test("barColor is quiet until 70/90", () => {
  assert.equal(barColor(0), null);
  assert.equal(barColor(69.9), null);
  assert.equal(barColor(70), "yellow");
  assert.equal(barColor(89.9), "yellow");
  assert.equal(barColor(90), "red");
});

test("contextTone is yellow at 200k, red at 500k", () => {
  assert.equal(contextTone(111_000), null);
  assert.equal(contextTone(199_999), null);
  assert.equal(contextTone(200_000), TONE.yellow);
  assert.equal(contextTone(499_999), TONE.yellow);
  assert.equal(contextTone(500_000), TONE.red);
  assert.equal(contextTone(null), "dim");
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

test("current line includes modern session context", () => {
  const plains = currentLineSegments(sample).map((s) => s.plain);
  assert.equal(plains[0], "󰚩 xai/grok-4.6");
  assert.ok(plains.includes("󰔛 medium"));
  assert.ok(plains.includes(" jolo"));
  assert.ok(plains.includes(" master ●"));
  assert.ok(plains.includes("󰍛 ctx 42% 120k/500k"));
  assert.ok(plains.includes("󰔚 $1.23"));
});

test("omits thinking and branch when absent", () => {
  const plains = currentLineSegments({
    ...sample,
    thinking: null,
    branch: null,
    dirty: false,
  }).map((s) => s.plain);
  assert.equal(plains[0], "󰚩 xai/grok-4.6");
  assert.ok(!plains.some((p) => p.includes("master")));
});

test("fitSegments drops cost before context", () => {
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
  assert.ok(noCost.some((s) => s.key === "context"));

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
  const plains = currentLineSegments({
    ...sample,
    cacheRemainingSeconds: 272,
  }).map((s) => s.plain);
  assert.ok(plains.includes("󰒍 cache 4m 32s"));
});

test("cacheTone yellow then red as it nears", () => {
  assert.equal(cacheTone(272), "dim");
  assert.equal(cacheTone(119), TONE.yellow);
  assert.equal(cacheTone(30), TONE.yellow);
  assert.equal(cacheTone(29), TONE.red);
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
    null,
  );
  assert.equal(promptCacheTtlSeconds("openai-codex", "gpt-5.6", "long"), 86400);
  assert.equal(
    promptCacheTtlSeconds(
      "gateway",
      "openrouter/anthropic/claude-opus-5",
      undefined,
    ),
    300,
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
