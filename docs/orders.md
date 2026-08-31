# docs/orders.md — Order Service

## Overview

The Order Service manages the complete order lifecycle from cart checkout to
delivery. It is the orchestrator of the order placement flow — fetching the
cart, re-validating prices, creating the order, publishing events, and tracking
status transitions.

**Port:** 3004  
**Database:** PostgreSQL (`commercesphere_orders`)  
**Messaging:** RabbitMQ (publisher + consumer)

## Data Model

### Order

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| userId | UUID | From JWT — not a FK (different DB) |
| status | ENUM | PENDING, CONFIRMED, PAID, SHIPPED, DELIVERED, CANCELLED |
| totalAmount | DECIMAL(10,2) | Sum of all item totals |
| shippingAddress | JSONB | { street, city, state, zip, country } |
| paymentId | STRING | Set when payment completes (Phase 5) |
| notes | TEXT | Optional customer notes |
| createdAt, updatedAt | TIMESTAMP | Auto-managed by Sequelize |

### OrderItem

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| orderId | UUID | FK → Order |
| productId | STRING | MongoDB ObjectId from catalog |
| productName | STRING | Snapshot at order time |
| productImage | STRING | Snapshot — first image URL |
| quantity | INTEGER | min: 1 |
| unitPrice | DECIMAL(10,2) | Re-validated from catalog at checkout |
| totalPrice | DECIMAL(10,2) | quantity × unitPrice |

## Order Status Lifecycle

```
PENDING ──→ CONFIRMED ──→ PAID ──→ SHIPPED ──→ DELIVERED
  │              │
  └──→ CANCELLED ←┘
```

**Status transitions:**
- `PENDING → CONFIRMED` — Inventory reserved (automated via RabbitMQ consumer)
- `PENDING → CANCELLED` — Inventory failed OR customer cancelled
- `CONFIRMED → PAID` — Payment completed (Phase 5)
- `CONFIRMED → CANCELLED` — Customer cancelled before payment
- `PAID → SHIPPED` — Admin marks as shipped (order is immutable after PAID)
- `SHIPPED → DELIVERED` — Admin marks as delivered

**Terminal states:** `DELIVERED`, `CANCELLED` — no further transitions allowed.

**Immutability after PAID:** Once an order reaches `PAID`, it cannot be
cancelled. Corrections happen via a refund/adjustment record, not by editing
the paid order. This is for auditability (Technical_Specification.md §6).

## Order Placement Flow

### Step-by-step

1. **Customer calls `POST /api/orders`** with `{ shippingAddress, notes? }`
2. **Order Service fetches the user's cart** from Cart Service via REST
   (`GET http://cart-service:3003/cart` with JWT forwarded)
3. **Order Service re-validates product prices** from Catalog Service via REST
   (`GET http://catalog-service:3002/catalog/products/:id` per item)
4. **Order + OrderItems created** in PostgreSQL within a Sequelize transaction
   (status: `PENDING`)
5. **`order.created` event published** to RabbitMQ (`order_events` exchange)
6. **Cart is cleared** via `DELETE http://cart-service:3003/cart` (non-fatal on
   failure — cart will eventually expire via TTL)
7. **201 response** returned to the customer with order details

### Price re-validation rationale

The cart stores a price snapshot at add-time (for display), but the order must
use the **current** price from the catalog. If a product's price changed since
the user added it to the cart, the order uses the updated price. This prevents
stale-price exploitation and is documented in the cart INTERVIEW_NOTES entry.

### What happens after the 201

After the response, the flow continues asynchronously:

1. **Inventory Service consumes `order.created`** from RabbitMQ
2. Inventory attempts to reserve stock for all items (atomic SQL UPDATE)
3. **If all items reserved:** publishes `inventory.reserved` → Order Service
   consumer updates order to `CONFIRMED`
4. **If any item fails:** publishes `inventory.failed` → Order Service consumer
   updates order to `CANCELLED`

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /orders | customer | Create order from cart |
| GET | /orders | customer/admin | List orders (paginated) |
| GET | /orders/:id | customer/admin | Get order details + items |
| PUT | /orders/:id/status | admin | Update status (with transition validation) |
| PUT | /orders/:id/cancel | customer | Cancel order (PENDING/CONFIRMED only) |

## Cross-Service Communication

| Direction | Protocol | Why |
|---|---|---|
| Order → Cart (fetch cart) | REST | User is waiting — need the cart immediately |
| Order → Catalog (re-validate prices) | REST | User is waiting — need current prices |
| Order → Cart (clear cart) | REST | Non-fatal, fire-and-forget-ish |
| Order → Inventory (reserve stock) | RabbitMQ | Can be eventually consistent — user sees PENDING |
| Inventory → Order (reservation result) | RabbitMQ | Background status update |

## Payment Invocation Decision

**Resolved:** Payment Service (Phase 5) will be invoked via **synchronous REST**
from the Order Service, NOT by consuming `INVENTORY_RESERVED`.

**Rationale:** The user is staring at a spinner during checkout. Per the
Technical_Specification.md §3 "spinner rule," synchronous REST is appropriate
when the caller needs an immediate answer. The Order Service will call
`POST http://payment-service:3006/payments/charge` after the order is CONFIRMED
and the user initiates payment.

**Alternative considered:** Having Payment Service consume `INVENTORY_RESERVED`
was considered but rejected because:
1. The user needs feedback on payment success/failure in the same request
2. Event-driven payment would require polling or WebSocket for status updates
3. The synchronous approach is simpler to explain and implement

## Error Handling

- **Cart fetch fails:** 400 response, no order created
- **Product validation fails:** 400 response with details, no order created
- **DB transaction fails:** Automatic rollback, 500 response
- **RabbitMQ publish fails:** Order exists but may stay PENDING indefinitely
  (stretch goal: DLQ + retry mechanism)
- **Inventory reservation fails:** Order auto-cancelled via consumer
