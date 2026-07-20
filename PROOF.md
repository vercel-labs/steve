# Reproducible self-host verification

This document defines evidence that can be regenerated from the current source.
It intentionally contains no historical session IDs, screenshots, passwords, or
output captured from older Eve releases.

## Scope of the claim

The repository demonstrates that these components can run without
Vercel-managed infrastructure:

| Concern | Implementation |
| --- | --- |
| Eve host | `eve build` and `eve start` on Node.js |
| Durable execution | `@workflow/world-postgres` and PostgreSQL |
| Sandbox | Eve's Docker backend with deny-all egress |
| Web application | Next.js behind Caddy |
| Tracing | OpenTelemetry over OTLP/HTTP |

OpenAI or Anthropic still performs model inference. This verification does not
claim that the complete AI supply chain is self-hosted.

## 1. Dependency and build integrity

Start from a clean checkout:

```bash
corepack enable
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm exec eve info --json
pnpm typecheck
pnpm build
pnpm audit --prod --audit-level high
```

Expected evidence:

- Eve reports version `0.25.2`, status `ready`, and zero diagnostics.
- `pnpm why` reports one `ai@7` line and one Workflow 5 beta line.
- Both the Nitro Eve output and Next.js production output build.
- The lockfile contains no `link:` dependency or workstation path.
- The production audit has no high or critical advisory.

Inspect the coupled packages explicitly:

```bash
pnpm why eve ai @ai-sdk/provider @workflow/core @workflow/world @workflow/world-postgres
```

## 2. Production route protection

Build and start Eve with `NODE_ENV=production`, then shape the request like a
public host even when testing through loopback:

```bash
curl -i \
  -H 'Host: agent.example.test' \
  http://127.0.0.1:3000/eve/v1/info
```

Expected: `401` with no model work started.

Repeat with the configured Basic credentials:

```bash
set -a && . ./.env && set +a
curl --fail --user "$ROUTE_AUTH_BASIC_USER:$ROUTE_AUTH_BASIC_PASSWORD" \
  -H 'Host: agent.example.test' \
  http://127.0.0.1:3000/eve/v1/info
```

Expected: validated agent metadata. The health route remains public for load
balancers. Run the production URL check through TLS with:

```bash
set -a && . ./.env && set +a
SELF_HOST_URL="https://agent.example.com" \
SELF_HOST_EXPECT_AUTH=1 \
pnpm smoke:self-host
```

## 3. Sandbox isolation

Start PostgreSQL and the headless Eve host:

```bash
pnpm db:up
pnpm db:migrate
make dev
```

In another terminal:

```bash
make proof-isolation
```

Stream the returned session and inspect the `run_python` result. It must show:

- a container hostname rather than the host machine's name;
- `<unset in sandbox>` for `HOST_ONLY_SECRET`;
- a completed `run_python` action;
- no successful network access from the container.

This proves the boundary for model-authored Python. It does not imply that Eve
or authored TypeScript tools run outside the trusted application process.

## 4. Durable follow-ups

The reusable smoke client sends two turns through one `ClientSession`:

```bash
pnpm smoke:self-host
```

Expected evidence:

- the first turn calls `run_python` and returns 2010 and Christopher Nolan;
- the second turn calls `run_python` and returns 8.8;
- both results carry the same Eve session ID;
- neither turn reports `failed`;
- a 60-second Python request accepts cancellation and settles in under 30
  seconds because the tool has a 15-second execution ceiling;
- a 300,000-byte Python response is truncated at the combined 256 KiB output cap.

The Eve eval suite separately covers lookup, follow-up continuity, host-secret
isolation, and blocked network egress:

```bash
pnpm test:eval
```

These calls use the configured external model provider and may incur cost.

## 5. Process crash recovery

Run this against the systemd deployment, not `eve dev`:

1. Start a request that produces more than one tool/model step.
2. Record the Eve session ID and wait for at least one completed action.
3. Run `make -C deploy demo-kill`.
4. Wait for `steve.service` to restart and the client stream to reconnect.
5. Run `make -C deploy demo-events SESSION=<session-id>`.

The SQL helper joins events to runs where the run ID or `$eve.root` attribute
matches the selected session. Evidence from unrelated historical runs is
excluded. Use the saved Eve stream or trace alongside this summary when checking
individual action call IDs; aggregate Workflow event counts alone do not prove
that a tool side effect ran exactly once.

Pass criteria:

- systemd starts a new Eve process after the forced kill;
- the selected durable session continues rather than creating a replacement;
- previously completed action call IDs are not emitted as new calls after restart;
- the turn eventually waits, completes, or cancels without corrupting replay.

For an upgrade rehearsal, restore a production backup into a disposable
PostgreSQL instance and repeat this procedure before migrating the live host.

## 6. Routing and telemetry

Validate the rendered Caddy configuration in both domain and IP-only modes.
Both modes must route these prefixes to Eve:

```text
/eve/*
/.well-known/workflow/*
```

With Jaeger enabled, complete a turn and query the Jaeger UI for service
`steve`. The trace should include an `ai.eve.turn` parent with AI SDK model and
tool spans. Prompt and output bodies should be absent unless their explicit
OTel opt-in variables are true.

## What this does not prove

- high availability or multi-region durability;
- off-host backup retention or tested disaster recovery;
- tenant isolation beyond one shared Basic-auth boundary;
- CPU and memory quotas for Docker sandboxes;
- provider-side privacy, availability, or retention guarantees;
- fitness of Eve preview APIs for regulated production data.
