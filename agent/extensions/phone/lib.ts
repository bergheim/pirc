export function bareJid(jid: string): string {
    const cut = jid.indexOf("/");
    return (cut === -1 ? jid : jid.slice(0, cut)).toLowerCase();
}

export function allowedFrom(from: string, allow: string): boolean {
    return bareJid(from) === bareJid(allow);
}

/** Received-carbon inner from is only trusted if the outer stanza is us. */
export function inboundFrom(args: {
    outerFrom: string | undefined;
    innerFrom: string | undefined;
    receivedCarbon: boolean;
    self: string;
}): string | undefined {
    if (args.receivedCarbon) {
        if (
            !args.outerFrom ||
            bareJid(args.outerFrom) !== bareJid(args.self)
        ) {
            return undefined;
        }
        return args.innerFrom;
    }
    return args.innerFrom ?? args.outerFrom;
}

export function chunkText(text: string, max = 4000): string[] {
    if (text.length <= max) return [text];
    const out: string[] = [];
    for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
    return out;
}

function contentText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const part of content) {
        if (
            part &&
            typeof part === "object" &&
            (part as { type?: unknown }).type === "text" &&
            typeof (part as { text?: unknown }).text === "string"
        ) {
            parts.push((part as { text: string }).text);
        }
    }
    return parts.join("");
}

export function assistantText(message: {
    role?: string;
    content?: unknown;
}): string {
    if (message.role !== "assistant") return "";
    return contentText(message.content);
}

export function userText(message: {
    role?: string;
    content?: unknown;
}): string {
    if (message.role !== "user") return "";
    return contentText(message.content);
}
