# PHASES.md — Build Order for CommerceSphere

Follow this order. Don't start a later phase until the previous one's Definition of
Done (see `AGENTS.md`) is met, unless explicitly told otherwise. Each phase should
end with the corresponding `INTERVIEW_NOTES.md` entries written.

## Phase 0 — Foundations (Day 1)
- Repo scaffolding per the layout in `AGENTS.md`.
- `docker-compose.yml` with Postgres, MongoDB, Redis, RabbitMQ (services empty for now).
- API Gateway skeleton with a single passthrough route to prove routing works.
- `docs/architecture.md` written (can mirror `Technical_Specification.md` §2–3).

## Phase 1 — Auth Service (Day 2)
- Signup, login, JWT issue, refresh token rotation, RBAC (`Admin`/`Customer`).
- bcrypt password hashing, rate limiting on auth routes.
- `docs/auth.md` + `docs/security.md` started.

## Phase 2 — Catalog Service + Redis cache (Day 3)
- CRUD for products/categories, pagination, filtering, basic search.
- Image upload to Cloudinary/S3 (or local disk in dev, documented as a stand-in for CDN).
- Cache-aside implementation for product list/details/categories.
- `docs/catalog.md` + `docs/caching.md`.

## Phase 3 — Cart Service (Day 4)
- Add/remove/update quantity, guest cart, merge into user cart on login.
- Redis-backed with TTL.
- `docs/cart.md`.

## Phase 4 — Order + Inventory Services (Day 5)
- Order creation from cart, status lifecycle, RabbitMQ `ORDER_CREATED` event.
- Inventory reservation consumer, stock decrement, failure event.
- `docs/orders.md` + `docs/messaging.md`.

## Phase 5 — Payment integration (Day 6)
- Razorpay/Stripe sandbox checkout, webhook verification, idempotent charge handling.
- Order becomes immutable on `PAID`.
- `docs/payments.md`.

## Phase 6 — Events, deployment, docs polish (Day 7)
- Notification Service + Analytics Service wired as queue consumers.
- Full `docker-compose.yml` bring-up tested end to end.
- GitHub Actions CI.
- README with architecture diagram, setup instructions, resume bullet points.
- `docs/deployment.md`, `docs/interview-qa.md` finalized.
- Full pass through `INTERVIEW_NOTES.md` — make sure every phase has an entry.

## Stretch (only after Phase 6 is solid)
- Prometheus + Grafana dashboard.
- Circuit breaker between Order → Payment.
- Dead-letter queue for the RabbitMQ consumers.
- Read replica setup for Catalog/Analytics.
