# Deploying steve to a DigitalOcean droplet (Ansible)

Provisions a droplet, hardens it, and runs the self-hosted `eve` agent, a
Next.js UI, Beszel monitoring, and Jaeger tracing behind Caddy — with **zero
Vercel infrastructure**, on independent hardware. The agent and UI run natively
under `systemd`; Postgres (the durable Workflow world), Beszel, and Jaeger run in
Docker; Caddy terminates TLS and injects `x-hosted-on-vercel: false` on every
response.

```
you (laptop)  --ssh-->  droplet
   caddy  :80/:443  (public, TLS, header inject)
     ├─ eve.phil.bingo
     │     ├─ /eve/*, /.well-known/workflow/*  -> steve     (127.0.0.1:3000)
     │     └─ everything else (the UI)         -> steve-web (127.0.0.1:3001)
     ├─ status.eve.phil.bingo                  -> beszel-hub (127.0.0.1:8090)
     └─ jaeger.eve.phil.bingo (Basic auth)     -> jaeger     (127.0.0.1:16686)

   steve.service       eve start         (127.0.0.1:3000)  [spawns sandboxes via Docker socket]
   steve-web.service   next start        (127.0.0.1:3001)  [withEve + useEveAgent UI]
   docker: steve-postgres (127.0.0.1:5544), beszel-hub, beszel-agent,
           steve-jaeger (UI 127.0.0.1:16686, OTLP 127.0.0.1:4318)
```

## Why these choices

- **Native + systemd** for the eve host and the Next UI: the agent needs the
  Docker socket to spawn sandbox containers, so running it natively (rather than
  in a container that mounts the socket) is simpler and matches the verified
  local setup.
- **`eve start` (the production host)**: historically (eve 0.13.x) only `eve dev`
  registered the custom Postgres world's queue handler, so this deploy used to run
  `eve dev --no-ui`. **Fixed in eve 0.15.0** — `eve start` now runs the custom
  world correctly, so the app role does `eve build` and the unit runs `eve start`.
  Caveat: unlike `eve dev`, `eve start` does **not** reap per-run Docker sandbox
  containers on shutdown; run an external reaper if that matters.
- **Caddy path-routes the eve API straight to the agent**, and everything else
  to the Next UI. We deliberately do *not* use `withEve`'s production rewrite
  (`EVE_NEXT_PRODUCTION_ORIGIN`) to forward `/eve/v1/*`: that rewrite assumes the
  agent is mounted under its Vercel `servicePrefix` (`/_eve_internal/eve`) and
  double-prefixes the path when the agent runs as a separate origin serving at
  `/eve/v1`. `useEveAgent` calls same-origin `/eve/v1/*`, so Caddy path routing
  is transparent to the browser and avoids the rewrite entirely. (The eve
  internal `/.well-known/workflow/*` callback is routed to the agent too.)
- **Droplet size `s-2vcpu-4gb`**: the agent + Postgres + Docker sandbox + a
  Next.js production build (`next build` needs ~1.5GB) coexist; 2GB OOMs/struggles
  during the build, 4GB is comfortable. The frontend role also adds a 2G swapfile
  as a safety margin. Resize anytime via the DO dashboard/API (power off →
  resize RAM → power on); the agent unit waits for Postgres on reboot.
- **Agent is public (`none()` auth) for the PoC** so the UI works without
  credentials. Lock it down by switching `agent/channels/eve.ts` back to
  `[localDev(), httpBasic({...})]` (and front the UI with an auth-injecting
  route).
- **Self-hosted Jaeger for tracing**: traces go to a self-hosted Jaeger on the
  droplet (vanilla OpenTelemetry, no SaaS) whose UI is exposed publicly behind
  Caddy with HTTP Basic auth, so the `ai.eve.turn` span tree can be shown live in
  a browser. Both Jaeger UI and OTLP receiver bind to `127.0.0.1`; only Caddy is
  internet-facing. Production uses Jaeger because the deployed `.env` sets
  `OTEL_EXPORTER_OTLP_ENDPOINT` and leaves `OPEN_OBSERVE_OTLP_ENDPOINT` unset
  (the local-only OpenObserve dashboard is not deployed).

## Prerequisites (on your machine)

- Ansible (`brew install ansible`).
- Your default SSH key at `~/.ssh/id_ed25519` (used for the initial root login
  and the `deploy` user). Override `local_ssh_pubkey_path` in
  `group_vars/all.yml` if different.
- A DigitalOcean API token with write scope (exported as `DO_API_TOKEN`).
- A populated repo-root `.env` (the same one `make dev` uses) — it gets copied
  to the droplet as the app's runtime environment.
- Repo already pushed to `git@github.com:vercel-labs/steve.git` (it is).

Install the required collections:

```bash
cd deploy
ansible-galaxy collection install -r requirements.yml -p ./.galaxy
```

> There's a `Makefile` wrapping the common commands. The quickest path:
> ```bash
> export DO_API_TOKEN=dop_v1_...
> make deps && make all          # provision -> bootstrap -> deploy
> make deploy REF=my-branch      # redeploy a specific ref
> make status / make logs / make ssh
> ```
> The steps below explain each phase; use either the Makefile or the raw
> `ansible-playbook` commands.

