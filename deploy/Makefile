# Convenience wrapper around the steve deployment playbooks.
#
# Prereqs:
#   export DO_API_TOKEN=dop_v1_...      # DigitalOcean API token
#   a populated ../.env                 # copied to the droplet as runtime env
#
# Typical first run:  make deps && make provision && make bootstrap && make deploy
# Redeploy new code:  make deploy   (optionally: make deploy REF=my-branch)

ANSIBLE        ?= ansible-playbook
COLLECTIONS_DIR ?= ./.galaxy
REF            ?=
# Pass `make deploy REF=<git ref>` to deploy a specific branch/tag/SHA.
EXTRA          := $(if $(REF),-e git_ref=$(REF),)

export ANSIBLE_COLLECTIONS_PATH := $(COLLECTIONS_DIR)

.PHONY: help deps provision bootstrap deploy redeploy all ssh status logs check destroy-hint

help:
	@echo "Targets:"
	@echo "  make deps        Install required Ansible collections (-> .galaxy)"
	@echo "  make provision   Create the DigitalOcean droplet (needs DO_API_TOKEN)"
	@echo "  make bootstrap   One-time security hardening on the droplet"
	@echo "  make deploy      Deploy / redeploy the app (REF=<git ref> optional)"
	@echo "  make all         provision -> bootstrap -> deploy"
	@echo "  make check       Syntax-check all playbooks"
	@echo "  make ssh         SSH into the droplet as the deploy user"
	@echo "  make status      Show the steve service status on the droplet"
	@echo "  make logs        Tail the steve service logs on the droplet"
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
	ssh deploy@$(IP)

status:
	@test -n "$(IP)" || { echo "No droplet IP. Run 'make provision' first."; exit 1; }
	ssh deploy@$(IP) 'systemctl status steve --no-pager'

logs:
	@test -n "$(IP)" || { echo "No droplet IP. Run 'make provision' first."; exit 1; }
	ssh deploy@$(IP) 'journalctl -u steve -f'

destroy-hint:
	@echo "Destroy the droplet from the DigitalOcean dashboard, or set"
	@echo "state: absent in roles/provision/tasks/main.yml and re-run provision."
	@echo "Then delete inventory.ini."
