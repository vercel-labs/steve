# Developer experience notes — building a self-hosted eve agent

Context: built a fully self-hosted eve PoC (Postgres Workflow world + Docker
sandbox + direct OpenAI), originally on eve 0.13.3; re-verified on eve 0.15.0.
These are subjective DX observations — not bugs (those live in ISSUES.md), but
things that were surprising, rough, delightful, or well-designed. Intended as
product feedback for the eve team.

> **eve 0.15.0 update (2026-06-26).** Three of the sharp edges below are now
> FIXED: (1) `eve start` runs the custom world, (2) HEAD `/eve/v1/health` returns
> 200, (3) the `eve/react` Turbopack `node:module` client build works with no
> stub. Items marked `[FIXED 0.15.0]` inline. The `eve dev`-as-production-host
> awkwardness is now largely moot (`eve start` works; we keep `eve dev` only for
> its sandbox-container reaping). Remaining gaps: no OTel logs signal,
> `docker()` `onSession` typing, sandbox reaping tied to `eve dev`.

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

- **[!][FIXED 0.15.0] `eve start` silently can't run a custom world.** The docs
  present `eve build && eve start` as THE self-host path, but only `eve dev`
  registered the configured world's queue handler in 0.13.3. **Fixed in 0.15.0:**
  `eve start` now registers the direct queue handler for a configured custom
  world (outside Vercel build env) and runs turns end-to-end (verified). The
  "production" path now works with the documented self-host feature.

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

## VPS deployment (DigitalOcean + Ansible + Caddy) — follow-up

Context: took the local PoC and stood it up on a real DigitalOcean droplet via
an Ansible pipeline (provision → harden → deploy), behind Caddy with TLS. Most
of the friction here was generic infra tooling (DO API, SSH keys, pnpm) and is
*not* eve's fault — but a few observations are eve-specific and worth the team's
attention. Flagging clearly which is which.

### eve-specific (actionable for the team)

