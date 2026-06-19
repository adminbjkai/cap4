.PHONY: up down logs migrate reset-db smoke prune

# Canonical docker compose project name.
# Override: `make PROJECT=cap4-staging up`
PROJECT ?= cap4

# Host port the web-internal nginx binds (must match PORT in .env).
# The hardened stack does NOT publish the web-api container (:3000) to the host;
# everything is reached through nginx on this port. Override: `make PORT=8007 smoke`
PORT ?= 8007

# Start all services. Migrations run automatically via the 'migrate' service.
up:
	docker compose -p $(PROJECT) up -d --build

# Stop all services (preserves volumes / data).
down:
	docker compose -p $(PROJECT) down

# Follow logs for all services.
logs:
	docker compose -p $(PROJECT) logs -f --tail=200

# Re-run the migration runner against the running database.
# Useful after adding a new migration file without a full restart.
migrate:
	docker compose -p $(PROJECT) run --rm migrate

# Hard-reset: wipe volumes and restart from scratch.
# Migrations run automatically on fresh startup — no manual SQL needed.
reset-db:
	docker compose -p $(PROJECT) down -v
	docker compose -p $(PROJECT) up -d --build

# Run the smoke test (requires services to be up and healthy).
# /debug/smoke is only registered in non-production builds (NODE_ENV != production).
# The prod stack uses /health and /ready as the canonical liveness checks, reached
# through the nginx host port (PORT), which proxies them to web-api.
smoke:
	@echo "--- /health ---" && curl -fsS http://localhost:$(PORT)/health
	@echo "--- /ready ---"  && curl -fsS http://localhost:$(PORT)/ready
	@echo "\nSmoke passed."

# Remove containers, volumes, and dangling build cache.
prune:
	docker compose -p $(PROJECT) down -v --remove-orphans
	docker builder prune -f
