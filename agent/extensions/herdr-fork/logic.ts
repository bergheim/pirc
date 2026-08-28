/**
 * /herdr-fork: clone this Pi session into a fresh Herdr worktree workspace.
 * Pure logic + an injected argv runner so the whole flow is testable offline.
 */

export type RunResult = { status: number; stdout: string; stderr: string };
export type Runner = (cmd: string, args: string[]) => Promise<RunResult>;

export type Envelope = {
    id?: string;
    result?: Record<string, unknown>;
    error?: { code?: string; message?: string };
};

export type SalvagedIds = {
    workspaceId?: string;
    paneId?: string;
    path?: string;
};

export type PaneInfo = {
    pane_id: string;
    workspace_id?: string;
    cwd?: string | null;
    foreground_cwd?: string | null;
    agent?: string | null;
    agent_status?: string;
    agent_session?: { kind?: string; value?: string } | null;
};

const MAX_SLUG = 40;

export function validateFocus(
    raw: string,
): { ok: true; focus: string } | { ok: false; error: string } {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
    if (/[\u0000-\u001f\u007f]/.test(raw)) {
        return {
            ok: false,
            error: "Focus text must not contain newlines or control characters.",
        };
    }
    const focus = raw.trim();
    if (!focus) return { ok: true, focus: "" };
    if (focus.startsWith("/")) {
        return {
            ok: false,
            error: `Focus text must not start with "/" (it would run as a command in the clone). Got: ${focus}`,
        };
    }
    return { ok: true, focus };
}

/** Reduce free text to a git-ref-safe, length-capped slug. */
export function slugify(text: string): string {
    const base = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, MAX_SLUG)
        .replace(/^-+|-+$/g, "");
    return base;
}

/** Slug from focus text, else a timestamp + short-OID seed. */
export function forkSlug(focus: string, seed: string): string {
    return slugify(focus) || slugify(seed) || "session";
}

export function branchFor(slug: string): string {
    return `feat/herdr-fork-${slug}`;
}

export function agentNameFor(slug: string, seed: string): string {
    return slugify(`pi-fork-${slug}-${seed}`) || "pi-fork";
}

/** Last-ditch guard: the slug builder already restricts the charset. */
export function isSafeRef(ref: string): boolean {
    if (!ref || ref.length > 120) return false;
    if (!/^[A-Za-z0-9/_.-]+$/.test(ref)) return false;
    if (ref.includes("..") || ref.includes("//")) return false;
    if (ref.endsWith(".lock") || ref.endsWith("/") || ref.endsWith(".")) {
        return false;
    }
    return !ref.split("/").some((part) => !part || part.startsWith("-"));
}

export function parseEnvelope(stdout: string): Envelope | undefined {
    const whole = stdout.trim();
    const attempt = (text: string): Envelope | undefined => {
        if (!text.startsWith("{")) return undefined;
        try {
            const value = JSON.parse(text);
            return value && typeof value === "object"
                ? (value as Envelope)
                : undefined;
        } catch {
            return undefined;
        }
    };
    const direct = attempt(whole);
    if (direct) return direct;
    for (const line of whole.split("\n")) {
        const parsed = attempt(line.trim());
        if (parsed) return parsed;
    }
    return undefined;
}

/** Walk any parsed JSON for recovery ids, even when the shape is wrong. */
export function salvageIds(value: unknown): SalvagedIds {
    const out: SalvagedIds = {};
    const walk = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
            for (const item of node) walk(item);
            return;
        }
        for (const [key, val] of Object.entries(node)) {
            if (typeof val === "string") {
                if (key === "workspace_id" && !out.workspaceId) {
                    out.workspaceId = val;
                } else if (key === "pane_id" && !out.paneId) {
                    out.paneId = val;
                } else if (key === "path" && !out.path) {
                    out.path = val;
                }
            } else {
                walk(val);
            }
        }
    };
    walk(value);
    return out;
}

