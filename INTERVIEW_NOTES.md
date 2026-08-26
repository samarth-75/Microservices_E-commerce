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
