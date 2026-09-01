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

---

### JWT Auth & Refresh Token Rotation — auth-service (Phase 1)

| Field | Notes |
|---|---|
| Problem | Users need to authenticate once and stay logged in without re-entering credentials every 15 minutes, while minimizing damage if a token is intercepted. |
| Design choice | Dual-token strategy: short-lived access token (15 min, stateless JWT) + long-lived refresh token (7 days, stored as SHA-256 hash in Postgres). On each refresh, the old token is revoked and a new pair is issued (rotation). Two separate secrets for defense in depth. |
| Flow | `POST /login → bcrypt.compare → issue accessToken + refreshToken → store SHA256(refreshToken) in DB` / `POST /refresh → verify JWT → lookup hash in DB → revoke old → issue new pair → store new hash` |
| Code pointer | `services/auth-service/src/routes/auth.routes.js` (all five endpoints), `src/utils/jwt.js` (token gen/verify), `src/utils/hash.js` (SHA-256), `src/models/RefreshToken.js` (DB schema) |
| Trade-off | Refresh tokens stored in Postgres, not Redis — simpler and auditable, but slower lookups. Production could use Redis for active tokens + Postgres for audit log. SHA-256 instead of bcrypt for token hashing — tokens are high-entropy, so bcrypt's slowness adds latency without security benefit. |
| Likely question | "Why refresh tokens instead of just long-lived access tokens?" → Long-lived access tokens can't be revoked (they're stateless). A stolen 7-day access token gives an attacker 7 days of access with no way to stop it. With refresh rotation, (a) access tokens expire in 15 min, limiting the damage window, and (b) refresh tokens are one-time-use, so theft is detected on the next legitimate refresh. |

---

### RBAC (Role-Based Access Control) — auth-service (Phase 1)

| Field | Notes |
|---|---|
| Problem | Different users need different permissions — customers shouldn't access admin endpoints (catalog CRUD, analytics), and admin actions should be verifiable. |
| Design choice | Simple two-role ENUM on the User model (`admin`, `customer`). Middleware factory: `authorize('admin')` checks `req.user.role` set by the `authenticate` middleware. Two-step chain: authenticate → authorize. |
| Flow | `Request → authenticate (verify JWT, set req.user) → authorize('admin') (check role) → handler` |
| Code pointer | `services/auth-service/src/middleware/authenticate.js`, `services/auth-service/src/middleware/authorize.js`, User model role ENUM in `src/models/User.js` |
| Trade-off | ENUM roles are simple but not granular — "admin can do everything" vs. fine-grained permissions. For this project, two roles are sufficient and easy to explain. If roles grew complex (e.g. "inventory manager", "support agent"), I'd switch to a permissions table with role-permission mappings. |
| Likely question | "How would you add more granular permissions?" → Replace the ENUM with a roles table and a role_permissions join table. The authorize middleware would check `req.user.permissions.includes('catalog:write')` instead of `req.user.role === 'admin'`. The middleware interface stays the same, only the lookup changes. |

---

### Rate Limiting on Auth Endpoints — auth-service (Phase 1)

| Field | Notes |
|---|---|
| Problem | Auth endpoints (login, signup) are prime targets for brute-force password guessing and credential stuffing attacks. Without limits, an attacker could try thousands of passwords per second. |
| Design choice | `express-rate-limit` middleware: 10 requests per 15-minute window per IP on /signup, /login, /refresh. Returns 429 with Retry-After header. In-memory store for dev simplicity. |
| Flow | `Request → rateLimiter (check IP counter) → if under limit, proceed → else 429 Too Many Requests` |
| Code pointer | `services/auth-service/src/middleware/rateLimiter.js`, applied in `src/routes/auth.routes.js` on signup/login/refresh routes |
| Trade-off | In-memory store means rate limits reset on service restart and don't work across multiple instances. Production fix: use `rate-limit-redis` with the shared Redis instance. 10/15min is strict — real apps might use 5/min for login + CAPTCHA after 3 failures. |
| Likely question | "What happens if you have multiple auth-service instances behind a load balancer?" → Each instance has its own in-memory counter, so an attacker could send 10 requests to each instance (10 × N total). Fix: use a shared Redis store so all instances share the same counter. That's a one-line config change with `rate-limit-redis`. |

