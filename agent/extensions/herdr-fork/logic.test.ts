import assert from "node:assert/strict";
import test from "node:test";
import {
    branchFor,
    type ForkDeps,
    forkSlug,
    herdrFork,
    isSafeRef,
    parsePaneInfo,
    parseWorktreeCreate,
    porcelainPaths,
    type RunResult,
    recoveryReport,
    salvageIds,
    slugify,
    validateFocus,
} from "./logic.ts";

const OID = "a".repeat(40);
const CHECKOUT = "/home/tsb/.herdr/worktrees/demo";

const ok = (stdout: string): RunResult => ({ status: 0, stdout, stderr: "" });
const bad = (stderr: string, status = 1): RunResult => ({
    status,
    stdout: "",
    stderr,
});

function createEnvelope(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        id: "1",
        result: {
            type: "worktree_created",
            workspace: { workspace_id: "w9" },
            tab: { tab_id: "t1" },
            root_pane: { pane_id: "w9:p1", cwd: CHECKOUT },
            worktree: { path: CHECKOUT, branch: "feat/herdr-fork-demo" },
            ...overrides,
        },
    });
}

function paneEnvelope(pane: Record<string, unknown>): string {
    return JSON.stringify({ id: "2", result: { type: "pane_info", pane } });
}

type Calls = string[][];

/** Scripted runner: happy path by default, overridable per command prefix. */
function makeDeps(
    options: {
        responses?: Record<string, RunResult | RunResult[]>;
        session?: Partial<ForkDeps["session"]>;
        calls?: Calls;
    } = {},
): ForkDeps {
    const defaults: Record<string, RunResult> = {
        "git rev-parse --show-toplevel": ok("/repo\n"),
        "git rev-parse --git-common-dir": ok("/repo/.git\n"),
        "git status --porcelain": ok(""),
        "git rev-parse HEAD": ok(`${OID}\n`),
        "herdr --version": ok("herdr 1.0\n"),
        "herdr worktree create": ok(createEnvelope()),
        "herdr pane get": ok(
            paneEnvelope({ pane_id: "w9:p1", cwd: CHECKOUT, agent: null }),
        ),
        "herdr agent start": ok(""),
        "herdr agent wait": ok(""),
        "herdr agent get": ok(
            JSON.stringify({
                id: "3",
                result: {
                    type: "agent_info",
                    agent: {
                        pane_id: "w9:p1",
                        agent: "pi",
                        agent_status: "idle",
                        agent_session: {
                            kind: "path",
                            value: "/clone/session.jsonl",
                        },
                    },
                },
            }),
        ),
    };
    const queues = new Map<string, RunResult[]>();
    for (const [key, value] of Object.entries(options.responses ?? {})) {
        queues.set(key, Array.isArray(value) ? [...value] : [value]);
    }

    return {
        run: async (cmd, args) => {
            options.calls?.push([cmd, ...args]);
            // git calls arrive as ["-C", cwd, verb...]; drop the -C pair for matching.
            const rest = cmd === "git" ? args.slice(2) : args;
            const keys = [
                `${cmd} ${rest.slice(0, 3).join(" ")}`,
                `${cmd} ${rest.slice(0, 2).join(" ")}`,
                `${cmd} ${rest.slice(0, 1).join(" ")}`,
            ];
            for (const key of keys) {
                const queue = queues.get(key);
                const next =
                    queue && (queue.length > 1 ? queue.shift() : queue[0]);
                if (next) return next;
                const preset = defaults[key];
                if (preset) return preset;
            }
            return bad(`unscripted: ${cmd} ${args.join(" ")}`);
        },
        env: {
            HERDR_ENV: "1",
            HERDR_SOCKET_PATH: "/run/herdr.sock",
            HERDR_PANE_ID: "w8:p4",
        },
        cwd: "/repo",
        session: {
            file: "/sessions/source.jsonl",
            leafId: "e9",
            lastEntryId: "e9",
            ...options.session,
        },
        canonical: (p) => p.replace(/\/+$/, ""),
        fileId: (p) => (p === "/repo/.git" ? "1:100" : undefined),
        isRegularFile: () => true,
        piConfigDir: "/home/tsb/.pi",
        inContainer: false,
        sleep: async () => {},
        paneTimeoutMs: 1500,
        seed: "2026-08-28-abc1234",
    };
}

test("slugify caps length and strips unsafe characters", () => {
    assert.equal(slugify("Focus on the JSON shape"), "focus-on-the-json-shape");
    assert.equal(slugify("  ../weird..name.lock  "), "weird-name-lock");
    assert.equal(slugify("---"), "");
    assert.ok(slugify("x".repeat(200)).length <= 40);
    assert.equal(forkSlug("", "2026-08-28-abc1234"), "2026-08-28-abc1234");
    assert.ok(isSafeRef(branchFor(forkSlug("a b", "seed"))));
});

