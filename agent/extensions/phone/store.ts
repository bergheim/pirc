import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { KeyPair, OMEMOStore } from "libomemo.js";
import { abToB64, b64ToAb } from "./payload.ts";

type Wrapper = { keyPair: KeyPair };

function revive(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(revive);
    if (!value || typeof value !== "object") return value;
    const rec = value as Record<string, unknown>;
    if (typeof rec.__ab === "string") return b64ToAb(rec.__ab);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = revive(v);
    return out;
}

function encode(value: unknown): unknown {
    if (value instanceof ArrayBuffer) return { __ab: abToB64(value) };
    if (ArrayBuffer.isView(value)) {
        const view = value as ArrayBufferView;
        const copy = new Uint8Array(view.byteLength);
        copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
        return { __ab: abToB64(copy.buffer) };
    }
    if (Array.isArray(value)) return value.map(encode);
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = encode(v);
    }
    return out;
}

export class FileStore implements OMEMOStore {
    store: Record<string, unknown> = {};
    private readonly path: string;

    constructor(path: string) {
        this.path = path;
        try {
            const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
            this.store = (revive(raw) as Record<string, unknown>) ?? {};
        } catch {
            this.store = {};
        }
    }

    persist(): void {
        mkdirSync(dirname(this.path), { recursive: true });
        const tmp = `${this.path}.tmp`;
        writeFileSync(tmp, JSON.stringify(encode(this.store)));
        renameSync(tmp, this.path);
    }

    put(key: string, value: unknown): void {
        if (key == null || value == null) throw new Error("store null");
        this.store[key] = value;
        this.persist();
    }

    get<T = unknown>(key: string, defaultValue?: T): T | undefined {
        if (key in this.store) return this.store[key] as T;
        return defaultValue;
    }

    remove(key: string): void {
        delete this.store[key];
        this.persist();
    }

    getIdentityKeyPair(): KeyPair | undefined {
        return this.get<KeyPair>("identityKey");
    }

    getLocalRegistrationId(): number | undefined {
        return this.get<number>("registrationId");
    }

    isTrustedIdentity(address: string, identityKey: ArrayBuffer): boolean {
        const trusted = this.get<ArrayBuffer>(`identityKey${address}`);
        if (!trusted) return true;
        return abToB64(trusted) === abToB64(identityKey);
    }

    loadIdentityKey(address: string): ArrayBuffer | undefined {
        return this.get<ArrayBuffer>(`identityKey${address}`);
    }

    saveIdentity(address: string, identityKey: ArrayBuffer): boolean {
        const existing = this.get<ArrayBuffer>(`identityKey${address}`);
        this.put(`identityKey${address}`, identityKey);
        return Boolean(existing && abToB64(existing) !== abToB64(identityKey));
    }

    loadPreKey(keyId: number | string): Promise<Wrapper | undefined> {
        const res = this.get<KeyPair>(`25519KeypreKey${keyId}`);
        return Promise.resolve(res ? { keyPair: res } : undefined);
    }

    storePreKey(keyId: number | string, keyPair: KeyPair): void {
        this.put(`25519KeypreKey${keyId}`, keyPair);
    }

    removePreKey(keyId: number | string): void {
        this.remove(`25519KeypreKey${keyId}`);
    }

    loadSignedPreKey(keyId: number): Wrapper | undefined {
        const res = this.get<KeyPair>(`25519KeysignedKey${keyId}`);
        return res ? { keyPair: res } : undefined;
    }

    storeSignedPreKey(keyId: number | string, keyPair: KeyPair): void {
        this.put(`25519KeysignedKey${keyId}`, keyPair);
    }

    removeSignedPreKey(keyId: number | string): void {
        this.remove(`25519KeysignedKey${keyId}`);
    }

    loadSession(address: string): string | undefined {
        return this.get<string>(`session${address}`);
    }

    storeSession(address: string, record: string): void {
        this.put(`session${address}`, record);
    }

    removeSession(address: string): void {
        this.remove(`session${address}`);
    }

    removeAllSessions(jid: string): void {
        for (const key of Object.keys(this.store)) {
            if (key.startsWith(`session${jid}`)) delete this.store[key];
        }
        this.persist();
    }
}
