# Steve: self-hosted Eve runtime reference

Steve is a movie-data agent built with [Eve](https://eve.dev) and deployed on a
regular Node.js host. It demonstrates how to run Eve without Vercel-managed
runtime infrastructure:

- PostgreSQL stores durable Workflow state.
- Docker isolates model-authored Python and blocks sandbox network egress.
- OpenAI or Anthropic is called directly through its AI SDK provider package.
- A Next.js chat UI talks to Eve through the stable `/eve/v1` protocol.
- OpenTelemetry exports traces to a collector you operate, such as Jaeger.

The Eve runtime and control plane are self-hosted. Model inference is not: user
messages and model context are sent directly to the configured OpenAI or
Anthropic API.

> Eve is in public preview. `@workflow/world-postgres` describes itself as a
> reference implementation. This repository is a transparent single-host
> deployment baseline, not a high-availability production architecture.

## Architecture

```text
browser
  -> Caddy :443
     -> /eve/* and /.well-known/workflow/* -> Eve :3000
     -> all other paths                    -> Next.js :3001

Eve
  -> OpenAI or Anthropic API
  -> PostgreSQL Workflow world :5544 (loopback only)
  -> per-session Docker sandbox (deny-all egress)
  -> OTLP/HTTP collector (optional)
```

Both `/eve/` and `/.well-known/workflow/` must reach the Eve service. Omitting
the Workflow callback prefix allows sessions to start but leaves turns stalled.

## Compatibility set

The lockfile pins the packages that must move together:

| Package | Version |
| --- | --- |
| `eve` | `0.25.2` |
| `ai` | `7.0.31` |
| `@ai-sdk/openai` / `@ai-sdk/anthropic` | `4.0.16` |
| `workflow` | `5.0.0-beta.35` |
| `@workflow/world-postgres` | `5.0.0-beta.27` |

Do not replace the Postgres world with its npm `latest` tag. Eve currently uses
the Workflow 5 beta protocol, while that package's `latest` tag is Workflow 4.

## Prerequisites

- Node.js 24
- Corepack with pnpm 10.33.2
- Docker Engine or Docker Desktop
- An OpenAI or Anthropic API key with quota

## Local setup

```bash
corepack enable
pnpm install --frozen-lockfile --strict-peer-dependencies
cp .env.example .env
```

Edit `.env` before continuing:

1. Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.
2. Replace both example passwords.
3. Keep `POSTGRES_PASSWORD` and the password inside `WORKFLOW_POSTGRES_URL` identical.

Start and migrate PostgreSQL:

```bash
pnpm db:up
pnpm db:migrate
```

Start the web app:

```bash
pnpm dev
```

`withEve()` starts the Eve development host beside Next.js. Open
`http://localhost:3000`. Loopback requests use `localDev()` and do not require
Basic auth.

For a headless Eve host instead:

```bash
make dev
```

Then run `pnpm smoke:self-host` in a second terminal.

## Production auth

`agent/channels/eve.ts` uses environment-specific policies:

```text
development: localDev() -> httpBasic(...) -> reject
production:  httpBasic(...) -> reject
```

Production never enables `localDev()`, so spoofing a loopback `Host` header
cannot bypass authentication. Requests fail with `401` unless both
`ROUTE_AUTH_BASIC_USER` and `ROUTE_AUTH_BASIC_PASSWORD` are configured. If
either variable is missing, Eve's production placeholder keeps the routes
closed.

The production UI asks the visitor for those credentials and validates them
against `/eve/v1/info`. The password remains in browser memory and is not
embedded in the JavaScript bundle or persisted to local storage. Use HTTPS
before entering it.

## Agent behavior

Each durable session receives `/workspace/movies.csv`, a small bundled dataset
of approximate reference figures for well-known films. `run_python` writes a
script into the session's Docker sandbox and returns stdout, stderr, and the
exit code.

The sandbox configuration:

- pins a multi-architecture Eve image digest that includes Python 3;
- uses `deny-all` network policy;
- receives no host environment variables;
- persists `/workspace` across turns in the same durable session;
- limits each authored Python program to 15 seconds;
- caps combined stdout and stderr at 256 KiB;
- stops compute on Eve shutdown and reattaches the session after restart.

Built-in Bash, app-runtime web fetch, provider web search, and recursive agent
tools are disabled. The agent also has explicit per-session token budgets.

## Observability

Set a standard OTLP endpoint to export Eve and AI SDK trace spans:

```bash
docker compose --profile observability up -d jaeger
# .env
OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318"
```

Open `http://127.0.0.1:16686` locally. The same exporter works with any
OTLP/HTTP-compatible collector; configure `OTEL_EXPORTER_OTLP_HEADERS` when it
requires authentication.

Full model inputs and outputs are disabled by default. Set
`OTEL_RECORD_INPUTS=true` or `OTEL_RECORD_OUTPUTS=true` only after reviewing the
collector, access policy, and retention path.

Workflow state can also be inspected directly:

```bash
pnpm observe
pnpm observe:web
```

## Verification

Static checks do not require a model key:

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm exec eve info --json
pnpm typecheck
pnpm build
docker compose config --quiet
pnpm audit --prod --audit-level high
make -C deploy check
```

Live checks use the configured model provider and may incur provider cost:

```bash
set -a && . ./.env && set +a
pnpm smoke:self-host
pnpm test:eval
```

The smoke client verifies health, agent inspection, sandboxed Python, exact
movie facts, streaming, a follow-up on the same session, and bounded server-side
cancellation and output. Set
`SELF_HOST_URL`, and set `SELF_HOST_EXPECT_AUTH=1` when targeting a production
origin.

See [PROOF.md](./PROOF.md) for isolation and crash-recovery procedures.

## Deployment

The `deploy/` directory provisions a DigitalOcean droplet and installs the two
Node services, PostgreSQL, optional Beszel monitoring, optional Jaeger tracing,
and Caddy. Start with [deploy/README.md](./deploy/README.md).

Before each Workflow schema migration, Ansible writes a custom-format PostgreSQL
backup under `/opt/steve-backups/`. Production-shaped unauthenticated and
authenticated requests are checked before a deployment is reported healthy.

The one-time upgrade from Eve versions before `0.20` is guarded specially.
Active runs from that runtime line did not replay safely in verification against
the current Workflow runtime. Ansible refuses the cutover until the operator
inspects and explicitly cancels those old active runs; later `0.25` restarts
continue to resume compatible parked sessions normally.

## Limitations

- One host is a single point of failure.
- The embedded Postgres world's workers are not separated from the Eve process.
- Database backup retention and off-host replication are operator responsibilities.
- Docker sandbox CPU and memory quotas are not exposed by Eve's built-in Docker backend.
- Basic auth is appropriate for a controlled reference deployment, not multi-tenant identity.
- Model provider availability, policy, retention, and cost remain external dependencies.

## Project layout

```text
agent/                    Eve agent, channel, tools, sandbox, instrumentation
app/                      Next.js chat UI
evals/                    live Eve regression evals
scripts/                  reusable self-host smoke client
deploy/                   Ansible single-host deployment
docker-compose.yml        PostgreSQL and optional local Jaeger
Makefile                  local operations and verification helpers
DEMO.md                   customer-safe demo script
PROOF.md                  reproducible verification procedures
```