test("isSafeRef rejects illegal git refs", () => {
    assert.ok(isSafeRef("feat/herdr-fork-demo"));
    assert.ok(!isSafeRef("feat/../escape"));
    assert.ok(!isSafeRef("feat/-leading"));
    assert.ok(!isSafeRef("feat/thing.lock"));
    assert.ok(!isSafeRef("feat/trailing/"));
    assert.ok(!isSafeRef(""));
});

test("validateFocus rejects control characters and a leading slash", () => {
    assert.deepEqual(validateFocus("  hello  "), { ok: true, focus: "hello" });
    assert.deepEqual(validateFocus(""), { ok: true, focus: "" });
    const newline = validateFocus("line one\nline two");
    assert.equal(newline.ok, false);
    assert.match(newline.ok ? "" : newline.error, /newlines or control/);
    const slash = validateFocus("/compact everything");
    assert.equal(slash.ok, false);
    assert.match(slash.ok ? "" : slash.error, /must not start with/);
    assert.equal(validateFocus("bell\u0007here").ok, false);
});

test("parseWorktreeCreate reads a success envelope", () => {
    const parsed = parseWorktreeCreate(ok(createEnvelope()));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.workspaceId, "w9");
    assert.equal(parsed.paneId, "w9:p1");
    assert.equal(parsed.path, CHECKOUT);
});

test("parseWorktreeCreate surfaces an error envelope", () => {
    const parsed = parseWorktreeCreate({
        status: 1,
        stdout: JSON.stringify({
            id: "1",
            error: { code: "branch_exists", message: "branch already exists" },
        }),
        stderr: "",
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /branch_exists/);
    assert.match(parsed.error, /branch already exists/);
});

test("malformed envelope still yields ids for recovery", () => {
    const stdout = JSON.stringify({
        id: "1",
        result: {
            type: "something_else",
            workspace: { workspace_id: "w42" },
            root_pane: { pane_id: "w42:p1" },
            worktree: { path: "/tmp/wt" },
        },
    });
    const parsed = parseWorktreeCreate(ok(stdout));
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.ids.workspaceId, "w42");
    assert.equal(parsed.ids.paneId, "w42:p1");
    assert.equal(parsed.ids.path, "/tmp/wt");
    assert.match(parsed.error, /unexpected result type/);
});

test("salvageIds walks arbitrarily nested shapes", () => {
    assert.deepEqual(
        salvageIds({ a: [{ b: { workspace_id: "w1", path: "/p" } }] }),
        {
            workspaceId: "w1",
            path: "/p",
        },
    );
    assert.deepEqual(salvageIds(null), {});
});

test("porcelainPaths lists blocking files including renames", () => {
    const paths = porcelainPaths(
        " M src/a.ts\n?? notes.md\nR  old.ts -> new.ts\n",
    );
    assert.deepEqual(paths, ["src/a.ts", "notes.md", "new.ts"]);
});

test("recoveryReport always prints the remove command", () => {
    const report = recoveryReport({
        workspaceId: "w9",
        paneId: "w9:p1",
        path: CHECKOUT,
        paneStillShell: false,
    });
    assert.match(report, /herdr worktree remove --workspace w9/);
    assert.ok(!report.includes("--kind pi --pane"));
});

test("leaf mismatch refuses before touching herdr", async () => {
    const calls: Calls = [];
    const outcome = await herdrFork(
        "",
        makeDeps({ calls, session: { leafId: "e4", lastEntryId: "e9" } }),
    );
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /\/tree/);
    assert.equal(calls.length, 0);
});

test("dirty repo is refused and the paths are listed", async () => {
    const calls: Calls = [];
    const outcome = await herdrFork(
        "",
        makeDeps({
            calls,
            responses: {
                "git status --porcelain": ok(" M src/a.ts\n?? scratch.txt\n"),
            },
        }),
    );
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /src\/a\.ts/);
    assert.match(outcome.message, /scratch\.txt/);
    assert.ok(!calls.some((c) => c[1] === "worktree"));
});

test("live ~/.pi is refused by git-common-dir identity", async () => {
    const deps = makeDeps();
    deps.fileId = () => "1:100";
    const outcome = await herdrFork("", deps);
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /live Pi config/);
});

test("missing session file is refused", async () => {
    const deps = makeDeps();
    deps.isRegularFile = () => false;
    const outcome = await herdrFork("", deps);
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /no readable session file/);
});

test("argv is passed as arrays, with spaces preserved after --", async () => {
    const calls: Calls = [];
    const deps = makeDeps({ calls });
    deps.session = { ...deps.session, file: "/sessions/my project/s.jsonl" };
    const outcome = await herdrFork("focus on JSON", deps);
    assert.equal(outcome.ok, true);

    const start = calls.find((c) => c[1] === "agent" && c[2] === "start");
    assert.ok(start);
    const sep = start.indexOf("--");
    assert.ok(sep > 0);
    assert.deepEqual(start.slice(sep), [
        "--",
        "--fork",
        "/sessions/my project/s.jsonl",
    ]);
    assert.ok(start.includes("--kind") && start.includes("pi"));

    const create = calls.find((c) => c[1] === "worktree");
    assert.ok(create);
    assert.deepEqual(create.slice(0, 3), ["herdr", "worktree", "create"]);
    assert.equal(create[create.indexOf("--base") + 1], OID);
    assert.equal(
        create[create.indexOf("--branch") + 1],
        "feat/herdr-fork-focus-on-json",
    );
    assert.ok(create.includes("--no-focus"));
    assert.ok(!create.includes("--focus"));
});

