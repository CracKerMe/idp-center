# idp-center Helm chart

Skeleton chart for the phase 4.4 rollout in `ENTERPRISE-OAUTH-ANALYSIS-COMPLETE.md`.

## Prerequisites (do not skip)

Multi-replica deployment is only correct once phases 4.1–4.3 are live:

- **4.1** — schema is applied via `pnpm db:migrate` against `drizzle/*.sql`, not
  `drizzle-kit push`. The `db-migrate` initContainer runs this before the app starts;
  `server/database.ts`'s `initDatabase()` skips the push itself when `NODE_ENV=production`.
- **4.2** — `REDIS_URL` must be set (`secret.values.REDIS_URL`), or every replica gets its
  own rate-limit budget and its own signing-key cache instead of a shared one.
- **4.3** — the scheduler (`server/jobs/scheduler.ts`) uses PG advisory locks for leader
  election, so cleanup/key-rotation/UEBA jobs run exactly once across replicas — no extra
  chart-level configuration needed here, it Just Works once every replica points at the same
  PG.

## Install

```bash
helm install idp-center ./deploy/helm/idp-center \
  --set image.repository=ghcr.io/you/idp-center \
  --set image.tag=1.0.0 \
  --set-string secret.values.JWT_SECRET="$(openssl rand -hex 32)" \
  --set-string secret.values.ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  --set-string secret.values.DATABASE_URL="postgres://..." \
  --set-string secret.values.REDIS_URL="redis://..."
```

Prefer `secret.existingSecret` pointing at a Secret created by an external-secrets operator
over passing raw values on the CLI in any real environment — `--set-string secret.values.*`
is for local/dev clusters only.
