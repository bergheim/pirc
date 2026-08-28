import assert from "node:assert/strict";
import test from "node:test";
import { clockDataForMessage } from "./entry.ts";

test("first user message owns the live clock", () => {
    const first = clockDataForMessage("user", 1000, true);
    assert.deepEqual(first, {
        data: { t: 1000, live: true },
        liveEntryPending: false,
    });
    assert.deepEqual(clockDataForMessage("user", 1500, false), {
        data: { t: 1500 },
        liveEntryPending: false,
    });
    assert.deepEqual(clockDataForMessage("assistant", 2000, false), {
        data: { t: 2000 },
        liveEntryPending: false,
    });
});