test("focus text produces a manual compact line, never a sent one", async () => {
    const calls: Calls = [];
    const outcome = await herdrFork("focus on JSON", makeDeps({ calls }));
    assert.equal(outcome.ok, true);
    assert.match(outcome.message, /\/compact focus on JSON/);
    assert.ok(!calls.some((c) => c[2] === "prompt"));
});

test("delayed pane readiness eventually succeeds", async () => {
    const calls: Calls = [];
    const outcome = await herdrFork(
        "",
        makeDeps({
            calls,
            responses: {
                "herdr pane get": [
                    ok(
                        paneEnvelope({
                            pane_id: "w9:p1",
                            cwd: "/",
                            agent: null,
                        }),
                    ),
                    ok(
                        paneEnvelope({
                            pane_id: "w9:p1",
                            cwd: null,
                            agent: null,
                        }),
                    ),
                    ok(
                        paneEnvelope({
                            pane_id: "w9:p1",
                            cwd: CHECKOUT,
                            agent: null,
                        }),
                    ),
                ],
            },
        }),
    );
    assert.equal(outcome.ok, true, outcome.message);
    assert.match(outcome.message, /workspace: w9/);
    assert.ok(calls.filter((c) => c[1] === "pane").length >= 3);
});

test("start failure with Pi already on the pane prints no unconditional rerun", async () => {
    const outcome = await herdrFork(
        "",
        makeDeps({
            responses: {
                "herdr agent start": bad("agent_not_ready"),
                "herdr pane get": [
                    ok(
                        paneEnvelope({
                            pane_id: "w9:p1",
                            cwd: CHECKOUT,
                            agent: null,
                        }),
                    ),
                    ok(
                        paneEnvelope({
                            pane_id: "w9:p1",
                            cwd: CHECKOUT,
                            agent: "pi",
                        }),
                    ),
                ],
            },
        }),
    );
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /herdr worktree remove --workspace w9/);
    assert.match(outcome.message, /may already own/);
    assert.ok(!outcome.message.includes("--kind pi --pane"));
});

test("start failure on a still-shell pane offers the exact rerun", async () => {
    const outcome = await herdrFork(
        "",
        makeDeps({ responses: { "herdr agent start": bad("transient") } }),
    );
    assert.equal(outcome.ok, false);
    assert.match(
        outcome.message,
        /herdr agent start \S+ --kind pi --pane w9:p1 -- --fork \/sessions\/source\.jsonl/,
    );
    assert.match(outcome.message, /herdr worktree remove --workspace w9/);
});

test("blocked clone is reported as the trust prompt, with no keys sent", async () => {
    const calls: Calls = [];
    const outcome = await herdrFork(
        "",
        makeDeps({
            calls,
            responses: {
                "herdr agent get": ok(
                    JSON.stringify({
                        id: "3",
                        result: {
                            type: "agent_info",
                            agent: {
                                pane_id: "w9:p1",
                                agent_status: "blocked",
                            },
                        },
                    }),
                ),
            },
        }),
    );
    assert.equal(outcome.ok, true);
    assert.match(outcome.message, /project-trust prompt/);
    assert.match(outcome.message, /No keys were sent/);
    assert.ok(!calls.some((c) => c[2] === "prompt"));
});

test("success reports the shared .git caveat and an unchanged source", async () => {
    const outcome = await herdrFork("", makeDeps());
    assert.equal(outcome.ok, true);
    assert.match(outcome.message, /shares \.git/);
    assert.match(outcome.message, /This pane is unchanged/);
    assert.match(outcome.message, /session: {3}\/clone\/session\.jsonl/);
});

test("environment gates fire before any git or herdr call", async () => {
    for (const key of ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID"]) {
        const calls: Calls = [];
        const deps = makeDeps({ calls });
        deps.env = { ...deps.env, [key]: undefined };
        const outcome = await herdrFork("", deps);
        assert.equal(outcome.ok, false, key);
        assert.equal(calls.length, 0, key);
    }
    const deps = makeDeps();
    deps.inContainer = true;
    assert.match((await herdrFork("", deps)).message, /host-only/);
});

test("pane get parses the documented pane_info envelope", () => {
    const pane = parsePaneInfo(
        ok(
            paneEnvelope({
                pane_id: "w1:p2",
                cwd: "/x",
                agent_status: "unknown",
            }),
        ),
    );
    assert.equal(pane?.pane_id, "w1:p2");
    assert.equal(parsePaneInfo(ok("not json")), undefined);
});
