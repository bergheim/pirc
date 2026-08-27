import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Credential = { token: string } | { stale: string };

export const AUTH_FILE = path.join(os.homedir(), ".pi", "agent", "auth.json");
export const CLAUDE_CREDENTIALS_FILE = path.join(
    os.homedir(),
    ".claude",
    ".credentials.json",
);
export const ANTIGRAVITY_TOKEN_FILE = path.join(
    os.homedir(),
    ".gemini",
    "antigravity-cli",
    "antigravity-oauth-token",
);

type JsonObject = Record<string, unknown>;
type ReadResult = { ok: JsonObject } | { missing: true } | { corrupt: true };

// Read-only by design. Refreshing here would race pi's own refresh on a mount
// shared by the host and every container; a rotated token written back stale
// logs every pi on that mount out.
function readJson(file: string): ReadResult {
    let raw: string;
    try {
        raw = fs.readFileSync(file, "utf-8");
    } catch (err: any) {
        return err?.code === "ENOENT" ? { missing: true } : { corrupt: true };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { corrupt: true };
    }
    // A credential store must be a plain object: null, arrays, and scalars all
    // parse fine as JSON but crash the `entry.foo` lookups below if allowed
    // through.
    if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
    ) {
        return { corrupt: true };
    }
    return { ok: parsed as JsonObject };
}

function object(value: unknown): JsonObject | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as JsonObject)
        : null;
}

// The only thing standing between a malformed store and fetchOne's
// `credential.token.slice(...)` crashing downstream: no reader may hand back
// `{token}` unless the value is a genuine, non-empty string.
function isLiveToken(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function fromAuthFile(
    provider: string,
    authFile: string,
    nowMs: number,
): Credential {
    const result = readJson(authFile);
    if ("missing" in result) return { stale: "no credential" };
    if ("corrupt" in result) return { stale: "unreadable" };
    const entry = object(result.ok[provider]);
    if (!isLiveToken(entry?.access)) return { stale: "no credential" };
    // Real codex/anthropic entries always carry a numeric `expires` (unlike
    // Antigravity's file, which has none by design). An absent field is as
    // untrustworthy as a malformed one here, so both fail safe as expired
    // rather than being read as a live, never-expiring token.
    if (typeof entry.expires !== "number" || entry.expires <= nowMs) {
        return { stale: "expired" };
    }
    return { token: entry.access };
}

export function readCodexCredential(
    authFile = AUTH_FILE,
    nowMs = Date.now(),
): Credential {
    return fromAuthFile("openai-codex", authFile, nowMs);
}

export function readClaudeCodeCredential(
    credentialFile = CLAUDE_CREDENTIALS_FILE,
    nowMs = Date.now(),
): Credential {
    const result = readJson(credentialFile);
    if ("missing" in result) return { stale: "no credential" };
    if ("corrupt" in result) return { stale: "unreadable" };
    const oauth = object(result.ok.claudeAiOauth);
    if (!isLiveToken(oauth?.accessToken)) return { stale: "no credential" };
    if (typeof oauth.expiresAt !== "number" || oauth.expiresAt <= nowMs) {
        return { stale: "expired" };
    }
    return { token: oauth.accessToken };
}

export function readAnthropicCredential(
    authFile = AUTH_FILE,
    nowMs = Date.now(),
    claudeCredentialFile = CLAUDE_CREDENTIALS_FILE,
): Credential {
    const claude = readClaudeCodeCredential(claudeCredentialFile, nowMs);
    return "token" in claude
        ? claude
        : fromAuthFile("anthropic", authFile, nowMs);
}

export function readXaiCredential(
    authFile = AUTH_FILE,
    nowMs = Date.now(),
): Credential {
    return fromAuthFile("xai", authFile, nowMs);
}

// Antigravity has two possible stores. Prefer Pi's live OAuth token, then
// fall back read-only to the standalone `agy` CLI token file. The latter has
// no expiry field, so use it only when Pi's credential is absent or expired.
export function readAntigravityCredential(
    tokenFile = ANTIGRAVITY_TOKEN_FILE,
    authFile = AUTH_FILE,
    nowMs = Date.now(),
): Credential {
    const pi = fromAuthFile("google-antigravity", authFile, nowMs);
    if ("token" in pi) return pi;

    const result = readJson(tokenFile);
    if ("missing" in result) return { stale: "no credential" };
    if ("corrupt" in result) return { stale: "unreadable" };
    const accessToken = object(result.ok.token)?.access_token;
    return isLiveToken(accessToken)
        ? { token: accessToken }
        : { stale: "no credential" };
}
