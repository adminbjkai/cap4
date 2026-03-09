# Database Migrations

Apply migrations in lexical order from `db/migrations`.

## Apply migration locally (Docker)

```bash
docker compose up -d postgres
for f in /migrations/*.sql; do
  docker compose exec -T postgres psql -U ${POSTGRES_USER:-app} -d ${POSTGRES_DB:-cap4} -f "$f"
done
```

## Reset and re-apply from scratch

```bash
docker compose down -v
docker compose up -d postgres
for f in /migrations/*.sql; do
  docker compose exec -T postgres psql -U ${POSTGRES_USER:-app} -d ${POSTGRES_DB:-cap4} -f "$f"
done
```

## Verify

```bash
docker compose exec -T postgres psql -U ${POSTGRES_USER:-app} -d ${POSTGRES_DB:-cap4} -c "\\dt"
```
