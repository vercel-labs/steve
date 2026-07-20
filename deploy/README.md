# Deploy Steve to DigitalOcean with Ansible

This directory provisions one Ubuntu host and installs the self-hosted Eve
reference stack. It is intended to make the runtime topology reproducible and
inspectable. It is not a high-availability or multi-tenant deployment design.

## Topology

```text
internet
  -> Caddy :80/:443
     -> /eve/* and /.well-known/workflow/* -> steve.service :3000
     -> all other app paths                -> steve-web.service :3001
     -> optional monitoring domain         -> Beszel :8090
     -> optional trace domain              -> Jaeger :16686

localhost only
  -> PostgreSQL :5544
  -> Jaeger OTLP/HTTP :4318
```

The Eve and Next.js processes run as an unprivileged systemd user. PostgreSQL,
Jaeger, Beszel, and Eve's per-session sandboxes run in Docker. The Eve service
belongs to the `docker` group so it can create sandbox containers; that group is
root-equivalent and should be treated accordingly.

## Prerequisites

- Ansible Core 2.19 or 2.20
- Node.js 24 on the operator machine (used to validate dotenv before upload)
- A DigitalOcean API token with permission to create droplets and SSH keys
- A dedicated SSH key at `~/.ssh/steve_deploy`
- A GitHub repository that the new host can read with a deploy key
- A completed repository-root `.env`

Create the operator key if needed:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/steve_deploy
```

Install the required collections:

```bash
cd deploy
make deps
```

## Configure the application

Create the runtime environment from the repository root:

```bash
cp .env.example .env
```

Set these before deploying:

- one funded model key: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`;
- strong `ROUTE_AUTH_BASIC_USER` and `ROUTE_AUTH_BASIC_PASSWORD` values;
- a strong `POSTGRES_PASSWORD` and matching encoded password in `WORKFLOW_POSTGRES_URL`;
- `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` if Jaeger is enabled.

`POSTGRES_PASSWORD` initializes only a new official Postgres volume. On an
existing volume, rotate the database role password inside PostgreSQL first,
then update both environment values. Changing only the Compose variable does
not alter an existing role and will make migrations fail authentication.

The app role copies this file to `/opt/steve/.env` with mode `0600`. For a
larger deployment, replace this reference mechanism with your secret manager or
Ansible Vault.

## Configure the host

Review `group_vars/all.yml` before provisioning. At minimum, check:

```yaml
do_region: "nyc3"
do_size: "s-2vcpu-4gb"
app_repo: "git@github.com:your-org/your-repo.git"
git_ref: "origin/main"

domain: "agent.example.com"
acme_email: "ops@example.com"
```

The 4 GB default allows PostgreSQL, the two Node services, a sandbox container,
and a Next.js build to coexist. The frontend role also creates a 2 GB swapfile.

Leave `domain` empty for the first IP-only smoke check. Do not enter Basic auth
credentials or send model data over that plain-HTTP endpoint. Configure DNS and
TLS before using the agent. Eve also rejects Basic auth at the channel when the
request was not forwarded over HTTPS.

For an existing deployment, `domain` must be set explicitly. The playbook
refuses to replace an existing HTTPS site with IP-only HTTP unless
`allow_plain_http_existing_deployment` is deliberately enabled.

## Operator secrets

Export the DigitalOcean token only in the shell running Ansible:

```bash
export DO_API_TOKEN="..."
```

Optional Beszel values:

```bash
export BESZEL_AGENT_TOKEN="..."
```

If `jaeger_domain` is non-empty, configure a Caddy-compatible bcrypt hash. The
trace site returns `503` rather than opening without authentication when the
hash is absent.

```bash
export JAEGER_BASIC_AUTH_USER="trace-reader"
export JAEGER_BASIC_AUTH_HASH="$(caddy hash-password --plaintext 'replace-me')"
```

Do not commit these values or place them in `.env.example`.

## Provision and deploy

Run the three phases separately the first time:

```bash
make provision
make bootstrap
make deploy
```

Or run them in sequence:

```bash
make all
```

The phases are deliberately separate:

1. `provision.yml` creates the droplet and writes `inventory.ini`.
2. `bootstrap.yml` creates the deploy user, locks down SSH, enables UFW, fail2ban, and unattended upgrades.
3. `deploy.yml` installs Docker and Node, clones the repository, installs dependencies, migrates PostgreSQL, builds both apps, and configures systemd and Caddy.