## 1. Secrets (PoC-simple — no vault)

Three pieces, all dead simple:

- **DigitalOcean API token** — export it before provisioning:
  ```bash
  export DO_API_TOKEN="dop_v1_..."
  ```
  (Or pass `-e do_api_token=...` on the provision command.)
- **Monitoring & tracing auth (deploy-time)** — the Beszel agent token and the
  Jaeger UI Basic-auth credentials are read from your shell environment at deploy
  time (just like `DO_API_TOKEN`), so they're no longer baked into
  `group_vars/all.yml`. Export whichever you use before `ansible-playbook deploy.yml`:
  ```bash
  # Beszel: the agent token from the hub's "Add System" flow (see step 4).
  export BESZEL_AGENT_TOKEN="25d09c13-7c39-432f-8864-7f6f84a4a334"
  # Jaeger UI Basic auth. USER defaults to `eve`; HASH is a bcrypt hash
  # (caddy hash-password --plaintext '<password>'). Unset HASH => no auth.
  # Single-quote the hash so the shell doesn't expand its `$` segments.
  export JAEGER_BASIC_AUTH_USER="eve"
  export JAEGER_BASIC_AUTH_HASH='$2a$14$bJVPqzWhGCf0.G/T9MC6peaH5BckzStlmz3PMl/Q8hhzf0eTgOjRC'
  ```
  Nothing sensitive here — the demo login stays `eve` / `justshipthings`, so reuse
  the values above if you just want the demo working. They're also listed
  (commented) in `../.env.example` for discoverability.
- **App runtime secrets** — your existing repo-root `../.env` (the same file
  `make dev` uses) is rsynced verbatim to `/opt/steve/.env` on the droplet
  during deploy. It's gitignored, so nothing secret is committed. Make sure it
  has a real `OPENAI_API_KEY`, a strong `ROUTE_AUTH_BASIC_PASSWORD`, and
  `WORKFLOW_QUEUE_NAMESPACE="eve"`.
  > **Observability — important.** Set `OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"`
  > in the `.env` you ship so prod traces reach the droplet's Jaeger. The
  > OpenObserve path is now an opt-in **code toggle** in `agent/instrumentation.ts`
  > (committed OFF), so a stray `OPEN_OBSERVE_OTLP_ENDPOINT` in the copied `.env`
  > no longer hijacks prod telemetry — the agent only uses OpenObserve if that
  > import is uncommented (which it must not be for a deploy, since the SDK is an
  > unpublished local `link:`). Best practice is still to omit
  > `OPEN_OBSERVE_OTLP_ENDPOINT` from the shipped `.env` for clarity.

## 2. Provision the droplet (once)

```bash
ansible-playbook provision.yml
```

This creates the droplet, waits for SSH, and writes its public IP into
`inventory.ini` automatically. It prints the IP at the end.

## 3. Harden it (once)

```bash
ansible-playbook bootstrap.yml
```

Creates the `deploy` user (with your SSH key), disables root SSH + password
auth, enables `ufw` (only 22/80/443 open), `fail2ban`, and automatic security
upgrades.

## 4. Deploy

```bash
ansible-playbook deploy.yml
```

On the **first** run it generates a read-only GitHub **deploy key** on the
droplet and pauses, printing the public key with a link
(`https://github.com/vercel-labs/steve/settings/keys/new`). Add it (leave
"Allow write access" unchecked), press ENTER, and the play continues: clone →
copy `.env` → `pnpm install` → Postgres up → migrate → systemd service → Caddy.

At this point the site is reachable over **plain HTTP by IP** (no domain yet):

```bash
curl http://<droplet-ip>/                    # the Next.js UI
curl http://<droplet-ip>/eve/v1/health       # the agent API
curl -I http://<droplet-ip>/                 # -> x-hosted-on-vercel: false
```