---

### Catalog CRUD + MongoDB — catalog-service (Phase 2)

| Field | Notes |
|---|---|
| Problem | Products have heterogeneous attributes (T-shirts have size/color, laptops have RAM/storage). A relational DB would need an EAV table or JSONB — both are awkward. Need flexible schema per product without migrations. |
| Design choice | MongoDB with Mongoose for the catalog. Products use a `Map<String, String>` field for variable attributes. Categories are a separate collection referenced by ObjectId. Soft deletes (`isActive: false`) instead of hard deletes — preserves data for analytics and order history references. |
| Flow | `Admin → Gateway → Catalog Service → Joi validation → Mongoose → MongoDB` (writes) / `Customer → Gateway → Catalog Service → Redis check → MongoDB (on miss) → Redis write → response` (reads) |
| Code pointer | `services/catalog-service/src/models/Product.js` (schema + indexes), `src/models/Category.js` (auto-slug generation), `src/routes/product.routes.js` (CRUD + pagination/filter/sort/search), `src/routes/category.routes.js` |
| Trade-off | Using Mongoose adds overhead vs. the raw MongoDB driver, but provides schema validation, middleware hooks, and population (join-like) features that make the code more readable and maintainable. In a high-throughput system, you might drop down to the raw driver for hot paths and keep Mongoose for admin operations. |
| Likely question | "Why MongoDB for catalog but PostgreSQL for orders?" → Catalog data is read-heavy, schema-flexible, and doesn't need ACID transactions across multiple tables. Orders need ACID guarantees (payment ↔ inventory ↔ order must be consistent), relational joins (order → line items → products), and strong schema enforcement — PostgreSQL is the right fit there. |

---

### Redis Cache-Aside Pattern — catalog-service (Phase 2)

| Field | Notes |
|---|---|
| Problem | Product listing and detail pages are the highest-traffic endpoints. Every page view hits the database. Without caching, the catalog service becomes the bottleneck as traffic grows, and MongoDB queries (especially with filters + sorts) add latency. |
| Design choice | Cache-aside (lazy-loading) pattern with Redis: check cache → miss → query DB → write to cache → return. TTLs: product lists 5 min, product details 30 min, categories 1 hr. Cache keys use a deterministic MD5 hash of query params for list queries. All cache operations are wrapped in try/catch — Redis failure degrades to slower DB reads, never crashes. |
| Flow | `GET /products → check Redis (key: catalog:products:list:<hash>) → HIT: return cached → MISS: query MongoDB → write to Redis (EX 300s) → return` / `PUT /products/:id → update MongoDB → DEL cache key → SCAN+DEL all list keys` |
| Code pointer | `services/catalog-service/src/utils/cache.js` (getFromCache, setCache, invalidateCacheByKeys, invalidateCacheByPattern, hashQuery), integration in `src/routes/product.routes.js` GET handlers |
| Trade-off | Invalidating ALL list cache keys on any product write is brute-force but correct — we can't predict which paginated/filtered lists include the modified product. The cost is acceptable because: (a) list TTL is short (5 min), (b) admin writes are rare vs. customer reads, (c) SCAN is non-blocking. A smarter approach would use RabbitMQ events to invalidate only affected list queries, but that adds complexity for minimal gain at this scale. |
| Likely question | "What is cache stampede and how would you prevent it?" → When a popular key expires, many concurrent requests see a miss and all query MongoDB simultaneously. Mitigations: (1) Redlock mutex — first request locks, queries DB, caches; others wait. (2) Probabilistic early expiration — refresh before actual TTL. (3) Never-expire + background refresh worker. Not implemented here (low traffic), but the architecture supports adding it. See `docs/caching.md` for details. |

