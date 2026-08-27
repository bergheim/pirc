import assert from "node:assert/strict";
import test from "node:test";
import { BTW_SPIN, btwSpinLine, startBtwProgress } from "./progress.ts";

test("btwSpinLine wraps frames", () => {
    assert.equal(btwSpinLine(0), `${BTW_SPIN[0]} btw`);
    assert.equal(btwSpinLine(BTW_SPIN.length), `${BTW_SPIN[0]} btw`);
});

test("startBtwProgress ticks then stop is idempotent", () => {
    const lines: (string | undefined)[] = [];
    const timers: Array<() => void> = [];
    const stop = startBtwProgress(
        (line) => {
            lines.push(line);
        },
        (fn) => {
            timers.push(fn as () => void);
            return 1 as unknown as ReturnType<typeof setInterval>;
        },
        () => {
            timers.length = 0;
        },
    );

    assert.deepEqual(lines, [`${BTW_SPIN[0]} btw`]);
    timers[0]();
    assert.deepEqual(lines, [`${BTW_SPIN[0]} btw`, `${BTW_SPIN[1]} btw`]);

    stop();
    assert.equal(lines.at(-1), undefined);
    assert.equal(timers.length, 0);

    const n = lines.length;
    stop();
    assert.equal(lines.length, n);
});
