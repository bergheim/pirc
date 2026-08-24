/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store.ts";

test("FileStore persists ArrayBuffers", () => {
    const dir = mkdtempSync(join(tmpdir(), "phone-omemo-"));
    const path = join(dir, "store.json");
    const a = new FileStore(path);
    const buf = new Uint8Array([1, 2, 3]).buffer;
    a.put("identityKey", { pubKey: buf, privKey: buf });
    a.put("registrationId", 42);
    const b = new FileStore(path);
    assert.equal(b.getLocalRegistrationId(), 42);
    const id = b.getIdentityKeyPair();
    assert.ok(id);
    assert.deepEqual([...new Uint8Array(id.pubKey)], [1, 2, 3]);
});

test("TOFU trusts first identity and rejects a swap", () => {
    const dir = mkdtempSync(join(tmpdir(), "phone-omemo-"));
    const store = new FileStore(join(dir, "store.json"));
    const first = new Uint8Array([9, 9]).buffer;
    const second = new Uint8Array([8, 8]).buffer;
    assert.equal(store.isTrustedIdentity("peer.1", first), true);
    store.saveIdentity("peer.1", first);
    assert.equal(store.isTrustedIdentity("peer.1", first), true);
    assert.equal(store.isTrustedIdentity("peer.1", second), false);
});
