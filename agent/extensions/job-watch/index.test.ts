import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import jobWatch from "./index.ts";

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
let timers: Array<{ fn: () => void; ms: number }> = [];
let cleared: number[] = [];
globalThis.setInterval = ((fn: () => void, ms: number) =>
    timers.push({ fn, ms })) as unknown as typeof setInterval;
globalThis.clearInterval = ((id: number) =>
    cleared.push(id)) as unknown as typeof clearInterval;

interface WidgetComponent {
    render: (width: number) => string[];
    invalidate: () => void;
}

type WidgetValue =
    | undefined
    | ((tui: { requestRender: () => void }) => WidgetComponent);

function fakeUi() {
    const widgets: Array<[string, WidgetValue]> = [];
    let renders = 0;
    let component: WidgetComponent | undefined;
    const tui = {
        requestRender: () => {
            renders += 1;
        },
    };
    return {
        widgets,
        renderCount: () => renders,
        // Mirrors the TUI: the factory is invoked once, then the same component
        // is re-rendered whenever a repaint is requested.
        lines(): string[] | undefined {
            const last = widgets[widgets.length - 1];
            if (!last) return undefined;
            const factory = last[1];
            if (!factory) return undefined;
            component ??= factory(tui);
            return component.render(80);
        },
        ctx: {
            hasUI: true,
            ui: {
                setWidget(key: string, value: WidgetValue) {
                    if (!value) component = undefined;
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
            const poll = timers.find((timer) => timer.ms >= 5_000);
            if (!poll) throw new Error("no poll timer armed");
            await poll.fn();
        },
        tickClock: () => {
            const repaint = timers.find((timer) => timer.ms === 1_000);
            if (!repaint) throw new Error("no repaint timer armed");
            repaint.fn();
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

    assert.deepEqual(ui.lines(), ["Fake job · running · 1/2 · 󰔛 0s"]);

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
    assert.equal(ui.lines(), undefined, "the widget clears at terminal");
    assert.deepEqual(h.cleared(), [2, 1], "poll and repaint timers both stop");
});

test("later progress asks the TUI to repaint", async () => {
    const later = JSON.stringify({
        id: "run-1",
        label: "Fake job",
        state: "running",
        current: 2,
        total: 2,
    });
    const h = harness([running, later]);
    const ui = fakeUi();
    await startWatch(h, ui);
    ui.lines(); // the TUI builds the component on its first paint

    assert.equal(ui.renderCount(), 0);
    await h.tick();
    assert.equal(
        ui.renderCount(),
        1,
        "an idle agent draws no frames on its own",
    );
    assert.deepEqual(ui.lines(), ["Fake job · running · 2/2 · 󰔛 0s"]);
});

test("the elapsed clock ticks between polls", async () => {
    const h = harness([running]);
    const ui = fakeUi();
    const now = Date.now;
    try {
        await startWatch(h, ui);
        ui.lines();

        Date.now = () => now() + 65_000;
        h.tickClock();
        assert.equal(ui.renderCount(), 1, "the repaint runs without a poll");
        assert.equal(h.execCount(), 1, "the clock never probes");
        assert.deepEqual(ui.lines(), ["Fake job · running · 1/2 · 󰔛 1m05s"]);
    } finally {
        Date.now = now;
    }
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
    assert.deepEqual(h.cleared(), [2, 1], "poll and repaint timers both stop");
    assert.equal(ui.lines(), undefined);

    const execsBefore = h.execCount();
    await h.tick();
    assert.equal(h.execCount(), execsBefore, "a dropped watch stops probing");

    const missing = await h
        .tool("unwatch_job")
        .execute("call-3", { id: "nope" }, undefined, undefined, ui.ctx);
    assert.deepEqual(missing.details, { id: "nope", stopped: false });
});
