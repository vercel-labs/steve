# steve — a fully self-hosted eve agent

A proof of concept that Vercel's [`eve`](https://opencode.ai) agent framework
runs **end to end with zero Vercel-proprietary infrastructure**:

- **Durability** comes from a self-hosted **Postgres Workflow world**
  (`@workflow/world-postgres`), not Vercel Workflow.
- **Code isolation** comes from a **Docker sandbox**, not Vercel Sandbox.
- **Model calls** go **directly to OpenAI**, not through the AI Gateway.
- **Observability** comes from the **Workflow CLI** + optional **Jaeger/Axiom**, not
  the Vercel Agent Runs dashboard.

The agent is a durable, multi-step **data analyst**: given a request it
(1) generates a synthetic dataset, (2) analyzes it, and (3) summarizes the
result — each a distinct durable step, and all code runs inside the sandbox.

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
| `eve` | `0.13.3` |
| `@workflow/world-postgres` | `5.0.0-beta.19` |
| `workflow` (CLI) | `4.5.0` |
| `@ai-sdk/openai` | `3.0.74` |
| `@ai-sdk/anthropic` | `3.0.86` |
| `ai` | `7.0.0-canary.171` |
| `@opentelemetry/sdk-node` | `0.219.0` |

> **The `@workflow/world-postgres` version is critical.** The npm `latest` tag
> is `4.2.0`, which is **incompatible** with eve 0.13.3 and will make runs fail
> mid-execution. You must use the `5.0.0-beta` line that matches eve's bundled
> `@workflow/core`. See [Gotchas](#gotchas-discrepancies-from-the-naive-setup).

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

> Use `make dev` (`eve dev --no-ui`), **not** `eve start`. In eve 0.13.3 only the
> dev host registers the custom world's queue handler; `eve start` returns
> `{"error":"Unhandled queue"}`. See [Gotchas](#gotchas-discrepancies-from-the-naive-setup).

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

Optional OpenTelemetry traces to a local Jaeger:

```bash
docker compose --profile observability up -d jaeger
# set OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 in .env, restart `make dev`
# traces at http://localhost:16686
```

### Send traces and logs to Axiom

For external visibility, ship both signals to [Axiom](https://axiom.co) — into a
single dataset (named `steve` here, fine for the free plan):

- **Traces** (eve's `ai.eve.turn` / model-call / tool-call spans) are exported
  by `agent/instrumentation.ts` directly over OTLP/HTTP.
- **Console logs** (the eve host's stdout/stderr) are shipped by a **Vector**
  sidecar that tails `./logs/host.log`. eve emits no OTel logs signal, so logs
  are collected at the process level rather than through instrumentation.

Setup:

1. In Axiom, create a dataset (e.g. `steve`) and an API token with ingest
   permission on it.
2. In `.env`, set:
   ```bash
   AXIOM_TOKEN="xaat-..."
   AXIOM_DATASET="steve"          # optional, defaults to "steve"
   AXIOM_DOMAIN="api.axiom.co"    # optional, or api.eu.axiom.co
   ```
   (Setting `AXIOM_TOKEN` takes precedence over the Jaeger `OTEL_*` path.)
3. Run the agent and the log shipper:
   ```bash
   make dev          # writes logs to ./logs/host.log
   make logs-up      # starts the Vector sidecar -> Axiom (in another terminal)
   ```
4. Drive a session (`make session`) and view traces + logs in the Axiom `steve`
   dataset. Logs are tagged `source: eve-host` to distinguish them from spans.

> Single dataset works because traces arrive via OTLP and logs via Vector's
> `axiom` sink; on a paid plan you can split them into `steve-traces` /
> `steve-logs`. For a fully containerized VPS deployment, switch `vector.toml`'s
> `file` source to a `docker_logs` source instead of tailing a file.

## The three proofs

Full runbook in **[PROOF.md](./PROOF.md)**. In short:

```bash
make proof-isolation   # sandbox prints container hostname; host-only secret unreachable
# durability proof: start a session, kill `make dev` mid-run, restart, confirm resume
make proof-novercel    # greps agent/ + .env for active Vercel coupling -> CLEAN
```

## Deploying to a VPS (e.g. DigitalOcean)

This PoC was verified locally; the same artifacts run on any Linux VPS with
Docker. There is **no Vercel deploy step**.

1. Provision a droplet (any standard plan — the Docker sandbox does **not**
   require KVM/nested virtualization, unlike microsandbox).
2. Install Docker + Docker Compose and Node 24 + pnpm.
3. Copy the repo, `pnpm install`, set `.env` (use a strong
   `ROUTE_AUTH_BASIC_PASSWORD`, a real `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`,
   and point
   `WORKFLOW_POSTGRES_URL` at your Postgres).
4. `make db-up && make db-migrate`.
5. Run the host under a process manager (systemd / pm2):
   `PORT=3000 pnpm exec eve dev --no-ui --host 0.0.0.0`.
   - The host process needs access to the Docker socket to drive sandbox
     containers (run as a user in the `docker` group).
6. Put TLS + a reverse proxy (Caddy/Nginx) in front; the agent serves
   `/eve/v1/*`. Auth is HTTP Basic via `ROUTE_AUTH_BASIC_*`.

> Note: the production `eve start` path is blocked by the queue-handler bug
> documented in `_internal/ISSUES.md`; until that is fixed upstream, run the
> long-lived host with `eve dev --no-ui`.

## Gotchas (discrepancies from the naive setup)

These were discovered while building; full detail in `_internal/ISSUES.md`.

1. **`@workflow/world-postgres@latest` (4.2.0) is incompatible with eve 0.13.3.**
   Its event schema lacks the `attr_set` event eve emits, so runs fail mid-replay
   with a `ZodError` (`No matching discriminator "eventType"`). Pin
   `@workflow/world-postgres@5.0.0-beta.19` to match eve's bundled
   `@workflow/core@5.0.0-beta.19`.

2. **`WORKFLOW_QUEUE_NAMESPACE` must be `eve`.** eve registers its workflow queue
   handler under prefix `__eve_wkf_workflow_`, but the Postgres world defaults to
   `__wkf_workflow_`. Without the namespace, every job returns
   `400 {"error":"Unhandled queue"}` and runs never advance. Setting
   `WORKFLOW_QUEUE_NAMESPACE=eve` aligns them.

3. **Run the host with `eve dev --no-ui`, not `eve start`.** In 0.13.3 only the
   dev host wires the configured world's direct queue handler.

4. **`docker()` backend network policy goes on the factory, not `onSession`.**
   A type-declaration bug makes `use({ networkPolicy })` in `onSession` a type
   error for the Docker backend; the factory option is correctly typed.

## Project layout

```
agent/
  agent.ts                 direct OpenAI/Anthropic model + experimental.workflow.world
  instructions.md          data-analyst persona (always computes via the sandbox)
  channels/eve.ts          HTTP channel, auth = [localDev(), httpBasic()]
  sandbox/sandbox.ts        Docker backend, deny-all egress
  tools/run_python.ts      executes Python in the sandbox -> {stdout,stderr,exitCode}
  instrumentation.ts       OTel traces -> Jaeger or Axiom (optional)
vector.toml                Vector: tail host logs -> Axiom (optional)
docker-compose.yml         postgres:16 (+ jaeger `observability` / vector `logs` profiles)
Makefile                   db-up, db-migrate, dev, observe, logs-up, proof-* targets
.env.example
PROOF.md                   the three proofs, step by step
_internal/                 PLAN.md, ISSUES.md, DX_NOTES.md (notes for the eve team)
```