- **[!][largely resolved 0.15.0] `eve dev --no-ui` as the production host is
  operationally awkward.** Since `eve start` now runs the custom world (0.15.0),
  the production unit can use `eve start` instead of `eve dev` — removing the
  "why is prod running the dev server?" smell. The one remaining reason to keep
  `eve dev` is sandbox-container reaping (only `eve dev` reaps). Original 0.13.x
  framing preserved below.
  Running the long-lived host under systemd means the unit literally invokes
  `eve dev`. This is a recurring papercut beyond the docs issue noted above:
  - It *looks* wrong in a `systemd` unit / runbook ("why is production running
    the dev server?") and invites a future maintainer to "fix" it to `eve start`
    and break the deployment.
  - `eve dev` does more than serve (TUI affordances, watch-y behavior) that a
    daemon doesn't want. A dedicated `eve serve`/`eve host` command — or making
    `eve start` register the custom world's queue handler — would make the
    production story coherent. This is the same root cause as the `eve start`
    "Unhandled queue" bug, but it bites again the moment you write a service
    unit. Reiterating because it's now a deployment-shaped problem, not just a
    local-dev one.

- **[~] The host needs the Docker socket, which forces a co-location decision.**
  Because the Docker sandbox backend drives `docker run` against the host
  daemon, the eve host process must have access to `/var/run/docker.sock` (we
  ran it natively under systemd as a user in the `docker` group). That's fine,
  but it's an implicit deployment constraint that isn't called out: you can't
  cleanly containerize the eve host without docker-out-of-docker / socket
  mounting, which has real security implications (socket access ≈ root). A short
  "deploying the Docker sandbox in production" note — covering socket access,
  the `docker` group, and why the host can't be a vanilla unprivileged container
  — would save people from discovering this architecturally late.

- **[+] The build/runtime artifact is genuinely portable.** Nothing about the
  deploy needed eve's cooperation beyond "run this command with these env vars."
  `git clone` → `pnpm install` → systemd `eve dev --no-ui --host 127.0.0.1`
  behind any reverse proxy. No platform hooks, no `.vercel/output`, no special
  adapter. The no-Vercel thesis holds up under a real deploy, not just locally.

- **[+] `/eve/v1/health` is exactly what a reverse proxy / orchestrator wants.**
  Unauthenticated, returns `{"ok":true,"status":"ready",...}`, and made Caddy +
  the Ansible post-deploy readiness check trivial. Good that it's distinct from
  the authed routes.

- **[!][FIXED 0.15.0] eve routes 404 on HTTP `HEAD` — including `/eve/v1/health`.**
  As of 0.15.0 the health route registers both `GET` and `HEAD`; `curl -I
  http://127.0.0.1:3000/eve/v1/health` now returns `200`. HEAD-based health/uptime
  probes work. Original 0.13.x finding preserved below.

  Every
  route we tested returns 200 to `GET` but **404 to `HEAD`** (`/eve/v1/health`,
  `/eve/v1/info`, and `/` all behave this way; verified directly against the eve
  host on `127.0.0.1:3000`, bypassing the proxy, so it's the framework, not
  Caddy). This bit us concretely: `curl -I https://.../eve/v1/health` (which
  sends HEAD) reports `HTTP/2 404`, even though `curl` (GET) returns 200 — and
  confusingly the 404 still carries a JSON-ish body, so the payload "looks fine"
  while the status is wrong. This matters because **HEAD is the canonical method
  for health/uptime checks** — many load balancers, k8s probes, and monitoring
  services (UptimeRobot et al.) default to HEAD. A HEAD against the health
  endpoint that 404s will mark a perfectly healthy deployment as down. The eve
  HTTP layer (Nitro/h3 router) should handle HEAD on at least `/eve/v1/health`
  (ideally auto-deriving HEAD from GET handlers, which is standard), or the docs
  should explicitly say "health checks must use GET." Low effort, high blast
  radius for anyone wiring real infra in front of eve.

- **[~] Reverse proxy: proxy the WHOLE origin, not just `/eve/v1/*`.** We bind
  eve to `127.0.0.1:3000` and make Caddy the only public entry, forwarding all
  paths. Beyond the public API, eve serves an internal durable-dispatch route at
  `/.well-known/workflow/v1/flow` (confirmed live — it 400s an empty POST, i.e.
  it's a real handler, not a 404). In our setup the queue callback is in-process
  to localhost, so it doesn't strictly traverse the proxy — but anyone who
  restricts the proxy to `/eve/` (a natural instinct) risks breaking dispatch or
  webhooks. A one-line "proxy the entire origin" note in the deployment docs,
  plus a list of the non-`/eve/` paths eve exposes (`/.well-known/...`, channel
  webhooks), would prevent a subtle, runs-don't-advance class of bug.

### not eve's fault, but useful field notes (toolchain, for completeness)

- **[~] pnpm 11's supply-chain policy fights pinned beta versions.** This PoC
  pins exact, sometimes <24h-old beta versions on purpose (it has to, per the
  world/core matching constraint above). pnpm 11 then refuses the lockfile with
  `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` and also blocks dependency build
  scripts (`ERR_PNPM_IGNORED_BUILDS`), and the release-age check re-runs on the
  implicit deps-status check that `pnpm exec` performs — so it bites `install`,
  the migration CLI, *and* the host process. We had to set
  `PNPM_CONFIG_MINIMUM_RELEASE_AGE=0` + `PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true`
  across install, migrate, and the systemd unit. Indirectly an eve concern: the
  "you must pin a fresh beta world version" requirement collides with default
  supply-chain tooling. Another nudge toward publishing a stable, appropriately
  aged `@workflow/world-postgres` line that matches eve's core.

- **[info] DigitalOcean's Ansible module didn't reliably attach the SSH key**
  (left root with no authorized key); we create the droplet via the raw DO API
  instead. Pure infra, no eve relevance — noted only so the deploy code's choice
  isn't mistaken for an eve workaround.

---

## Frontend UI + remote auth — follow-up

Context: after deploying the agent to a self-hosted origin (`https://eve.phil.bingo`,
behind Caddy, `httpBasic()` auth), we tried to actually *use* it two ways — the
`eve dev` REPL pointed at the remote URL, and a scaffolded Next.js UI
(`withEve` + `useEveAgent`). Both ran into auth/bundling friction worth flagging.

### Remote REPL can't authenticate to a self-hosted, auth-protected host

- **[!] `eve dev <remote-url>` only supports anonymous or Vercel-OIDC auth.**
  Running `eve dev https://eve.phil.bingo` connects, then every turn fails with
  `Authorization is required for this route.` The REPL has no flag to pass HTTP
  Basic (or bearer) credentials. Reading the compiled client confirms the
  asymmetry:
  - The underlying `Client` (`eve/client`) fully supports
    `auth: { basic | bearer | vercelOidc }` and emits the right `Authorization`
    header.
  - But the dev-client path hardcodes anonymous options:
    `resolveDevelopmentClientOptions(url) => ({ host: url })`, and the only
    credentialed remote path is Vercel OIDC
    (`resolveRemoteDevelopmentClientOptions` → `auth: { vercelOidc }`).
    `client-options.d.ts` even documents the intent: *"remote URLs receive no
    ambient credentials."*
  - It also ignores URL userinfo (`https://user:pass@host` is not honored).

  Net: a **self-hosted, non-Vercel, auth-protected** deployment — exactly the
  shape this whole PoC is about — is the one configuration the remote REPL can't
  talk to. For a framework whose pitch includes "not coupled to Vercel," the
  remote dev tooling assuming Vercel OIDC for auth is a notable gap.

  Suggestion: add `eve dev --header`, `--basic user:pass`, or `--bearer <token>`
  (or honor `EVE_DEV_AUTH_*` / URL userinfo) so the TUI can drive a protected
  self-hosted host. The `Client` already does the work; only the dev wrapper
  needs to surface it.

### `eve/react` breaks the Next.js client build under Turbopack

- **[!][FIXED 0.15.0] `next build` fails: `node:module` pulled into the client
  chunk via `eve/react`.** Re-tested on eve 0.15.0 + Next 16.2.9 (Turbopack):
  `next build` now **compiles successfully with no `node:module` alias/stub**.
  The `turbopack.resolveAlias` workaround and `lib/node-module-stub.js` were
  removed from this repo. Original 0.13.x finding preserved below.

  A `"use client"` component importing `useEveAgent` from
  `eve/react` makes Turbopack fail with
  `the chunking context (unknown) does not support external modules
  (request: node:module)` during `EcmascriptModuleContent::new_merged`. We
  statically walked the entire `eve/react` client import graph (21 files) — none
  of it imports `node:module`; the reference is introduced by Turbopack's
  module-*merging*, not by eve's client source. Next 16 forces Turbopack for
  `next build` (no webpack fallback), so it can't simply be bundler-switched.
  This is the documented, supported integration (`guides/frontend/nextjs.mdx`:
  `withEve` + `useEveAgent`), so it breaking on current Next + Turbopack is a
  real regression for anyone scaffolding a UI today.

  Workaround (config-only, no component changes): alias the builtin to a
  browser stub in `next.config.ts`:
  ```ts
  turbopack: { resolveAlias: { "node:module": "./lib/node-module-stub.js" } }
  ```
  This unblocked the build cleanly. But it's a guess-and-stub hack; eve should
  ensure `eve/react` (and whatever the merge step drags in) is client-safe, or
  ship a dedicated client-only entry that never references Node builtins.

### Auth model mismatch between "self-host" and "frontend" guidance

- **[~] The supported UI auth story assumes Vercel or cookies; self-hosted
  Basic auth has no first-class path.** `guides/frontend/nextjs.mdx` says
  `withEve` makes eve routes same-origin so cookie auth "just works," and points
  non-cookie schemes at `useEveAgent({ headers })`. But our deployment uses
  `httpBasic()` on a *separate* origin proxied via `EVE_NEXT_PRODUCTION_ORIGIN`,
  and eve's Next proxy rewrite does not inject upstream credentials. So the
  realistic options collapse to: (a) make the agent **public** (`none()`), (b)
  re-architect to put the UI on the same origin as the agent so a cookie/session
  applies, or (c) hand-roll an auth-injecting Next route in front of the proxy.
  For a PoC we chose (a) — switched the channel to `none()` and redeployed —
  which is fine for a demo but means "usable UI" and "protected agent" are
  effectively mutually exclusive without extra plumbing.

  Suggestion: document (and ideally support) a self-hosted, separate-origin,
  Basic/bearer-protected topology end to end — e.g. an `EVE_NEXT_PRODUCTION_*`
  way to attach an upstream Authorization header on the rewrite, mirroring what
  `Client` already supports. Today the easy paths are Vercel OIDC, same-origin
  cookies, or "make it public."

- **[+] `none()` is a clean escape hatch.** Switching `agent/channels/eve.ts` to
  `eveChannel({ auth: [none()] })` and redeploying made the routes public in one
  line — exactly what a demo wants, and clearly named so it can't be set by
  accident. Good that it exists and is explicit.

## Suggestions (high-leverage, in priority order)

> **Status after eve 0.15.0:** #3 (eve start runs the custom world), #6 (prod
> host story), #8 (HEAD on /eve/v1/health), and #10 (eve/react Turbopack build)
> are **FIXED**. #1/#2 (world version + queue namespace) still apply but are now
> the main remaining self-host papercuts. #4/#5/#7/#9/#11 not re-checked this pass.


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
6. **Ship a production host command (`eve serve`/`eve host`)** — or fix
   `eve start` for custom worlds — so the systemd/daemon story doesn't depend on
   `eve dev`. (Surfaced again, harder, at deploy time.)
7. **Add a "deploying the Docker sandbox" doc section** covering the Docker
   socket requirement, the `docker` group, why the host can't be a vanilla
   unprivileged container, and the "proxy the whole origin (incl.
   `/.well-known/workflow/v1/flow`), not just `/eve/v1/*`" reverse-proxy gotcha.
