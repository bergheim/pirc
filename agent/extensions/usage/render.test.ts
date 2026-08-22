import assert from "node:assert/strict";
import test from "node:test";
import {
  barColor,
  currentLineSegments,
  fitSegments,
  formatDuration,
  formatK,
  renderBar,
  renderCurrentLine,
  type CurrentSession,
} from "./render.ts";
import { parseGrokBilling } from "./parse.ts";

const theme = { fg: (_color: string, text: string) => text };

const sample: CurrentSession = {
  provider: "xai",
  modelId: "grok-4.6",
  thinking: "medium",
  dir: "jolo",
  branch: "master",
  percent: 42,
  tokens: 85400,
  contextWindow: 200000,
  cost: 1.23,
  fiveHour: { percent: 24, resetsInSeconds: 7200 },
  week: { percent: 41, resetsInSeconds: 259200 },
};

test("formatK", () => {
  assert.equal(formatK(0), "0");
  assert.equal(formatK(42), "42");
  assert.equal(formatK(85400), "85k");
  assert.equal(formatK(200000), "200k");
  assert.equal(formatK(Number.NaN), "0");
});

test("barColor thresholds match Claude", () => {
  assert.equal(barColor(0), "green");
  assert.equal(barColor(69.9), "green");
  assert.equal(barColor(70), "yellow");
  assert.equal(barColor(89.9), "yellow");
  assert.equal(barColor(90), "red");
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

test("current line includes context and both windows", () => {
  const plains = currentLineSegments(sample).map((s) => s.plain);
  assert.equal(plains[0], "[xai/grok-4.6 medium]");
  assert.ok(plains.includes("jolo"));
  assert.ok(plains.includes("master"));
  assert.ok(plains.some((p) => p.includes("42%")));
  assert.ok(plains.includes("(85k/200k)"));
  assert.ok(plains.includes("5h 24%→2h"));
  assert.ok(plains.includes("7d 41%→3d"));
  assert.ok(plains.includes("$1.23"));
});

test("omits thinking, branch, and empty windows", () => {
  const plains = currentLineSegments({
    ...sample, thinking: null, branch: null, fiveHour: null, week: null,
  }).map((s) => s.plain);
  assert.equal(plains[0], "[xai/grok-4.6]");
  assert.ok(!plains.includes("master"));
  assert.ok(!plains.some((p) => p.startsWith("5h") || p.startsWith("7d")));
});

test("fitSegments drops cost before windows and context", () => {
  const segs = currentLineSegments(sample);
  const full = fitSegments(segs, 200);
  assert.ok(full.some((s) => s.plain.startsWith("$")));

  const cost = segs.find((s) => s.key === "cost")!;
  const widthWithoutCost = segs.reduce((n, s) => n + s.plain.length, 0) + (segs.length - 1) - cost.plain.length - 1;
  const noCost = fitSegments(segs, widthWithoutCost);
  assert.ok(!noCost.some((s) => s.plain.startsWith("$")));
  assert.ok(noCost.some((s) => s.key === "bar"));
  assert.ok(noCost.some((s) => s.key === "five" || s.key === "week"));

  const modelOnly = fitSegments(segs, 10);
  assert.equal(modelOnly.length, 1);
  assert.ok(modelOnly[0].plain.startsWith("[xai"));
});

test("renderCurrentLine stays within width", () => {
  const line = renderCurrentLine(theme, sample, 40);
  assert.ok(line.length <= 40);
  assert.ok(line.includes("[xai/grok-4.6 medium]"));
});

test("parseGrokBilling reads weekly credits", () => {
  const now = Date.parse("2026-08-17T12:07:37.089603+00:00");
  const usage = parseGrokBilling({
    config: {
      creditUsagePercent: 1.0,
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        end: "2026-08-24T12:07:37.089603+00:00",
      },
    },
  }, now);
  assert.ok(usage);
  assert.equal(usage.sessionPercent, 1);
  assert.equal(usage.weeklyPercent, 1);
  assert.equal(usage.resetsInSeconds, null);
  assert.equal(usage.weeklyResetsInSeconds, 7 * 24 * 3600);
});
