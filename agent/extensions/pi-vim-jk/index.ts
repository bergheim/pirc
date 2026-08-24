/**
 * pi-vim extras: jk → NORMAL, edge j/k browse prompt history.
 *
 * Wraps the editor factory after session_start so we run on top of pi-vim
 * (packages load after ~/.pi/agent/extensions).
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { historyDir, jkStep, JK_MS, vimBusy } from "./logic.ts";

type Editor = {
	handleInput(data: string): void;
	getMode?: () => string;
	navigateHistory?: (direction: number) => void;
	isOnFirstVisualLine?: () => boolean;
	isOnLastVisualLine?: () => boolean;
	getCursor?: () => { line: number };
	getText?: () => string;
} & Record<string, unknown>;

function atFirst(ed: Editor): boolean {
	if (typeof ed.isOnFirstVisualLine === "function")
		return ed.isOnFirstVisualLine();
	return (ed.getCursor?.().line ?? 0) === 0;
}

function atLast(ed: Editor): boolean {
	if (typeof ed.isOnLastVisualLine === "function")
		return ed.isOnLastVisualLine();
	const n = ed.getText?.().split("\n").length ?? 1;
	return (ed.getCursor?.().line ?? 0) >= n - 1;
}

export function wrapEditor(editor: Editor): Editor {
	const inner = editor.handleInput.bind(editor);
	let pendingJ = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const clearWait = (): void => {
		pendingJ = false;
		if (timer) clearTimeout(timer);
		timer = null;
	};

	const handle = (data: string): void => {
		const mode = editor.getMode?.() ?? "insert";

		if (mode === "insert") {
			const step = jkStep(pendingJ, data);
			if (step?.type === "type-j") {
				clearWait();
				inner("j");
				pendingJ = true;
				timer = setTimeout(clearWait, JK_MS);
				return;
			}
			if (step?.type === "undo-esc") {
				clearWait();
				inner("\x7f");
				inner("\x1b");
				return;
			}
			if (step?.type === "armed") clearWait();
		} else if (pendingJ) {
			clearWait();
		}

		const dir = historyDir(
			mode,
			data,
			atFirst(editor),
			atLast(editor),
			vimBusy(editor),
		);
		if (dir !== 0 && typeof editor.navigateHistory === "function") {
			editor.navigateHistory(dir);
			return;
		}
		inner(data);
	};

	editor.handleInput = handle;

	return editor;
}

function install(ctx: ExtensionContext): boolean {
	const current = ctx.ui.getEditorComponent();
	if (!current) return false;
	ctx.ui.setEditorComponent((tui, theme, kb) =>
		wrapEditor(current(tui, theme, kb) as Editor),
	);
	return true;
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		// User session_start runs before package ones. Immediate install
		// wraps nothing (or, on /reload, the old factory that pi-vim then
		// replaces). `await` flushes microtasks too early — use a macrotask.
		setTimeout(() => install(ctx), 0);
	});
}
