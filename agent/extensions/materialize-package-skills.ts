/**
 * Copy package-shipped skills into ~/.pi/agent/skills/<name>/.
 * Packages keep extensions; they do not export skills (see settings.json).
 * Local skills (no .pi-materialized marker) are left alone.
 */

import {
	cpSync,
	existsSync,
	globSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MARKER = ".pi-materialized";

type PkgJson = { pi?: { skills?: string[] } };

function isDir(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** pi installs packages as git/<host>/<user>/<repo> and npm/node_modules/[@scope/]<pkg>. */
function packageRoots(agentDir: string): string[] {
	return globSync(
		[
			"git/*/*/*/package.json",
			"npm/node_modules/*/package.json",
			"npm/node_modules/@*/*/package.json",
		],
		{ cwd: agentDir },
	).map((rel) => dirname(join(agentDir, rel)));
}

function skillSourceDirs(pkgRoot: string): string[] {
	let declared: string[] = [];
	try {
		const raw = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as PkgJson;
		declared = raw.pi?.skills ?? [];
	} catch {
		declared = [];
	}
	const dirs = declared.map((rel) => join(pkgRoot, rel)).filter(isDir);
	const conventional = join(pkgRoot, "skills");
	if (isDir(conventional) && !dirs.includes(conventional)) dirs.push(conventional);
	return dirs;
}

function skillFolders(sourceDir: string): string[] {
	return readdirSync(sourceDir)
		.map((name) => join(sourceDir, name))
		.filter((path) => existsSync(join(path, "SKILL.md")));
}

function isLocalSkill(dest: string): boolean {
	return existsSync(dest) && !existsSync(join(dest, MARKER));
}

export function materializePackageSkills(agentDir = getAgentDir()): string[] {
	const destRoot = join(agentDir, "skills");
	mkdirSync(destRoot, { recursive: true });
	const copied: string[] = [];
	for (const pkg of packageRoots(agentDir)) {
		for (const sourceDir of skillSourceDirs(pkg)) {
			for (const src of skillFolders(sourceDir)) {
				const name = basename(src);
				const dest = join(destRoot, name);
				if (isLocalSkill(dest)) continue;
				rmSync(dest, { recursive: true, force: true });
				cpSync(src, dest, { recursive: true });
				writeFileSync(join(dest, MARKER), `${src}\n`);
				copied.push(name);
			}
		}
	}
	return copied;
}

export default function (_pi: ExtensionAPI): void {
	materializePackageSkills();
}
