import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    readAnthropicCredential,
    readAntigravityCredential,
} from "./auth.ts";

const now = 1_000;

function credentialFiles(): {
    dir: string;
    pi: string;
    claude: string;
    agy: string;
    cleanup(): void;
} {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-usage-auth-"));
    return {
        dir,
        pi: path.join(dir, "auth.json"),
        claude: path.join(dir, ".credentials.json"),
        agy: path.join(dir, "antigravity.json"),
        cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    };
}

test("prefers a live Claude Code credential over Pi auth", () => {
    const files = credentialFiles();
    try {
        fs.writeFileSync(
            files.pi,
            JSON.stringify({
                anthropic: { access: "pi-token", expires: now + 1 },
            }),
        );
        fs.writeFileSync(
            files.claude,
            JSON.stringify({
                claudeAiOauth: {
                    accessToken: "claude-token",
                    expiresAt: now + 1,
                },
            }),
        );
        assert.deepEqual(readAnthropicCredential(files.pi, now, files.claude), {
            token: "claude-token",
        });
    } finally {
        files.cleanup();
    }
});

test("falls back to live Pi auth when Claude Code is expired", () => {
    const files = credentialFiles();
    try {
        fs.writeFileSync(
            files.pi,
            JSON.stringify({
                anthropic: { access: "pi-token", expires: now + 1 },
            }),
        );
        fs.writeFileSync(
            files.claude,
            JSON.stringify({
                claudeAiOauth: { accessToken: "claude-token", expiresAt: now },
            }),
        );
        assert.deepEqual(readAnthropicCredential(files.pi, now, files.claude), {
            token: "pi-token",
        });
    } finally {
        files.cleanup();
    }
});

test("falls back to Agy when Pi Antigravity auth is expired", () => {
    const files = credentialFiles();
    try {
        fs.writeFileSync(
            files.pi,
            JSON.stringify({
                "google-antigravity": { access: "pi-token", expires: now },
            }),
        );
        fs.writeFileSync(
            files.agy,
            JSON.stringify({ token: { access_token: "agy-token" } }),
        );
        assert.deepEqual(readAntigravityCredential(files.agy, files.pi, now), {
            token: "agy-token",
        });
    } finally {
        files.cleanup();
    }
});

test("prefers live Pi Antigravity auth over Agy", () => {
    const files = credentialFiles();
    try {
        fs.writeFileSync(
            files.pi,
            JSON.stringify({
                "google-antigravity": { access: "pi-token", expires: now + 1 },
            }),
        );
        fs.writeFileSync(
            files.agy,
            JSON.stringify({ token: { access_token: "agy-token" } }),
        );
        assert.deepEqual(readAntigravityCredential(files.agy, files.pi, now), {
            token: "pi-token",
        });
    } finally {
        files.cleanup();
    }
});

test("reports stale when neither Antigravity credential is available", () => {
    const files = credentialFiles();
    try {
        assert.deepEqual(readAntigravityCredential(files.agy, files.pi, now), {
            stale: "no credential",
        });
    } finally {
        files.cleanup();
    }
});

test("reports stale when neither Anthropic credential is available", () => {
    const files = credentialFiles();
    try {
        assert.deepEqual(readAnthropicCredential(files.pi, now, files.claude), {
            stale: "no credential",
        });
    } finally {
        files.cleanup();
    }
});
