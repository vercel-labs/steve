# Demo — steve, a fully self-hosted eve agent

A ~5 minute live demo that shows the whole thesis end to end: a durable,
multi-step agent that **writes and runs its own code in an isolated sandbox**,
produces a **visual result**, and runs entirely on **independent infrastructure
with zero Vercel coupling**.

- **App:** https://eve.phil.bingo
- **Monitoring:** https://status.eve.phil.bingo

> The agent is public (`none()` auth) for the demo, so no login is needed.

---

## The one-liner

> "This is an AI agent built on Vercel's `eve` framework — but running entirely
> on a $24 DigitalOcean droplet I control. No Vercel. The model writes Python,
> runs it in an isolated Docker sandbox, the run is durable in Postgres, and the
> result renders as a live chart. Let me show you."

---

## Act 1 — It does real work, and you can see it (≈2 min)

1. Open **https://eve.phil.bingo**.
2. Type a request, e.g.:

   > Analyze Q4 sales by region for an outdoor gear company. Generate realistic
   > data, compute the numbers, and chart it.

3. Narrate the steps as they stream — these are **real durable checkpoints**, not
   a single model call:
   - **Generate** — writes Python that creates a synthetic CSV in the sandbox.
   - **Analyze** — reads it back, computes totals / per-region breakdown.
   - **Chart** — builds a Mermaid chart spec from the computed numbers.
   - **Summarize** — the final answer, with a **live bar chart** rendered inline.

   Expand a `run_python` tool call to show the audience the **actual Python the
   model wrote** — and point out it ran in a container, not on the host.

4. Land the point: *"Every number came from code the model wrote and executed in
   an isolated sandbox — nothing was hallucinated, and none of it touched
   Vercel."*

## Act 2 — It's genuinely self-hosted (≈1 min)

1. In a terminal:
   ```bash
   curl -I https://eve.phil.bingo/eve/v1/health -X GET
   ```
   Point at the **`x-hosted-on-vercel: false`** header — injected by our own
   Caddy on the droplet. (Use `-X GET`; eve 404s `HEAD`.)
2. Open **https://status.eve.phil.bingo** (Beszel). Show live CPU / memory /
   **Docker containers** — you can see `steve-postgres` and the ephemeral
   `eve-sbx-...` sandbox container that ran the analysis. *"This is the actual
   box. There's the sandbox container that just ran the model's code."*

## Act 3 — It's durable (the headline, ≈2 min)

This is the most counterintuitive, memorable part: **kill the agent mid-run and
watch it resume.**

1. Start a fresh analysis in the UI (Act 1 prompt again).
2. As soon as the first step completes, **kill the agent process** on the droplet:
   ```bash
   cd deploy && make demo-kill          # hard-restarts the eve host mid-run
   ```
3. The UI stream blips, then **the same run continues and finishes** — the
   completed steps are *not* re-run.
4. Prove it from the durable event log:
   ```bash
   make demo-events                     # step_started == step_completed, run_completed
   ```
   *"The process died, but the run survived — because durability lives in
   Postgres on this droplet, not in any managed Vercel service. It picked up
   exactly where it left off."*

---

## Backup / variations

- **Pie chart:** ask "show that as a share-of-total pie chart instead."
- **Isolation proof:** ask "use run_python to print your container hostname and
  try to read the HOST_ONLY_SECRET env var." It prints a Docker container id and
  `<unset in sandbox>` — proving the host's secrets are unreachable.
- **Different domain:** "analyze website signups by traffic source", "model a
  week of support-ticket volume by category" — anything tabular charts well.

## If something goes wrong

- **UI loads but no response:** check the agent — `make status` (look for
  `steve` active). Restart with `make demo-restart` if needed.
- **Chart shows as code, not a diagram:** the model occasionally forgets the
  fenced ` ```mermaid ` block; just ask "render that as a mermaid chart."
- **Slow first run:** the sandbox image may be cold; the very first run after a
  deploy pulls `ghcr.io/vercel/eve:latest`. Do a throwaway run before presenting.

## Reset between demos

Nothing is required — each request is a new session. To clear history in the
browser, just reload the page.