---

### Image Upload Architecture — catalog-service (Phase 2)

| Field | Notes |
|---|---|
| Problem | Products need images. Need to handle file upload, storage, and serving — but don't want to over-engineer with S3/CDN for a dev/portfolio project. |
| Design choice | `multer` for multipart form handling → local disk storage (`uploads/products/<uuid>.<ext>`) → Express static file serving. UUID filenames prevent collisions. MIME type filter (jpeg/png/webp only), 5MB max per file, 5 files per upload. Documented as a dev stand-in for CDN/S3. |
| Flow | `POST /products (multipart/form-data) → multer (validate file type/size → save to disk) → route handler (store paths in product.images[]) → response` / `GET /uploads/products/<filename> → Express static middleware → file response` |
| Code pointer | `services/catalog-service/src/middleware/upload.js` (multer config + error handler), image path assignment in `src/routes/product.routes.js` POST/PUT handlers |
| Trade-off | Local disk doesn't scale — images are lost if the container is replaced (mitigated with a Docker volume), and there's no CDN/edge caching. Production would use signed URLs for direct-to-S3 upload (bypassing the service entirely), CloudFront CDN for global delivery, and a resize worker for thumbnails. The local approach is fine for demonstrating the upload flow and discussing the production architecture. |
| Likely question | "How would you handle image uploads at scale?" → (1) Client gets a signed S3 URL from the service, uploads directly to S3 (service never touches the bytes). (2) S3 event triggers a Lambda to generate thumbnails. (3) CloudFront CDN serves images globally. (4) Product document stores only the CDN URL, not the raw S3 path. This eliminates the service as a bottleneck for uploads and serving. |

---

### Catalog Search — catalog-service (Phase 2)

| Field | Notes |
|---|---|
| Problem | Customers need to find products by name or description. Basic search is table stakes for any e-commerce platform. |
| Design choice | MongoDB text index on `name` (weight 10) and `description` (weight 5). Uses `$text` operator with `$meta: textScore` for relevance ranking. Combined with filters (category, price, brand) and pagination. No typo tolerance, no autocomplete — documented as a "good enough" implementation with a clear upgrade path. |
| Flow | `GET /products?search=wireless+headphones → Joi validates query → check Redis → MongoDB $text query + $meta textScore sort → cache result → return` |
| Code pointer | `services/catalog-service/src/models/Product.js` (text index definition with weights), `src/routes/product.routes.js` GET `/` handler (filter building + textScore projection + sort) |
| Trade-off | MongoDB text search is simple and requires no additional infrastructure, but lacks typo tolerance, fuzzy matching, autocomplete, and faceted search. For a production e-commerce site, you'd add Elasticsearch (or MongoDB Atlas Search) as a dedicated search layer: products are indexed on write via an event consumer, and search queries go to Elasticsearch instead of MongoDB. The catalog MongoDB remains the source of truth for CRUD. |
| Likely question | "How would you add typo-tolerant search?" → Add Elasticsearch as a separate service. On product create/update, publish an event to RabbitMQ → a search-indexer consumer writes to Elasticsearch. Search queries hit Elasticsearch for matching IDs, then fetch full product documents from MongoDB (or denormalize into Elasticsearch). This keeps MongoDB as the write source of truth and Elasticsearch as a read-optimized search index. |

---

### Redis as Primary Data Store — cart-service (Phase 3)

