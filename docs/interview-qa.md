# docs/interview-qa.md — Interview Questions & Answers

A curated set of questions an interviewer might ask about CommerceSphere,
organized by topic. Each answer is designed to be 30–60 seconds when spoken
aloud. Point to specific files/functions when possible.

---

## Architecture & Design

### Q: Why microservices instead of a monolith for this project?

**A:** The goal of this project is to demonstrate distributed systems thinking,
not to ship a product. A monolith would be simpler and faster to build, but it
wouldn't give me anything interesting to talk about in an interview. Microservices
let me demonstrate: database-per-service isolation, async event-driven
communication, independent deployment, and fault isolation. The trade-off is
operational complexity (Docker Compose with 13 containers), but that's part of
what I wanted to learn.

### Q: How do your services communicate?

**A:** Two patterns:
1. **REST** for synchronous calls where the user is waiting — e.g., Cart Service
   validates products by calling Catalog Service, Order Service fetches cart items.
2. **RabbitMQ** for async events where the result can be eventually consistent —
   e.g., order.created triggers inventory reservation, notifications, and analytics
   recording independently.

The rule of thumb I used: *"If the user is staring at a spinner, it's REST. If it
can happen in the background, it's an event."* This is documented in
`Technical_Specification.md §3`.

### Q: Walk me through what happens when a customer places an order.

**A:** Six steps:
1. Customer calls POST /api/orders → Order Service fetches the cart, re-validates
   prices against Catalog Service, creates a PENDING order in Postgres.
2. Order Service publishes `order.created` to the `order_events` RabbitMQ exchange.
3. Inventory Service consumes the event, attempts stock reservation using an atomic
   `UPDATE ... WHERE available >= quantity`, publishes `inventory.reserved` or
   `inventory.failed`.
4. Order Service consumes the inventory response and transitions the order to
   CONFIRMED (or marks it failed).
5. Notification Service independently consumes both events and logs simulated
   email/SMS notifications.
6. Analytics Service independently consumes `order.created` and records it in
   its own database for metrics.

The synchronous part (steps 1-2) takes ~500ms. Inventory reservation happens in
~50ms asynchronously. The customer sees PENDING immediately, and it updates to
CONFIRMED within a second.

---

## Database Design

### Q: Why database-per-service? Isn't that wasteful?

**A:** Database-per-service is a microservices best practice because it ensures
complete data isolation. If the Catalog Service needs to change its schema, it
can do so without coordinating with the Order Service. The trade-off is that
cross-service queries require REST calls instead of JOINs — but this forces
you to think about service boundaries carefully, which is the point.

In this project, one PostgreSQL instance hosts multiple databases (auth, orders,
inventory, payments, analytics), each created by `infra/postgres/init.sql`. In
production, each would be a separate managed database instance for independent
scaling and failure isolation.

### Q: How does the Analytics Service get order data without querying the Order Service's database?

**A:** CQRS-lite pattern. The Analytics Service consumes `order.created` events
from RabbitMQ and builds its own denormalized data store (OrderEvent,
OrderItemEvent tables). It never queries the Order Service's database. The data
is eventually consistent — there's a sub-second delay between order creation
and analytics recording. This is acceptable because analytics data doesn't need
real-time precision.

---

## Caching

### Q: Explain your caching strategy.

**A:** Cache-aside (lazy loading) pattern with Redis. When a product is requested:
1. Check Redis → if found, return immediately (cache hit)
2. If not found (cache miss), query MongoDB
3. Store the result in Redis with a TTL
4. Return the result

TTLs vary by data volatility:
- Product list: 5 minutes
- Product detail: 30 minutes
- Categories: 1 hour

