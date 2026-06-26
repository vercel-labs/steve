# Observe SDK (`@open-observe/sdk`) integration — feedback for the maintainer

Context: integrated `@open-observe/sdk` into a self-hosted eve agent (steve) to
replace the existing vanilla-OTel → Jaeger tracing pipeline, and ran the local
`@open-observe/dashboard` alongside it. steve is an **external** project (not in
the openobserve monorepo), linked via `pnpm add link:`. SDK version `0.0.1`,
dashboard `0.0.1`, eve `0.13.6`, Node 24.15, pnpm 10.33, Next 16.

This is product feedback for the openobserve maintainer. Bottom line: **the SDK
side worked and is well-designed**; **the dashboard silently drops valid OTLP
data it 200s**, which is the one blocking bug.

Legend: [+] delight / good design · [~] friction / surprise · [!] sharp edge / bug

---

## TL;DR

- The SDK install + `observe()` wiring per the README's "Eve Agent Or Project"
  path worked essentially first try. Typecheck clean, host boots clean, and a
  packet capture confirms it exports a rich, correct span tree (workflow steps,
  `gen_ai::chat gpt-5-mini`, `eve::ai.eve.turn`, undici HTTP) with
  `service.name=steve` and the right project header.
- **The blocking issue is dashboard-side**: the dashboard accepts every OTLP
  POST with `200 {"partialSuccess":{}}` but persists **zero** rows. Every
  read API (`/api/counts`, `/api/traces`, `/api/sessions`, `/api/metrics`,
  `/api/logs`) returns 0 for the project, despite the project being
  auto-created and the payloads being well-formed OTLP/JSON with hex IDs.

---

## What was genuinely great

- **[+] The README "Eve Agent Or Project" recipe is copy-paste correct.** The
  `defineInstrumentation({ setup: async ({ agentName }) => observe({...}) })`
  block dropped straight in. `serviceName: agentName`, `projectId`, and the
  `otlp: { traces, logs, metrics }` shape all matched the exported types. No
  guessing.

- **[+] `observe()` attaches to eve's existing tracer provider cleanly.** In
  `auto` mode the SDK detected eve's already-registered provider and added its
  span processors via `addSpanProcessor` rather than fighting it. No duplicate
  provider, no "global tracer already set" warning. This is exactly the right
  behavior for a framework that owns its own OTel setup, and it's the thing I
  was most worried about going in.

- **[+] The capture proves the instrumentation is genuinely good.** Pointing
  `OPEN_OBSERVE_OTLP_ENDPOINT` at a tiny local capture server showed the SDK
  emitting a complete, correctly-scoped tree from a single turn:

  ```
  steve::eve::ai.eve.turn
  steve::gen_ai::invoke_agent gpt-5-mini
  steve::gen_ai::chat gpt-5-mini
  steve::gen_ai::step 1
  steve::workflow::workflow.run .../turnWorkflow   (+ ~25 workflow.* spans)
  steve::undici::POST   (outbound model call)
  ```

  Token usage, the workflow run tree, and the AI turn all came through with the
  right `service.name`. The allowlist did its job — no framework noise, and
  zero false drops (verified with `OPEN_OBSERVE_DEBUG_ALLOWLIST=1`).

- **[+] `OPEN_OBSERVE_DEBUG_ALLOWLIST=1` is a great debugging affordance.** It
  prints the fully-resolved allowlist at boot and logs every `DROP` with the
  scope name. That single env var let me rule out "allowlist ate my spans" in
  about 30 seconds. More SDKs should ship this.

- **[+] `x-open-observe-project-id` partitioning is clean and zero-config.**
  Setting `projectId: "steve"` auto-created the project on first POST
  (lazy-upsert in `/v1/traces`). One dashboard, multiple local projects, no
  manual setup. Nice.

- **[+] Fail-open default endpoint.** `?? 'http://localhost:3001'` means the
  agent runs fine whether or not the dashboard is up. Good for a local-first
  tool — observability should never be load-bearing for the app.

---

## What was surprising or rough

- **[~] The SDK ships TypeScript source, so external Next.js apps need
  `transpilePackages`.** `package.json` `main` points at `./src/index.ts`. The
  README does call this out, but it's easy to miss and the failure mode (Next
  refusing to bundle raw TS from `node_modules`) is opaque. Publishing a built
  `dist/` (or at least a `prepare` build) would remove an entire class of
  consumer friction. Right now every external consumer must remember:
  ```ts
  transpilePackages: ['@open-observe/sdk']
  ```

- **[~] Peer deps `@opentelemetry/api` / `@opentelemetry/sdk-trace-base` are
  not obviously satisfied for `link:` installs.** It happened to work here only
  because the linked checkout carried its own `node_modules` with those
  packages. For a consumer who already has OTel installed at a different major,
  this is a silent dual-instance landmine (two `@opentelemetry/api` copies =
  context propagation breaks). Worth documenting the expected resolution, or
  pinning peer ranges tightly.

