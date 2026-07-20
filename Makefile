# Self-hosted Eve reference app — convenience targets.

PNPM ?= corepack pnpm

.PHONY: help db-up db-down db-migrate dev observe observe-web build clean \
		proof-isolation proof-self-host session

help:
	@echo "Targets:"
	@echo "  make db-up         Start Postgres (docker compose)"
	@echo "  make db-migrate    Create/upgrade the Workflow world schema (idempotent)"
	@echo "  make dev           Run the long-running host (eve dev --no-ui)"
	@echo "  make observe       List durable runs from Postgres (workflow inspect runs)"
	@echo "  make observe-web   Open the Workflow web UI against Postgres"
	@echo "  make build         Compile the agent (eve build)"
	@echo "  make session       Start a sample analysis session via curl"
	@echo "  make proof-isolation  Run the sandbox isolation proof"
	@echo "  make proof-self-host  Validate Eve discovery + self-host Compose"
	@echo "  make db-down       Stop Postgres"
	@echo "  make clean         Stop containers and remove build output"

db-up:
	docker compose up -d postgres

db-down:
	docker compose down

# Idempotent. Reads WORKFLOW_POSTGRES_URL from .env (loaded by the CLI's dotenv).
db-migrate:
	$(PNPM) run db:migrate

build:
	$(PNPM) run build:eve

# Development host. Production uses `eve build` + `eve start`; both hosts stop
# open sandbox compute on shutdown and preserve durable session state.
dev:
	@mkdir -p logs
	PORT=3000 $(PNPM) run dev:eve -- --logs all 2>&1 | tee logs/host.log

# Observability (replaces the Vercel Agent Runs dashboard).
# WORKFLOW_TARGET_WORLD in .env selects the Postgres backend by default.
observe:
	$(PNPM) exec workflow inspect runs --backend @workflow/world-postgres

observe-web:
	$(PNPM) exec workflow web --backend @workflow/world-postgres

# Start a representative movie analysis session against the running host.
session:
	@curl -s -X POST http://localhost:3000/eve/v1/session \
	  -H 'content-type: application/json' \
	  -d '{"message":"What year was Inception, and who directed it? Use run_python and cite the dataset result."}'
	@echo

# Isolation proof: run code in the sandbox that prints its container identity
# and shows the host-only secret is unreachable. See PROOF.md for details.
proof-isolation:
	@curl -s -X POST http://localhost:3000/eve/v1/session \
	  -H 'content-type: application/json' \
	  -d '{"message":"Using run_python, print socket.gethostname() and os.environ.get(\"HOST_ONLY_SECRET\", \"<unset in sandbox>\"). Then call urllib.request.urlopen(\"https://example.com\", timeout=3): print NETWORK_UNEXPECTEDLY_AVAILABLE if it succeeds, otherwise print NETWORK_BLOCKED:<exception class>. Report all three values verbatim."}'
	@echo

proof-self-host:
	$(PNPM) exec eve info --json
	docker compose config --quiet
	@echo "Self-host configuration is discoverable and Compose is valid."

clean:
	docker compose --profile observability down
	rm -rf .output .eve/nitro logs