| Field | Notes |
|---|---|
| Problem | Shopping carts need sub-millisecond latency for add/remove operations (user clicks "Add to Cart" and expects instant feedback). Carts are ephemeral — abandoned carts should auto-expire without a cleanup job. |
| Design choice | Redis as the **primary store** (not just a cache). Cart data lives exclusively in Redis — no backing MongoDB or PostgreSQL. Uses Redis Hash data structure: key = `cart:user:<id>` or `cart:guest:<id>`, field = productId, value = JSON of item. TTL: 7 days for guests, 30 days for users, refreshed on every operation. |
| Flow | `POST /cart/items → optionalAuth → resolveCartId → validate → REST call to catalog-service → HSET cart:<key> <productId> <JSON> → EXPIRE <key> <ttl>` |
| Code pointer | `services/cart-service/src/config/redis.js` (maxRetriesPerRequest=3, NOT null — errors propagate because Redis IS the primary store), `src/utils/cartHelpers.js` (Hash operations), `src/middleware/resolveCartId.js` (identity resolution) |
| Trade-off | Redis is volatile by default — data can be lost on restart. Acceptable for carts (annoying, not catastrophic). Production mitigation: Redis AOF/RDB persistence, or Redis Cluster with replicas. Contrast with catalog caching where Redis failure degrades gracefully (cache miss → DB read). Here, Redis failure = service failure. That's why `maxRetriesPerRequest=3` (throws on error) instead of `null` (swallows errors). |
| Likely question | "Why not use PostgreSQL for carts like you do for orders?" → Orders need ACID guarantees, relational joins, and permanent storage. Carts need speed, TTL, and ephemeral storage. Using PostgreSQL for carts would add latency (disk I/O), require a cleanup cron for abandoned carts, and waste relational features (no joins needed). Redis Hashes give O(1) per-item access and built-in TTL — the right tool for this data shape. |

---

### Guest Cart + Merge on Login — cart-service (Phase 3)

