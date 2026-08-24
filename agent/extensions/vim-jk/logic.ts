/** Insert-mode `jk` timeout. Long enough to type, short enough not to lag `j`. */
export const JK_MS = 250;

export type VimBusy = {
	pendingOperator?: unknown;
	pendingMotion?: unknown;
	pendingG?: boolean;
	pendingReplace?: boolean;
	prefixCount?: string;
	operatorCount?: string;
	pendingExCommand?: string | null;
};

export function vimBusy(ed: VimBusy): boolean {
	return Boolean(
		ed.pendingOperator ||
			ed.pendingMotion ||
			ed.pendingG ||
			ed.pendingReplace ||
			ed.prefixCount ||
			ed.operatorCount ||
			ed.pendingExCommand != null,
	);
}

/** -1 older, 1 newer, 0 leave to vim. */
export function historyDir(
	mode: string,
	key: string,
	atFirst: boolean,
	atLast: boolean,
	busy: boolean,
): -1 | 1 | 0 {
	if (mode !== "normal" || busy || (key !== "j" && key !== "k")) return 0;
	if (key === "k" && atFirst) return -1;
	if (key === "j" && atLast) return 1;
	return 0;
}

export type JkAction =
	| { type: "type-j" }
	| { type: "undo-esc" }
	| { type: "armed" };

/** `j` types immediately. A following `k` undoes it. Pasted `"jk"` is not this. */
export function jkStep(pending: boolean, data: string): JkAction | null {
	if (pending && data === "k") return { type: "undo-esc" };
	if (data === "j") return { type: "type-j" };
	if (pending) return { type: "armed" };
	return null;
}
