# Deploying steve to a DigitalOcean droplet (Ansible)

Provisions a droplet, hardens it, and runs the self-hosted `eve` agent behind
Caddy — with **zero Vercel infrastructure**, on independent hardware. The agent
runs natively under `systemd`; Postgres (the durable Workflow world) runs in
Docker; Caddy terminates TLS and injects `x-hosted-on-vercel: false` on every
response.

```
你 (laptop)  --ssh-->  droplet
                         ├─ caddy            :80/:443  (public, TLS, header inject)
                         │     └─ reverse_proxy 127.0.0.1:3000
                         ├─ steve.service    eve dev --no-ui  (127.0.0.1:3000)
                         │     └─ spawns sandbox containers via the Docker socket
                         └─ docker: steve-postgres  (127.0.0.1:5544)
```

## Why these choices

- **Native + systemd** for the eve host: it needs the Docker socket to spawn
  sandbox containers anyway, so running it natively (rather than in a container
  that mounts the socket) is simpler and matches the verified local setup.
- **`eve dev --no-ui`, not `eve start`**: in eve 0.13.3 only the dev host
  registers the custom Postgres world's queue handler. See `_internal/ISSUES.md`.
- **Caddy proxies all paths** (not just `/eve/v1/*`) so eve's internal
  `/.well-known/workflow/v1/flow` queue callback keeps working.
- **Droplet size `s-2vcpu-2gb`**: the smallest size that reliably runs
  `pnpm install` + build with Node 24 alongside Postgres and sandbox containers
  without OOM. (1GB droplets fail during install.)

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

At this point the app is reachable over **plain HTTP by IP** (no domain yet):

```bash
curl -u admin:<password> http://<droplet-ip>/eve/v1/health
curl -I http://<droplet-ip>/eve/v1/health   # -> x-hosted-on-vercel: false
```

## 5. Add your domain (when ready)

1. Create a DNS **A record** for your domain pointing at the droplet IP.
2. Set in `group_vars/all.yml`:
   ```yaml
   domain: "agent.example.com"
   acme_email: "you@example.com"
   ```
3. Re-run the deploy — Caddy provisions a Let's Encrypt cert automatically:
   ```bash
   ansible-playbook deploy.yml
   ```
   ```bash
   curl -u admin:<password> https://agent.example.com/eve/v1/health
   curl -I https://agent.example.com/eve/v1/health   # x-hosted-on-vercel: false
   ```

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
systemctl status steve            # service state
journalctl -u steve -f            # live logs
cd /opt/steve && pnpm exec workflow inspect runs --backend @workflow/world-postgres
sudo ufw status                   # firewall (22/80/443 only)
```

## What lives where

| Path | Purpose |
| --- | --- |
| `provision.yml` | create the droplet via the DO API, write `inventory.ini` |
| `bootstrap.yml` | one-time hardening (root) |
| `deploy.yml` | deploy / redeploy (deploy user) |
| `group_vars/all.yml` | config (size, region, domain, versions, env paths) |
| `roles/hardening` | deploy user, SSH lockdown, ufw, fail2ban, auto-upgrades |
| `roles/docker` | Docker Engine + compose plugin |
| `roles/app` | Node 24/pnpm, deploy key, clone, `.env`, Postgres, migrate, systemd |
| `roles/caddy` | reverse proxy, TLS, `x-hosted-on-vercel: false` header |

## Tearing down

Destroy the droplet from the DigitalOcean dashboard (or set `state: absent` in
the provision role and re-run). Nothing on your machine needs cleanup beyond
deleting `inventory.ini`.
