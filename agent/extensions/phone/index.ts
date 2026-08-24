/// <reference types="node" />
/// <reference path="./xmpp.d.ts" />
import { client, xml } from "@xmpp/client";
import { allowedFrom, assistantText, bareJid, chunkText } from "./lib.ts";

const DEFAULT_JID = "pi@xmpp.glvortex.net";
const DEFAULT_ALLOW = "tsb@xmpp.glvortex.net";

type XmppClient = ReturnType<typeof client>;

type PhoneUi = {
    notify: (msg: string, level: "info" | "warning" | "error") => void;
    input: (title: string, placeholder: string) => Promise<string | undefined>;
    setStatus: (id: string, text: string | undefined) => void;
};

type PhoneCtx = {
    ui: PhoneUi;
    isIdle: () => boolean;
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
};

export default function (pi: PhonePi) {
    let xmpp: XmppClient | undefined;
    let peer: string | undefined;
    let allow = DEFAULT_ALLOW;

    async function sendChat(to: string, body: string): Promise<void> {
        if (!xmpp || !body) return;
        for (const part of chunkText(body)) {
            await xmpp.send(
                xml("message", { type: "chat", to }, xml("body", {}, part)),
            );
        }
    }

    async function stop(): Promise<void> {
        const conn = xmpp;
        xmpp = undefined;
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
        const service = process.env.PI_XMPP_SERVICE ?? domain;

        const conn = client({
            service,
            domain,
            username,
            password,
            resource: `phone-${process.pid}`,
        });

        conn.on("error", (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.ui.notify(`phone: ${msg}`, "error");
        });

        conn.on("offline", () => {
            if (xmpp === conn) {
                xmpp = undefined;
                peer = undefined;
                ctx.ui.setStatus("phone", undefined);
            }
        });

        conn.on(
            "stanza",
            (stanza: {
                is: (name: string) => boolean;
                attrs: { type?: string; from?: string };
                getChildText: (name: string) => string | undefined;
            }) => {
                if (!stanza.is("message")) return;
                const type = stanza.attrs.type;
                if (type === "groupchat" || type === "error") return;
                const from = stanza.attrs.from;
                if (!from || !allowedFrom(from, allow)) return;
                const body = stanza.getChildText("body")?.trim();
                if (!body) return;
                peer = from;
                if (ctx.isIdle()) pi.sendUserMessage(body);
                else pi.sendUserMessage(body, { deliverAs: "followUp" });
            },
        );

        try {
            await conn.start();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.ui.notify(`phone failed: ${msg}`, "error");
            return;
        }

        xmpp = conn;
        peer = allow;
        ctx.ui.setStatus("phone", "phone");
        ctx.ui.notify(`phone → ${bareJid(allow)}`, "info");
        await sendChat(allow, "phone on — this pi session");
    }

    pi.registerCommand("phone", {
        description: "Relay this session over XMPP",
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
        if (!xmpp || !peer) return;
        const message = (
            event as { message?: { role?: string; content?: unknown } }
        ).message;
        if (!message) return;
        const text = assistantText(message);
        if (!text) return;
        await sendChat(peer, text);
    });

    pi.on("session_shutdown", async () => {
        await stop();
    });
}
