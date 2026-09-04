# docs/analytics.md — Analytics Service

## Overview

The Analytics Service is a dual-purpose service: it consumes RabbitMQ events to build
an analytics data store (CQRS-lite read model) and exposes admin-only REST endpoints
for querying sales metrics.

**Port:** 3008
**Database:** PostgreSQL (`commercesphere_analytics`)
**Messaging:** RabbitMQ (consumer only)

---

## Architecture Decision: CQRS-Lite

The Analytics Service cannot query the Order Service's database (database-per-service
pattern). Instead, it consumes `order.created` events and builds its own denormalized
data store — `OrderEvent` and `OrderItemEvent` tables optimized for aggregation queries.

This is CQRS-lite (Command Query Responsibility Segregation):
- **Write model** (Order Service): normalized, transactional, optimized for writes
- **Read model** (Analytics Service): denormalized, indexed, optimized for aggregation

The data is eventually consistent — there's a sub-second delay between order creation
and analytics recording. This is acceptable because analytics data doesn't need
real-time precision.

---

## Events Consumed

### From `order_events` exchange (queue: `analytics.order_events`)

| Routing Key | Action |
|---|---|
| `order.created` | Create OrderEvent + OrderItemEvent records |
| `order.cancelled` | Update OrderEvent status to CANCELLED |

### Idempotency

The `OrderEvent` table has a unique constraint on `orderId`. If the same event arrives
twice (RabbitMQ redelivery), the consumer checks for existing records before inserting.
Duplicate events are safely skipped.

---

## REST Endpoints (Admin-Only)

All endpoints require JWT authentication with `role: admin`.

### GET /analytics/orders/summary

Returns total orders, revenue, average order value, and cancelled orders count.

**Query params:** `?from=YYYY-MM-DD&to=YYYY-MM-DD` (optional date filtering)

**Response:**
```json
{
  "totalOrders": 150,
  "cancelledOrders": 12,
  "totalRevenue": "49750.00",
  "averageOrderValue": 331.67,
  "dateRange": { "from": "2026-09-01", "to": "2026-09-04" }
}
```

### GET /analytics/orders/daily

Returns orders per day for the last N days.

**Query params:** `?days=30` (default: 30)

**Response:**
```json
{
  "days": 30,
  "from": "2026-08-05",
  "to": "2026-09-04",
  "data": [
    { "date": "2026-09-01", "orderCount": 12, "revenue": "3990.00" },
    { "date": "2026-09-02", "orderCount": 15, "revenue": "5250.00" }
  ]
}
```

### GET /analytics/products/top

Returns top N products by total quantity sold.

**Query params:** `?limit=10&days=30` (defaults: 10 products, last 30 days)

**Response:**
```json
{
  "limit": 10,
  "days": 30,
  "data": [
    {
      "productId": "abc123",
      "productName": "Wireless Earbuds",
      "totalQuantity": 45,
      "totalRevenue": "44550.00",
      "orderCount": 38
    }
  ]
}
```

---

## Data Model

### OrderEvent
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Analytics record ID |
| orderId | UUID (unique) | Original order ID (idempotency key) |
| userId | UUID | Customer ID |
| totalAmount | DECIMAL(10,2) | Order total |
| itemCount | INTEGER | Number of items |
| status | ENUM(CREATED, CANCELLED) | Current order status |
| orderDate | TIMESTAMP | When the order was placed |

### OrderItemEvent
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Record ID |
| orderId | UUID (FK) | Reference to OrderEvent |
| productId | STRING | Product ID from catalog |
| productName | STRING | Denormalized for display |
| quantity | INTEGER | Quantity ordered |
| price | DECIMAL(10,2) | Unit price at time of order |

---

## File Structure

```
services/analytics-service/
├── package.json
├── Dockerfile
├── .dockerignore
├── .env.example
└── src/
    ├── index.js                              # Express + RabbitMQ startup
    ├── config/
    │   ├── database.js                       # Sequelize/Postgres config
    │   └── rabbitmq.js                       # Connection, topology
    ├── models/
    │   ├── OrderEvent.js                     # Order analytics model
    │   ├── OrderItemEvent.js                 # Per-item analytics model
    │   └── index.js                          # Associations
    ├── consumers/
    │   └── orderEvents.consumer.js           # Event → DB recording
    ├── routes/
    │   └── analytics.routes.js               # Admin-only REST API
    └── middleware/
        ├── authenticate.js                   # JWT verification
        └── authorize.js                      # RBAC (admin-only)
```

---

## Health Check

```bash
curl http://localhost:3008/health
```

```json
{
  "status": "ok",
  "service": "analytics-service",
  "uptime": 42.5,
  "timestamp": "2026-09-04T12:00:00.000Z",
  "dependencies": {
    "postgres": "ok",
    "rabbitmq": "ok"
  }
}
```
