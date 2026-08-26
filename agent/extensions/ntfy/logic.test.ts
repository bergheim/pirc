import assert from "node:assert/strict";
import test from "node:test";
import {
    formatElapsed,
    hostTopic,
    ntfyUrl,
    onAgentStart,
    onSessionStart,
    onSettled,
    onShutdown,
    parseThreshold,
    titleFor,
} from "./logic.ts";

test("formatElapsed buckets", () => {
    assert.equal(formatElapsed(12), "12s");
    assert.equal(formatElapsed(83), "1m 23s");
    assert.equal(formatElapsed(60), "1m");
    assert.equal(formatElapsed(3720), "1h 2m");
    assert.equal(formatElapsed(3600), "1h");
    assert.equal(formatElapsed(-1), "");
    assert.equal(formatElapsed(Number.NaN), "");
});

test("parseThreshold defaults and rejects junk", () => {
    assert.equal(parseThreshold(undefined), 60);
    assert.equal(parseThreshold(""), 60);
    assert.equal(parseThreshold("  "), 60);
    assert.equal(parseThreshold("20"), 20);
    assert.equal(parseThreshold("0"), 0);
    assert.equal(parseThreshold("nope"), 60);
    assert.equal(parseThreshold("-5"), 60);
});

test("hostTopic defaults to pi", () => {
    assert.equal(hostTopic(undefined), "pi");
    assert.equal(hostTopic("  "), "pi");
    assert.equal(hostTopic("laptop"), "laptop");
});

test("ntfyUrl strips slash and encodes topic", () => {
    assert.equal(
        ntfyUrl("http://burial.ts.glvortex.net:9080/", "pi"),
        "http://burial.ts.glvortex.net:9080/pi",
    );
});

test("titleFor includes elapsed when present", () => {
    assert.equal(titleFor("emacs", 83), "emacs - pi done (1m 23s)");
    assert.equal(titleFor("emacs"), "emacs - pi done");
});

test("lifecycle: tui stamps once, notifies if slow, always on quit", () => {
    let cycle = onSessionStart("tui");
    const first = onAgentStart(cycle, 0);
    assert.equal(first.stamp, true);
    cycle = first.cycle;
    assert.equal(onAgentStart(cycle, 1000).stamp, false);

    const settled = onSettled(cycle, 61_000, 60);
    assert.equal(settled.notify, true);
    assert.equal(settled.elapsed, 61);
    assert.equal(onShutdown(settled.cycle, "quit"), true);
});

test("lifecycle: print mode and fast turns stay quiet", () => {
    const print = onSessionStart("print");
    assert.equal(onAgentStart(print, 0).stamp, false);
    assert.equal(onSettled(print, 120_000, 60).notify, false);
    assert.equal(onShutdown(print, "quit"), false);

    let tui = onAgentStart(onSessionStart("tui"), 0).cycle;
    assert.equal(onSettled(tui, 10_000, 60).notify, false);
    tui = onAgentStart(onSessionStart("tui"), 0).cycle;
    assert.equal(onShutdown(tui, "reload"), false);
});
