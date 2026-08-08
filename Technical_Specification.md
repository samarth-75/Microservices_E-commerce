# Technical Specification — CommerceSphere
Scalable Cloud-Native Microservices E-commerce Platform

> Agent instructions: this is a living document. When you make an architecture
> decision that isn't captured here yet, add it here before or as you implement it.
> Don't let the code drift from this file.

## 1. One-paragraph description (resume/README copy)

CommerceSphere is a cloud-native e-commerce platform built using a microservices
architecture, where independent services — authentication, product catalog, cart,
orders, payments, inventory, notifications, and analytics — communicate through REST
APIs and asynchronous messaging. The platform is designed for scalability, fault
isolation, high performance, and production-like deployment using Docker, an API
Gateway, Redis caching, and message queues.

## 2. Services and responsibilities

| Service | Responsibility | Primary DB |
|---|---|---|
| Auth Service | Login, signup, JWT issue/refresh, roles | PostgreSQL |
| User Service | Profile, addresses, preferences | PostgreSQL |
| Catalog Service | Products, categories, search | MongoDB |
| Cart Service | Cart CRUD, guest→user merge | Redis |
| Order Service | Order creation and lifecycle | PostgreSQL |
| Payment Service | Gateway integration, webhook verification | PostgreSQL |
| Inventory Service | Stock management and reservation | PostgreSQL |
| Notification Service | Email/SMS/order updates | — (consumer only) |
| Analytics Service | Sales metrics, dashboards | PostgreSQL (read replica ideally) |

**Database-per-service pattern**: no service ever queries another service's database
directly. Cross-service data needs go through REST calls or async events, never
shared DB access.

## 3. Communication patterns

- **Synchronous / REST**: used when the caller needs an immediate answer (e.g.
  frontend → Catalog Service for a product page, Cart → Catalog to validate a SKU).
- **Asynchronous / RabbitMQ**: used for anything that can be eventually consistent
  (order → inventory reservation, order → notification, order → analytics).
- Rule of thumb the agent should apply when unsure which to use: *if the user is
  staring at a spinner waiting for this, it's REST; if it can happen in the
  background, it's an event.*

### Core event flow — order placement

1. Customer places order → Order Service creates order (status `PENDING`).
2. Order Service publishes `ORDER_CREATED` to RabbitMQ.
3. Inventory Service consumes it, attempts stock reservation, publishes
   `INVENTORY_RESERVED` or `INVENTORY_FAILED`.
4. Payment Service is invoked synchronously (REST) once inventory is reserved, or
   consumes `INVENTORY_RESERVED` — pick one and document why in `docs/orders.md`.
5. Notification Service consumes order-state events and sends async
   email/SMS updates.
6. Analytics Service consumes the same events for reporting, independent of the
   above chain — its failure must never block an order.

Order status lifecycle: `PENDING → PAID → SHIPPED → DELIVERED → CANCELLED`

## 4. Auth & security

- JWT access tokens (short-lived, ~15 min) + refresh tokens (rotated on use, longer
  TTL, stored hashed).
- Role-based access control: `Admin`, `Customer` at minimum.
- Passwords hashed with bcrypt.
- Rate limiting on all auth endpoints.
- Secure, HTTP-only cookies for refresh tokens where applicable.
- Input validation (Zod/Joi) on every route.
- Helmet security headers, CORS configured per-environment, HTTPS in production.
- Secrets only via environment variables, never committed.

## 5. Caching strategy (Redis, cache-aside)

| Data | TTL |
|---|---|
| Product list | 5–10 min |
| Product details | 30 min |
| Categories | 1 hr |
| User session/profile | 15–30 min |
| Cart | 1–7 days |

Pattern: check Redis → miss → fetch DB → write to Redis → return. Invalidate the
relevant cache keys on product update (don't wait for TTL expiry on writes the user
just made).

## 6. Payments

- Razorpay or Stripe, **sandbox/test mode only**.
- Webhook signature verification required before trusting any payment event.
- Idempotency keys on the charge endpoint and the webhook handler — a retried
  request must never double-charge or double-fulfill.
- Orders are immutable once `PAID`, for auditability — corrections happen via a
  new refund/adjustment record, not by editing the paid order.

## 7. Scalability & reliability (what to actually implement vs. what to describe)

Implement for real:
- Stateless service APIs (so any instance can serve any request).
- `/health` endpoint per service.
- Cache-aside pattern as above.
- At least one retry-with-backoff on a queue consumer.

Fine to implement in simplified form but still be ready to *explain* the production
version of:
- Horizontal scaling / load balancing across multiple Catalog Service instances.
- Read replicas for read-heavy services.
- Circuit breaker pattern between services.
- Dead-letter queue for messages that repeatedly fail processing.
- CDN for product images (Cloudinary/S3 in dev is fine, describe CDN in docs).

## 8. Observability

- Structured JSON logs with a request ID that propagates across service calls.
- Track at minimum: API latency, request count, error rate, cache hit ratio, orders
  per minute.
- Prometheus + Grafana dashboard is a stretch goal — if built, include a screenshot
  in the README.

## 9. Deployment

- Each service gets its own `Dockerfile`.
- Root `docker-compose.yml` wires all services + Postgres + MongoDB + Redis +
  RabbitMQ for local dev.
- GitHub Actions: lint + test on PR, build images on merge to main.
- Frontend and backend deployed separately (e.g. frontend on Vercel/Netlify,
  backend services on Render/Railway/AWS EC2/a Docker VPS).

## 10. Naming

Project name: **CommerceSphere**. Resume title: *"CommerceSphere — Cloud-Native
Microservices E-commerce Platform"*. Don't rename mid-project — consistency matters
for the resume/GitHub link trail.