On the first deploy, Ansible prints a generated read-only GitHub deploy key and
pauses. Add that key to the repository without write access, then continue.

## DNS and TLS

Create an A record for `domain` pointing to the droplet. Add separate records
only for optional public monitoring or tracing domains. Then set the values in
`group_vars/all.yml` and rerun:

```bash
make deploy
```

Caddy obtains and renews TLS certificates automatically. It routes both Eve
prefixes in the domain and IP-only configurations:

```text
/eve/*
/.well-known/workflow/*
```

## Deployment checks

The playbook does not report success after health checks alone. It verifies:

- the public Eve health route returns `200`;
- a production-shaped `/eve/v1/info` request without credentials returns `401`;
- the Basic credentials in `.env` successfully reach `/eve/v1/info`;
- the Next.js root returns `200`.

Run a real model, sandbox, stream, and follow-up smoke test after TLS is active:

```bash
cd /opt/steve
set -a && . ./.env && set +a
SELF_HOST_URL="https://agent.example.com" \
SELF_HOST_EXPECT_AUTH=1 \
pnpm smoke:self-host
```

This sends four agent turns, including bounded cancellation and output checks. Tool loops
may require additional provider calls and incur model cost.

## Database migrations and backups

Before every schema migration, the app role writes a custom-format PostgreSQL
backup to:

```text
/opt/steve-backups/workflow-<timestamp>.dump
```

The role validates each dump before publishing it and retains the latest 10 by
default (`workflow_backup_retention`). Copy backups off the host; a backup on
the same droplet does not protect against host loss.

The upgrade to `@workflow/world-postgres@5.0.0-beta.27` adds migration `0015`,
which moves Workflow-owned enum types from `public` to the `workflow` schema.
Test the migration and session replay against a restored production copy before
upgrading a critical deployment.

There is an additional one-time Eve replay boundary. Active runs created before
Eve `0.20` diverged when replayed directly on the current Workflow runtime during
this repository's upgrade test. The app role records the last successful Eve
version and blocks that cutover when old runs are still `pending` or `running`.
Inspect them before deciding to cancel:

```bash
pnpm exec workflow inspect runs --status running --backend @workflow/world-postgres
pnpm exec workflow cancel --status running --confirm --backend @workflow/world-postgres
pnpm exec workflow cancel --status pending --confirm --backend @workflow/world-postgres
```

This guard applies only to the incompatible pre-`0.20` cutover. Compatible
sessions created on the current runtime remain active across ordinary restarts.

For rollback, stop `steve.service`, restore the selected dump with `pg_restore`
using PostgreSQL's documented procedure, deploy the known-good Git SHA, and then
start the service. Never restore over a running Eve worker.

## Operations

From the operator machine:

```bash
make status
make logs
make web-logs
make ssh
make deploy REF=<branch-tag-or-sha>
```

On the host:

```bash
systemctl status steve steve-web
journalctl -u steve -f
journalctl -u steve-web -f
docker ps
cd /opt/steve && pnpm observe
sudo ufw status
```

`eve start` receives `SIGTERM` during a normal systemd stop. Eve stops open
sandbox compute and reattaches durable sessions from their persisted state after
restart.

## Crash-recovery demo

Start a multi-step request, capture its Eve session ID, and hard-kill only the
main systemd process:

```bash
make demo-kill
make demo-events SESSION=<session-id>
```

`Restart=always` starts a new Eve process. The event query is scoped to the
selected session and its child runs; global event counts are not accepted as
proof of one session's recovery.

## Optional monitoring

Beszel is disabled by default. To enable it, set `monitoring_enabled: true`, a
`monitoring_domain`, `beszel_hub_url`, and the public key from Beszel's Add
System flow. Export its shared token separately.

Jaeger is enabled internally by default and binds its UI and OTLP receiver to
loopback. Leave `jaeger_domain` empty to access it through an SSH tunnel. If you
publish it, Basic auth is mandatory because traces may contain operational
metadata even when prompt and output recording are disabled.

## Redeploy and teardown

Redeploy a known ref with:

```bash
make deploy REF=<git-ref>
```

Destroy the droplet through the DigitalOcean dashboard or API, then remove the
generated `inventory.ini`. The provision role does not implement deletion, so
it must not be invoked with an undocumented `state: absent` assumption.
