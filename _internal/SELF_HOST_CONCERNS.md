# Self-host concerns that Vercel hosting would avoid

Operational burdens we take on by running eve fully self-hosted (Postgres
Workflow world + Docker sandbox + direct OpenAI on eve 0.13.3) that largely
disappear when the agent is hosted on Vercel. These are not eve bugs — they are
the cost of owning the runtime. Logged so we can decide later what (if anything)
to build, and so we can articulate the Vercel value proposition.

Legend: [infra] you must operate it · [lifecycle] resource cleanup/expiry ·
[scaling] capacity/concurrency · [security] isolation/network boundary

---

## Sandbox container lifecycle (the orphaned-container problem)

- **[lifecycle] Orphaned Docker sandbox containers are not reaped.** With the
  `docker()` backend, every turn that runs sandbox code starts a long-lived
  keepalive container:

  ```
  docker run -d --name eve-sbx-ses-docker-... --label eve.sandbox=1 \
    --entrypoint /bin/sh ghcr.io/vercel/eve:latest -c "sleep 2147483647"
  ```

  (see `node_modules/eve/.../execution/sandbox/bindings/docker-container.js`,
  `startDockerContainer`). The container is **not** created with `--rm`, so
  Docker never auto-removes it.

  The only cleanup path eve ships is `stopDevelopmentSandboxResources`
  (`execution/sandbox/development-cleanup.js`). It is wired **only** into the
  `eve dev` server lifecycle (`internal/nitro/host/start-development-server.js`,
  in the server's `finally`/`catch`), and it filters by the current dev run's
  ID tag (`eve.sandbox.tag.<EVE_DEVELOPMENT_SANDBOX_RUN_ID>`). It calls
  `stopDockerContainerIfRunning` (`docker stop -t 0`) on just that run's
  containers.

  Consequences when self-hosting:
  - A `kill -9` / crash / OOM of the host leaves the in-flight container
    running. (Our durability proof in `ISSUES.md` #2 does exactly this — the
    `kill -9` durability test is itself a container-orphaning path.)
  - Containers from a *previous* dev run are out of scope for the *current*
    run's cleanup, so they accumulate across restarts.
  - Running under `eve start` (vs `eve dev`) gets no cleanup wiring at all.
    (Re-confirmed on eve 0.15.0: after an `eve start` host was killed, two
    `eve-sbx-*` containers were still `Up` and had to be removed by hand. Note
    that on 0.15.0 `eve start` now *runs* the custom world — see ISSUES.md — so
    this reaping gap is more relevant than before, since `eve start` is now a
    viable production host but still does not reap.)
  - Stopped-but-not-removed containers also linger (cleanup only `stop`s).

  **What we'd have to build:** a periodic reaper (e.g. cron/systemd timer)
  that prunes by label — `docker ps -aq --filter label=eve.sandbox=1` filtered
  by age — plus removal (not just stop). Or run with an idle-timeout sidecar.
  Not building this yet; documenting the gap.

- **On Vercel this is a non-issue.** Hosted bundles strip the local backends
  entirely (`internal/nitro/host/compiled-sandbox-backend-prune-plugin.js`
  stubs Docker/just-bash/microsandbox out of the Nitro server bundle) and use
  the `vercel()` sandbox. That backend has a built-in expiry —
  `DEFAULT_SANDBOX_TIMEOUT_MS = 1_800_000` (30 min) in
  `execution/sandbox/bindings/vercel.js` — so sandboxes self-expire with no
  host process responsible for reaping. No orphans, no reaper to operate.

---

<!-- Append further self-host-only operational concerns below as we hit them.
     Candidate topics to flesh out when we encounter them:
     - [infra] Postgres Workflow world: we operate the DB, graphile-worker,
       backups, migrations (Vercel-hosted manages the world for us).
     - [scaling] single long-lived host vs. serverless turn execution.
     - [lifecycle] template image / cache pruning on the host.
     - [security] Docker egress is coarse allow-all/deny-all only; domain
       allow-lists + credential brokering require vercel() (see ISSUES.md). -->
