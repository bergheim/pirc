import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration } from "./format.ts";

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