export type CreateParsed =
    | {
          ok: true;
          workspaceId: string;
          paneId: string;
          path: string;
          branch?: string;
      }
    | { ok: false; error: string; ids: SalvagedIds };

export function parseWorktreeCreate(res: RunResult): CreateParsed {
    const envelope = parseEnvelope(res.stdout);
    const ids = salvageIds(envelope ?? {});
    const detail = rawDetail(res);

    if (envelope?.error) {
        const { code, message } = envelope.error;
        return {
            ok: false,
            error: `herdr worktree create failed: ${code ?? "error"}: ${message ?? "(no message)"}`,
            ids,
        };
    }
    if (!envelope?.result) {
        return {
            ok: false,
            error: `herdr worktree create returned no JSON envelope.\n${detail}`,
            ids,
        };
    }
    const result = envelope.result as {
        type?: string;
        workspace?: { workspace_id?: string };
        root_pane?: PaneInfo;
        worktree?: { path?: string; branch?: string | null };
    };
    if (result.type !== "worktree_created") {
        return {
            ok: false,
            error: `herdr worktree create returned unexpected result type ${JSON.stringify(result.type)}.\n${detail}`,
            ids,
        };
    }
    const workspaceId = result.workspace?.workspace_id;
    const paneId = result.root_pane?.pane_id;
    const path = result.worktree?.path;
    if (!workspaceId || !paneId || !path) {
        return {
            ok: false,
            error: `herdr worktree create envelope is missing workspace_id / pane_id / worktree path.\n${detail}`,
            ids,
        };
    }
    if (res.status !== 0) {
        return {
            ok: false,
            error: `herdr worktree create exited ${res.status} despite a worktree_created envelope.\n${detail}`,
            ids: { workspaceId, paneId, path },
        };
    }
    return {
        ok: true,
        workspaceId,
        paneId,
        path,
        branch: result.worktree?.branch ?? undefined,
    };
}

export function parsePaneInfo(res: RunResult): PaneInfo | undefined {
    const result = parseEnvelope(res.stdout)?.result as
        | { pane?: PaneInfo }
        | undefined;
    return result?.pane;
}

export function parseAgentInfo(res: RunResult): PaneInfo | undefined {
    const result = parseEnvelope(res.stdout)?.result as
        | { agent?: PaneInfo; pane?: PaneInfo }
        | undefined;
    return result?.agent ?? result?.pane;
}

/** Ready = sitting in the new checkout and still a plain shell. */
export function paneReady(
    pane: PaneInfo | undefined,
    checkoutPath: string,
    canonical: (p: string) => string,
): boolean {
    if (!pane) return false;
    if (pane.agent) return false;
    const want = canonical(checkoutPath);
    for (const candidate of [pane.cwd, pane.foreground_cwd]) {
        if (candidate && canonical(candidate) === want) return true;
    }
    return false;
}

export function porcelainPaths(stdout: string): string[] {
    return stdout
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
            const rest = line.slice(3);
            const renamed = rest.split(" -> ");
            return renamed[renamed.length - 1] ?? rest;
        });
}

export function rawDetail(res: RunResult): string {
    const parts = [`exit status: ${res.status}`];
    if (res.stdout.trim()) parts.push(`stdout:\n${res.stdout.trim()}`);
    if (res.stderr.trim()) parts.push(`stderr:\n${res.stderr.trim()}`);
    return parts.join("\n");
}

export type RecoveryInput = {
    workspaceId?: string;
    paneId?: string;
    path?: string;
    branch?: string;
    agentName?: string;
    sessionFile?: string;
    /** True only when the pane was verified still a plain shell. */
    paneStillShell: boolean;
};

