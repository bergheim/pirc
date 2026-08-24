import assert from "node:assert/strict";
import test from "node:test";
import { wrapEditor } from "./index.ts";

function fake(init?: Partial<{ mode: string; line: number; last: number }>) {
	const got: string[] = [];
	const hist: number[] = [];
	const ed = {
		mode: init?.mode ?? "insert",
		line: init?.line ?? 0,
		last: init?.last ?? 0,
		handleInput(data: string) {
			got.push(data);
		},
		getMode() {
			return this.mode;
		},
		getCursor() {
			return { line: this.line };
		},
		isOnFirstVisualLine() {
			return this.line === 0;
		},
		isOnLastVisualLine() {
			return this.line === this.last;
		},
		navigateHistory(dir: number) {
			hist.push(dir);
		},
	};
	wrapEditor(ed);
	return { ed, got, hist };
}

test("j draws immediately; jk backspaces then escapes", () => {
	const { ed, got } = fake();
	ed.handleInput("j");
	assert.deepEqual(got, ["j"]);
	ed.handleInput("k");
	assert.deepEqual(got, ["j", "\x7f", "\x1b"]);
});

test("paste jk is not a mapping", () => {
	const { ed, got } = fake();
	ed.handleInput("jk");
	assert.deepEqual(got, ["jk"]);
});

test("normal k at top browses older history", () => {
	const { ed, got, hist } = fake({ mode: "normal", line: 0, last: 2 });
	ed.handleInput("k");
	assert.deepEqual(hist, [-1]);
	assert.deepEqual(got, []);
});

test("normal j mid-buffer is a motion", () => {
	const { ed, got, hist } = fake({ mode: "normal", line: 1, last: 2 });
	ed.handleInput("j");
	assert.deepEqual(got, ["j"]);
	assert.deepEqual(hist, []);
});
