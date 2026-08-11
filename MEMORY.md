# MEMORY.md — Project State

**Read this file first, before `PHASES.md` or any service code, at the start of
every session — regardless of which AI tool (Antigravity, Claude Code, Cursor,
etc.) is being used.** Update it last, before ending the session. This is the one
file every tool trusts to know "what's actually true right now" — code can be
half-written, but this file should always reflect the real current state.

Last updated: 2026-08-08 — Antigravity (Gemini agent)

---

## 1. Current phase

**Active phase:** Phase 2 — Catalog Service *(Phase 1 complete)*
**Status:** Not started

## 2. Phase completion checklist

Mirrors `PHASES.md`. Mark `[x]` only when the Definition of Done in `AGENTS.md` is
fully met for everything in that phase — not just "code exists."

- [x] Phase 0 — Foundations (repo scaffold, docker-compose skeleton, gateway passthrough)
- [x] Phase 1 — Auth Service
- [ ] Phase 2 — Catalog Service + Redis cache
- [ ] Phase 3 — Cart Service
- [ ] Phase 4 — Order + Inventory Services
- [ ] Phase 5 — Payment integration
- [ ] Phase 6 — Events, deployment, docs polish
- [ ] Stretch goals (Prometheus/Grafana, circuit breaker, DLQ, read replicas)

## 3. Service status

| Service | Status | Notes |
|---|---|---|
| API Gateway | done | Express, /health, Helmet, CORS, structured JSON logging, proxies /api/auth/* → auth-service:3001, Dockerfile |
| Auth Service | done | Signup, login, JWT access+refresh rotation, RBAC (admin/customer), bcrypt, rate limiting (10/15min), Joi validation, /health with DB status, Sequelize+Postgres, Dockerfile |
| User Service | not started | |
| Catalog Service | not started | |
| Cart Service | not started | |
| Order Service | not started | |
| Payment Service | not started | |
| Inventory Service | not started | |
| Notification Service | not started | |
| Analytics Service | not started | |
| Frontend | not started | |

Status values to use: `not started`, `in progress`, `done`, `blocked`.

## 4. Decisions resolved (moved out of PRD.md § 7 "Open questions" as they're settled)

- **ORM choice: Sequelize** — most popular Node.js ORM for Postgres, easy to explain
  in interviews. Prisma was considered but Sequelize's explicit model definitions make
  the code more readable for interviewers. Resolved Phase 1.
- **Refresh token storage: SHA-256 in Postgres** — tokens hashed with SHA-256 (not bcrypt)
  because they're high-entropy random strings, not human-chosen passwords. Stored in
  Postgres (not Redis) for auditability and simpler setup. Resolved Phase 1.
- **Database-per-service init: SQL init script** — `infra/postgres/init.sql` auto-creates
  per-service databases on first Postgres boot. Mounted via docker-entrypoint-initdb.d.
  Resolved Phase 1.

## 5. Known issues / blockers

*(none)*

## 6. What NOT to redo

Things already tried, decided against, or built and later reverted — so a new
agent session doesn't waste time re-litigating them.

- Phase 0 gateway uses a local stub route (`/api/catalog/ping`) instead of
  `http-proxy-middleware` because catalog-service doesn't exist yet. Replace the
  stub with a real proxy in Phase 2, don't re-debate whether to use a proxy now.
- Gateway now uses `http-proxy-middleware` for auth (`/api/auth/*` → auth-service:3001).
  This is the pattern to follow for all future services. Don't revert to stub routes.
- Auth service uses `sequelize.sync({ alter: true })` in dev for convenience.
  Don't switch to migrations until production deployment is a concern — sync is fine
  for the development workflow.
- Every service MUST have a `.dockerignore` that excludes `node_modules`. Without it,
  Windows-compiled native binaries (e.g. bcrypt) get copied into Alpine Linux containers
  via `COPY . .`, causing `ERR_DLOPEN_FAILED`. The Dockerfile's own `npm ci` produces
  correct Linux binaries — `.dockerignore` prevents overwriting them.
- Gateway proxy `pathRewrite` must use a function `(path) => /auth${path}`, NOT the
  regex form `{ '^/api/auth': '/auth' }`. When using `app.use('/api/auth', proxy)`,
  Express strips the mount path before the proxy sees it, so regex doesn't match.

## 7. Next recommended action

"Start Phase 2: build the Catalog Service with MongoDB, CRUD for products/categories,
pagination, filtering, basic search, image upload (local disk in dev), and Redis
cache-aside for product lists/details/categories. Create `docs/catalog.md` and
`docs/caching.md`."
