# Convenience wrapper around the steve deployment playbooks.
#
# Prereqs:
#   export DO_API_TOKEN=dop_v1_...      # DigitalOcean API token
#   a populated ../.env                 # copied to the droplet as runtime env
# Optional deploy-time auth (see README.md; demo values in ../.env.example):
#   export BESZEL_AGENT_TOKEN=...                 # Beszel agent token (from the hub)
#   export JAEGER_BASIC_AUTH_USER=eve             # Jaeger UI Basic auth user
#   export JAEGER_BASIC_AUTH_HASH='$2a$14$...'    # Jaeger UI Basic auth bcrypt hash
#
# Typical first run:  make deps && make provision && make bootstrap && make deploy
# Redeploy new code:  make deploy   (optionally: make deploy REF=my-branch)

ANSIBLE        ?= ansible-playbook
COLLECTIONS_DIR ?= ./.galaxy
REF            ?=
# Pass `make deploy REF=<git ref>` to deploy a specific branch/tag/SHA.
EXTRA          := $(if $(REF),-e git_ref=$(REF),)

# Deploy SSH key. Use IdentitiesOnly so a loaded ssh-agent (e.g. corp keys)
# doesn't exhaust auth attempts before this key is tried.
SSH_KEY        ?= ~/.ssh/steve_deploy
SSH            := ssh -i $(SSH_KEY) -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new

export ANSIBLE_COLLECTIONS_PATH := $(COLLECTIONS_DIR)

.PHONY: help deps provision bootstrap deploy redeploy all ssh status logs web-logs check demo-kill demo-restart demo-events destroy-hint

help:
	@echo "Targets:"
	@echo "  make deps        Install required Ansible collections (-> .galaxy)"
	@echo "  make provision   Create the DigitalOcean droplet (needs DO_API_TOKEN)"
	@echo "  make bootstrap   One-time security hardening on the droplet"
	@echo "  make deploy      Deploy / redeploy the app (REF=<git ref> optional)"
	@echo "  make all         provision -> bootstrap -> deploy"
	@echo "  make check       Syntax-check all playbooks"
	@echo "  make ssh         SSH into the droplet as the deploy user"
	@echo "  make status      Show service + container status on the droplet"
	@echo "  make logs        Tail the steve (agent) logs on the droplet"
	@echo "  make web-logs    Tail the steve-web (UI) logs on the droplet"
	@echo "  make demo-kill   Kill the agent mid-run (durability demo; see DEMO.md)"
	@echo "  make demo-events Show the durable event-log proof"
	@echo "  make demo-restart  Restart the agent cleanly"
	@echo "  make destroy-hint  How to tear the droplet down"

deps:
	ansible-galaxy collection install -r requirements.yml -p $(COLLECTIONS_DIR)

provision:
	$(ANSIBLE) -i localhost, provision.yml

bootstrap:
	$(ANSIBLE) bootstrap.yml

deploy:
	$(ANSIBLE) deploy.yml $(EXTRA)

# Alias for clarity.
redeploy: deploy

all: provision bootstrap deploy

check:
	@for pb in provision.yml bootstrap.yml deploy.yml; do \
	  echo "=== $$pb ==="; $(ANSIBLE) --syntax-check $$pb; \
	done

# --- droplet operations (read IP from the generated inventory) -------------
IP = $(shell awk '/^\[steve\]/{getline; print $$1; exit}' inventory.ini 2>/dev/null)

ssh:
	@test -n "$(IP)" || { echo "No droplet IP. Run 'make provision' first."; exit 1; }
	$(SSH) deploy@$(IP)

status:
	@test -n "$(IP)" || { echo "No droplet IP. Run 'make provision' first."; exit 1; }
	$(SSH) deploy@$(IP) 'systemctl status steve steve-web --no-pager; echo; docker ps --format "table {{.Names}}\t{{.Status}}"'

logs:
	@test -n "$(IP)" || { echo "No droplet IP. Run 'make provision' first."; exit 1; }
	$(SSH) deploy@$(IP) 'journalctl -u steve -f'

web-logs:
	@test -n "$(IP)" || { echo "No droplet IP. Run 'make provision' first."; exit 1; }
	$(SSH) deploy@$(IP) 'journalctl -u steve-web -f'

# --- demo helpers (see ../DEMO.md) -----------------------------------------
# Hard-kill the eve agent mid-run to demonstrate durable resume. systemd
# (Restart=always) brings it right back; the in-flight run resumes from the
# Postgres event log without re-running completed steps.
demo-kill:
	@test -n "$(IP)" || { echo "No droplet IP."; exit 1; }
	@$(SSH) deploy@$(IP) 'sudo pkill -9 -f "eve dev"; true' >/dev/null 2>&1 || true
	@echo "SIGKILLed the eve host. systemd (Restart=always) will bring it back;"
	@echo "the in-flight run resumes from Postgres. Watch the UI, then: make demo-events"

demo-restart:
	@test -n "$(IP)" || { echo "No droplet IP."; exit 1; }
	$(SSH) deploy@$(IP) 'sudo systemctl restart steve && echo restarted'

# Show the durable event-log proof: per-type event counts + run statuses.
# step_started == step_completed means no completed step was re-run on resume.
demo-events:
	@test -n "$(IP)" || { echo "No droplet IP."; exit 1; }
	$(SSH) deploy@$(IP) 'docker exec steve-postgres psql -U world -d world \
	  -c "select type, count(*) from workflow.workflow_events group by type order by 2 desc;" \
	  -c "select status, count(*) from workflow.workflow_runs group by status;"'

destroy-hint:
	@echo "Destroy the droplet from the DigitalOcean dashboard, or set"
	@echo "state: absent in roles/provision/tasks/main.yml and re-run provision."
	@echo "Then delete inventory.ini."
