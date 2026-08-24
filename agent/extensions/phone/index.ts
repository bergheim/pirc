/// <reference types="node" />
/// <reference path="./xmpp.d.ts" />
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { client, xml } from "@xmpp/client";
import {
    allowedFrom,
    assistantText,
    bareJid,
    chunkText,
    inboundFrom,
    phoneCommand,
    skillLines,
    userText,
} from "./lib.ts";
import { NS, Omemo, type XmppIq } from "./omemo.ts";

// @xmpp/client 0.13 picks SCRAM-SHA-1 first; this ejabberd rejects the response.
function preferPlainSasl(): void {
    const req = createRequire(import.meta.url);
    const fromClient = createRequire(req.resolve("@xmpp/client"));
    const fromSasl = createRequire(fromClient.resolve("@xmpp/sasl"));
    const FactoryMod = fromSasl("saslmechanisms") as {
        Factory?: { prototype: { use: (...args: unknown[]) => unknown } };
        prototype: { use: (...args: unknown[]) => unknown };
    };
    const Factory = FactoryMod.Factory ?? FactoryMod;
    const orig = Factory.prototype.use;
    Factory.prototype.use = function (name: unknown, mech?: unknown) {
        const label =
            typeof name === "string"
                ? name
                : ((name as { prototype?: { name?: string } })?.prototype
                      ?.name ?? "");
        if (label === "SCRAM-SHA-1") return this;
        return orig.call(this, name, mech);
    };
}
preferPlainSasl();

const DEFAULT_JID = "pi@xmpp.glvortex.net";
const DEFAULT_ALLOW = "tsb@xmpp.glvortex.net";

type XmppClient = ReturnType<typeof client> & XmppIq;

type PhoneUi = {
    notify: (msg: string, level: "info" | "warning" | "error") => void;
    input: (title: string, placeholder: string) => Promise<string | undefined>;
    setStatus: (id: string, text: string | undefined) => void;
};

type PhoneCtx = {
    ui: PhoneUi;
    isIdle: () => boolean;
    abort: () => void;
};

type PhonePi = {
    registerCommand: (
        name: string,
        opts: {
            description: string;
            handler: (args: string, ctx: PhoneCtx) => Promise<void>;
        },
    ) => void;
    on: (
        event: string,
        handler: (event: unknown, ctx: PhoneCtx) => unknown,
    ) => void;
    sendUserMessage: (
        text: string,
        opts?: { deliverAs: "followUp" | "steer" },
    ) => void;
    getCommands: () => { name: string; source?: string }[];
};

