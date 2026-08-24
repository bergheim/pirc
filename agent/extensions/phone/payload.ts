const KEY_ALGO: AesKeyGenParams = { name: "AES-GCM", length: 128 };
const TAG_BITS = 128;
const TAG_BYTES = TAG_BITS / 8;

export type Payload = {
    keyAndTag: ArrayBuffer;
    ciphertext: ArrayBuffer;
    iv: ArrayBuffer;
};

export async function encryptPayload(plaintext: string): Promise<Payload> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.generateKey(KEY_ALGO, true, [
        "encrypt",
        "decrypt",
    ]);
    const packed = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, tagLength: TAG_BITS },
        key,
        new TextEncoder().encode(plaintext),
    );
    const ciphertext = packed.slice(0, packed.byteLength - TAG_BYTES);
    const tag = packed.slice(packed.byteLength - TAG_BYTES);
    const raw = await crypto.subtle.exportKey("raw", key);
    const keyAndTag = concat(raw, tag);
    return { keyAndTag, ciphertext, iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) };
}

export async function decryptPayload(
    keyAndTag: ArrayBuffer,
    ciphertext: ArrayBuffer,
    iv: ArrayBuffer,
): Promise<string> {
    if (keyAndTag.byteLength < TAG_BYTES + 16) {
        throw new Error("omemo key too short");
    }
    const keyBytes = keyAndTag.slice(0, keyAndTag.byteLength - TAG_BYTES);
    const tag = keyAndTag.slice(keyAndTag.byteLength - TAG_BYTES);
    const key = await crypto.subtle.importKey("raw", keyBytes, KEY_ALGO, false, [
        "decrypt",
    ]);
    const packed = concat(ciphertext, tag);
    const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv), tagLength: TAG_BITS },
        key,
        packed,
    );
    return new TextDecoder().decode(plain);
}

export function concat(a: ArrayBuffer, b: ArrayBuffer): ArrayBuffer {
    const out = new Uint8Array(a.byteLength + b.byteLength);
    out.set(new Uint8Array(a), 0);
    out.set(new Uint8Array(b), a.byteLength);
    return out.buffer;
}

export function abToB64(ab: ArrayBuffer): string {
    return Buffer.from(ab).toString("base64");
}

export function b64ToAb(s: string): ArrayBuffer {
    const buf = Buffer.from(s.trim(), "base64");
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
