/**
 * Mid-sentence skill mentions via `$name`.
 *
 *   yeah this is perfect. commit and push. then $j-save full
 *
 * Autocomplete after a token-boundary `$`. On submit, hoist `$name args`
 * to the stock `<skill>` block + args (same as `/skill:name args`).
 * Args = rest of the clause (until . ! ? ; or the next `$skill`),
 * including following lines. Leading prose stays after the block.
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	parseFrontmatter,
	stripFrontmatter,
	type ExtensionAPI,
	type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import {
	fuzzyFilter,
	type AutocompleteItem,
	type AutocompleteProvider,
} from "@earendil-works/pi-tui";
import { findSkillHits, stripHits } from "./parse.ts";

type Skill = {
	name: string;
	path: string;
	baseDir: string;
	description?: string;
	enums: string[];
};

function skillName(command: SlashCommandInfo): string | undefined {
	if (command.source !== "skill") return;
	return command.name.startsWith("skill:")
		? command.name.slice(6)
		: command.name;
}

function enumArgs(hint: unknown): string[] {
	if (typeof hint !== "string") return [];
	const inner = hint.match(/\[([^\]]+)\]/)?.[1] ?? hint.match(/<([^>]+)>/)?.[1];
	if (!inner?.includes("|")) return [];
	return inner
		.split("|")
		.map((s) => s.trim())
		.filter(Boolean);
}

export function loadSkills(commands: SlashCommandInfo[]): Map<string, Skill> {
	const skills = new Map<string, Skill>();
	for (const command of commands) {
		const name = skillName(command);
		if (!name) continue;
		let enums: string[] = [];
		try {
			const raw = readFileSync(command.sourceInfo.path, "utf8");
			enums = enumArgs(parseFrontmatter(raw).frontmatter["argument-hint"]);
		} catch {
			// hint is optional; expand still works
		}
		skills.set(name, {
			name,
			path: command.sourceInfo.path,
			baseDir: command.sourceInfo.baseDir ?? dirname(command.sourceInfo.path),
			description: command.description,
			enums,
		});
	}
	return skills;
}

export function skillBlock(skill: Skill, body: string): string {
	return `<skill name="${skill.name}" location="${skill.path}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}

export function expandSkillHits(
	text: string,
	skills: Map<string, Skill>,
): string {
	const hits = findSkillHits(text, new Set(skills.keys()));
	if (hits.length === 0) return text;
	const parts: string[] = [];
	const used: typeof hits = [];
	for (const hit of hits) {
		const skill = skills.get(hit.name);
		if (!skill) continue;
		let body: string;
		try {
			body = stripFrontmatter(readFileSync(skill.path, "utf8")).trim();
		} catch {
			continue;
		}
		const block = skillBlock(skill, body);
		parts.push(hit.args ? `${block}\n\n${hit.args}` : block);
		used.push(hit);
	}
	if (parts.length === 0) return text;
	const remainder = stripHits(text, used);
	return remainder
		? `${parts.join("\n\n")}\n\n${remainder}`
		: parts.join("\n\n");
}

function applyInsert(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	item: AutocompleteItem,
	prefix: string,
): { lines: string[]; cursorLine: number; cursorCol: number } {
	const line = lines[cursorLine] ?? "";
	const before = line.slice(0, cursorCol - prefix.length);
	const after = line.slice(cursorCol);
	const space = after.startsWith(" ") ? "" : " ";
	const insert = item.value + space;
	const next = [...lines];
	next[cursorLine] = before + insert + after;
	return { lines: next, cursorLine, cursorCol: before.length + insert.length };
}

function createProvider(
	current: AutocompleteProvider,
	getSkills: () => Map<string, Skill>,
): AutocompleteProvider {
	let ours: "name" | "arg" | null = null;

	return {
		triggerCharacters: ["$"],
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			ours = null;
			const before = (lines[cursorLine] ?? "").slice(0, cursorCol);
			const skills = getSkills();
			const names = [...skills.keys()];

			const argMatch = before.match(/(?:^|[ \t])\$([a-z0-9-]+)[ \t]+(\S*)$/);
			if (argMatch && skills.has(argMatch[1])) {
				const enums = skills.get(argMatch[1])?.enums ?? [];
				const query = argMatch[2] ?? "";
				const items = (
					query ? enums.filter((e) => e.startsWith(query)) : enums
				).map((value) => ({
					value,
					label: value,
				}));
				if (items.length > 0) {
					ours = "arg";
					return { items, prefix: query };
				}
			}

			const nameMatch = before.match(/(?:^|[ \t])(\$([a-z0-9-]*))$/);
			if (nameMatch) {
				const query = nameMatch[2] ?? "";
				const matched = query ? fuzzyFilter(names, query, (n) => n) : names;
				if (matched.length > 0) {
					ours = "name";
					return {
						prefix: nameMatch[1],
						items: matched.slice(0, 20).map((name) => ({
							value: `$${name}`,
							label: name,
							description: skills.get(name)?.description,
						})),
					};
				}
			}

			return current.getSuggestions(lines, cursorLine, cursorCol, options);
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (ours) return applyInsert(lines, cursorLine, cursorCol, item, prefix);
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return (
				current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true
			);
		},
	};
}

export default function (pi: ExtensionAPI): void {
	let skills = new Map<string, Skill>();
	const refresh = (): void => {
		skills = loadSkills(pi.getCommands());
	};

	pi.on("session_start", (_event, ctx) => {
		refresh();
		ctx.ui.addAutocompleteProvider((current) =>
			createProvider(current, () => skills),
		);
	});

	pi.on("input", (event) => {
		if (!event.text.includes("$")) return;
		refresh();
		const expanded = expandSkillHits(event.text, skills);
		if (expanded !== event.text)
			return { action: "transform" as const, text: expanded };
	});
}
