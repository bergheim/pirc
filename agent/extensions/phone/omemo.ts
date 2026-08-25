import {
    KeyHelper,
    OMEMOAddress,
    SessionBuilder,
    SessionCipher,
    type DecryptResult,
} from "libomemo.js";
import { xml } from "@xmpp/client";
import { FileStore } from "./store.ts";
import { abToB64, b64ToAb, decryptPayload, encryptPayload } from "./payload.ts";
import { bareJid } from "./lib.ts";

export const NS = "eu.siacs.conversations.axolotl";
const NS_LIST = `${NS}.devicelist`;
const NS_BUNDLES = `${NS}.bundles`;
const NS_PUBSUB = "http://jabber.org/protocol/pubsub";
const PREKEYS = 25;

type El = {
    getChild: (name: string, ns?: string) => El | undefined;
    getChildren: (name: string, ns?: string) => El[];
    getChildText: (name: string, ns?: string) => string | null;
    getText: () => string;
    attrs: Record<string, string | undefined>;
};

export type XmppIq = {
    send: (stanza: unknown) => Promise<unknown>;
    iqCaller: { request: (stanza: unknown) => Promise<El> };
};

export class Omemo {
    private readonly conn: XmppIq;
    private readonly store: FileStore;
    readonly ourJid: string;
    readonly allowJid: string;

    constructor(
        conn: XmppIq,
        store: FileStore,
        ourJid: string,
        allowJid: string,
    ) {
        this.conn = conn;
        this.store = store;
        this.ourJid = ourJid;
        this.allowJid = allowJid;
    }

    get deviceId(): number {
        const id = this.store.getLocalRegistrationId();
        if (!id) throw new Error("omemo identity missing");
        return id;
    }

    static async create(
        conn: XmppIq,
        storePath: string,
        ourJid: string,
        allowJid: string,
    ): Promise<Omemo> {
        const store = new FileStore(storePath);
        const omemo = new Omemo(
            conn,
            store,
            bareJid(ourJid),
            bareJid(allowJid),
        );
        await omemo.ensureIdentity();
        await omemo.publish();
        return omemo;
    }

    async encrypt(plaintext: string): Promise<unknown> {
        const devices = await this.peerDevices();
        if (devices.length === 0) {
            throw new Error(`no OMEMO devices for ${this.allowJid}`);
        }
        const { keyAndTag, ciphertext, iv } = await encryptPayload(plaintext);
        const keys: unknown[] = [];
        for (const rid of devices) {
            await this.ensureSession(this.allowJid, rid);
            const cipher = new SessionCipher(
                this.store,
                new OMEMOAddress(this.allowJid, rid),
                NS,
            );
            const enc = await cipher.encrypt(keyAndTag);
            const attrs: Record<string, string> = { rid: String(rid) };
            if (enc.type === 3) attrs.prekey = "true";
            keys.push(
                xml(
                    "key",
                    attrs,
                    Buffer.from(enc.body, "binary").toString("base64"),
                ),
            );
        }
        return xml(
            "encrypted",
            { xmlns: NS },
            xml(
                "header",
                { sid: String(this.deviceId) },
                ...keys,
                xml("iv", {}, abToB64(iv)),
            ),
            xml("payload", {}, abToB64(ciphertext)),
        );
    }

    async decrypt(from: string, enc: El): Promise<string | undefined> {
        const header = enc.getChild("header");
        const sid = Number(header?.attrs.sid);
        if (!header || !Number.isFinite(sid)) return undefined;
        const mine = header
            .getChildren("key")
            .find((k) => Number(k.attrs.rid) === this.deviceId);
        const keyB64 = mine?.getText().trim();
        if (!keyB64) return undefined;
        const ivB64 = header.getChildText("iv");
        const payloadB64 = enc.getChildText("payload");
        if (!ivB64 || !payloadB64) return undefined;

        const peer = bareJid(from);
        const cipher = new SessionCipher(
            this.store,
            new OMEMOAddress(peer, sid),
            NS,
        );
        const prekey =
            mine?.attrs.prekey === "true" || mine?.attrs.prekey === "1";
        let result: DecryptResult;
        try {
            result = prekey
                ? await cipher.decryptPreKeyWhisperMessage(keyB64, "base64")
                : await cipher.decryptWhisperMessage(keyB64, "base64");
        } catch {
            result = prekey
                ? await cipher.decryptWhisperMessage(keyB64, "base64")
                : await cipher.decryptPreKeyWhisperMessage(keyB64, "base64");
        }
        if (prekey) await this.publishBundle();
        return decryptPayload(
            result.plaintext,
            b64ToAb(payloadB64),
            b64ToAb(ivB64),
        );
    }

    private async ensureIdentity(): Promise<void> {
        if (
            this.store.getIdentityKeyPair() &&
            this.store.getLocalRegistrationId()
        ) {
            return;
        }
        const identity = await KeyHelper.generateIdentityKeyPair();
        const deviceId = KeyHelper.generateRegistrationId();
        this.store.put("identityKey", identity);
        this.store.put("registrationId", deviceId);
        const signed = await KeyHelper.generateSignedPreKey(identity, 1, NS);
        this.store.storeSignedPreKey(1, signed.keyPair);
        this.store.put("signedPreKeyId", 1);
        this.store.put("signedPreKeySignature", signed.signature);
        for (let i = 1; i <= PREKEYS; i++) {
            const pre = await KeyHelper.generatePreKey(i);
            this.store.storePreKey(i, pre.keyPair);
        }
    }

    private async publish(): Promise<void> {
        await this.publishDevices();
        await this.publishBundle();
    }

