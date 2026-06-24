# Plan: fully self-hosted eve agent (Postgres world + Docker sandbox)

## Thesis

Prove Vercel's `eve` agent framework runs end-to-end with **zero
Vercel-proprietary infrastructure**: no Vercel deploy, no Vercel Sandbox, no AI
Gateway, no Connect, no managed dashboard. Durability = self-hosted Postgres
Workflow world; code isolation = Docker sandbox; model calls = direct provider.

## Decisions (from the user)

- **Sandbox backend: Docker** (not microsandbox). Simpler, no KVM/nested-virt
  requirement, identical local + VPS. User explicitly did not care about
  microsandbox specifically.
- **Model: OpenAI** (`@ai-sdk/openai`, `OPENAI_API_KEY`) — user has no Anthropic
  key. Model id chosen: `gpt-5.1` (current general model; user deferred choice).
- **Auth: `[localDev(), httpBasic()]`** — dropped `vercelOidc()` to keep the
  project clean of Vercel coupling.
- **Observability stretch: vanilla OTel** (`@opentelemetry/sdk-node` + OTLP)
  → local Jaeger, avoiding `@vercel/otel` to keep the no-Vercel thesis airtight.
- **Scope: local proof only; document the VPS deploy** (do not provision a real
  droplet).

## Verified ground truth (eve 0.13.3, against installed packages/docs)

| Assumption | Reality |
| --- | --- |
| `experimental.workflow.world` config | Confirmed in defineAgent + docs (agent-config.md) |
| `@workflow/world-postgres` | 4.2.0; exports `createWorld(config?): World & { start() }`; bin `workflow-postgres-setup` |
| Does eve call `world.start()`? | **YES** — `installConfiguredWorkflowWorld` does `setWorld(n); await n.start?.()` (configure-world.js). No manual wiring needed. |
| World resolution | Accepts default fn OR `createWorld` export; world-postgres uses `createWorld` ✓ |
| Direct provider bypasses Gateway | Pass provider **object** `openai(...)` not string id; reads `OPENAI_API_KEY` (deployment.md:66-81) |
| Docker sandbox backend | `eve/sandbox/docker` real export; `docker({ image, env, pullPolicy, networkPolicy })`; default image `ghcr.io/vercel/eve:latest` |
| Docker network policy | Only `"allow-all"` / `"deny-all"` (no domain allow-lists) |
| `run` result shape | `{ stdout, stderr, exitCode }` |
| `httpBasic()` | Takes explicit `{ username, password }` — does NOT auto-read env |
| Workflow CLI | pkg `workflow@4.5.0` → `@workflow/cli@4.2.10`; `inspect` (runs/--world/--backend) and `web` (--backend/--world/--port) commands exist |
| World env vars | `WORKFLOW_POSTGRES_URL` (also `DATABASE_URL` for setup CLI); optional `WORKFLOW_POSTGRES_WORKER_CONCURRENCY`, `WORKFLOW_QUEUE_NAMESPACE` |
| Self-host start | `eve build && PORT=3000 eve start --host 0.0.0.0` |

## Pinned versions

- eve 0.13.3
- @ai-sdk/openai 3.0.74
- @workflow/world-postgres 4.2.0
- workflow CLI 4.5.0 (@workflow/cli 4.2.10)
- @opentelemetry/sdk-node 0.219.0, exporter-trace-otlp-http, resources 2.8.0, semantic-conventions 1.41.1
- Node 24.15.0, pnpm 10.33.2

## The agent (durable 3-step data analyst)

1. **Generate** — `run_python` writes+runs Python producing a synthetic sales
   CSV to `/workspace`.
2. **Analyze** — second `run_python` reads CSV, computes summary stats.
3. **Summarize** — model turns computed numbers into written analysis.

Tool: `run_python(code, filename)` → `{ stdout, stderr, exitCode }`, executes
strictly in the Docker sandbox via `ctx.getSandbox()`.

## Replacement map (Vercel → self-hosted)

| Vercel | Replacement |
| --- | --- |
| Vercel Workflow | `@workflow/world-postgres` + Docker Postgres |
| Vercel Sandbox | Docker container backend |
| AI Gateway | direct `@ai-sdk/openai` + `OPENAI_API_KEY` |
| Agent Runs dashboard | `workflow inspect runs` + `workflow web` |
| Connect / Blob / Cron | not used |

## The three proofs

1. **Isolation** — `run_python` prints container hostname (≠ host) and shows a
   host-only secret env var is unreachable from sandbox code; network deny-all.
2. **Durability (headline)** — start analysis, kill `eve start` between steps,
   restart, confirm resume from Postgres event log (completed steps not re-run).
3. **No-Vercel** — grep project + env clean of vercel/AI_GATEWAY/VERCEL_OIDC.

## Files

```
agent/agent.ts            openai() object model + experimental.workflow.world
agent/instructions.md     data-analyst persona
agent/channels/eve.ts     localDev() + httpBasic()
agent/sandbox/sandbox.ts  docker() backend, deny-all onSession
agent/tools/run_python.ts code exec in sandbox
agent/instrumentation.ts  vanilla OTel -> Jaeger (stretch)
docker-compose.yml        postgres:16 (+ jaeger profile)
Makefile                  db:up, db:migrate, dev, start, observe, proof:*
.env.example
README.md / PROOF.md
_internal/PLAN.md, ISSUES.md
```

## Build order (verification-first)

1. Pin/install deps ✓
2. Postgres up + migrate
3. Direct OpenAI turn works
4. Docker sandbox run_python works
5. Run persists in `workflow inspect runs`
6. Crash/resume works
7. Full 3-step flow + README/PROOF