| Field | Notes |
|---|---|
| Problem | E-commerce sites lose sales if they force registration before adding to cart. Guests need carts too. When a guest logs in, their anonymous cart items shouldn't disappear — they need to be merged into the user's cart. |
| Design choice | Guest carts use a client-generated UUID sent via `x-guest-id` header (stored in localStorage). The `optionalAuth` middleware tries JWT auth but doesn't 401 on failure — it sets `req.user = null`. The `resolveCartId` middleware resolves `cart:user:<id>` or `cart:guest:<id>` based on auth state. On login, frontend calls `POST /cart/merge { guestId }` — guest items are merged into the user cart, with user items taking precedence for conflicts. |
| Flow | `Guest adds items → cart:guest:<guestId>. Guest logs in → frontend calls POST /cart/merge with JWT + { guestId }. Cart service: HGETALL guest cart → HGETALL user cart → for each guest item not in user cart, HSET into user cart → DEL guest cart → return merged cart.` |
| Code pointer | `services/cart-service/src/middleware/optionalAuth.js` (JWT-or-null pattern), `src/middleware/resolveCartId.js` (identity resolution), `src/utils/cartHelpers.js` → `mergeCarts()`, `src/routes/cart.routes.js` → `POST /merge` |
| Trade-off | User items take precedence over guest items (same product → keep user's quantity). Alternative: sum quantities on merge. We chose precedence because the user's logged-in action is more intentional than a guest browse. The `x-guest-id` header approach is simple but not secure — a malicious user could guess/enumerate guest IDs. Production fix: signed cookies or short-lived opaque tokens. Acceptable for a portfolio project. |
| Likely question | "What happens if the user has 50 items and the guest has 50 items?" → The merge adds all non-duplicate guest items. We don't enforce a max cart size here, but production would: reject the merge if it exceeds a limit (e.g. 99 items), or merge up to the limit and discard the rest with a warning. |

---

### Cross-Service Communication (Cart → Catalog) — cart-service (Phase 3)

| Field | Notes |
|---|---|
| Problem | When adding an item to the cart, we need to verify the product exists and is active (not soft-deleted). Cart service has no access to MongoDB (database-per-service pattern) — it can't query catalog data directly. |
| Design choice | Synchronous REST call from cart-service to catalog-service: `GET http://catalog-service:3002/catalog/products/<id>`. 3-second timeout. On success, snapshot the product's name/price/image into the cart item. On failure (timeout, 404, service down), return an error to the user. This is the first real cross-service communication in the project — catalog and auth were both behind the gateway only. |
| Flow | `POST /cart/items → cart-service → HTTP GET → catalog-service → MongoDB (or Redis cache) → returns product → cart-service snapshots name/price/image → HSET into Redis` |
| Code pointer | `services/cart-service/src/utils/catalogClient.js` (HTTP client with timeout + error logging), usage in `src/routes/cart.routes.js` POST `/items` handler |
| Trade-off | Synchronous REST creates coupling: if catalog-service is down, you can't add to cart. This is acceptable because the user needs to see the product page (catalog) to click "Add to Cart" anyway — if catalog is down, they can't browse products either. Alternative: cache product data locally in cart-service and validate asynchronously. But that adds complexity and could allow adding discontinued products. Price snapshots mean the cart may show stale prices — the order service will re-validate at checkout. |
| Likely question | "What if the product price changes after the user adds it to the cart?" → The cart stores a snapshot of the price at add-time. We could add a background job to re-validate prices periodically, or re-validate on cart retrieval. At checkout, the order service MUST re-validate the current price from catalog to prevent stale-price exploitation. The cart is for display; the order is for billing. |

---

### Order Lifecycle & Status Machine — order-service (Phase 4)

| Field | Notes |
|---|---|
| Problem | Orders need a clear, auditable lifecycle. The status must transition through a defined set of states (PENDING → CONFIRMED → PAID → SHIPPED → DELIVERED), and invalid transitions must be rejected. Once an order is paid, it must be immutable for auditability. |
| Design choice | Status stored as a PostgreSQL ENUM with a STATUS_TRANSITIONS map defining valid transitions from each state. Transition validation happens at the route level before any DB write. Two terminal states (DELIVERED, CANCELLED) — once reached, no further changes allowed. Orders become immutable after PAID status. JSONB for shippingAddress (flexible, queryable without an extra table). UUID primary keys everywhere. |
| Flow | `POST /orders → authenticate → fetch cart (REST → cart-service) → re-validate prices (REST → catalog-service per item) → Sequelize transaction: create Order + OrderItems → publish order.created (RabbitMQ) → clear cart (REST, non-fatal) → 201 response` |
| Code pointer | `services/order-service/src/models/Order.js` (ENUM + STATUS_TRANSITIONS map), `src/routes/order.routes.js` (POST / handler — cart fetch, price validation, transaction, RabbitMQ publish), `src/models/OrderItem.js` (snapshot fields) |
| Trade-off | Re-validating prices per item via REST at checkout adds latency (N sequential HTTP calls), but ensures billing correctness. Alternative: batch price endpoint on catalog-service. Not implemented because the catalog already caches responses in Redis, so individual lookups are fast. Another trade-off: the order may be created (PENDING) even if RabbitMQ publish fails — the order exists but inventory is never reserved. Fix: outbox pattern (write event to DB + poll), but that's over-engineered for this project. |
| Likely question | "Why is the order immutable after PAID?" → Auditability. If a customer disputes a charge, you need to show exactly what was ordered and at what price. If orders could be edited post-payment, you'd lose that evidence trail. Corrections happen via refund records, not by modifying the original order. This is standard in real e-commerce (Amazon doesn't edit your order after you pay — they issue credits). |

---

### Inventory Reservation with Atomic SQL — inventory-service (Phase 4)

