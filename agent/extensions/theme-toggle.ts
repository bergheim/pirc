/**
 * Flip between two fixed themes.
 *
 *   alt+shift+d   /theme-toggle
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const LIGHT = "crew-catppuccin-latte";
const DARK = "crew-catppuccin-mocha";

export function nextTheme(name?: string): string {
	return name === DARK ? LIGHT : DARK;
}

function toggle(ctx: ExtensionContext): void {
	const next = nextTheme(ctx.ui.theme.name);
	const result = ctx.ui.setTheme(next);
	if (!result.success) {
		ctx.ui.notify(result.error ?? `theme ${next} failed`, "error");
		return;
	}
	ctx.ui.notify(next);
}

export default function (pi: ExtensionAPI): void {
	pi.registerShortcut("alt+shift+d", {
		description: "Toggle light/dark theme",
		handler: (ctx) => toggle(ctx),
	});
	pi.registerCommand("theme-toggle", {
		description: "Toggle light/dark theme (latte ↔ mocha)",
		handler: (_args, ctx) => toggle(ctx),
	});
}