On product update/delete, we actively invalidate the cache (don't wait for TTL).
All cache operations are wrapped in try/catch — Redis failure degrades to slower
DB reads, never crashes the service. This is in `services/catalog-service/src/config/redis.js`.

### Q: Why is Redis the primary store for Cart instead of just a cache?

**A:** Cart data is inherently ephemeral — guest carts expire in 7 days, user
carts in 30 days. There's no business requirement to query cart history after
expiration. Using Redis as the primary store eliminates a database round-trip
and lets us use Redis Hash operations for O(1) per-item access. The trade-off
is that a Redis failure means cart data is temporarily unavailable (not just
slower), which is why the Cart Service uses `maxRetriesPerRequest: 3` (errors
propagate) while the Catalog cache uses error swallowing (cache miss = DB read).

---

## Messaging

### Q: Why RabbitMQ with topic exchanges?

**A:** Topic exchanges give us routing-key-based filtering. The `order_events`
exchange receives messages with keys like `order.created` and `order.cancelled`.
Three services consume from this exchange:
- **Inventory Service** binds to `order.created` and `order.cancelled`
- **Notification Service** binds to `order.created` and `order.cancelled`
- **Analytics Service** binds to `order.created` and `order.cancelled`

Each has its own queue. RabbitMQ delivers a copy of each message to every bound
queue — this is the fan-out pattern. New consumers can be added by creating a new
queue and binding it, without modifying the publisher.

### Q: What happens if a consumer fails?

**A:** Messages are acknowledged (acked) only after successful processing. If
processing fails, the message is nacked and requeued for retry. The consumer uses
`prefetch(1)` so only one message is in flight at a time — preventing a failed
consumer from accumulating unprocessed messages. In production, I'd add a
dead-letter queue (DLQ) for messages that fail repeatedly, and an alert on DLQ
depth.

---

## Payments

### Q: How do you prevent double-charging?

**A:** Two levels of idempotency:
1. **Database level:** The Payment model has a unique constraint on `orderId`
   (which serves as the idempotency key). Only one payment record can exist per
   order. If the customer clicks "Pay" twice, the second request finds the
   existing PENDING payment and returns the same Stripe session URL.
2. **Webhook level:** The webhook handler checks `payment.status !== 'COMPLETED'`
   before processing. If Stripe delivers the same webhook twice, the second
   delivery is a no-op that returns 200.

### Q: Why Stripe Checkout Sessions instead of PaymentIntents?

**A:** Checkout Sessions redirect the customer to Stripe's hosted page. Card
numbers never touch our servers, which eliminates PCI compliance requirements.
The trade-off is less UI customization — we can't embed a card form. But for
this project, the architecture decisions matter more than the checkout UI.
PaymentIntents would be needed for embedded card forms, saved payment methods,
or subscriptions — none of which are in scope.

---

## Auth & Security

### Q: How does your JWT implementation work?

**A:** Two-token pattern:
- **Access token** (15 min): Short-lived, stateless, contains userId + role.
  Each service validates it independently using the shared secret.
- **Refresh token** (7 days): Longer-lived, stored as SHA-256 hash in Postgres.
  On refresh, the old token is invalidated and a new pair is issued (rotation).

SHA-256 instead of bcrypt for refresh tokens because they're high-entropy random
strings, not human-chosen passwords. Bcrypt's deliberate slowness is unnecessary
and would add latency to token refresh.

### Q: How do services authenticate each other?

**A:** In this project, services share the JWT secret within the Docker network.
The Payment Service, for example, creates a short-lived (30s) internal JWT with
`role: 'admin'` when it needs to update an order status after a webhook. In
production, I'd use service mesh mTLS (Istio/Linkerd) or OAuth2 client
credentials for service-to-service auth.

---

## Production Readiness

### Q: What would you change for production?

**A:** Five things, in priority order:
1. **Managed databases** — separate PostgreSQL instances per service (not one
   shared instance), managed Redis (ElastiCache), managed RabbitMQ (CloudAMQP).
2. **Service mesh** — Istio or Linkerd for mTLS between services, replacing the
   shared JWT secret.
3. **Centralized logging** — ELK Stack or Datadog. The structured JSON logs are
   ready for this — they all have timestamps, service names, and request IDs.
4. **Dead-letter queues** — for RabbitMQ messages that fail repeatedly, plus
   alerts on DLQ depth.
5. **CDN for images** — move product images from local disk to S3 + CloudFront.

### Q: How would you handle a service going down?

**A:** Depends on which service:
- **Stateless services** (Auth, Catalog): Docker restart policy handles this.
  Multiple instances behind a load balancer would make it seamless.
- **Message consumers** (Inventory, Notification, Analytics): Messages queue up
  in RabbitMQ while the consumer is down. When it comes back, it processes the
  backlog. No data loss.
- **Payment Service**: Stripe retries webhooks for up to 3 days. The payment is
  already recorded on Stripe's side, so we just need to eventually process it.
- **Cart Service**: Redis is the primary store, so a Redis failure means carts
  are unavailable. In production, use Redis Cluster with replication.

### Q: How would you scale the Catalog Service for high read traffic?

**A:** Three levels:
1. **Redis cache** — already implemented, handles most reads without touching
   MongoDB.
2. **Horizontal scaling** — run multiple Catalog Service instances behind the
   API Gateway. Each is stateless, so any instance can serve any request.
3. **Read replicas** — MongoDB secondary nodes for read-heavy queries, keeping
   the primary for writes.