| Field | Notes |
|---|---|
| Problem | When an order is placed, stock must be reserved to prevent overselling. Two concurrent orders for the last 3 units of a product must not both succeed. The reservation must be all-or-nothing — if any item in the order can't be reserved, none should be. |
| Design choice | Atomic SQL UPDATE with a WHERE clause: `UPDATE inventory SET reservedStock = reservedStock + :qty WHERE productId = :pid AND totalStock - reservedStock >= :qty`. If affected rows = 0, stock is insufficient. Wrapped in a Sequelize transaction for all-or-nothing across multiple items. Separate Reservation table tracks per-order reservations for proper release on cancellation. Two-field stock model: totalStock (warehouse total) vs. reservedStock (pending orders). |
| Flow | `RabbitMQ delivers order.created → for each item: atomic UPDATE with WHERE check → if ALL succeed: create Reservation records, commit, publish inventory.reserved → if ANY fail: rollback, publish inventory.failed` |
| Code pointer | `services/inventory-service/src/consumers/orderCreated.consumer.js` (reservation logic), `src/consumers/orderCancelled.consumer.js` (stock release), `src/models/Inventory.js` (totalStock/reservedStock split + virtual availableStock), `src/models/Reservation.js` (per-order tracking) |
| Trade-off | The atomic UPDATE approach is "optimistic locking" — no explicit database locks, so it's performant under normal load. Under extreme concurrency (flash sale), many UPDATEs would fail and orders would be cancelled. Production fix: add a queue/semaphore for high-demand items, or use `SELECT FOR UPDATE` (pessimistic locking) for items with stock < 10. Not implemented because flash sales are out of scope (PRD.md §4). |
| Likely question | "How do you prevent overselling without explicit database locks?" → The WHERE clause in the UPDATE acts as a database-level guard. PostgreSQL's MVCC ensures that two concurrent transactions see consistent snapshots. Only one can succeed in reducing the available stock below zero — the other's UPDATE affects 0 rows and we treat that as insufficient stock. It's the optimistic concurrency control pattern. |

---

### RabbitMQ Event-Driven Architecture — Phase 4

| Field | Notes |
|---|---|
| Problem | The order placement flow spans multiple services (Order, Inventory, later Notification and Analytics). If this were all synchronous REST, the checkout request would be slow (sequential calls) and tightly coupled (any downstream failure fails the order). We need asynchronous communication for operations that don't require an immediate response. |
| Design choice | RabbitMQ with topic exchanges. Two exchanges: `order_events` (Order Service publishes), `inventory_events` (Inventory Service publishes). Topic exchange allows routing-key-based filtering — consumers bind with patterns they care about. Each consumer has its own named, durable queue. Prefetch 1 for reliable one-at-a-time processing. Messages are persistent (survive broker restarts). Acknowledgment: ack on success, nack+requeue on transient errors, ack on permanent errors (to avoid infinite loops). |
| Flow | `Order creates (PENDING) → publishes order.created to order_events exchange → Inventory consumes from inventory.order_created queue → reserves stock → publishes inventory.reserved to inventory_events exchange → Order consumes from order.inventory_response queue → updates order to CONFIRMED` |
| Code pointer | `services/order-service/src/config/rabbitmq.js` (connection, topology, publish), `services/inventory-service/src/config/rabbitmq.js` (consumer-side topology), `services/order-service/src/consumers/inventoryResponse.consumer.js`, `services/inventory-service/src/consumers/orderCreated.consumer.js`, `docs/messaging.md` (complete topology and schema reference) |
| Trade-off | RabbitMQ over Kafka: RabbitMQ is simpler for task-queue semantics (process once, ack, delete). Kafka would give event replay and higher throughput but adds operational complexity and is harder to explain in a short interview. At-least-once delivery means consumers should be idempotent — currently, the order status check (`if status !== 'PENDING'`) provides idempotency for the inventory response consumer. No dead-letter queue yet (stretch goal). |
| Likely question | "What happens if the Inventory Service is down when the order is created?" → The message sits in the RabbitMQ queue (persisted to disk) until the Inventory Service comes back up. RabbitMQ acts as a buffer. The order stays in PENDING status. When the service recovers, it processes the queued messages. This is the key benefit of async messaging over REST — the publisher doesn't need the consumer to be available at the moment of publishing. |

---

### Cross-Service Order Placement Flow — Phase 4

