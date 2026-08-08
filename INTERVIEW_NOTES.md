# INTERVIEW_NOTES.md

Purpose: this file is the reason the project holds up in an interview. Every time a
feature is finished, add an entry using the template below — problem, design
choice, flow, code pointer, trade-off, likely question. Keep entries short (this is
a cheat sheet you'll re-read before an interview, not documentation).

**Agent instruction**: append an entry here immediately after finishing any feature
in the Definition of Done sense (see `AGENTS.md`). Don't wait until the end of a phase.

---

## Entry template (copy this per feature)

### <Feature name> — <service>

| Field | Notes |
|---|---|
| Problem | What need/pain this feature addresses |
| Design choice | What you built and why this approach over alternatives |
| Flow | One-line request/data flow, e.g. Request → Cache → DB |
| Code pointer | File(s)/function(s) to open if asked to show it live |
| Trade-off | What you gave up for simplicity/time, and what the "real" version would do |
| Likely question | The question an interviewer would ask about this specific feature |

---

## Pre-loaded interview questions (be ready with a ~2 minute answer for each)

General architecture:
- Why microservices instead of a monolith for a project this size?
- How do services communicate with each other?
- What happens if the Payment Service goes down mid-checkout?
- Explain eventual consistency using this project as the example.
- Why a separate database per service instead of one shared database?

Caching:
- How does the Redis caching layer work here (cache-aside, step by step)?
- What is cache invalidation, and how do you handle it on product updates?
- What is cache stampede, and does this design have that risk?

Messaging / events:
- Walk me through what happens, service by service, when an order is placed.
- What is a dead-letter queue, and where would you add one here?
- What's the difference between using REST vs. RabbitMQ for a given interaction,
  and how did you decide which to use where?

Payments:
- How do you prevent duplicate charges when a payment request is retried?
- Why is the order made immutable after payment succeeds?
- How do you verify a payment webhook is actually from the provider?

Security:
- Why refresh tokens instead of just long-lived access tokens?
- How is inter-service communication secured?
- Where in the codebase do you validate input, and what would happen without it?

Scaling:
- Catalog traffic is much higher than payment traffic — how does the design reflect that?
- How would you scale the Catalog Service to handle 1 million users?
- What's the difference between horizontal and vertical scaling, applied to this project?

---

## Resume bullet points (final)

- Designed and developed a cloud-native microservices e-commerce platform with 8+
  independent services using Node.js, Express, PostgreSQL, MongoDB, Redis, and
  RabbitMQ.
- Implemented JWT authentication, refresh token rotation, and role-based access
  control for secure multi-user access.
- Integrated Redis caching for product catalog and cart services, reducing average
  API response time significantly.
- Built an event-driven order workflow using RabbitMQ with asynchronous inventory
  reservation and notification processing.
- Integrated Razorpay/Stripe payment gateway with webhook verification and
  idempotent payment handling.
- Containerized all services using Docker and configured CI/CD with GitHub Actions
  for automated build and deployment.

---

## Feature log

### Repo Scaffolding & Database-per-Service — Phase 0

| Field | Notes |
|---|---|
| Problem | Need a mono-repo structure that enforces service isolation from the start — no service should accidentally share code or DB access with another. |
| Design choice | One `services/<name>` folder per service, each owning its own DB. Mono-repo (not poly-repo) so cross-cutting concerns like `docker-compose.yml` and shared docs live in one place, but each service can have independent dependencies and Dockerfiles. |
| Flow | N/A (structural, not a request flow) |
| Code pointer | Root directory tree, `docker-compose.yml` (volumes section — one named volume per DB), `docs/architecture.md` §"Database-per-Service Pattern" |
| Trade-off | Mono-repo means a single `git clone`, which is simpler for a portfolio project. In a real org, poly-repos with a service registry would give better CI isolation and team ownership boundaries. |
| Likely question | "Why microservices for a project this size?" → To demonstrate the architecture pattern. A monolith would be simpler to build but wouldn't show distributed-systems thinking (service isolation, async events, independent deployment). |

---

### API Gateway Pattern — gateway

| Field | Notes |
|---|---|
| Problem | Without a gateway, the frontend would need to know the address of every service, handle auth token validation in every service, and CORS/security headers would be duplicated everywhere. |
| Design choice | Express gateway with Helmet, CORS, structured JSON logging with request IDs (for cross-service tracing), and a `/health` endpoint. Phase 0 uses a stub route (`/api/catalog/ping`) to prove routing works; real proxy to downstream services comes in Phase 2+. |
| Flow | `Client → Gateway (/api/catalog/ping) → stub response (Phase 0)` / `Client → Gateway → proxy → Catalog Service (Phase 2+)` |
| Code pointer | `gateway/src/index.js` — particularly the request-ID middleware, Morgan JSON logging, and the stub route with its documentation comment. |
| Trade-off | Building a custom Express gateway instead of using NGINX or a managed API gateway (AWS API Gateway). Custom gives full control and is easy to explain in an interview; NGINX would be more performant but harder to extend with custom auth logic. |
| Likely question | "Why not use NGINX?" → Express gives fine-grained control over middleware ordering (auth → rate-limit → proxy) and is the same language as the services, so the team only needs one skill set. For higher throughput, NGINX or Envoy would be the production choice. |

---

### Docker Compose Infrastructure — Phase 0

| Field | Notes |
|---|---|
| Problem | Need Postgres, MongoDB, Redis, and RabbitMQ running locally with zero manual setup so the project meets the PRD success criterion: "stand up the full system locally with one `docker-compose up`." |
| Design choice | All four infra services in one `docker-compose.yml` with healthchecks, named volumes for persistence, and env-var-driven configuration (`.env.example` committed, `.env` gitignored). Gateway depends on all infra being healthy before starting. |
| Flow | `docker-compose up -d` → Postgres, MongoDB, Redis, RabbitMQ start → healthchecks pass → Gateway starts → `/health` returns 200 |
| Code pointer | `docker-compose.yml` — healthcheck blocks for each service, `depends_on` with `condition: service_healthy` on the gateway. |
| Trade-off | All infra in one Compose file is simple but means everything runs on one machine. Production would use managed services (RDS, ElastiCache, CloudAMQP) or Kubernetes. The Compose setup is intentionally "portable dev environment," not production topology. |
| Likely question | "Why healthchecks on every service?" → So dependent services (like the gateway) don't start before their dependencies are ready. Without healthchecks, the gateway could start and crash because Postgres isn't accepting connections yet, causing confusing startup failures. |

