# MEMORY.md — Project State

**Read this file first, before `PHASES.md` or any service code, at the start of
every session — regardless of which AI tool (Antigravity, Claude Code, Cursor,
etc.) is being used.** Update it last, before ending the session. This is the one
file every tool trusts to know "what's actually true right now" — code can be
half-written, but this file should always reflect the real current state.

Last updated: 2026-08-25 — Antigravity (Claude Opus 4.6 Thinking)

---

## 1. Current phase

**Active phase:** Phase 3 — Cart Service *(Phases 0–2 complete)*
**Status:** Not started

## 2. Phase completion checklist

Mirrors `PHASES.md`. Mark `[x]` only when the Definition of Done in `AGENTS.md` is
fully met for everything in that phase — not just "code exists."

- [x] Phase 0 — Foundations (repo scaffold, docker-compose skeleton, gateway passthrough)
- [x] Phase 1 — Auth Service
- [x] Phase 2 — Catalog Service + Redis cache
- [ ] Phase 3 — Cart Service
- [ ] Phase 4 — Order + Inventory Services
- [ ] Phase 5 — Payment integration
- [ ] Phase 6 — Events, deployment, docs polish
- [ ] Stretch goals (Prometheus/Grafana, circuit breaker, DLQ, read replicas)

## 3. Service status

| Service | Status | Notes |
|---|---|---|
| API Gateway | done | Express, /health, Helmet, CORS, structured JSON logging, proxies /api/auth/* → auth-service:3001, proxies /api/catalog/* → catalog-service:3002, Dockerfile |
| Auth Service | done | Signup, login, JWT access+refresh rotation, RBAC (admin/customer), bcrypt, rate limiting (10/15min), Joi validation, /health with DB status, Sequelize+Postgres, Dockerfile |
| Catalog Service | done | Products CRUD (pagination, filtering, sorting, full-text search), Categories CRUD (auto-slug, parent nesting), MongoDB+Mongoose, Redis cache-aside (5min/30min/1hr TTLs), image upload (multer, local disk), Joi validation, JWT auth for admin routes, /health with MongoDB+Redis status, Dockerfile |
| User Service | not started | |
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
- **Catalog ODM: Mongoose** — provides schema validation, middleware hooks, and population.
  Raw MongoDB driver would be faster but harder to explain and maintain. Resolved Phase 2.
- **Search strategy: MongoDB text index** — basic full-text search on name + description
  with weighted relevance scoring. No typo tolerance. Upgrade path documented as
  Elasticsearch/Atlas Search. Resolved Phase 2 (PRD.md §7 question answered: "no" to
  typo tolerance unless time allows).
- **Image upload: local disk (dev stand-in)** — multer to `uploads/products/` with UUID
  filenames. Documented as production CDN/S3 stand-in. Docker volume for persistence.
  Resolved Phase 2.
- **Category hierarchy: single-level nesting** — optional `parentCategory` reference.
  Flat for now, extensible later. Resolved Phase 2.

## 5. Known issues / blockers

*(none)*

## 6. What NOT to redo

Things already tried, decided against, or built and later reverted — so a new
agent session doesn't waste time re-litigating them.

- Phase 0 gateway uses a local stub route (`/api/catalog/ping`) instead of
  `http-proxy-middleware` because catalog-service doesn't exist yet. Replace the
  stub with a real proxy in Phase 2, don't re-debate whether to use a proxy now.
  **UPDATE Phase 2: stub removed, real proxy to catalog-service:3002 is live.**
- Gateway now uses `http-proxy-middleware` for auth (`/api/auth/*` → auth-service:3001)
  AND catalog (`/api/catalog/*` → catalog-service:3002).
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
- Catalog service auth middleware duplicates JWT verification logic from auth-service
  intentionally. Each service validates tokens independently — no shared npm library.
  This is a deliberate trade-off: slight duplication vs. coupling. See
  `services/catalog-service/src/middleware/authenticate.js` for the rationale.
- Cache operations are all wrapped in try/catch with error swallowing. Redis failure
  degrades to slower DB reads, never crashes the service. Don't add `throw` to cache
  helpers — graceful degradation is the design goal.

## 7. Next recommended action

"Start Phase 3: build the Cart Service with Redis-backed storage, add/remove/update
quantity, guest cart with TTL, merge guest cart into user cart on login, and create
`docs/cart.md`."