| Field | Notes |
|---|---|
| Problem | Placing an order requires data from three services (Cart, Catalog, Inventory) and coordination across two communication patterns (synchronous REST, asynchronous events). This is the most complex cross-service flow in the project and the one most likely to come up in a system design interview. |
| Design choice | Hybrid approach: synchronous REST for data the user is waiting on (cart contents, price validation), asynchronous events for operations that can happen in the background (inventory reservation, notifications). The "spinner rule" from Technical_Specification.md §3 guided every decision. Payment invocation (Phase 5) will also be synchronous REST — the user needs immediate feedback on payment success/failure. |
| Flow | `Customer → Gateway → Order Service → [REST: Cart Service] → [REST: Catalog Service × N items] → [DB: create Order + Items] → [RabbitMQ: publish order.created] → [REST: clear Cart] → 201 to Customer. Then async: [RabbitMQ → Inventory Service → reserve stock → publish result → RabbitMQ → Order Service → update status]` |
| Code pointer | `services/order-service/src/routes/order.routes.js` POST `/` (orchestration), `src/utils/cartClient.js` (REST to cart), `src/utils/catalogClient.js` (REST to catalog), `src/config/rabbitmq.js` (event publishing), `src/consumers/inventoryResponse.consumer.js` (async status update) |
| Trade-off | The orchestration approach (Order Service calls other services) is simpler than choreography (services react to events independently). Downside: Order Service becomes a "god service" that knows about Cart, Catalog, and Inventory. In a larger system, you'd consider a Saga pattern with a separate orchestrator. For this project, the direct approach is easier to explain and debug. |
| Likely question | "Walk me through what happens, service by service, when an order is placed." → [Use the flow above, expanding each step into 1-2 sentences. End with: "The entire synchronous part takes about 500ms. The inventory reservation happens in ~50ms asynchronously. The customer sees their order immediately with PENDING status, and it updates to CONFIRMED within a second."] |

---

### Stripe Webhook Verification & Idempotent Payment Handling — payment-service (Phase 5)

| Field | Notes |
|---|---|
| Problem | Payment events come from Stripe via webhooks. We cannot blindly trust incoming webhook requests — an attacker could forge them. We also can't assume webhooks arrive exactly once — Stripe may retry on timeout. The system must be secure against forgery and safe under duplicate delivery. |
| Design choice | Stripe webhook signature verification using `stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)`. This function: (1) extracts the timestamp and signature from the `stripe-signature` header, (2) computes HMAC-SHA256 of `timestamp.rawBody` using the webhook secret, (3) compares signatures, (4) rejects if timestamp is too old (replay protection). Idempotency: `orderId` is the idempotency key (unique constraint in DB). Webhook handler checks `payment.status !== 'COMPLETED'` before processing. |
| Flow | `Stripe fires webhook → Payment Service receives POST /payments/webhook → verify signature with stripe.webhooks.constructEvent → find Payment by stripeSessionId → if already COMPLETED, skip (idempotent) → update Payment to COMPLETED → REST call to Order Service: PUT /orders/:orderId/status { status: 'PAID' } → return 200 to Stripe` |
| Code pointer | `services/payment-service/src/routes/payment.routes.js` POST `/webhook` handler + `handleCheckoutCompleted` function, `src/index.js` (express.raw middleware ordering), `src/models/Payment.js` (unique constraint on idempotencyKey) |
| Trade-off | The raw body requirement for signature verification means the webhook route must use `express.raw()` instead of `express.json()`. This requires careful middleware ordering in `src/index.js` — raw body on the webhook path, parsed JSON on everything else. If express.json() runs first, verification always fails. We mount express.raw() specifically on `/payments/webhook` before the global express.json(). A common production bug — documented here so future developers don't break it. |
| Likely question | "How do you prevent someone from forging a Stripe webhook?" → Stripe includes an HMAC-SHA256 signature in the `stripe-signature` header, computed using the webhook secret (known only to Stripe and our server). We verify this signature using `stripe.webhooks.constructEvent()`. If the signature doesn't match — whether because the payload was tampered with or the secret is wrong — the event is rejected with a 400. Additionally, the signature includes a timestamp to prevent replay attacks. |

---

### Stripe Checkout Sessions vs PaymentIntents — payment-service (Phase 5)

