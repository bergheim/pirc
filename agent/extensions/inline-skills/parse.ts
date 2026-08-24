export type SkillHit = {
	start: number;
	end: number;
	name: string;
	args: string;
};

const NAME_RE = /^([a-z0-9-]+)/;
/** Clause end. Newline is whitespace, not a stop — `/compact focus on trees` can wrap. */
const ARG_STOP = new Set([".", "!", "?", ";"]);

export function findSkillHits(text: string, names: Set<string>): SkillHit[] {
	const hits: SkillHit[] = [];
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== "$") continue;
		const prev = i === 0 ? " " : text[i - 1];
		if (prev !== " " && prev !== "\t" && prev !== "\n") continue;
		const match = text.slice(i + 1).match(NAME_RE);
		if (!match || !names.has(match[1])) continue;
		const nameEnd = i + 1 + match[0].length;
		let argsStart = nameEnd;
		while (argsStart < text.length && /\s/.test(text[argsStart])) argsStart++;
		// `$foo,` / `$foo's` — no whitespace, don't swallow punctuation
		if (argsStart === nameEnd) {
			hits.push({ start: i, end: nameEnd, name: match[1], args: "" });
			i = nameEnd - 1;
			continue;
		}
		let argsEnd = argsStart;
		while (argsEnd < text.length) {
			const c = text[argsEnd];
			if (ARG_STOP.has(c)) break;
			if (c === "$" && /\s/.test(text[argsEnd - 1] ?? " ")) {
				const following = text.slice(argsEnd + 1).match(NAME_RE);
				if (following && names.has(following[1])) break;
			}
			argsEnd++;
		}
		const args = text.slice(argsStart, argsEnd).trim();
		const end = args ? argsEnd : nameEnd;
		hits.push({ start: i, end, name: match[1], args });
		i = end - 1;
	}
	return hits;
}

/** Text with `$name` + args spans removed. Skill blocks hoist in front of this. */
export function stripHits(text: string, hits: SkillHit[]): string {
	let remainder = text;
	for (const hit of hits.toReversed()) {
		remainder = remainder.slice(0, hit.start) + remainder.slice(hit.end);
	}
	return remainder
		.replace(/[ \t]+$/gm, "")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}
