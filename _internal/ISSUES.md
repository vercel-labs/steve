# Issues & notes for the eve team

Running log of friction, surprises, bugs, and doc gaps found while building a
fully self-hosted eve PoC (eve 0.13.3, Postgres world + Docker sandbox, OpenAI
direct). Severity: [info] / [minor] / [major].

## Doc / DX notes

- **[minor] `httpBasic()` env behavior undocumented.** `deployment.md` references
  `ROUTE_AUTH_BASIC_PASSWORD` as a route-auth secret, implying env-driven config,
  but `httpBasic()` actually takes an explicit `{ username, password }` object
  and does NOT read env itself. The author must wire `process.env` manually. The
  env var name is convention only. Mildly confusing; a doc example wiring env →
  httpBasic would help.

- **[info] `world.start()` is auto-called — good, but only discoverable by
  reading compiled source.** The plan/docs hedge ("verify whether eve invokes
  start() for you... the documented pattern is to import getWorld..."). In
  eve 0.13.3, `installConfiguredWorkflowWorld` calls `await world.start?.()`
  automatically. Worth stating definitively in the self-host docs so authors
  don't add redundant manual `getWorld().start()` wiring.

- **[info] Workflow CLI package/command naming.** The plan referenced
  `npx workflow inspect runs --backend @workflow/world-postgres`. The published
  CLI is `workflow`/`wf` (pkg `workflow` → `@workflow/cli`). Commands `inspect`
  and `web` exist; need to confirm exact flag spelling (`--world` vs `--backend`)
  at runtime — both tokens appear in the compiled command source.
  (TODO: confirm during verification step.)

## Bugs

- **[major] `docker()` backend factory loses its session-use option types.**
  In eve 0.13.3, `vercel()` and `microsandbox()` are declared as
  `SandboxBackend<BootstrapUseOptions, SessionUseOptions>`, but `docker()` is
  declared as a bare `SandboxBackend` (no type parameters):

  ```
  // node_modules/eve/dist/src/public/sandbox/backends/docker.d.ts:14
  export declare function docker(opts?: DockerSandboxCreateOptions): SandboxBackend;
  ```

  Because the session-options generic defaults to `Record<string, never>`,
  calling the documented pattern `use({ networkPolicy: "deny-all" })` inside
  `onSession` fails typecheck:

  ```
  agent/sandbox/sandbox.ts: error TS2322: Type 'string' is not assignable to type 'never'.
  ```

  This directly contradicts the Sandbox docs (sandbox.mdx), which show
  `onSession` calling `use({ networkPolicy: "deny-all" })`. The Docker backend
  *does* accept `networkPolicy` at runtime (and on the factory), so this is a
  type-declaration regression, not a runtime limitation.

  Fix suggestion: declare
  `docker(opts?): SandboxBackend<DockerSandboxSessionUseOptions, DockerSandboxSessionUseOptions>`
  (and export those option interfaces, which currently don't exist for Docker —
  only `DockerSandboxCreateOptions/NetworkPolicy/PullPolicy` are exported).

  Workaround used in this PoC: set `networkPolicy: "deny-all"` on the `docker()`
  factory itself (which is correctly typed) instead of in `onSession`.

- **[major] Self-hosted Postgres world fails under `eve build && eve start`:
  `{"error":"Unhandled queue"}` (HTTP 400), run never advances past pending.**

  Repro: configure `experimental.workflow.world = "@workflow/world-postgres"`,
  `eve build`, then `PORT=3000 eve start`. POST a session. The run is enqueued
  in Postgres (`workflow.workflow_runs` row = `pending`), graphile-worker picks
  up the job, but the callback to `POST /.well-known/workflow/v1/flow` returns
  `400 {"error":"Unhandled queue"}`. graphile-worker retries to max attempts and
  the run stalls at 0 steps. `world.start()` IS running (the queue is polled), so
  this is not the start() problem the plan warned about.

  Root cause (in eve 0.13.3 `configure-nitro-routes.js`): the workflow route's
  **direct queue-handler registration is gated on `o.options.dev`**:

  ```js
  let f = o.options.dev && d !== void 0
    ? [{ bundlePath: d, queuePrefix: EVE_WORKFLOW_QUEUE_PREFIX }]
    : [];
  // ... addWorkflowFileHandler(..., { directHandlers: f, ... })
  ```

  In a production (`eve start`) build `o.options.dev` is false, so `f` is empty
  and the generated workflow handler never calls
  `world.registerHandler(queuePrefix, POST)`. The world-local queue router then
  has no direct handler for the prefix and returns "Unhandled queue" for every
  job. Under `eve dev` the handler IS registered, so the same world works.

  Impact: the documented self-host path (`eve build && eve start` with a custom
  `experimental.workflow.world`) does not actually execute turns. This directly
  undercuts the "advanced self-hosted deployments can select the Workflow world"
  guidance in deployment.md / agent-config.md / execution-model docs.

  Question for the team: is non-dev `eve start` expected to register the
  configured world's direct queue handler? If the production path is supposed to
  dispatch over HTTP to the route (rather than via the in-process directHandler),
  then the route's POST handler isn't matching the postgres world's queue-name
  prefix in `eve start` builds. Either way, a custom world can't run a turn under
  `eve start` in 0.13.3.

  Workaround under evaluation: run the long-lived host with `eve dev` instead of
  `eve start` (dev registers the direct handler). Verifying next.

- **[major] Version-line trap: `@workflow/world-postgres@latest` (4.2.0) is
  INCOMPATIBLE with eve 0.13.3; you must use the `5.0.0-beta` line.**

  eve 0.13.3 bundles `@workflow/core@5.0.0-beta.19`, `@workflow/world@5.0.0-beta.10`,
  `@workflow/world-local@5.0.0-beta.19`. The `npm` **latest** tag for
  `@workflow/world-postgres` is `4.2.0`, so `pnpm add @workflow/world-postgres`
  silently installs 4.x — which depends on `@workflow/world@4.2.0`.

  The 4.2.0 event schema's discriminated union (`@workflow/world/dist/events.js`)
  only knows: run_created/started/completed/failed/cancelled, step_*, hook_*,
  wait_*. It does **not** know the **`attr_set`** event type that eve
  5.0.0-beta emits via `experimental_setAttributes` (the `$eve.*` run tags in
  `src/runtime/attributes/emit.js`).

  Result with 4.2.0: the run executes its first step, eve writes an `attr_set`
  event, and when the workflow runtime replays the event log it throws
  `ZodError: invalid_union / "No matching discriminator" path=["eventType"]`,
  failing the run (`run_failed`). The earlier non-fatal
  `[eve] setEveAttributes failed ... discriminator "eventType"` warning is the
  same mismatch surfacing on write.

  Fix: pin `@workflow/world-postgres@5.0.0-beta.19` (matches eve's bundled
  core/world). `5.0.0-beta.13..19` are published.

  Team feedback: this is a sharp edge. eve 0.13.3's self-host docs point users to
  `@workflow/world-postgres` without a version, and `@latest` resolves to an
  incompatible major. Either (a) publish the postgres world's 5.x line under the
  `latest`/a documented tag, or (b) have eve validate the configured world's
  `@workflow/world` peer version at startup and emit an actionable error instead
  of a deep ZodError mid-run. A peer-version check would have turned a ~1hr
  investigation into a one-line message.

## Verification status

- **Queue dispatch + event schema: FIXED and verified.** After pinning
  `@workflow/world-postgres@5.0.0-beta.19` and setting
  `WORKFLOW_QUEUE_NAMESPACE=eve`, a session ran end-to-end against the
  self-hosted Postgres world: 4 `step_completed` events, `attr_set` accepted,
  run reached `completed`/`running` with no ZodError and no "Unhandled queue".
  Model routing confirmed DIRECT to OpenAI (no Gateway) — the only error came
  straight from `api.openai.com`.

- **[resolved] OpenAI `insufficient_quota` (initial key).** The first key had no
  quota; eve handled it by parking the session for retry (durable error handling
  working). Replaced with a funded key.

## Full live verification — ALL THREE PROOFS PASS

With `@workflow/world-postgres@5.0.0-beta.19`, `WORKFLOW_QUEUE_NAMESPACE=eve`,
`eve dev --no-ui` host, Docker sandbox, and a funded OpenAI key:

1. **Isolation PASS.** `run_python` printed container hostname `e318ab324dcb`
   (≠ host `computer.local`) and `HOST_ONLY_SECRET` = `<unset in sandbox>`.
   Live sandbox container observed: `eve-sbx-ses-docker-...` from
   `ghcr.io/vercel/eve:latest`.
2. **Durability PASS (headline).** Killed host (`kill -9`) with 2 `step_completed`
   persisted and step 3 in flight; restarted; same session resumed; finished with
   6 `step_completed`, `step_started==step_completed==6` (no re-run), turn
   `run_completed`. Correct analysis produced post-crash.
3. **No-Vercel PASS.** `make proof-novercel` -> CLEAN.

3-step analysis produced real computed numbers (e.g. 1,000 orders, net sales
269,862.90, avg discount 11.85%, per-product/region breakdowns), all computed in
the sandbox. Build emits standard Nitro `.output/` (no `.vercel/output`).

<!-- Append findings below as they occur during the build. -->
