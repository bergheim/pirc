import assert from "node:assert/strict";
import test from "node:test";
import {
    CLOCK_DONE,
    CLOCK_LIVE,
    formatDuration,
    stampText,
} from "./format.ts";

test("formatDuration buckets", () => {
    assert.equal(formatDuration(850), "850ms");
    assert.equal(formatDuration(12_000), "12s");
    assert.equal(formatDuration(83_000), "1m 23s");
    assert.equal(formatDuration(60_000), "1m");
    assert.equal(formatDuration(3_720_000), "1h 2m");
    assert.equal(formatDuration(3_600_000), "1h");
    assert.equal(formatDuration(-1), "");
    assert.equal(formatDuration(Number.NaN), "");
});

test("stampText live vs settled duration", () => {
    assert.equal(stampText({ live: true }, 12_000), `${CLOCK_LIVE} 12s`);
    assert.equal(stampText({ live: true }), "");
    assert.equal(stampText({ d: 12_000 }, 99_000), `${CLOCK_DONE} took 12s`);
    assert.match(
        stampText({ t: Date.UTC(2026, 0, 1, 12, 0, 0), d: 12_000 }),
        new RegExp(`${CLOCK_DONE} took 12s$`),
    );
});
