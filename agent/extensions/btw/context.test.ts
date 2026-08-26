import assert from "node:assert/strict";
import test from "node:test";
import {
    MAX_CONTEXT_CHARS,
    buildConversationContext,
    extractText,
    truncateFromStart,
} from "./context.ts";

test("extractText joins text blocks and skips tools", () => {
    assert.equal(extractText("  hi  "), "hi");
    assert.equal(extractText(null), "");
    assert.equal(
        extractText([
            { type: "text", text: "one" },
            { type: "toolCall", name: "bash", arguments: { command: "rm" } },
            { type: "text", text: " two " },
        ]),
        "one\ntwo",
    );
});

test("buildConversationContext keeps user/assistant text only", () => {
    const snapshot = buildConversationContext([
        { type: "custom", message: { role: "user", content: "nope" } },
        {
            type: "message",
            message: {
                role: "user",
                content: [{ type: "text", text: "fix the footer" }],
            },
        },
        {
            type: "message",
            message: {
                role: "assistant",
                content: [
                    { type: "text", text: "ok" },
                    { type: "toolCall", name: "edit", arguments: { path: "x" } },
                ],
            },
        },
        {
            type: "message",
            message: { role: "toolResult", content: [{ type: "text", text: "huge" }] },
        },
    ]);
    assert.equal(snapshot, "User: fix the footer\n\nAssistant: ok");
});

test("truncateFromStart keeps the tail", () => {
    const text = "abcdefghij";
    assert.equal(truncateFromStart(text, 100), text);
    assert.match(truncateFromStart(text, 4), /ghij$/);
    assert.ok(truncateFromStart("x".repeat(MAX_CONTEXT_CHARS + 10), MAX_CONTEXT_CHARS).length > MAX_CONTEXT_CHARS);
});
