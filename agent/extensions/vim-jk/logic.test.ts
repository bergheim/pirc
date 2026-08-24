import assert from "node:assert/strict";
import test from "node:test";
import { historyDir, jkStep, vimBusy } from "./logic.ts";

test("history only on bare normal-mode edge j/k", () => {
	assert.equal(historyDir("normal", "k", true, false, false), -1);
	assert.equal(historyDir("normal", "j", false, true, false), 1);
	assert.equal(historyDir("normal", "k", false, false, false), 0);
	assert.equal(historyDir("insert", "k", true, false, false), 0);
	assert.equal(historyDir("normal", "k", true, false, true), 0);
	assert.equal(historyDir("visual", "j", false, true, false), 0);
});

test("jk: j types now; k undoes; other key just disarms", () => {
	assert.deepEqual(jkStep(false, "j"), { type: "type-j" });
	assert.deepEqual(jkStep(true, "k"), { type: "undo-esc" });
	assert.deepEqual(jkStep(true, "a"), { type: "armed" });
	assert.deepEqual(jkStep(true, "j"), { type: "type-j" });
	assert.equal(jkStep(false, "jk"), null);
	assert.equal(jkStep(false, "a"), null);
});

test("vimBusy sees pending operator / count", () => {
	assert.equal(vimBusy({}), false);
	assert.equal(vimBusy({ pendingOperator: "d" }), true);
	assert.equal(vimBusy({ prefixCount: "3" }), true);
	assert.equal(vimBusy({ pendingExCommand: "q" }), true);
});
