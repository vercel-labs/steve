# steve — a fully self-hosted eve agent

A proof of concept that Vercel's [`eve`](https://opencode.ai) agent framework
runs **end to end with zero Vercel-proprietary infrastructure**:

- **Durability** comes from a self-hosted **Postgres Workflow world**
  (`@workflow/world-postgres`), not Vercel Workflow.
- **Code isolation** comes from a **Docker sandbox**, not Vercel Sandbox.
- **Model calls** go **directly to OpenAI**, not through the AI Gateway.
- **Observability** comes from the **Workflow CLI** + OpenTelemetry traces,
  not the Vercel Agent Runs dashboard. Locally, traces/logs/metrics go to a
  local **Observe dashboard** (`@open-observe/sdk`); in production they go to a
  self-hosted **Jaeger**. The backend is chosen by env (see below).

The agent is a durable, multi-step **data analyst**: given a request it
(1) generates a synthetic dataset, (2) analyzes it, and (3) summarizes the
result — each a distinct durable step, and all code runs inside the sandbox.

It runs locally for the proofs below, **and** is deployed end-to-end to an
independent DigitalOcean droplet (no Vercel) with a one-command Ansible
pipeline. See **[What's deployed](#whats-deployed)** for the live topology,
**[`deploy/README.md`](./deploy/README.md)** for the full runbook, and
**[`DEMO.md`](./DEMO.md)** for a ~5-minute live demo script.

## What it proves

| Vercel-proprietary service | Replaced here by |
| --- | --- |
| Vercel Workflow (managed durability) | `@workflow/world-postgres` + Dockerized Postgres |
| Vercel Sandbox | Docker container sandbox (`eve/sandbox/docker`) |
| AI Gateway | direct `@ai-sdk/openai` / `@ai-sdk/anthropic` + provider key |
| Agent Runs dashboard | `workflow inspect runs` / `workflow web` |
| Vercel Connect / Blob / Cron | not used |

See **[PROOF.md](./PROOF.md)** for the three reproducible proofs (isolation,
crash-recovery durability, no-Vercel).

## Prerequisites

- **Node >= 24** (tested on 24.15.0)
- **pnpm** (tested on 10.33.2)
- **Docker** (Engine 24+, used for both Postgres and the agent sandbox)
- A provider API key with quota: **`OPENAI_API_KEY`** (default) or
  **`ANTHROPIC_API_KEY`** (fallback)

### Model choice

`agent/agent.ts` selects a provider based on which key you set:

- **OpenAI (default):** `gpt-5-mini`, reading `OPENAI_API_KEY`.
- **Anthropic (fallback):** `claude-haiku-4-5`, reading `ANTHROPIC_API_KEY`,
  used automatically when `OPENAI_API_KEY` is unset.

Both are cheap so anyone can run the proofs, and both reliably complete the
generate → analyze → summarize loop with correct, sandbox-computed numbers.
Either way the call goes directly to the provider (no AI Gateway). Swap in a
bigger model (e.g. `gpt-5.1` or `claude-sonnet-4-6`) for higher quality, or
wire any other direct provider by changing the model object in `agent.ts` and
setting the matching key.

## Pinned versions

These are pinned exactly in `package.json`; the beta line matters (see Gotchas).

| Package | Version |
| --- | --- |
| `eve` | `0.15.0` |
| `@workflow/world-postgres` | `5.0.0-beta.19` |
| `workflow` (CLI) | `4.5.0` |
| `@ai-sdk/openai` | `3.0.74` |
| `@ai-sdk/anthropic` | `3.0.86` |
| `ai` | `7.0.0-canary.171` |
| `@opentelemetry/sdk-node` | `0.219.0` |

> **The `@workflow/world-postgres` version is critical.** The npm `latest` tag
> is `4.2.0`, which is **incompatible** and will make runs fail mid-execution.
> You must use the `5.0.0-beta` line that matches eve's bundled `@workflow/core`
> (eve `0.15.0` bundles `@workflow/core@5.0.0-beta.24`; `world-postgres@5.0.0-beta.19`
> brings `@workflow/world@5.0.0-beta.13`, which knows the `attr_set` event eve
> emits — verified end-to-end on `0.15.0`). See
> [Gotchas](#gotchas-discrepancies-from-the-naive-setup).

## Setup

```bash
pnpm install
cp .env.example .env          # then edit .env: set a funded OPENAI_API_KEY
make db-up                    # start Postgres on host port 5544
make db-migrate               # create the Workflow world schema (idempotent)
```

The required env vars (see `.env.example` for the full list):

```bash
OPENAI_API_KEY="sk-..."                                  # default provider, direct (no Gateway)
# ANTHROPIC_API_KEY="sk-ant-..."                         # fallback if OPENAI_API_KEY is unset
WORKFLOW_POSTGRES_URL="postgres://world:world@localhost:5544/world"
WORKFLOW_TARGET_WORLD="@workflow/world-postgres"          # default backend for the CLI
WORKFLOW_QUEUE_NAMESPACE="eve"                            # MUST be "eve" (see Gotchas)
ROUTE_AUTH_BASIC_USER="admin"
ROUTE_AUTH_BASIC_PASSWORD="change-me"
HOST_ONLY_SECRET="..."                                    # used by the isolation proof
# OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"     # optional, enables Jaeger
```

## Run

Start the long-running host (it polls the Postgres queue and serves HTTP):

```bash
make dev
# -> server listening at http://localhost:3000/
```

> `make dev` runs `eve dev --no-ui`. As of eve `0.15.0`, **`eve build && eve start`
> also works** with the custom Postgres world (the old `{"error":"Unhandled queue"}`
> regression is fixed — verified end-to-end). `eve dev` is still used here because
> it auto-reaps the per-run Docker sandbox containers on shutdown, which `eve start`
> does not. See [Gotchas](#gotchas-discrepancies-from-the-naive-setup).

In another terminal, start a session:

```bash
make session
# {"continuationToken":"eve:...","ok":true,"sessionId":"wrun_..."}

# Stream it (NDJSON), one event per line:
curl -N http://localhost:3000/eve/v1/session/<sessionId>/stream
```

## Observe (replaces the Vercel dashboard)

```bash
make observe        # workflow inspect runs --backend @workflow/world-postgres
make observe-web    # workflow web --backend @workflow/world-postgres  (browser UI)
```

### OpenTelemetry traces: OpenObserve (local) or Jaeger (prod)

eve's trace spans (`ai.eve.turn` -> `ai.streamText` -> `ai.toolCall`) are
exported over OTLP/HTTP by `agent/instrumentation.ts`:

- **Jaeger** (default, prod): if `OTEL_EXPORTER_OTLP_ENDPOINT` is set, vanilla
  OpenTelemetry exports trace spans to a self-hosted Jaeger. This is the
  committed default and needs no code changes.
- **OpenObserve** (local, opt-in): exports **traces, logs, and metrics** to a
  local Observe dashboard via `@open-observe/sdk`. Because that SDK is **not
  published to npm** (it's a local `link:` checkout shipping raw TS), the import
  is a **manual comment/uncomment toggle** in `agent/instrumentation.ts` rather
  than env-only — the committed default keeps it disabled so `eve start` /
  `next build` never reference the unpublished package. When enabled (and
  `OPEN_OBSERVE_OTLP_ENDPOINT` set) it takes precedence over Jaeger.
- Neither configured: telemetry export is disabled (fail-open); the agent runs.

**Local (OpenObserve):**

```bash
# In the openobserve checkout — start the dashboard (OTLP ingest + UI on :3001):
pnpm --filter @open-observe/dashboard dev

# In this repo:
#   1. In agent/instrumentation.ts, flip the OpenObserve toggle ON
#      (comment the prod-safe `resolveObserve = () => undefined` line and
#       uncomment the `import { observe }` + observe-returning line below it).
#   2. .env sets OPEN_OBSERVE_OTLP_ENDPOINT=http://localhost:3001
make dev
make session      # drive a run, then explore at http://localhost:3001/p/steve
```

**Local (Jaeger), to mirror production:** comment out `OPEN_OBSERVE_OTLP_ENDPOINT`
in `.env` and set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`, then:

```bash
docker compose --profile observability up -d jaeger
make dev
make session      # spans at http://localhost:16686
```

On the deployed droplet Jaeger runs in Docker and its UI is exposed publicly at
**`https://jaeger.eve.phil.bingo`** behind Caddy with HTTP Basic auth, so the
spans can be demoed in a browser. The deploy sets `OTEL_EXPORTER_OTLP_ENDPOINT`
and leaves `OPEN_OBSERVE_OTLP_ENDPOINT` unset, so production uses Jaeger. See
[`deploy/README.md`](./deploy/README.md).

## The three proofs

Full runbook in **[PROOF.md](./PROOF.md)**. In short:

```bash
make proof-isolation   # sandbox prints container hostname; host-only secret unreachable
# durability proof: start a session, kill `make dev` mid-run, restart, confirm resume
make proof-novercel    # greps agent/ + .env for active Vercel coupling -> CLEAN
```

## What's deployed

Beyond the local proofs, the whole stack is deployed to a single **DigitalOcean
droplet** — provisioned, hardened, and configured entirely by an **Ansible**
pipeline under [`deploy/`](./deploy). There is **no Vercel deploy step**. What
runs on the droplet:

| Component | What it is | Where |
| --- | --- | --- |
| **eve agent** | the durable data-analyst host (`eve dev --no-ui`), native under systemd | `127.0.0.1:3000` (`steve.service`) |
| **Next.js UI** | a chat front-end (`withEve` + `useEveAgent`), native under systemd | `127.0.0.1:3001` (`steve-web.service`) |
| **Postgres** | the durable Workflow world (Docker) | `127.0.0.1:5544` (`steve-postgres`) |
| **Docker sandbox** | per-run isolated containers the agent spawns via the Docker socket | ephemeral |
| **Beszel** | host/Docker monitoring — hub (dashboard) + agent, in Docker | `127.0.0.1:8090` + agent |
| **Jaeger** | OpenTelemetry trace UI + OTLP receiver (Docker); the agent ships spans to it | `127.0.0.1:16686` + `:4318` |
| **Caddy** | public reverse proxy, automatic Let's Encrypt TLS, header injection | `:80/:443` |

Public routing (single droplet, all behind Caddy):

```
eve.phil.bingo
  ├─ /eve/*, /.well-known/workflow/*  ->  eve agent      (127.0.0.1:3000)
  └─ everything else (the chat UI)    ->  Next.js         (127.0.0.1:3001)
status.eve.phil.bingo                 ->  Beszel hub      (127.0.0.1:8090)
jaeger.eve.phil.bingo (Basic auth)    ->  Jaeger UI       (127.0.0.1:16686)
```

Every response carries **`x-hosted-on-vercel: false`**, injected by Caddy, to
make the "not on Vercel" claim self-evident.

### Deploy / operate

```bash
cd deploy
export DO_API_TOKEN=dop_v1_...
make deps && make all          # provision -> harden -> deploy
make deploy                    # redeploy latest (idempotent)
make status / make logs        # operate the droplet
```

Highlights of the pipeline (full detail in [`deploy/README.md`](./deploy/README.md)):

- **Provision** a droplet via the DO API; **harden** it (non-root deploy user,
  key-only SSH, `ufw` 22/80/443, `fail2ban`, unattended security upgrades).
- **Agent + UI** run under systemd; the agent unit waits for Postgres on boot.
  Code ships via a read-only GitHub **deploy key** + `git pull`; the local
  `.env` is copied up (PoC-simple, no vault).
- **Caddy** path-routes the eve API straight to the agent and everything else to
  the UI — deliberately *not* using `withEve`'s production rewrite, which
  double-prefixes paths for a separate-origin agent (see `_internal/DX_NOTES.md`).
- **Auth:** the agent is **public (`none()`)** so the UI works without
  credentials — a PoC choice. Swap `agent/channels/eve.ts` back to
  `[localDev(), httpBasic({...})]` to lock it down.

> Why `eve dev --no-ui` rather than `eve start`? Historically (eve 0.13.x) only
> the dev host registered the custom Postgres world's queue handler; `eve start`
> returned "Unhandled queue". **This is fixed as of eve 0.15.0** — `eve start`
> now runs the custom world. We still use `eve dev` because only it auto-reaps
> the per-run Docker sandbox containers on shutdown. See `_internal/ISSUES.md`.

## Gotchas (discrepancies from the naive setup)

These were discovered while building; full detail in `_internal/ISSUES.md`.

1. **`@workflow/world-postgres@latest` (4.2.0) is incompatible.** Its event schema
   lacks the `attr_set` event eve emits, so runs fail mid-replay with a `ZodError`
   (`No matching discriminator "eventType"`). Pin `@workflow/world-postgres@5.0.0-beta.19`
   to match eve's bundled `@workflow/core` (eve `0.15.0` bundles `5.0.0-beta.24`;
   `world-postgres@5.0.0-beta.19` brings `@workflow/world@5.0.0-beta.13`, which
   knows `attr_set`). Still required on `0.15.0`.

2. **`WORKFLOW_QUEUE_NAMESPACE` must be `eve`.** eve registers its workflow queue
   handler under prefix `__eve_wkf_workflow_`, but the Postgres world defaults to
   `__wkf_workflow_`. Without the namespace, every job returns
   `400 {"error":"Unhandled queue"}` and runs never advance. Setting
   `WORKFLOW_QUEUE_NAMESPACE=eve` aligns them. Still required on `0.15.0`.

3. **~~Run the host with `eve dev --no-ui`, not `eve start`.~~ FIXED in eve 0.15.0.**
   `eve build && eve start` now runs the custom Postgres world end-to-end (verified:
   runs complete, `attr_set` persists, no "Unhandled queue"). We still prefer
   `eve dev --no-ui` only because it auto-reaps the Docker sandbox containers on
   shutdown; `eve start` leaves them running (operate a reaper if you use it).

4. **`docker()` backend network policy goes on the factory, not `onSession`.**
   A type-declaration bug makes `use({ networkPolicy })` in `onSession` a type
   error for the Docker backend; the factory option is correctly typed. **Still
   present on eve 0.15.0** (`TS2322: Type 'string' is not assignable to type 'never'`).

## Project layout

```
agent/
  agent.ts                 direct OpenAI/Anthropic model + experimental.workflow.world
  instructions.md          data-analyst persona (always computes via the sandbox)
  channels/eve.ts          HTTP channel, auth = [none()] (public, PoC) — see deploy notes
  sandbox/sandbox.ts        Docker backend, deny-all egress
  tools/run_python.ts      executes Python in the sandbox -> {stdout,stderr,exitCode}
  instrumentation.ts       OTel traces -> OpenObserve (local) or Jaeger (prod)
app/, components/, lib/    Next.js chat UI (withEve + useEveAgent)
next.config.ts             withEve(); transpilePackages @open-observe/sdk
deploy/                    Ansible: provision + harden + deploy agent, UI, Beszel, Caddy
  README.md                full deploy runbook; roles/ for each component
docker-compose.yml         postgres:16 (+ jaeger `observability` profile)
Makefile                   db-up, db-migrate, dev, observe, proof-* targets
.env.example
PROOF.md                   the three proofs, step by step
_internal/                 PLAN.md, ISSUES.md, DX_NOTES.md (notes for the eve team)
```
