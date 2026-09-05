import { execFileSync } from "node:child_process";

export default function (): void {
	if (process.env.CONTEXT7_API_KEY) return;
	try {
		process.env.CONTEXT7_API_KEY = execFileSync(
			"pass",
			["show", "api/llm/context7"],
			{ encoding: "utf8" },
		)
			.split("\n", 1)[0]
			.trim();
	} catch {
		// locked gpg or missing entry: leave unset, the tool reports the auth error
	}
}
