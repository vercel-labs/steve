# PROOF — demonstrating a fully self-hosted eve agent

This document is the reproducible evidence that the thesis holds: `eve` runs
end to end with **no Vercel-proprietary infrastructure**. Three proofs:

1. **Isolation** — model-generated code runs in the Docker sandbox, never in the host.
2. **Durability** (headline) — a run survives killing and restarting the host.
3. **No-Vercel** — the project has zero active Vercel coupling.

## Replacement map

Every Vercel-proprietary service is replaced by a self-hosted component:

| Vercel service | Self-hosted replacement | Where |
| --- | --- | --- |
| Vercel Workflow | `@workflow/world-postgres` + Dockerized Postgres | `agent/agent.ts`, `docker-compose.yml` |
| Vercel Sandbox | Docker container backend | `agent/sandbox/sandbox.ts` |
| AI Gateway | direct `@ai-sdk/openai` + `OPENAI_API_KEY` | `agent/agent.ts` |
| Agent Runs dashboard | `workflow inspect runs` / `workflow web` | `make observe` / `make observe-web` |
| Vercel OTel / observability | vanilla OpenTelemetry → Jaeger | `agent/instrumentation.ts` |
| Vercel Connect / Blob / Cron | not used | — |

## Prerequisites for all proofs

```bash
pnpm install
cp .env.example .env        # set a funded OPENAI_API_KEY; keep WORKFLOW_QUEUE_NAMESPACE=eve
make db-up
make db-migrate
make dev                     # long-running host in its own terminal
```

---

## Proof 1 — Isolation (code runs in the sandbox, not the host)

The host process has a secret in its environment (`HOST_ONLY_SECRET`) that is
**never** passed into the sandbox. We ask the agent to print, from inside the
sandbox, its container hostname and any value it can see for that secret.

```bash
make proof-isolation
# returns a sessionId; stream it:
curl -N http://localhost:3000/eve/v1/session/<sessionId>/stream
```

**What to observe in the response:**

- `socket.gethostname()` prints a **Docker container id** (a random 12-hex
  string), not your machine's hostname — proving the code executed in the
  container.
- `os.environ.get("HOST_ONLY_SECRET")` prints `<unset in sandbox>` — the host's
  secret is **unreachable** from sandbox code, proving the trust boundary.

Additionally, the sandbox is configured `deny-all` for network egress
(`agent/sandbox/sandbox.ts`), so model-generated code cannot phone home.

> Why this matters: tools run in the **app runtime** with full `process.env`,
> but `run_python` deliberately delegates all execution to `ctx.getSandbox()`.
> The host never executes model-authored code.

---

## Proof 2 — Durability via crash recovery (the headline)

This proves the Postgres event log — not any Vercel service — is what makes
sessions durable. We interrupt the host mid-run and confirm the run resumes
from the last completed step, without re-running completed sandbox steps.

### Step-by-step runbook

**1. Confirm a clean slate and start a run.**

```bash
make observe        # note the current runs (may be empty)
make session        # kicks off the 3-step analysis; note the sessionId
```

**2. Watch it begin and reach a step boundary.** Stream the session or poll the
event log; wait until at least the first step has completed:

```bash
# Event log: completed steps accumulate here
docker exec steve-postgres psql -U world -d world \
  -c "select type, count(*) from workflow.workflow_events group by type order by 2 desc;"
# Look for step_completed >= 1 before continuing.
```

You can also watch live:

```bash
make observe        # the run shows status R (running)
```

**3. Kill the host mid-run** (between steps). In the terminal running `make dev`,
press `Ctrl-C`, or from elsewhere:

```bash
pkill -f "eve dev --no-ui"
```

**4. Inspect the event log while the host is down.** The completed steps are
durably recorded in Postgres; nothing is lost:

```bash
make observe        # run still listed; status reflects last persisted state
docker exec steve-postgres psql -U world -d world \
  -c "select type, count(*) from workflow.workflow_events group by type order by 2 desc;"
# Record the step_completed count here — call it N.
```

**5. Restart the host.**

```bash
make dev
```

On startup the Postgres world re-enqueues active runs (you'll see
`[world-postgres] Re-enqueued N active run(s) on startup` in the log) and the
queue resumes.

**6. Confirm correct resume.**

```bash
make observe        # the SAME runId continues; it advances past N and completes
docker exec steve-postgres psql -U world -d world \
  -c "select type, count(*) from workflow.workflow_events group by type order by 2 desc;"
# step_started for the already-completed steps does NOT increase beyond N;
# new step_completed events appear only for the remaining steps, and a
# run_completed event lands at the end.
```

