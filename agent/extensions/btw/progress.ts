export const BTW_SPIN = [
    "⠋",
    "⠙",
    "⠹",
    "⠸",
    "⠼",
    "⠴",
    "⠦",
    "⠧",
    "⠇",
    "⠏",
] as const;

export function btwSpinLine(i: number): string {
    return `${BTW_SPIN[i % BTW_SPIN.length]} btw`;
}

export function startBtwProgress(
    setLine: (line: string | undefined) => void,
    intervalFn: typeof setInterval = setInterval,
    clearFn: typeof clearInterval = clearInterval,
): () => void {
    let i = 0;
    let stopped = false;
    const tick = () => {
        setLine(btwSpinLine(i++));
    };
    tick();
    const id = intervalFn(tick, 80);
    return () => {
        if (stopped) return;
        stopped = true;
        clearFn(id);
        setLine(undefined);
    };
}