export default function (pi: PhonePi) {
    let xmpp: XmppClient | undefined;
    let omemo: Omemo | undefined;
    let peer: string | undefined;
    let allow = DEFAULT_ALLOW;
    let lastFromPhone: string | undefined;
    let injectTail: Promise<void> = Promise.resolve();

    async function sendChat(to: string, body: string): Promise<void> {
        if (!xmpp || !omemo || !body) return;
        for (const part of chunkText(body)) {
            const encrypted = await omemo.encrypt(part);
            await xmpp.send(
                xml(
                    "message",
                    { type: "chat", to: bareJid(to) },
                    encrypted,
                    xml("store", { xmlns: "urn:xmpp:hints" }),
                ),
            );
        }
    }

    async function stop(): Promise<void> {
        const conn = xmpp;
        xmpp = undefined;
        omemo = undefined;
        peer = undefined;
        if (!conn) return;
        await conn.stop().catch(() => undefined);
    }

    async function start(ctx: PhoneCtx): Promise<void> {
        if (xmpp) {
            ctx.ui.notify("phone already on", "info");
            return;
        }

        const jid = process.env.PI_XMPP_JID ?? DEFAULT_JID;
        allow = process.env.PI_XMPP_ALLOW ?? DEFAULT_ALLOW;
        const password =
            process.env.PI_XMPP_PASSWORD ??
            (await ctx.ui.input("XMPP password for pi@", ""));
        if (!password) {
            ctx.ui.notify("PI_XMPP_PASSWORD unset", "error");
            return;
        }

        const at = jid.lastIndexOf("@");
        if (at < 1) {
            ctx.ui.notify(`bad PI_XMPP_JID: ${jid}`, "error");
            return;
        }
        const username = jid.slice(0, at);
        const domain = jid.slice(at + 1);
        const service = process.env.PI_XMPP_SERVICE ?? `xmpp://${domain}:5222`;

        const conn = client({
            service,
            domain,
            username,
            password,
            resource: `phone-${process.pid}`,
        }) as XmppClient;

        conn.on("error", (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.ui.notify(`phone: ${msg}`, "error");
        });

        conn.on("offline", () => {
            if (xmpp === conn) {
                xmpp = undefined;
                omemo = undefined;
                peer = undefined;
                ctx.ui.setStatus("phone", undefined);
            }
        });

        conn.on(
            "stanza",
            (stanza: {
                is: (name: string) => boolean;
                attrs: { type?: string; from?: string };
                getChild: (
                    name: string,
                    ns?: string,
                ) =>
                    | Parameters<Omemo["decrypt"]>[1]
                    | {
                          getChild: (
                              name: string,
                              ns?: string,
                          ) => Parameters<Omemo["decrypt"]>[1] | undefined;
                      }
                    | undefined;
                getChildText: (name: string) => string | undefined;
                toString?: () => string;
            }) => {
                if (!stanza.is("message")) return;
                const type = stanza.attrs.type;
                if (type === "groupchat" || type === "error") return;
                try {
                    appendFileSync(
                        join(homedir(), ".pi", "agent", "phone-in.log"),
                        `${new Date().toISOString()} ${stanza.toString?.() ?? ""}\n`,
                    );
                } catch {
                    /* ignore */
                }
                const carbon = stanza.getChild(
                    "received",
                    "urn:xmpp:carbons:2",
                );
                const inner =
                    carbon
                        ?.getChild("forwarded", "urn:xmpp:forward:0")
                        ?.getChild("message") ?? stanza;
                const from = inboundFrom({
                    outerFrom: stanza.attrs.from,
                    innerFrom: inner.attrs?.from ?? stanza.attrs.from,
                    receivedCarbon: Boolean(carbon),
                    self: jid,
                });
                if (!from || !allowedFrom(from, allow)) return;
                const runCommand = async (
                    cmd: NonNullable<ReturnType<typeof phoneCommand>>,
                ): Promise<void> => {
                    peer = from;
                    if (cmd === "stop") {
                        if (!ctx.isIdle()) ctx.abort();
                        await sendChat(from, "stopped");
                        return;
                    }
                    if (cmd === "skills") {
                        const lines = skillLines(pi.getCommands());
                        await sendChat(
                            from,
                            lines.length ? lines.join("\n") : "no skills",
                        );
                        return;
                    }
                    await sendChat(from, "phone off");
                    await stop();
                    ctx.ui.setStatus("phone", undefined);
                    ctx.ui.notify("phone off", "info");
                };
                const inject = (body: string) => {
                    const cmd = phoneCommand(body);
                    if (cmd) {
                        void runCommand(cmd).catch((err: unknown) => {
                            const msg =
                                err instanceof Error
                                    ? err.message
                                    : String(err);
                            ctx.ui.notify(`phone cmd: ${msg}`, "error");
                        });
                        return;
                    }
                    peer = from;
                    lastFromPhone = body;
                    injectTail = injectTail
                        .then(async () => {
                            if (!ctx.isIdle()) {
                                ctx.abort();
                                const t0 = Date.now();
                                // ponytail: poll; session.abort() is not awaitable from ctx
                                while (
                                    !ctx.isIdle() &&
                                    Date.now() - t0 < 15_000
                                ) {
                                    await new Promise((r) => setTimeout(r, 50));
                                }
                            }
                            pi.sendUserMessage(body);
                        })
                        .catch((err: unknown) => {
                            const msg =
                                err instanceof Error
                                    ? err.message
                                    : String(err);
                            ctx.ui.notify(`phone inject: ${msg}`, "error");
                        });
                };
                const encrypted =
                    inner.getChild?.("encrypted", NS) ??
                    inner.getChild?.("encrypted");
                if (!encrypted || !omemo) return;
                void omemo
                    .decrypt(from, encrypted as Parameters<Omemo["decrypt"]>[1])
                    .then((body) => {
                        if (body?.trim()) inject(body);
                    })
                    .catch((err: unknown) => {
                        const msg =
                            err instanceof Error ? err.message : String(err);
                        ctx.ui.notify(`phone decrypt: ${msg}`, "error");
                    });
            },
        );

        try {
            await conn.start();
            await conn.send(xml("presence"));
            await conn.iqCaller
                .request(
                    xml(
                        "iq",
                        { type: "set" },
                        xml("enable", { xmlns: "urn:xmpp:carbons:2" }),
                    ),
                )
                .catch(() => undefined);
            omemo = await Omemo.create(
                conn,
                process.env.PI_OMEMO_STORE ??
                    join(homedir(), ".pi", "agent", "phone-omemo.json"),
                jid,
                allow,
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.ui.notify(`phone failed: ${msg}`, "error");
            await conn.stop().catch(() => undefined);
            omemo = undefined;
            return;
        }

        xmpp = conn;
        peer = allow;
        ctx.ui.setStatus("phone", "phone");
        ctx.ui.notify(`phone → ${bareJid(allow)} (omemo)`, "info");
        try {
            await sendChat(allow, "phone on — this pi session");
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.ui.notify(`phone send: ${msg}`, "error");
        }
    }

    pi.registerCommand("phone", {
        description: "Relay this session over OMEMO XMPP",
        handler: async (args, ctx) => {
            if (args.trim().toLowerCase() === "off") {
                await stop();
                ctx.ui.setStatus("phone", undefined);
                ctx.ui.notify("phone off", "info");
                return;
            }
            await start(ctx);
        },
    });

    pi.on("message_end", async (event) => {
        if (!xmpp || !omemo || !peer) return;
        const message = (
            event as { message?: { role?: string; content?: unknown } }
        ).message;
        if (!message) return;
        const incoming = userText(message);
        if (incoming) {
            if (incoming === lastFromPhone) {
                lastFromPhone = undefined;
                return;
            }
            try {
                await sendChat(peer, `[tui] ${incoming}`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`phone send: ${msg}`);
            }
            return;
        }
        const text = assistantText(message);
        if (!text) return;
        try {
            await sendChat(peer, text);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`phone send: ${msg}`);
        }
    });

    pi.on("session_shutdown", async () => {
        await stop();
    });
}
