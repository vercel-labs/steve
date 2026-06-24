# Deploying steve to a DigitalOcean droplet (Ansible)

Provisions a droplet, hardens it, and runs the self-hosted `eve` agent, a
Next.js UI, and Beszel monitoring behind Caddy — with **zero Vercel
infrastructure**, on independent hardware. The agent and UI run natively under
`systemd`; Postgres (the durable Workflow world) and Beszel run in Docker; Caddy
terminates TLS and injects `x-hosted-on-vercel: false` on every response.

```
你 (laptop)  --ssh-->  droplet
   caddy  :80/:443  (public, TLS, header inject)
     ├─ eve.phil.bingo
     │     ├─ /eve/*, /.well-known/workflow/*  -> steve     (127.0.0.1:3000)
     │     └─ everything else (the UI)         -> steve-web (127.0.0.1:3001)
     └─ status.eve.phil.bingo                  -> beszel-hub (127.0.0.1:8090)

   steve.service       eve dev --no-ui   (127.0.0.1:3000)  [spawns sandboxes via Docker socket]
   steve-web.service   next start        (127.0.0.1:3001)  [withEve + useEveAgent UI]
   docker: steve-postgres (127.0.0.1:5544), beszel-hub, beszel-agent
```

## Why these choices

- **Native + systemd** for the eve host and the Next UI: the agent needs the
  Docker socket to spawn sandbox containers, so running it natively (rather than
  in a container that mounts the socket) is simpler and matches the verified
  local setup.
- **`eve dev --no-ui`, not `eve start`**: in eve 0.13.3 only the dev host
  registers the custom Postgres world's queue handler. See `_internal/ISSUES.md`.
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
  route). See `_internal/DX_NOTES.md` for the auth trade-offs.

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

Two pieces, both dead simple:

- **DigitalOcean API token** — export it before provisioning:
  ```bash
  export DO_API_TOKEN="dop_v1_..."
  ```
  (Or pass `-e do_api_token=...` on the provision command.)
- **App runtime secrets** — your existing repo-root `../.env` (the same file
  `make dev` uses) is rsynced verbatim to `/opt/steve/.env` on the droplet
  during deploy. It's gitignored, so nothing secret is committed. Make sure it
  has a real `OPENAI_API_KEY`, a strong `ROUTE_AUTH_BASIC_PASSWORD`, and
  `WORKFLOW_QUEUE_NAMESPACE="eve"`.

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
curl http://<droplet-ip>/eve/v1/health       # the agent API (use GET, not HEAD)
curl -I http://<droplet-ip>/                 # -> x-hosted-on-vercel: false
```

> Use `GET` for `/eve/v1/health`; eve 404s `HEAD` requests (so `curl -I` against
> the health path shows 404 even when healthy). See `_internal/DX_NOTES.md`.

## 5. Add your domain (when ready)

1. Create DNS **A records** pointing at the droplet IP:
   - your app domain (e.g. `eve.phil.bingo`)
   - the monitoring subdomain (e.g. `status.eve.phil.bingo`), if you want the
     Beszel dashboard exposed.
2. Set in `group_vars/all.yml`:
   ```yaml
   domain: "eve.phil.bingo"
   monitoring_domain: "status.eve.phil.bingo"   # or "" to keep Beszel private
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
4. **Beszel first run:** open `https://status.eve.phil.bingo/`, create the admin
   account, then **Add System** with host `127.0.0.1` and port `45876`. The hub
   shows a public key to authorize; paste it into `group_vars/all.yml` as
   `beszel_agent_key` and re-run deploy (or complete the add-system flow in the
   hub, which writes the key to the agent on connect).

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
| `roles/caddy` | reverse proxy, TLS, path routing, `x-hosted-on-vercel: false` header |

## Tearing down

Destroy the droplet from the DigitalOcean dashboard (or set `state: absent` in
the provision role and re-run). Nothing on your machine needs cleanup beyond
deleting `inventory.ini`.
