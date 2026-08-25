/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
    allowedFrom,
    assistantText,
    bareJid,
    chunkText,
    CHATSTATES,
    inboundFrom,
    chatState,
    phoneCommand,
    skillLines,
    userText,
} from "./lib.ts";

test("bareJid strips resource and lowercases", () => {
    assert.equal(
        bareJid("TSB@xmpp.glvortex.net/Conversations"),
        "tsb@xmpp.glvortex.net",
    );
    assert.equal(bareJid("tsb@xmpp.glvortex.net"), "tsb@xmpp.glvortex.net");
});

test("inboundFrom rejects forged received carbons", () => {
    const self = "pi@xmpp.glvortex.net";
    const peer = "tsb@xmpp.glvortex.net/phone";
    assert.equal(
        inboundFrom({
            outerFrom: self,
            innerFrom: peer,
            receivedCarbon: true,
            self,
        }),
        peer,
    );
    assert.equal(
        inboundFrom({
            outerFrom: "evil@xmpp.glvortex.net",
            innerFrom: peer,
            receivedCarbon: true,
            self,
        }),
        undefined,
    );
    assert.equal(
        inboundFrom({
            outerFrom: peer,
            innerFrom: peer,
            receivedCarbon: false,
            self,
        }),
        peer,
    );
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

test("phoneCommand reserved first line", () => {
    assert.equal(phoneCommand("/stop"), "stop");
    assert.equal(phoneCommand("/STOP now"), "stop");
    assert.equal(phoneCommand("/phone off"), "phone-off");
    assert.equal(phoneCommand("/phone"), undefined);
    assert.equal(phoneCommand("/skills"), "skills");
    assert.equal(phoneCommand("stop"), undefined);
});

test("skillLines lists $names", () => {
    assert.deepEqual(
        skillLines([
            { name: "skill:ponytail", source: "skill" },
            { name: "phone", source: "command" },
            { name: "skill:j-save", source: "skill" },
        ]),
        ["$j-save", "$ponytail"],
    );
});

test("chatState reads XEP-0085", () => {
    const kids = new Set([`composing:${CHATSTATES}`]);
    assert.equal(
        chatState((name, ns) => (kids.has(`${name}:${ns}`) ? {} : undefined)),
        "composing",
    );
    assert.equal(
        chatState(() => undefined),
        undefined,
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