> As of eve 0.15.0, `HEAD /eve/v1/health` returns `200` (it 404'd on 0.13.x), so
> HEAD-based health/uptime probes work.

## 5. Add your domain (when ready)

1. Create DNS **A records** pointing at the droplet IP:
   - your app domain (e.g. `eve.phil.bingo`)
   - the monitoring subdomain (e.g. `status.eve.phil.bingo`), if you want the
     Beszel dashboard exposed.
   - the tracing subdomain (e.g. `jaeger.eve.phil.bingo`), if you want the
     Jaeger trace UI exposed.
2. Set in `group_vars/all.yml`:
   ```yaml
   domain: "eve.phil.bingo"
   monitoring_domain: "status.eve.phil.bingo"   # or "" to keep Beszel private
   jaeger_domain: "jaeger.eve.phil.bingo"       # or "" to keep Jaeger private
   acme_email: "you@example.com"
   ```
3. Re-run the deploy — Caddy provisions Let's Encrypt certs automatically:
   ```bash
   ansible-playbook deploy.yml
   ```
   ```bash
   curl https://eve.phil.bingo/                 # UI
   curl https://eve.phil.bingo/eve/v1/health    # agent API
   curl -I https://eve.phil.bingo/              # x-hosted-on-vercel: false
   ```
4. **Beszel monitoring first run.** The hub + agent are deployed automatically,
   but the agent needs credentials from the hub to connect:
   1. Open `https://status.eve.phil.bingo/` and create the admin account.
   2. **Add System** with host `127.0.0.1` and port `45876`. The hub shows a
      public **key** (and the agent uses a **token** for the WebSocket handshake).
   3. Put the public key into `group_vars/all.yml`, export the token, and re-run
      deploy:
      ```yaml
      # group_vars/all.yml — the key is a public key, safe to commit
      beszel_agent_key: "ssh-ed25519 AAAA..."
      beszel_hub_url: "https://status.eve.phil.bingo"
      ```
      ```bash
      export BESZEL_AGENT_TOKEN="<uuid-from-add-system>"   # shared secret, not committed
      ansible-playbook deploy.yml
      ```
   The agent then logs `WebSocket connected host=status.eve.phil.bingo` and the
   dashboard shows live CPU / memory / disk / network / Docker metrics.

   > Note: `beszel_agent_token` is a shared secret, so it's read from the
   > `BESZEL_AGENT_TOKEN` environment variable at deploy time rather than
   > committed to `group_vars/all.yml`. Leave it unset and the agent just runs
   > unregistered until you export it. The `beszel_agent_key` is a public key and
   > safe to commit.
5. **Jaeger tracing.** Jaeger all-in-one is deployed automatically and the agent
   ships its OpenTelemetry spans to it (the rsynced `.env` sets
   `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` and leaves
   `OPEN_OBSERVE_OTLP_ENDPOINT` unset, so instrumentation selects the Jaeger
   path).    The UI is exposed at `https://jaeger.eve.phil.bingo`
   behind Caddy with HTTP Basic auth. The credentials come from the environment
   at deploy time (export before `ansible-playbook deploy.yml`):
   ```bash
   export JAEGER_BASIC_AUTH_USER="eve"    # defaults to `eve` if unset
   # bcrypt hash; regenerate with: caddy hash-password --plaintext '<password>'
   # single-quote it so the shell doesn't expand the `$` segments
   export JAEGER_BASIC_AUTH_HASH='$2a$14$bJVPqzWhGCf0.G/T9MC6peaH5BckzStlmz3PMl/Q8hhzf0eTgOjRC'
   ```
   Drive a session in the UI, then open the Jaeger UI, pick service `steve`, and
   explore the `ai.eve.turn -> ai.streamText -> ai.toolCall` span tree.

   > The default demo login is `eve` / `justshipthings` (the hash above). Change
   > the password by generating a new bcrypt hash and re-exporting
   > `JAEGER_BASIC_AUTH_HASH`. If you leave `JAEGER_BASIC_AUTH_HASH` unset, the
   > Jaeger UI is served **without** Basic auth. Trace payloads can include prompts
   > and tool args, so don't expose it unauthenticated for anything sensitive.

## Redeploying new changes

Push to the repo, then re-run the deploy. It pulls the latest ref, reinstalls
deps, re-copies your local `.env`, re-runs the (idempotent) migration, and restarts the
service only if something changed:

```bash
ansible-playbook deploy.yml
# deploy a specific branch/tag/SHA:
ansible-playbook deploy.yml -e git_ref=my-feature-branch
```

## Operating the droplet

```bash
ssh deploy@<droplet-ip>
systemctl status steve steve-web  # agent + UI service state
journalctl -u steve -f            # agent logs
journalctl -u steve-web -f        # UI logs
docker ps                         # postgres, beszel-hub, beszel-agent, sandboxes
cd /opt/steve && pnpm exec workflow inspect runs --backend @workflow/world-postgres
sudo ufw status                   # firewall (22/80/443 only)
```

## What lives where

| Path | Purpose |
| --- | --- |
| `provision.yml` | create the droplet via the DO API, write `inventory.ini` |
| `bootstrap.yml` | one-time hardening (root) |
| `deploy.yml` | deploy / redeploy (deploy user) |
| `group_vars/all.yml` | config (size, region, domain, ports, versions, env paths) |
| `roles/hardening` | deploy user, SSH lockdown, ufw, fail2ban, auto-upgrades |
| `roles/docker` | Docker Engine + compose plugin |
| `roles/app` | Node 24/pnpm, deploy key, clone, `.env`, Postgres, migrate, agent systemd |
| `roles/frontend` | swapfile, `next build`, `steve-web` systemd unit (the public UI) |
| `roles/monitoring` | Beszel hub + agent via Docker Compose |
| `roles/jaeger` | Jaeger all-in-one (trace UI + OTLP receiver) via Docker Compose |
| `roles/caddy` | reverse proxy, TLS, path routing, `x-hosted-on-vercel: false` header |

## Tearing down

Destroy the droplet from the DigitalOcean dashboard (or set `state: absent` in
the provision role and re-run). Nothing on your machine needs cleanup beyond
deleting `inventory.ini`.
