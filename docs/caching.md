# Caching Strategy — Documentation

## Overview

CommerceSphere uses Redis with the **cache-aside (lazy-loading)** pattern for the
Catalog Service. This document explains the pattern, TTL strategy, cache invalidation,
and interview-ready trade-off analysis.

## Cache-Aside Pattern

```
┌─────────┐     1. GET /products     ┌─────────────────┐
│  Client  │ ──────────────────────→ │  Catalog Service │
└─────────┘                          └────────┬────────┘
                                              │
                                   2. Check Redis
                                              │
                                    ┌─────────▼──────────┐
                                    │       Redis        │
                                    │  (cache layer)     │
                                    └─────────┬──────────┘
                                              │
                              ┌───────────────┴───────────────┐
                              │                               │
                        Cache HIT                        Cache MISS
                              │                               │
                     3a. Return cached              3b. Query MongoDB
                         data directly                        │
                                                    ┌─────────▼──────────┐
                                                    │      MongoDB       │
                                                    │  (source of truth) │
                                                    └─────────┬──────────┘
                                                              │
                                                    4. Write to Redis
                                                       with TTL
                                                              │
                                                    5. Return fresh data
```

**Step-by-step:**
1. Request arrives at the Catalog Service
2. Check Redis for the cache key
3. **HIT:** Return cached JSON directly (fast path, ~1ms)
4. **MISS:** Query MongoDB (slow path, ~10-50ms), write result to Redis with TTL, return
5. Subsequent requests for the same key hit the cache until TTL expires

## TTL Strategy

| Data | Cache Key Pattern | TTL | Rationale |
|---|---|---|---|
| Product list | `catalog:products:list:<queryHash>` | 5 min | Lists change frequently as products are added/updated |
| Product detail | `catalog:products:<id>` | 30 min | Individual products change less often than lists |
| Category list | `catalog:categories:all` | 1 hr | Categories rarely change |
| Category detail | `catalog:categories:<id>` | 1 hr | Same as above |

**Query hash:** Product list queries are cached by a deterministic MD5 hash of the
query parameters (page, limit, filters, sort, search). Same parameters in any order
produce the same hash → same cache key.

## Cache Key Convention

```
catalog:products:list:a1b2c3d4e5f6...   ← list query (MD5 of query params)
catalog:products:507f1f77bcf86cd7...     ← product detail (MongoDB ObjectId)
catalog:categories:all                   ← all categories
catalog:categories:507f1f77bcf86cd7...   ← category detail (MongoDB ObjectId)
```

## Cache Invalidation

**Strategy: invalidate on write.** When an admin creates, updates, or deletes a product
or category, the service immediately deletes the relevant cache keys. We don't wait for
TTL expiry because the admin just made a change and would expect to see it reflected.

| Write operation | Keys invalidated |
|---|---|
| Create product | All product list keys (`catalog:products:list:*`) |
| Update product | Specific detail key + all list keys |
| Delete product | Specific detail key + all list keys |
| Create/update/delete category | All category keys (`catalog:categories:*`) |

**Why invalidate all list keys on product write?** Because list queries are filtered
and paginated — we can't predict which list caches include the modified product. The
brute-force approach of clearing all list keys is acceptable because:
1. List caches have a short TTL (5 min) anyway
2. Admin writes are infrequent compared to customer reads
3. The `SCAN` + `DEL` approach is non-blocking (doesn't freeze Redis)

**Implementation:** Uses Redis `SCAN` (not `KEYS`) to find matching patterns. `KEYS`
blocks Redis on large datasets; `SCAN` iterates incrementally.

## Cache Stampede

**What it is:** When a popular cache key expires, many concurrent requests all see a
cache miss simultaneously and all query MongoDB at once, overloading it.

**Risk in this project:** Low. Traffic is simulated/demo-level, not millions of concurrent
users. But it's a critical interview question.

**Mitigation options (would implement in production):**

1. **Mutex/lock (Redlock):** First request acquires a short-lived lock, queries DB, and
   populates the cache. Other requests wait or get a stale copy.

2. **Probabilistic early expiration:** Each request checks if the TTL is about to expire
   and probabilistically refreshes the cache before the actual expiry. This spreads the
   refresh load over time instead of a single spike.

3. **Background refresh:** A separate worker periodically refreshes popular cache keys
   before they expire, so no user request ever sees a miss.

4. **Never-expire + async refresh:** Cache never expires, but a background job updates
   it periodically. Requests always get data (possibly slightly stale), never hit the DB
   directly.

## Graceful Degradation

All cache operations are wrapped in try/catch with error swallowing. If Redis is down:
- **Reads:** Return null (cache miss) → fall through to MongoDB → slightly slower but functional
- **Writes:** Silently fail → data isn't cached → next read goes to DB directly
- **Invalidation:** Silently fails → stale data may be served until TTL expires

This means a Redis outage degrades performance but never crashes the service.

## What Production Would Change

| Dev implementation | Production version |
|---|---|
| Single Redis instance | Redis Cluster or ElastiCache with read replicas |
| Pattern-based invalidation (SCAN) | Event-driven invalidation via RabbitMQ |
| In-process cache helpers | Shared cache library (npm package) |
| No cache warming | Pre-warm popular products on service startup |
| No metrics | Track cache hit ratio, miss rate, latency (Prometheus) |
| No stampede protection | Redlock or probabilistic early expiration |
