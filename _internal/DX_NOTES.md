# Developer experience notes — building a self-hosted eve agent

Context: built a fully self-hosted eve PoC (Postgres Workflow world + Docker
sandbox + direct OpenAI) on eve 0.13.3. These are subjective DX observations —
not bugs (those live in ISSUES.md), but things that were surprising, rough,
delightful, or well-designed. Intended as product feedback for the eve team.

Legend: [+] delight / good design  ·  [~] friction / surprise  ·  [!] sharp edge

---

## What was genuinely great

- **[+] Scaffold-to-config flow is clean.** `defineAgent`, `defineTool`,
  `defineSandbox`, `defineInstrumentation`, `eveChannel` are a consistent,
  discoverable family. One default export per file, filename = identity (e.g.
  `tools/run_python.ts` -> tool name `run_python`). Easy to reason about.

- **[+] The sandbox API is excellent.** `ctx.getSandbox()` then
  `writeTextFile` / `run` / `resolvePath` is intuitive and read like the docs.
  Writing the `run_python` tool took one try and worked first time. The
  app-runtime-vs-sandbox trust boundary is clearly drawn and easy to honor.

- **[+] Durability is truly transparent.** We wrote zero workflow code. Tools
  look synchronous; the multi-step turn checkpoints automatically; killing the
  process mid-run and having it resume "just worked" once the world was wired
  correctly. This is the headline feature and it delivers.

- **[+] Bundled docs are high quality and honest.** `node_modules/eve/docs/**`
  is thorough and unusually candid about the Vercel/non-Vercel split
  (deployment.md, execution-model-and-durability.md). The "Where adjacent
  settings live" tables in agent-config.md are a great touch.

- **[+] `.d.ts` as ground truth worked.** The plan's instruction to trust
  installed types over prose held up. Reading `docker-sandbox.d.ts`,
  `auth.d.ts`, and `configure-world.js` resolved every ambiguity definitively.

- **[+] Discovery diagnostics.** `eve info` + `.eve/diagnostics.json` make it
  obvious what the framework picked up. 0 errors / 0 warnings gave real
  confidence before running.

- **[+] HTTP contract is dead simple.** `POST /eve/v1/session` + NDJSON stream
  is trivial to drive from curl/scripts. Made automated verification easy.

- **[+] Graceful model-error handling.** When the first key hit
  `insufficient_quota`, eve parked the session for retry instead of crashing —
  durable error handling demonstrated for free.

- **[+] `workflow inspect runs` / `workflow web`.** A legitimately good
  dashboard replacement, and it points at Postgres with one flag.

---

## What was surprising or rough

- **[!] The single biggest trap: nothing tells you the world package version
  must match eve's bundled `@workflow/core`.** `pnpm add @workflow/world-postgres`
  installs `@latest` (4.x), which is a different MAJOR than eve's bundled 5.x
  beta. The failure mode is a deep ZodError mid-run, not an install/startup
  error. Easily an hour of spelunking. (See ISSUES.md.) Self-host docs reference
  the package by name with no version guidance, and there is no peer/compat
  check. This is the #1 thing to fix for self-host DX.

- **[!] Queue namespace coupling is invisible.** That a self-selected world
  requires `WORKFLOW_QUEUE_NAMESPACE=eve` to match eve's registered handler
  prefix is undocumented and unguessable. The error ("Unhandled queue", 400)
  doesn't hint at namespaces. Either eve should set this for the configured
  world automatically, or document it loudly.

- **[!] `eve start` silently can't run a custom world.** The docs present
  `eve build && eve start` as THE self-host path, but only `eve dev` registers
  the configured world's queue handler in 0.13.3. Discovering this required
  reading compiled source. The "production" path appears to be the one that
  doesn't work with the documented self-host feature.

- **[~] "long-running host" is ambiguous.** The plan/docs talk about a
  long-lived host that polls the queue, but it's unclear that the *intended*
  command is `eve dev --no-ui` rather than `eve start`. `eve dev` reads as
  "development only," so using it as the production host feels wrong even though
  it's currently required.

