# AGENTS.md — CommerceSphere

Standing instructions for any Antigravity agent working in this repo.
Read this file before planning or writing any code. If `Technical_Specification.md`
and this file ever disagree on a *decision*, treat `Technical_Specification.md` as the
source of truth for architecture and this file as the source of truth for process/standards.

## What we're building

**CommerceSphere** — a cloud-native, microservices e-commerce platform built as a
final-year BE Computer Science resume/interview project. The goal is not "ship a
store", the goal is "demonstrate backend architecture, distributed systems, and
system-design thinking in a way that survives a 15-minute technical interview."
Every feature should be simple to build but rich to *explain*.

Full service breakdown, tech stack, and data flows live in `Technical_Specification.md`.
The product "why/who/scope" — target user, in/out of scope, success criteria — lives
in `PRD.md`. Read both before planning; if a request falls outside `PRD.md`'s scope
section, say so rather than building it silently.

## Operating rules for the agent

0. **Read `MEMORY.md` first, every session, before anything else.** It's the single
   source of truth for what's actually done vs. still pending — trust it over
   guessing from the code. Update it last, before ending the session: current
   phase, service status table, any newly resolved decisions, any blockers, and
   the "next recommended action" line. This applies no matter which AI tool
   (Antigravity, Claude Code, Cursor, etc.) is running the session — it's the
   hand-off file between all of them.
1. **Plan before you build.** For any new service or feature, first update
   `Technical_Specification.md` (or the relevant `docs/<service>.md` file) with the
   design, then implement it. Don't write code the docs don't describe.
2. **One service, one PR-sized unit of work.** Don't sprawl changes across multiple
   services in one pass unless the task is explicitly cross-cutting (e.g. shared
   `docker-compose.yml`, API Gateway routing).
3. **After finishing any feature, append an entry to `INTERVIEW_NOTES.md`** — see the
   template inside that file. This is not optional. It is the primary deliverable
   alongside the code, because it's what makes the project defensible in interviews.
4. **Follow the phased order in `PHASES.md`.** Don't jump ahead to Payments before
   Auth + Catalog exist, etc., unless explicitly told to.
5. **Prefer boring, explainable choices over clever ones.** If there are two ways to
   implement something, pick the one that's easier to describe in one paragraph out
   loud, not the one that saves the most lines of code.
6. **Every service must have a `/health` endpoint** and structured JSON logging with
   a request ID, from the first commit — not bolted on later.
7. **Never commit secrets.** All credentials via `.env` files (gitignored); commit
   `.env.example` with placeholder values only.
8. **Ask before**: adding a new top-level dependency that isn't in the tech stack
   below, changing the database-per-service pattern, or changing the messaging
   broker choice (RabbitMQ).

## Tech stack (do not substitute without asking)

| Layer | Choice |
|---|---|
| Frontend | React (Vite) + Redux Toolkit + Tailwind |
| API Gateway | Express Gateway or NGINX |
| Backend services | Node.js + Express (NestJS acceptable for cleaner DI if agent prefers) |
| Relational data (orders, payments) | PostgreSQL |
| Document data (catalog) | MongoDB |
| Cache / sessions / cart | Redis |
| Messaging | RabbitMQ |
| Auth | JWT access + refresh token rotation, RBAC |
| Payments | Razorpay or Stripe **sandbox only** |
| Containers | Docker + Docker Compose |
| CI/CD | GitHub Actions |
| Monitoring (stretch) | Prometheus + Grafana |
| Logging | Winston or Pino, structured JSON, request-ID correlated |

## Coding standards

- JavaScript/TypeScript, Node 20+. TypeScript preferred for new services if the agent
  can keep velocity up; plain JS is acceptable to stay on schedule — consistency
  within a service matters more than TS-everywhere.
- Input validation on every endpoint (Zod or Joi).
- Parameterized queries / ORM only — no raw string-concatenated SQL.
- Each service owns its own database. No service reaches into another service's DB.
- Sync communication = REST. Cross-service events = RabbitMQ. Don't use REST for
  things that should be eventually consistent (e.g. inventory reservation after
  order creation).
- Idempotency keys required on the Payment Service's webhook handler and charge
  endpoint.

## Repo layout (create if missing)

```
/services
  /auth-service
  /user-service
  /catalog-service
  /cart-service
  /order-service
  /payment-service
  /inventory-service
  /notification-service
  /analytics-service
/gateway
/frontend
/docs
  architecture.md
  auth.md
  catalog.md
  cart.md
  orders.md
  payments.md
  caching.md
  messaging.md
  deployment.md
  security.md
  interview-qa.md
docker-compose.yml
AGENTS.md
MEMORY.md
PRD.md
Technical_Specification.md
PHASES.md
INTERVIEW_NOTES.md
```

## Definition of done (per service)

- [ ] `/health` endpoint returns 200 with uptime + dependency status
- [ ] Structured logs with request ID
- [ ] Input validation on all routes
- [ ] Dockerfile + entry in `docker-compose.yml`
- [ ] Corresponding `docs/<service>.md` written
- [ ] `INTERVIEW_NOTES.md` entry added
- [ ] Basic tests for the happy path and one failure path
