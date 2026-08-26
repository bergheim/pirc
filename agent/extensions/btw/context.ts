export const MAX_CONTEXT_CHARS = 40_000;

const SYSTEM_PROMPT = `You answer a quick side question for a coding-agent user.
Use the conversation snapshot only as background. Answer directly.
Do not claim to have changed files, run tools, or affected the main task.`;

type ContentBlock = {
    type?: string;
    text?: string;
};

type SessionMessage = {
    role?: string;
    content?: unknown;
};

type SessionEntry = {
    type: string;
    message?: SessionMessage;
};

export function buildConversationContext(entries: readonly SessionEntry[]): string {
    const sections: string[] = [];
    for (const entry of entries) {
        if (entry.type !== "message" || !entry.message?.role) continue;
        const role = entry.message.role;
        if (role !== "user" && role !== "assistant") continue;
        const text = extractText(entry.message.content);
        if (!text) continue;
        sections.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
    }
    return truncateFromStart(sections.join("\n\n"), MAX_CONTEXT_CHARS);
}

export function buildSideMessages(question: string, conversationContext: string) {
    return [
        {
            role: "user" as const,
            content: [
                {
                    type: "text" as const,
                    text: [
                        "Answer this side question without modifying the main conversation.",
                        "",
                        "<side_question>",
                        question,
                        "</side_question>",
                        "",
                        "<conversation_context>",
                        conversationContext || "No prior conversation context was available.",
                        "</conversation_context>",
                    ].join("\n"),
                },
            ],
            timestamp: Date.now(),
        },
    ];
}

export function sideSystemPrompt(): string {
    return SYSTEM_PROMPT;
}

export function extractText(content: unknown): string {
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const block = part as ContentBlock;
        if (block.type === "text" && typeof block.text === "string") {
            parts.push(block.text.trim());
        }
    }
    return parts.filter(Boolean).join("\n");
}

export function truncateFromStart(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `[Earlier context omitted; showing the last ${maxChars} characters.]\n${text.slice(-maxChars)}`;
}
