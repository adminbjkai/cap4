.PHONY: up down logs reset-db smoke

# Canonical docker compose project name.
# Override: `make PROJECT=cap3-staging up`
PROJECT ?= cap3

up:
	docker compose -p $(PROJECT) up -d --build

down:
	docker compose -p $(PROJECT) down

logs:
	docker compose -p $(PROJECT) logs -f --tail=200

reset-db:
	for f in $$(docker compose -p $(PROJECT) exec -T postgres sh -lc 'ls /migrations/*.sql | sort'); do \
		docker compose -p $(PROJECT) exec -T postgres psql -U $${POSTGRES_USER:-app} -d $${POSTGRES_DB:-cap3} -f $$f; \
	done
setup: up
	@echo "Waiting for services to be healthy..."
	@until [ "$$(docker compose -p $(PROJECT) ps -q web-api)" ] && [ "$$(docker inspect $$(docker compose -p $(PROJECT) ps -q web-api) --format='{{.State.Health.Status}}')" = "healthy" ]; do \
		echo "Waiting for web-api..."; \
		sleep 2; \
	done
	$(MAKE) PROJECT=$(PROJECT) reset-db
	@echo "Setup complete! UI at http://localhost:8022"

prune:
	docker compose -p $(PROJECT) down -v --remove-orphans
	docker builder prune -f

smoke:
	curl -sS -X POST http://localhost:3000/debug/smoke