| Field | Notes |
|---|---|
| Problem | Stripe offers two integration models: (1) Checkout Sessions — redirect to Stripe's hosted page, (2) PaymentIntents — collect card details on your own frontend. We need to choose one and be able to explain why. |
| Design choice | Stripe Checkout Sessions. The customer is redirected to Stripe's hosted page for payment. Card numbers never touch our servers. We create the session server-side, return the URL, and the customer pays on Stripe's page. When payment completes, Stripe fires a webhook. |
| Flow | `Customer clicks Pay → POST /orders/:id/pay → Order Service verifies CONFIRMED → proxies to Payment Service → Payment Service creates Stripe Checkout Session → returns sessionUrl → customer redirects to Stripe → pays → Stripe fires checkout.session.completed webhook → Payment Service updates status` |
| Code pointer | `services/payment-service/src/routes/payment.routes.js` POST `/create-session`, `services/order-service/src/routes/order.routes.js` POST `/:id/pay` |
| Trade-off | Checkout Sessions are less customizable than PaymentIntents (can't embed a card form in our UI), but they're significantly simpler and safer: (1) No PCI compliance burden — card data never reaches our servers, (2) Stripe handles 3D Secure, card validation, error display, (3) Fewer frontend changes needed, (4) Stripe itself recommends Checkout for new integrations. The PaymentIntents API would be needed for embedded card forms, saved payment methods, or subscriptions — none of which are in scope (PRD.md §4). |
| Likely question | "Why didn't you use Stripe Elements or PaymentIntents?" → Checkout Sessions are recommended by Stripe for standard one-time payments. They eliminate PCI scope entirely because card data never touches our servers. PaymentIntents would be necessary if we needed an embedded card form or saved payment methods, but those features are out of scope for v1. The trade-off is customization vs. simplicity — we chose simplicity because this is a portfolio project where the architecture matters more than the checkout UI. |

---

### Payment → Order Status Transition (CONFIRMED → PAID) — Phase 5

| Field | Notes |
|---|---|
| Problem | After Stripe confirms payment, the order must transition from CONFIRMED to PAID. This cross-service status update happens inside the webhook handler. The Payment Service is the authority on payment completion, but the Order Service owns the order status. |
| Design choice | Synchronous REST call from Payment Service → Order Service inside the webhook handler. The Payment Service creates a short-lived (30s) internal service JWT with `role: 'admin'` to authorize the status update. This happens AFTER the Payment record is updated to COMPLETED, so if the Order update fails, the payment is still recorded (and can be reconciled manually). |
| Flow | `Webhook handler: update Payment to COMPLETED → sign 30s admin JWT → PUT order-service/orders/:orderId/status { status: 'PAID' } → log success or log CRITICAL on failure` |
| Code pointer | `services/payment-service/src/utils/orderClient.js` (`updateOrderStatus` — signs internal service token), `services/payment-service/src/routes/payment.routes.js` (`handleCheckoutCompleted` function) |
| Trade-off | The internal service JWT is a pragmatic choice for Docker-network communication. In production: use service mesh mTLS (Istio/Linkerd), API keys, or OAuth2 client credentials. If the Order update fails after payment is confirmed, we have an inconsistency (payment exists, order still CONFIRMED). We log this at CRITICAL level. Production fix: reconciliation job that periodically checks for COMPLETED payments with non-PAID orders. Not implemented because the Docker network is reliable and this edge case is rare. |
| Likely question | "What if the Payment Service confirms payment but fails to update the Order to PAID?" → This is a distributed consistency problem. We mitigate it by: (1) updating the Payment record first (so the money is tracked), (2) logging at CRITICAL level if the Order update fails, (3) the Payment record has the orderId, so a reconciliation job can find mismatches. In production, we'd add a dead-letter queue or a scheduled reconciliation task. The key insight is: it's better to have the payment recorded and the order not updated (fixable) than to have the order updated and the payment not recorded (money lost). |
