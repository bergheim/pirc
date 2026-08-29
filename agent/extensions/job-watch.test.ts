import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import jobWatch from "./job-watch.ts";

interface ToolResult {
    content: unknown;
    details: Record<string, unknown>;
}

interface FakeTool {
    name: string;
    execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: undefined,
        onUpdate: undefined,
        ctx: unknown,
    ) => Promise<ToolResult>;
}

interface SentMessage {
    content: string;
    options: unknown;
}

// Timers are faked for the whole file: the extension arms its poll interval
// inside execute(), not only while the factory runs.
let timers: Array<() => void> = [];
let cleared: number[] = [];
globalThis.setInterval = ((fn: () => void) =>
    timers.push(fn)) as unknown as typeof setInterval;
globalThis.clearInterval = ((id: number) =>
    cleared.push(id)) as unknown as typeof clearInterval;

function fakeUi() {
    const widgets: Array<[string, unknown]> = [];
    return {
        widgets,
        lastWidget: () => widgets[widgets.length - 1],
        ctx: {
            hasUI: true,
            ui: {
                setWidget(key: string, value: unknown) {
                    widgets.push([key, value]);
                },
                notify() {},
            },
        },
    };
}

function harness(stdouts: string[]) {
    timers = [];
    cleared = [];
    const messages: SentMessage[] = [];
    const tools = new Map<string, FakeTool>();
    let execs = 0;

    const pi = {
        registerTool(tool: FakeTool) {
            tools.set(tool.name, tool);
        },
        registerCommand() {},
        on() {},
        async exec() {
            const stdout = stdouts[Math.min(execs, stdouts.length - 1)];
            execs += 1;
            return { code: 0, stderr: "", stdout };
        },
        sendMessage(message: { content: string }, options: unknown) {
            messages.push({ content: message.content, options });
        },
    };

    jobWatch(pi as unknown as ExtensionAPI);

    return {
        tool(name: string): FakeTool {
            const tool = tools.get(name);
            if (!tool) throw new Error(`tool ${name} not registered`);
            return tool;
        },
        tick: async () => {
            const [fn] = timers;
            if (!fn) throw new Error("no poll timer armed");
            await fn();
        },
        cleared: () => cleared,
        messages,
        execCount: () => execs,
    };
}

const running = JSON.stringify({
    id: "run-1",
    label: "Fake job",
    state: "running",
    current: 1,
    total: 2,
});

function done(result: unknown) {
    return JSON.stringify({
        id: "run-1",
        label: "Fake job",
        state: "done",
        result,
    });
}

function startWatch(
    h: ReturnType<typeof harness>,
    ui: ReturnType<typeof fakeUi>,
) {
    return h.tool("watch_job").execute(
        "call-1",
        {
            id: "run-1",
            label: "Fake job",
            program: "fake-probe",
            args: [],
            intervalSeconds: 5,
        },
        undefined,
        undefined,
        ui.ctx,
    );
}

test("progress reaches the widget and completion wakes the agent once", async () => {
    const h = harness([running, done({ ok: true })]);
    const ui = fakeUi();
    await startWatch(h, ui);

    assert.deepEqual(ui.widgets[0], [
        "job-watch",
        ["Fake job · running · 󰔛 1/2"],
    ]);

    await h.tick();
    await h.tick();

    assert.equal(h.execCount(), 2, "a terminal watch stops probing");
    assert.equal(h.messages.length, 1, "a terminal watch wakes exactly once");
    const [wake] = h.messages;
    assert.deepEqual(wake?.options, {
        triggerTurn: true,
        deliverAs: "followUp",
    });
    assert.match(String(wake?.content), /Watched job done: Fake job/);
    assert.equal(
        ui.lastWidget()?.[1],
        undefined,
        "the widget clears at terminal",
    );
    assert.deepEqual(h.cleared(), [1]);
});

test("oversized results are truncated before reaching context", async () => {
    const h = harness([done({ blob: "x".repeat(20_000) })]);
    const ui = fakeUi();
    await startWatch(h, ui);

    const content = String(h.messages[0]?.content);
    assert.ok(
        content.length < 8_000,
        `wake message too big: ${content.length}`,
    );
    assert.match(content, /result truncated/);
});

test("unwatch_job stops monitoring and leaves the job alone", async () => {
    const h = harness([running]);
    const ui = fakeUi();
    await startWatch(h, ui);

    const stopped = await h
        .tool("unwatch_job")
        .execute("call-2", { id: "run-1" }, undefined, undefined, ui.ctx);
    assert.deepEqual(stopped.details, { id: "run-1", stopped: true });
    assert.deepEqual(h.cleared(), [1], "the poll timer is cleared");
    assert.equal(ui.lastWidget()?.[1], undefined);

    const execsBefore = h.execCount();
    await h.tick();
    assert.equal(h.execCount(), execsBefore, "a dropped watch stops probing");

    const missing = await h
        .tool("unwatch_job")
        .execute("call-3", { id: "nope" }, undefined, undefined, ui.ctx);
    assert.deepEqual(missing.details, { id: "nope", stopped: false });
});
