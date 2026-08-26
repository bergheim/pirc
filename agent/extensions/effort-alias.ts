import type { ExtensionAPI, ThinkingLevel } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("effort", {
    description: "Select thinking effort or set it by argument",
    handler: async (args, ctx) => {
      let level = args.trim().toLowerCase();

      if (!level) {
        const levels = ctx.model ? getSupportedThinkingLevels(ctx.model) : [...LEVELS];
        level = (await ctx.ui.select(`Thinking effort (${pi.getThinkingLevel()})`, levels)) ?? "";
        if (!level) return;
      }

      if (!LEVELS.includes(level as ThinkingLevel)) {
        ctx.ui.notify(`Unknown effort: ${level}. Use: ${LEVELS.join(", ")}`, "error");
        return;
      }

      pi.setThinkingLevel(level as ThinkingLevel);
      ctx.ui.notify(`Effort: ${pi.getThinkingLevel()}`, "info");
    },
  });
}