### What proves durability

- The **same `runId`** resumes after the restart (no new session).
- The `step_completed` events recorded before the kill are **replayed, not
  re-executed** — eve restores their results from the Postgres event log.
- The run reaches `run_completed` despite the process having died mid-run.
- There is **no Vercel Workflow** anywhere in the loop; the only durable store
  is the `workflow.*` tables in your Postgres container.

### Evidence to capture

- `make observe` output before and after the restart (same runId, advancing).
- The `workflow.workflow_events` type counts before and after (completed steps
  preserved; only remaining steps added).
- The host log line `[world-postgres] Re-enqueued N active run(s) on startup`.
- Optionally, `make observe-web` screenshots of the event log timeline.

---

## Proof 3 — No Vercel coupling

```bash
make proof-novercel
# Scanning authored source + .env for ACTIVE Vercel coupling...
# CLEAN: no active Vercel coupling in agent/ or .env.
```

The check fails the build if any of these appear (uncommented) in `agent/` or
`.env`: `vercel()` sandbox backend, `vercelOidc()`, `AI_GATEWAY_API_KEY`,
`VERCEL_OIDC_TOKEN`, `vercel deploy`, `@vercel/otel`.

Corroborating facts:

- `agent/agent.ts` uses `openai("...")` — a provider **object**, which bypasses
  the AI Gateway. (When the key has no quota, the error message comes straight
  from `api.openai.com`, confirming the direct path.)
- `agent/channels/eve.ts` uses only `localDev()` + `httpBasic()` — no
  `vercelOidc()`.
- `agent/sandbox/sandbox.ts` pins the `docker()` backend.
- `agent/instrumentation.ts` uses the vanilla OpenTelemetry SDK, not
  `@vercel/otel`.
- The build emits a standard Nitro Node output under `.output/` (run
  `eve build` with `VERCEL` unset); there is no `.vercel/output`.

---

## Captured evidence (live run, eve 0.13.3 + world-postgres 5.0.0-beta.19)

All three proofs were executed live against a funded OpenAI key.

### Proof 1 — Isolation (captured)

Request: print `socket.gethostname()` and `HOST_ONLY_SECRET` from inside the sandbox.

```
sandbox output:
  e318ab324dcb            <- Docker container id (NOT the host)
  <unset in sandbox>      <- HOST_ONLY_SECRET is unreachable from the sandbox

host for comparison:
  hostname            = computer.local
  HOST_ONLY_SECRET    = if-you-can-read-this-from-the-sandbox-isolation-is-broken
```

The container hostname differs from the host, and the host-only secret is not
visible to sandbox code. A live sandbox container was observed during runs:
`eve-sbx-ses-docker-...-wrun_...` from image `ghcr.io/vercel/eve:latest`.

### Proof 2 — Durability via crash recovery (captured)

Session `wrun_01KVVM0E6QPQ73R691M227K9BM`:

| Phase | `step_completed` events | run status |
| --- | --- | --- |
| After first step, before kill | **2** | running |
| Host killed mid-run (`kill -9`, step 3 in flight: `step_started`=3) | 2 (persisted) | running |
| After restart, run resumes and finishes | **6** | turn `completed` |

Key facts proving correct resume:
- The **same session id** resumed (no new session created).
- Final `step_started == step_completed == 6` — **no completed step was
  re-run** (counts would diverge if steps replayed as fresh executions).
- The turn run reached `run_completed`; the parent session parked at `running`.
- The agent still produced a correct, fully-computed analysis after the crash
  (500 orders, total revenue $410,968.32, per-product/region breakdowns).

The only durable store in the loop is the `workflow.*` tables in the local
Postgres container — no Vercel Workflow.

### Proof 3 — No Vercel coupling (captured)

```
$ make proof-novercel
Scanning authored source + .env for ACTIVE Vercel coupling...
CLEAN: no active Vercel coupling in agent/ or .env.
```

### Sample analysis output (3-step run)

A representative completed run generated 1,000 synthetic orders in
`/workspace/sales.csv`, then computed (all inside the sandbox): total units
9,790; gross sales 305,849.41; net sales 269,862.90; average discount 11.85%;
plus per-product and per-region breakdowns — and summarized them with the
underlying assumptions stated. Every number came from sandbox computation, not
the model guessing.