- **[~] `[open-observe] ai-sdk: unavailable` / `sandbox: unavailable` at boot
  reads like an error but isn't.** Those lines print at host startup before the
  AI SDK / sandbox modules are loaded, and the spans still flow correctly later
  (the capture proves `gen_ai` spans arrive). The wording made me waste time
  thinking the AI adapter had failed. Suggest softening to
  `ai-sdk: deferred (host owns telemetry registration)` or gating behind the
  debug flag.

- **[~] `npm` is not published yet, so the only path is `link:` to a checkout.**
  Understood (README says "soon"), but it means the integration is pinned to a
  local absolute path. Fine for a PoC, not portable across machines/CI.

---

## Sharp edges / the blocking bug

- **[!] BLOCKER: the dashboard 200s every OTLP POST but stores nothing.** This
  is the one thing that prevented a working end-to-end demo. Evidence:

  - Dashboard log shows real ingest with non-trivial processing time:
    ```
    POST /v1/traces  200 in 299ms (application-code: 295ms)
    POST /v1/logs    200 in  94ms (application-code:  91ms)
    POST /v1/metrics 200 ... (steady stream)
    ```
  - The `steve` project was auto-created (so `ensureProject` ran, the
    project-id header was read correctly):
    ```
    GET /api/projects → {"projects":[{"id":"default"...},{"id":"steve"...}]}
    ```
  - But every read returns empty, for both `steve` and `default`:
    ```
    GET /api/counts?projectId=steve   → {"counts":{"sessions":0,"traces":0,"logs":0}}
    GET /api/traces?projectId=steve   → {"traces":[]}
    GET /api/sessions?projectId=steve → {"sessions":[]}
    GET /api/metrics?projectId=steve  → {"usage":{"byModel":[],...,"total":{"calls":0,...}}}
    GET /api/logs?projectId=steve     → {"logs":[]}
    ```
  - The payload is valid OTLP/JSON. Captured a representative span:
    ```
    traceId = "4972c6b6bbeb3d0a943fcacd7627e4b3"   (32 hex chars)
    spanId  = "24b66a55ec4bacdb"                   (16 hex chars)
    startTimeUnixNano = "1782437658810000000"      (string)
    kind = 0
    ```
    `parseOtlpTraces` reads `s.traceId` / `s.spanId` as strings directly, which
    matches this hex encoding — so parsing should succeed.

  Because the SDK side is provably correct (the capture shows good spans
  leaving the agent), the bug is in the dashboard's ingest → DuckDB store path:
  `parseOtlpTraces` / `ingestSpans` (or the DuckDB write) is silently producing
  0 stored rows while still returning success. Two likely suspects to check:
  1. `parseOtlpTraces` returning spans but `store.ingestSpans` dropping them
     (dedup key, project scoping, or a swallowed DuckDB error).
  2. A read/write project-id mismatch (written under one id, queried under
     another) — though `default` is also empty, which argues against this.

  **Ruled out — the SDK's service/scope allowlist.** The maintainer suggested
  the SDK allowlist (which exports traces only from certain services/scopes)
  might be dropping spans. It is not: the allowlist runs *before* export, and a
  packet capture in front of the exporter proves the spans cross the wire.
  Re-tested with `OPEN_OBSERVE_DEBUG_ALLOWLIST=1` and a capture proxy in place
  of the dashboard, driving one turn:
  ```
  allowlist DROP count: 0
  captured spans (service.name=steve):
    steve :: workflow  84   (incl. the full turn/step run tree)
    steve :: undici     6   (outbound model call)
    steve :: gen_ai     3   (chat / invoke_agent / step)
    steve :: eve        1   (ai.eve.turn)
  ```
  94 spans leave the SDK per turn with zero drops; the dashboard 200s those
  exact payloads and stores 0. So the allowlist is exonerated — the data loss
  is strictly downstream of export, in the dashboard's ingest/store path. (The
  dashboard has no service-allowlist on its ingest side either; the only
  `allowlist:` reference in the dashboard is its own self-instrumentation
  `agent/instrumentation.ts`, unrelated to ingest.)

  **Ask:** the ingest route should not return `200 {"partialSuccess":{}}` when
  it stored 0 of N received spans. Surfacing a partial-success count, or
  logging `ingested X/Y spans`, would have turned a 1-hour black-box
  investigation into a 1-line log read. Right now a successful HTTP 200 is
  indistinguishable from total data loss.

- **[!] No server-side ingest visibility.** The dashboard logs the HTTP request
  but never how many spans/logs/points it actually persisted. A single
  `[ingest] traces: stored N spans (project=steve)` line would make this whole
  class of problem self-diagnosing.

---

## Net assessment

The SDK is the strong half: the eve integration recipe is accurate, `observe()`
co-exists with eve's OTel provider correctly, the allowlist and debug tooling
are excellent, and the exported data is rich and correctly shaped. The
instrumentation work here is genuinely good.

The dashboard is the weak link for this use case: it silently discards valid
data while reporting success, with no ingest-side logging to diagnose it. That
single behavior is the difference between "drop-in Jaeger replacement" and
"looks wired up but shows nothing." Fixing the ingest persistence (and adding a
stored-count log / honest partial-success response) would make this a clean
replacement for the Jaeger pipeline.