8. **Handle HTTP `HEAD` on `/eve/v1/health`** (ideally derive HEAD from GET
   across the router). Today HEAD 404s, so HEAD-based health/uptime probes
   (LBs, k8s, monitoring services) mark a healthy deployment as down.
9. **Let the remote dev REPL authenticate with non-Vercel schemes**
   (`eve dev --basic/--bearer/--header`, or honor URL userinfo / `EVE_DEV_AUTH_*`).
   Today `eve dev <remote-url>` can only go anonymous or Vercel-OIDC, so it
   can't drive a self-hosted, auth-protected host — the core self-host shape.
10. **Fix `eve/react` for the Next 16 + Turbopack client build** (`node:module`
    gets merged into the client chunk) and/or ship a guaranteed client-safe
    entry. The documented `withEve` + `useEveAgent` path currently fails
    `next build` out of the box.
11. **Document a self-hosted, separate-origin, Basic/bearer-protected UI
    topology** — e.g. attach an upstream Authorization header on the
    `EVE_NEXT_PRODUCTION_ORIGIN` rewrite. Today protected-agent + usable-UI
    requires hand-rolled plumbing or going public.

## Bottom line

The core model — durable turns, transparent steps, a clean sandbox boundary,
swappable world/sandbox/model — is genuinely well designed, and once configured
correctly it all worked exactly as advertised, including the crash/resume
headline. The friction was almost entirely in the *self-host wiring* of the
beta Workflow world: version matching, queue namespace, and the dev-vs-start
host path. None are conceptual problems; all are surfaceable with a couple of
startup checks and a few doc lines. For a beta, the foundation is strong.

Taking it to a real VPS reinforced this: the artifact is genuinely portable and
deployed behind Caddy/TLS with no eve-specific cooperation, and `/eve/v1/health`
made orchestration easy. The two things that resurfaced as *deployment*-shaped
problems (rather than local-dev quirks) are the `eve dev`-as-production-host
awkwardness and the undocumented Docker-socket / proxy-the-whole-origin
requirements of the Docker sandbox. Both are doc-and-one-command fixes, not
design flaws.