    private async publishDevices(): Promise<void> {
        const ids = new Set(await this.fetchDeviceIds(this.ourJid));
        ids.add(this.deviceId);
        await this.conn.iqCaller.request(
            xml(
                "iq",
                { type: "set" },
                xml(
                    "pubsub",
                    { xmlns: NS_PUBSUB },
                    xml(
                        "publish",
                        { node: NS_LIST },
                        xml(
                            "item",
                            {},
                            xml(
                                "list",
                                { xmlns: NS },
                                ...[...ids].map((id) =>
                                    xml("device", { id: String(id) }),
                                ),
                            ),
                        ),
                    ),
                ),
            ),
        );
    }

    private async publishBundle(): Promise<void> {
        const identity = this.store.getIdentityKeyPair();
        const signedId = this.store.get<number>("signedPreKeyId") ?? 1;
        const signed = this.store.loadSignedPreKey(signedId);
        const sig = this.store.get<ArrayBuffer>("signedPreKeySignature");
        if (!identity || !signed || !sig)
            throw new Error("omemo bundle incomplete");
        const prekeys = [];
        for (const key of Object.keys(this.store.store)) {
            if (!key.startsWith("25519KeypreKey")) continue;
            const id = key.slice("25519KeypreKey".length);
            const pair = this.store.get<{ pubKey: ArrayBuffer }>(key);
            if (!pair) continue;
            prekeys.push(
                xml("preKeyPublic", { preKeyId: id }, abToB64(pair.pubKey)),
            );
        }
        await this.conn.iqCaller.request(
            xml(
                "iq",
                { type: "set" },
                xml(
                    "pubsub",
                    { xmlns: NS_PUBSUB },
                    xml(
                        "publish",
                        { node: `${NS_BUNDLES}:${this.deviceId}` },
                        xml(
                            "item",
                            {},
                            xml(
                                "bundle",
                                { xmlns: NS },
                                xml(
                                    "signedPreKeyPublic",
                                    { signedPreKeyId: String(signedId) },
                                    abToB64(signed.keyPair.pubKey),
                                ),
                                xml("signedPreKeySignature", {}, abToB64(sig)),
                                xml(
                                    "identityKey",
                                    {},
                                    abToB64(identity.pubKey),
                                ),
                                xml("prekeys", {}, ...prekeys),
                            ),
                        ),
                    ),
                ),
            ),
        );
    }

    private async peerDevices(): Promise<number[]> {
        return (await this.fetchDeviceIds(this.allowJid)).filter(
            (id) => !(this.allowJid === this.ourJid && id === this.deviceId),
        );
    }

    private async fetchDeviceIds(jid: string): Promise<number[]> {
        try {
            const res = await this.conn.iqCaller.request(
                xml(
                    "iq",
                    { type: "get", to: jid },
                    xml(
                        "pubsub",
                        { xmlns: NS_PUBSUB },
                        xml("items", { node: NS_LIST }),
                    ),
                ),
            );
            const list = res
                .getChild("pubsub", NS_PUBSUB)
                ?.getChild("items")
                ?.getChild("item")
                ?.getChild("list", NS);
            if (!list) return [];
            return list
                .getChildren("device")
                .map((d) => Number(d.attrs.id))
                .filter((n) => Number.isFinite(n) && n > 0);
        } catch (err: unknown) {
            const cond =
                err &&
                typeof err === "object" &&
                "condition" in err
                    ? String((err as { condition: unknown }).condition)
                    : "";
            if (cond === "item-not-found") return [];
            throw err;
        }
    }

    private async ensureSession(jid: string, deviceId: number): Promise<void> {
        const addr = new OMEMOAddress(jid, deviceId);
        const cipher = new SessionCipher(this.store, addr, NS);
        if (await cipher.hasOpenSession()) return;
        const bundle = await this.fetchBundle(jid, deviceId);
        const builder = new SessionBuilder(this.store, addr, NS);
        await builder.processPreKey(bundle);
    }

    private async fetchBundle(jid: string, deviceId: number) {
        const res = await this.conn.iqCaller.request(
            xml(
                "iq",
                { type: "get", to: jid },
                xml(
                    "pubsub",
                    { xmlns: NS_PUBSUB },
                    xml("items", { node: `${NS_BUNDLES}:${deviceId}` }),
                ),
            ),
        );
        const bundle = res
            .getChild("pubsub", NS_PUBSUB)
            ?.getChild("items")
            ?.getChild("item")
            ?.getChild("bundle", NS);
        if (!bundle) throw new Error(`no bundle for ${jid}:${deviceId}`);
        const spk = bundle.getChild("signedPreKeyPublic");
        const preEls =
            bundle.getChild("prekeys")?.getChildren("preKeyPublic") ?? [];
        const pick = preEls[Math.floor(Math.random() * preEls.length)];
        if (!spk || !pick)
            throw new Error(`incomplete bundle ${jid}:${deviceId}`);
        const identityText = bundle.getChildText("identityKey");
        const sigText = bundle.getChildText("signedPreKeySignature");
        const spkText = spk.getText();
        const preText = pick.getText();
        if (!identityText || !sigText || !spkText || !preText) {
            throw new Error(`incomplete bundle ${jid}:${deviceId}`);
        }
        return {
            registrationId: deviceId,
            identityKey: b64ToAb(identityText),
            signedPreKey: {
                keyId: Number(spk.attrs.signedPreKeyId),
                publicKey: b64ToAb(spkText),
                signature: b64ToAb(sigText),
            },
            preKey: {
                keyId: Number(pick.attrs.preKeyId),
                publicKey: b64ToAb(preText),
            },
        };
    }
}