- **[~] `experimental.workflow.world` ergonomics.** It's a string package name,
  resolved by convention (default export OR `createWorld`). Good that
  `world.start()` is auto-called — but that fact is only confirmable by reading
  `configure-world.js`. The docs hedge ("verify whether eve invokes this for
  you"), which sends you source-diving for a yes/no answer.

- **[~] `httpBasic()` doesn't read env.** deployment.md mentions
  `ROUTE_AUTH_BASIC_PASSWORD` as a route-auth secret, implying convention-based
  env wiring, but `httpBasic({ username, password })` takes explicit args. Minor,
  but the doc nudges you toward an env var the helper ignores.

- **[~] Docker backend network policy typing.** `use({ networkPolicy })` in
  `onSession` is a type error for `docker()` (works for `vercel()`/
  `microsandbox()`), because `docker()` returns a bare `SandboxBackend`. The
  workaround (policy on the factory) is fine, but the inconsistency is
  surprising given the docs show the `onSession` form.

- **[~] Migration is not resilient to a half-applied prior schema.** Switching
  world versions (4.x -> 5.x) left a partial schema, and `workflow-postgres-setup`
  then failed on an enum (`invalid input value for enum status: "paused"`)
  rather than reconciling or giving a clear "drop and re-migrate" hint. Had to
  recreate the database. A `--force`/reset flag or clearer guidance would help.

- **[~] Stale dev server squatting the port.** After a kill, a previous
  `eve dev` instance held the port and the new one served "Dev server is
  unavailable" with a lock-style message. Recoverable, but confusing mid-iteration.

- **[~] CBOR/zstd event payloads aren't inspectable by hand.** Great for
  efficiency, but `psql` on `workflow_events.payload` shows nothing useful;
  you must go through `workflow inspect` or the stream API to read run content.
  Expected, just worth knowing.

- **[~] AI SDK / `ai` version churn.** A persistent pnpm peer warning
  (`unmet peer ai@7.0.0-beta.178: found 7.0.0-canary.171`) is noise that makes
  you second-guess whether the toolchain is consistent. It was harmless here.

---

## Observability backends (Jaeger / Axiom) — follow-up

- **[+] Swapping the trace backend was config-only.** Pointing eve's traces from
  Jaeger to Axiom meant changing the OTLP exporter `url` and adding two headers
  in `instrumentation.ts` — no new dependencies, no eve changes. The
  vendor-neutral `defineInstrumentation` + standard OTel exporter design pays off
  here. Strong evidence for the portability thesis.

- **[!] eve emits no OpenTelemetry logs signal — only traces + stderr.** This
  was the one real gap when wiring up external log visibility. eve's structured
  observability is traces (`ai.eve.turn` spans) and Postgres `$eve.*` run tags;
  its "logs" are plain console output (the `--logs` TUI flag). There is no
  `LoggerProvider` / `sdk-logs` integration, so an OTel-logs exporter would ship
  nothing. To get the rich console stream (startup, queue activity, model errors
  like `insufficient_quota`, `Re-enqueued N active run(s)`) into a backend, we
  had to collect at the process level — a Vector sidecar tailing the host log
  file. That works well, but it's external plumbing the framework doesn't help
  with.

  Suggestion for the team: consider emitting key runtime events (turn/step
  lifecycle, tool calls, world/queue events, model errors) as OTel LogRecords
  (or at least structured JSON to stdout) so a single OTel pipeline can carry
  both traces and logs. Today, traces are first-class and logs are DIY.

- **[~] Jaeger is traces-only — easy to forget.** Worth a doc line that the
  bundled Jaeger profile handles traces only; logs need a different backend
  (Axiom, Loki, etc.). Not eve's fault, but it surfaces because eve points you at
  Jaeger for "observability."

---

## Suggestions (high-leverage, in priority order)

1. **Compat check the configured world's `@workflow/world` against eve's
   bundled core at startup**, and fail with an actionable message
   ("world-postgres 4.2.0 is incompatible with eve 0.13.3; install 5.0.0-beta.x").
   Would have eliminated the single worst part of this build.
2. **Auto-apply (or document prominently) `WORKFLOW_QUEUE_NAMESPACE` for the
   configured world**, or include the namespace in the "Unhandled queue" error.
3. **Make `eve start` register the custom world's queue handler**, or clearly
   document `eve dev --no-ui` as the supported self-host host command.
4. **State definitively in the self-host docs that eve calls `world.start()`**
   so nobody adds redundant wiring.
5. **A `workflow-postgres-setup --reset`** (or clearer recovery guidance) for
   version migrations.

## Bottom line

The core model — durable turns, transparent steps, a clean sandbox boundary,
swappable world/sandbox/model — is genuinely well designed, and once configured
correctly it all worked exactly as advertised, including the crash/resume
headline. The friction was almost entirely in the *self-host wiring* of the
beta Workflow world: version matching, queue namespace, and the dev-vs-start
host path. None are conceptual problems; all are surfaceable with a couple of
startup checks and a few doc lines. For a beta, the foundation is strong.
