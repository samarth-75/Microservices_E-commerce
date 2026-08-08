# MEMORY.md — Project State

**Read this file first, before `PHASES.md` or any service code, at the start of
every session — regardless of which AI tool (Antigravity, Claude Code, Cursor,
etc.) is being used.** Update it last, before ending the session. This is the one
file every tool trusts to know "what's actually true right now" — code can be
half-written, but this file should always reflect the real current state.

Last updated: 2026-08-07 — Antigravity (Gemini agent)

---

## 1. Current phase

**Active phase:** Phase 1 — Auth Service *(Phase 0 complete)*
**Status:** Not started

## 2. Phase completion checklist

Mirrors `PHASES.md`. Mark `[x]` only when the Definition of Done in `AGENTS.md` is
fully met for everything in that phase — not just "code exists."

- [x] Phase 0 — Foundations (repo scaffold, docker-compose skeleton, gateway passthrough)
- [ ] Phase 1 — Auth Service
- [ ] Phase 2 — Catalog Service + Redis cache
- [ ] Phase 3 — Cart Service
- [ ] Phase 4 — Order + Inventory Services
- [ ] Phase 5 — Payment integration
- [ ] Phase 6 — Events, deployment, docs polish
- [ ] Stretch goals (Prometheus/Grafana, circuit breaker, DLQ, read replicas)

## 3. Service status

| Service | Status | Notes |
|---|---|---|
| API Gateway | done | Express, /health + /api/catalog/ping stub, Helmet, CORS, structured JSON logging, Dockerfile |
| Auth Service | not started | |
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

*(none yet — as each open question in `PRD.md` is resolved, record the decision
here with a one-line reason, then delete it from `PRD.md` §7)*

- Example format: *"Guest checkout: allowed, no login required until payment step
  — resolved Phase 3, keeps cart flow simpler and matches most real retailers."*

## 5. Known issues / blockers

*(none)*

## 6. What NOT to redo

Things already tried, decided against, or built and later reverted — so a new
agent session doesn't waste time re-litigating them.

- Phase 0 gateway uses a local stub route (`/api/catalog/ping`) instead of
  `http-proxy-middleware` because catalog-service doesn't exist yet. Replace the
  stub with a real proxy in Phase 2, don't re-debate whether to use a proxy now.

## 7. Next recommended action

"Start Phase 1: build the Auth Service with signup, login, JWT issue/refresh,
refresh token rotation, RBAC (Admin/Customer), bcrypt password hashing, and rate
limiting. Create `docs/auth.md` and `docs/security.md`."
