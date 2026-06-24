# Self-hosted eve PoC — convenience targets.
# Everything here runs without any Vercel service.

.PHONY: help db-up db-down db-migrate dev observe observe-web build clean \
        proof-isolation proof-novercel session logs-up logs-down

help:
	@echo "Targets:"
	@echo "  make db-up         Start Postgres (docker compose)"
	@echo "  make db-migrate    Create/upgrade the Workflow world schema (idempotent)"
	@echo "  make dev           Run the long-running host (eve dev --no-ui)"
	@echo "  make observe       List durable runs from Postgres (workflow inspect runs)"
	@echo "  make observe-web   Open the Workflow web UI against Postgres"
	@echo "  make logs-up       Ship host console logs to Axiom via Vector"
	@echo "  make logs-down     Stop the Vector log shipper"
	@echo "  make build         Compile the agent (eve build)"
	@echo "  make session       Start a sample analysis session via curl"
	@echo "  make proof-isolation  Run the sandbox isolation proof"
	@echo "  make proof-novercel   Grep the project for Vercel coupling"
	@echo "  make db-down       Stop Postgres"
	@echo "  make clean         Stop containers and remove build output"

db-up:
	docker compose up -d postgres

db-down:
	docker compose down

# Idempotent. Reads WORKFLOW_POSTGRES_URL from .env (loaded by the CLI's dotenv).
db-migrate:
	pnpm exec workflow-postgres-setup

build:
	pnpm exec eve build

# The long-running host. IMPORTANT: use `eve dev --no-ui`, NOT `eve start`.
# In eve 0.13.3 only the dev host registers the configured world's queue
# handler; `eve start` returns "Unhandled queue". See _internal/ISSUES.md.
# Logs are tee'd to ./logs/host.log so the optional Vector sidecar can ship
# them to Axiom while you still see them in the terminal.
dev:
	@mkdir -p logs
	PORT=3000 pnpm exec eve dev --no-ui --host 0.0.0.0 --logs all 2>&1 | tee logs/host.log

# Observability (replaces the Vercel Agent Runs dashboard).
# WORKFLOW_TARGET_WORLD in .env selects the Postgres backend by default.
observe:
	pnpm exec workflow inspect runs --backend @workflow/world-postgres

observe-web:
	pnpm exec workflow web --backend @workflow/world-postgres

# Ship the eve host's console logs to Axiom via Vector (reads ./logs/host.log).
# Requires AXIOM_TOKEN in .env. Run `make dev` in another terminal first.
logs-up:
	docker compose --profile logs up -d vector

logs-down:
	docker compose --profile logs down

# Start a sample three-step analysis session against the running host.
session:
	@curl -s -X POST http://localhost:3000/eve/v1/session \
	  -H 'content-type: application/json' \
	  -d '{"message":"Run a sales analysis: generate a synthetic dataset CSV in the sandbox, compute summary statistics, and give me a short written summary."}'
	@echo

# Isolation proof: run code in the sandbox that prints its container identity
# and shows the host-only secret is unreachable. See PROOF.md for details.
proof-isolation:
	@curl -s -X POST http://localhost:3000/eve/v1/session \
	  -H 'content-type: application/json' \
	  -d '{"message":"Using run_python, print socket.gethostname() and os.environ.get(\"HOST_ONLY_SECRET\", \"<unset in sandbox>\"). Report both verbatim."}'
	@echo

# No-Vercel proof: fail if any forbidden Vercel coupling is ACTIVE in source.
# Scans authored code + the real .env (not .env.example, which intentionally
# lists the forbidden vars as commented "do not set" examples). Comment lines
# are ignored so documentation of the forbidden list does not trip the check.
proof-novercel:
	@echo "Scanning authored source + .env for ACTIVE Vercel coupling..."
	@matches=$$(grep -RInE "vercel\(\)|vercelOidc\(|AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN|vercel deploy|@vercel/otel" \
	  agent .env 2>/dev/null | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(#|//|\*)" || true); \
	if [ -n "$$matches" ]; then \
	  echo "$$matches"; echo "FOUND active Vercel coupling above."; exit 1; \
	else \
	  echo "CLEAN: no active Vercel coupling in agent/ or .env."; \
	fi

clean:
	docker compose --profile observability --profile logs down
	rm -rf .output .eve/nitro logs
