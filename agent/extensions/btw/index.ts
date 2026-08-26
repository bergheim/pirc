/**
 * /btw <question> — one-shot side answer. Stays out of the main model context.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import {
    buildConversationContext,
    buildSideMessages,
    extractText,
    sideSystemPrompt,
} from "./context.ts";

const TYPE = "btw";

type BtwData = {
    q: string;
    a: string;
};

export default function (pi: ExtensionAPI): void {
    let inflight: AbortController | undefined;

    const abortInflight = () => {
        inflight?.abort();
        inflight = undefined;
    };

    pi.on("session_shutdown", abortInflight);

    pi.registerEntryRenderer<BtwData>(TYPE, (entry, _opts, theme) => {
        const q = entry.data?.q?.trim();
        const a = entry.data?.a?.trim();
        if (!q && !a) return undefined;
        const box = new Box(0, 0, (s) => theme.bg("userMessageBg", s));
        box.addChild(
            new Text(theme.fg("customMessageLabel", theme.bold("btw"))),
        );
        if (q) box.addChild(new Text(theme.fg("customMessageText", q)));
        if (a) box.addChild(new Text(theme.fg("userMessageText", a)));
        return box;
    });

    pi.registerCommand("btw", {
        description:
            "Ask a side question without adding it to the main conversation",
        handler: async (args, ctx) => {
            const question = args.trim();
            if (!question) {
                ctx.ui.notify("Usage: /btw <question>", "warning");
                return;
            }
            if (!ctx.model) {
                ctx.ui.notify("No model selected", "error");
                return;
            }

            const provider = ctx.modelRegistry.getProvider(ctx.model.provider);
            if (!provider) {
                ctx.ui.notify(`No provider for ${ctx.model.provider}`, "error");
                return;
            }
            const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
            if (!auth.ok) {
                ctx.ui.notify(auth.error, "error");
                return;
            }

            abortInflight();
            const ac = new AbortController();
            inflight = ac;
            ctx.ui.setStatus("btw", "btw…");
            try {
                const response = await provider
                    .streamSimple(
                        ctx.model,
                        {
                            systemPrompt: sideSystemPrompt(),
                            messages: buildSideMessages(
                                question,
                                buildConversationContext(
                                    ctx.sessionManager.getBranch(),
                                ),
                            ),
                        },
                        {
                            apiKey: auth.apiKey,
                            headers: auth.headers,
                            env: auth.env,
                            reasoning:
                                ctx.thinkingLevel === "off"
                                    ? undefined
                                    : ctx.thinkingLevel,
                            cacheRetention: "none",
                            signal: ac.signal,
                        },
                    )
                    .result();
                if (ac.signal.aborted || response.stopReason === "aborted")
                    return;
                if (response.stopReason === "error") {
                    ctx.ui.notify(
                        response.errorMessage ?? "btw request failed",
                        "error",
                    );
                    return;
                }
                const answer =
                    extractText(response.content) || "No response received.";
                pi.appendEntry<BtwData>(TYPE, { q: question, a: answer });
            } catch (error) {
                if (ac.signal.aborted) return;
                ctx.ui.notify(
                    error instanceof Error ? error.message : String(error),
                    "error",
                );
            } finally {
                if (inflight === ac) {
                    inflight = undefined;
                    ctx.ui.setStatus("btw", undefined);
                }
            }
        },
    });
}
