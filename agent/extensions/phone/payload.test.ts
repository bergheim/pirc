/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { decryptPayload, encryptPayload } from "./payload.ts";

test("payload roundtrip", async () => {
    const enc = await encryptPayload("hello phone");
    const out = await decryptPayload(enc.keyAndTag, enc.ciphertext, enc.iv);
    assert.equal(out, "hello phone");
});