/** POSIX single-quote, only when the token needs it. */
export function shellQuote(arg: string): string {
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
    return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Never auto-remove: print what the operator can run instead. */
export function recoveryReport(info: RecoveryInput): string {
    const lines: string[] = ["The checkout was kept. Recovery:"];
    if (info.branch) lines.push(`  branch:    ${info.branch}`);
    if (info.path) lines.push(`  checkout:  ${info.path}`);
    if (info.workspaceId) lines.push(`  workspace: ${info.workspaceId}`);
    if (info.paneId) lines.push(`  pane:      ${info.paneId}`);
    if (
        info.paneStillShell &&
        info.agentName &&
        info.paneId &&
        info.sessionFile
    ) {
        lines.push(
            "",
            "Pane is still a shell. Retry the agent with:",
            `  herdr agent start ${shellQuote(info.agentName)} --kind pi --pane ${shellQuote(info.paneId)} -- --fork ${shellQuote(info.sessionFile)}`,
        );
    } else if (info.paneId) {
        lines.push(
            "",
            "Pi may already own that pane - inspect before restarting anything:",
            `  herdr pane get ${shellQuote(info.paneId)}`,
        );
    }
    if (info.workspaceId) {
        lines.push(
            "",
            "Discard the checkout only if you want it gone:",
            `  herdr worktree remove --workspace ${shellQuote(info.workspaceId)}`,
        );
    }
    return lines.join("\n");
}

export type ForkDeps = {
    run: Runner;
    env: Record<string, string | undefined>;
    cwd: string;
    session: {
        file: string | undefined;
        leafId: string | null;
        lastEntryId: string | null;
    };
    /** Resolved real path, or the input when it cannot be resolved. */
    canonical: (p: string) => string;
    /** "dev:ino" identity, undefined when the path is missing. */
    fileId: (p: string) => string | undefined;
    isRegularFile: (p: string) => boolean;
    piConfigDir: string;
    inContainer: boolean;
    sleep: (ms: number) => Promise<void>;
    paneTimeoutMs?: number;
    startTimeoutMs?: number;
    waitTimeoutMs?: number;
    seed?: string;
};

export type ForkOutcome = { ok: boolean; message: string };

async function git(
    deps: ForkDeps,
    args: string[],
    cwd = deps.cwd,
): Promise<RunResult> {
    return deps.run("git", ["-C", cwd, ...args]);
}

export async function herdrFork(
    rawArgs: string,
    deps: ForkDeps,
): Promise<ForkOutcome> {
    const fail = (message: string): ForkOutcome => ({ ok: false, message });

    const focusCheck = validateFocus(rawArgs);
    if (!focusCheck.ok) return fail(focusCheck.error);
    const focus = focusCheck.focus;

    // --- session preconditions -------------------------------------------
    const sessionFile = deps.session.file;
    if (!sessionFile || !deps.isRegularFile(sessionFile)) {
        return fail(
            "This session has no readable session file on disk, so there is nothing to fork. Persistence may be disabled.",
        );
    }
    if (deps.session.leafId !== deps.session.lastEntryId) {
        return fail(
            [
                "The active leaf is not the last persisted entry (you navigated with /tree).",
                "pi --fork restores the last entry in the file, so the clone would get the wrong branch.",
                "Return to the tip of the conversation and rerun.",
            ].join("\n"),
        );
    }

    // --- environment ------------------------------------------------------
    if (deps.inContainer) {
        return fail(
            "/herdr-fork is host-only. Herdr puts worktrees outside container mounts.",
        );
    }
    if (deps.env.HERDR_ENV !== "1") {
        return fail("Not running inside Herdr (HERDR_ENV is not 1).");
    }
    if (!deps.env.HERDR_SOCKET_PATH) {
        return fail(
            "HERDR_SOCKET_PATH is not set; cannot reach the Herdr server.",
        );
    }
    if (!deps.env.HERDR_PANE_ID) {
        return fail(
            "HERDR_PANE_ID is not set; cannot identify the source pane.",
        );
    }
    const version = await deps.run("herdr", ["--version"]);
    if (version.status !== 0) {
        return fail(
            `The herdr CLI is not runnable on PATH.\n${rawDetail(version)}`,
        );
    }
    // --version only proves the binary exists; this proves the server answers.
    const selfPane = await deps.run("herdr", [
        "pane",
        "get",
        deps.env.HERDR_PANE_ID,
    ]);
    if (selfPane.status !== 0 || !parsePaneInfo(selfPane)) {
        return fail(
            `The Herdr server did not return pane ${deps.env.HERDR_PANE_ID}; it is unreachable.\n${rawDetail(selfPane)}`,
        );
    }

    // --- git --------------------------------------------------------------
    const topLevel = await git(deps, ["rev-parse", "--show-toplevel"]);
    if (topLevel.status !== 0) {
        return fail(
            `${deps.cwd} is not inside a git work tree.\n${rawDetail(topLevel)}`,
        );
    }
    const repoRoot = topLevel.stdout.trim();
    if (!repoRoot)
        return fail(`Could not resolve a git work tree from ${deps.cwd}.`);

    const commonDirRes = await git(
        deps,
        ["rev-parse", "--git-common-dir"],
        repoRoot,
    );
    if (commonDirRes.status !== 0) {
        return fail(
            `Could not resolve the git common dir.\n${rawDetail(commonDirRes)}`,
        );
    }
    const commonDirRaw = commonDirRes.stdout.trim();
    const commonDir = commonDirRaw.startsWith("/")
        ? commonDirRaw
        : `${repoRoot}/${commonDirRaw}`;

    // Bind-mount aliases survive realpath, so also compare inode identity.
    const piGit = `${deps.piConfigDir}/.git`;
    const sameCanonical =
        deps.canonical(repoRoot) === deps.canonical(deps.piConfigDir);
    const piGitId = deps.fileId(piGit);
    const sameGitDir =
        piGitId !== undefined && piGitId === deps.fileId(commonDir);
    if (sameCanonical || sameGitDir) {
        return fail(
            "Refusing to fork the live Pi config repo (~/.pi). Run /herdr-fork from a project checkout.",
        );
    }

    const porcelain = await git(deps, ["status", "--porcelain"], repoRoot);
    if (porcelain.status !== 0) {
        return fail(
            `git status failed in ${repoRoot}.\n${rawDetail(porcelain)}`,
        );
    }
    const dirty = porcelainPaths(porcelain.stdout);
    if (dirty.length > 0) {
        return fail(
            [
                `${repoRoot} has uncommitted changes; they would not appear in the new worktree.`,
                "Commit or clean these paths first:",
                ...dirty.map((p) => `  ${p}`),
            ].join("\n"),
        );
    }

    const headRes = await git(deps, ["rev-parse", "HEAD"], repoRoot);
    const oid = headRes.stdout.trim();
    if (headRes.status !== 0 || !/^[0-9a-f]{7,40}$/.test(oid)) {
        return fail(
            `Could not capture the current commit.\n${rawDetail(headRes)}`,
        );
    }

    // --- names ------------------------------------------------------------
    const seed =
        deps.seed ??
        `${new Date().toISOString().slice(0, 16)}-${oid.slice(0, 7)}`;
    const slug = forkSlug(focus, seed);
    const branch = branchFor(slug);
    const agentName = agentNameFor(slug, oid.slice(0, 7));
    if (!isSafeRef(branch))
        return fail(`Refusing unsafe branch name: ${branch}`);

    // --- create -----------------------------------------------------------
    const created = parseWorktreeCreate(
        await deps.run("herdr", [
            "worktree",
            "create",
            "--cwd",
            repoRoot,
            "--branch",
            branch,
            "--base",
            oid,
            "--label",
            slug.slice(0, 24),
            "--no-focus",
        ]),
    );
    if (!created.ok) {
        const { workspaceId, paneId, path } = created.ids;
        if (!workspaceId && !paneId && !path) return fail(created.error);
        return fail(
            `${created.error}\n\n${recoveryReport({
                workspaceId,
                paneId,
                path,
                branch,
                paneStillShell: false,
            })}`,
        );
    }
    const { workspaceId, paneId, path: checkout } = created;

    const keepAlive = (message: string, paneStillShell: boolean): ForkOutcome =>
        fail(
            `${message}\n\n${recoveryReport({
                workspaceId,
                paneId,
                path: checkout,
                branch,
                agentName,
                sessionFile,
                paneStillShell,
            })}`,
        );

    // --- wait for the root pane to be a shell sitting in the checkout ------
    const paneDeadlineMs = deps.paneTimeoutMs ?? 15000;
    let pane: PaneInfo | undefined;
    let ready = false;
    for (let waited = 0; ; waited += 500) {
        pane = parsePaneInfo(await deps.run("herdr", ["pane", "get", paneId]));
        if (paneReady(pane, checkout, deps.canonical)) {
            ready = true;
            break;
        }
        if (waited >= paneDeadlineMs) break;
        await deps.sleep(500);
    }
    if (!ready) {
        return keepAlive(
            `Pane ${paneId} never became a shell in ${checkout} within ${paneDeadlineMs}ms (cwd=${pane?.cwd ?? "?"}, agent=${pane?.agent ?? "none"}).`,
            !pane?.agent,
        );
    }

    // --- start pi --fork in that pane -------------------------------------
    const startTimeout = deps.startTimeoutMs ?? 30000;
    const start = await deps.run("herdr", [
        "agent",
        "start",
        agentName,
        "--kind",
        "pi",
        "--pane",
        paneId,
        "--timeout",
        String(startTimeout),
        "--",
        "--fork",
        sessionFile,
    ]);
    if (start.status !== 0) {
        const after = parsePaneInfo(
            await deps.run("herdr", ["pane", "get", paneId]),
        );
        return keepAlive(
            `herdr agent start failed.\n${rawDetail(start)}`,
            after !== undefined && !after.agent,
        );
    }

    // --- wait for a settled state ----------------------------------------
    const waitTimeout = deps.waitTimeoutMs ?? 120000;
    const waited = await deps.run("herdr", [
        "agent",
        "wait",
        agentName,
        "--until",
        "idle",
        "--until",
        "blocked",
        "--timeout",
        String(waitTimeout),
    ]);
    const info = parseAgentInfo(
        await deps.run("herdr", ["agent", "get", agentName]),
    );
    const status = info?.agent_status;
    const clonePath =
        info?.agent_session?.kind === "path"
            ? info.agent_session.value
            : undefined;

    const lines = [
        status === "blocked"
            ? "Forked, but the clone is waiting on input."
            : "Forked into a new Herdr worktree workspace.",
        "",
        `  branch:    ${branch}`,
        `  checkout:  ${checkout}`,
        `  workspace: ${workspaceId}`,
        `  pane:      ${paneId}`,
        `  agent:     ${agentName}`,
        `  session:   ${clonePath ?? "(not reported yet)"}`,
    ];
    if (waited.status !== 0) {
        lines.push(
            "",
            `The agent did not settle within ${waitTimeout}ms (status=${status ?? "unknown"}). It may still be starting.`,
        );
    }
    if (status === "blocked") {
        lines.push(
            "",
            "A brand-new checkout is an untrusted Pi project, so this is almost certainly the",
            "project-trust prompt. Switch to the pane above and answer it yourself.",
            "No keys were sent to that pane, and none will be.",
        );
    }
    if (focus) {
        lines.push(
            "",
            "Compact is not sent automatically. To compact the clone only, run this in that pane:",
            `  /compact ${focus}`,
        );
    }
    lines.push(
        "",
        `Isolation caveat: the clone shares .git with this repo (${commonDir}).`,
        "Worktree files are separate, but refs, stash, hooks and config are shared.",
        "",
        `This pane is unchanged: same session, same cwd, still on ${repoRoot}.`,
    );
    return { ok: true, message: lines.join("\n") };
}
