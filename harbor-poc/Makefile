.PHONY: help build simulate verify clean install-harbor task-shell

help: ## Show this help message
	@echo "Harbor POC - Available Commands"
	@echo "================================"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: ## Build all Docker images
	docker compose build

simulate: build ## Run full trial simulation (buggy → fix → verify)
	docker compose --profile simulate up --abort-on-container-exit task-simulator
	docker compose --profile simulate down

verify: ## Run verifier only (after manually editing the task workspace)
	docker compose --profile verify up --abort-on-container-exit verifier
	docker compose --profile verify down

task-shell: ## Open an interactive shell in the task environment
	docker run --rm -it \
		-v $(PWD)/tasks/hello-python/tests:/tests:ro \
		-v $(PWD)/tasks/hello-python/solution:/solution:ro \
		$$(docker build -q ./tasks/hello-python/environment) \
		/bin/bash

install-harbor: ## Install harbor CLI locally (requires Python 3.11+)
	pip install harbor

harbor-help: ## Show harbor CLI help (requires harbor installed)
	harbor --help

clean: ## Remove all containers and volumes
	docker compose down -v --remove-orphans
	docker rmi harbor-poc-harbor-runner harbor-poc-task-simulator harbor-poc-verifier 2>/dev/null || true

logs: ## Show logs from last run
	docker compose logs
