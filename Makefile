.PHONY: up down logs reset-db smoke

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail=200

reset-db:
	docker compose exec -T postgres psql -U $${POSTGRES_USER:-app} -d $${POSTGRES_DB:-capv2} -f /migrations/0001_init.sql

smoke:
	curl -sS -X POST http://localhost:3000/debug/smoke
