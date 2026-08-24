/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
    allowedFrom,
    assistantText,
    bareJid,
    chunkText,
    userText,
} from "./lib.ts";

test("bareJid strips resource and lowercases", () => {
    assert.equal(
        bareJid("TSB@xmpp.glvortex.net/Conversations"),
        "tsb@xmpp.glvortex.net",
    );
    assert.equal(bareJid("tsb@xmpp.glvortex.net"), "tsb@xmpp.glvortex.net");
});

test("allowedFrom matches bare JID only", () => {
    assert.equal(
        allowedFrom("tsb@xmpp.glvortex.net/phone", "tsb@xmpp.glvortex.net"),
        true,
    );
    assert.equal(
        allowedFrom("other@xmpp.glvortex.net/phone", "tsb@xmpp.glvortex.net"),
        false,
    );
});

test("chunkText splits on max", () => {
    assert.deepEqual(chunkText("abcd", 2), ["ab", "cd"]);
    assert.deepEqual(chunkText("ab", 4), ["ab"]);
});

test("assistantText joins text parts and ignores tools", () => {
    assert.equal(
        assistantText({
            role: "assistant",
            content: [
                { type: "text", text: "hi " },
                { type: "toolCall", name: "bash" },
                { type: "text", text: "there" },
            ],
        }),
        "hi there",
    );
    assert.equal(assistantText({ role: "user", content: "nope" }), "");
});

test("userText reads user content", () => {
    assert.equal(userText({ role: "user", content: "from tui" }), "from tui");
    assert.equal(userText({ role: "assistant", content: "nope" }), "");
});
