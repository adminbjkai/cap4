# Database Migrations

The canonical schema migration is `db/migrations/0001_init.sql`.

## Apply migration locally (Docker)

```bash
docker compose up -d postgres
docker compose exec -T postgres psql -U ${POSTGRES_USER:-app} -d ${POSTGRES_DB:-capv2} -f /migrations/0001_init.sql
```

## Reset and re-apply from scratch

```bash
docker compose down -v
docker compose up -d postgres
docker compose exec -T postgres psql -U ${POSTGRES_USER:-app} -d ${POSTGRES_DB:-capv2} -f /migrations/0001_init.sql
```

## Verify

```bash
docker compose exec -T postgres psql -U ${POSTGRES_USER:-app} -d ${POSTGRES_DB:-capv2} -c "\\dt"
```
