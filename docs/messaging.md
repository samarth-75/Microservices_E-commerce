# docs/messaging.md — RabbitMQ Event-Driven Architecture

## Overview

CommerceSphere uses RabbitMQ for asynchronous, event-driven communication
between services. RabbitMQ was introduced in Phase 4 (Order + Inventory) as
the first async integration. It handles events that don't need an immediate
response — the user doesn't need to wait for inventory reservation to complete
before seeing their order confirmation.

## When to Use REST vs. RabbitMQ

**Rule of thumb (from Technical_Specification.md §3):**
> If the user is staring at a spinner waiting for this, it's REST.
> If it can happen in the background, it's an event.

| Interaction | Protocol | Why |
|---|---|---|
| Cart → Catalog (validate product) | REST | User is clicking "Add to Cart" |
| Order → Cart (fetch cart) | REST | User is clicking "Place Order" |
| Order → Catalog (re-validate prices) | REST | Part of the same checkout request |
| Order → Inventory (reserve stock) | RabbitMQ | Can be eventually consistent |
| Inventory → Order (reservation result) | RabbitMQ | Background status update |
| Order → Notification (send email) | RabbitMQ | User doesn't wait for email |
| Order → Analytics (log metrics) | RabbitMQ | Never blocks the user |

## Why RabbitMQ Over Kafka

**Short answer:** RabbitMQ is simpler to set up, explain, and manage for this
project's scale, and the interview focus is on demonstrating the event-driven
pattern — not on choosing the highest-throughput broker.

**Key differences to know for interviews:**

| Feature | RabbitMQ | Kafka |
|---|---|---|
| Model | Message broker (push to consumers) | Distributed log (consumers pull) |
| Ordering | Per-queue FIFO | Per-partition ordering |
| Replay | No (messages deleted after ack) | Yes (retained for configurable time) |
| Throughput | Thousands/sec | Millions/sec |
| Use case | Task queues, RPC, routing | Event streaming, log aggregation |

**For this project:** We need task-queue semantics (process each order once,
ack on success, requeue on failure). RabbitMQ's acknowledge + requeue model
fits perfectly. Kafka would be overkill and harder to explain.

## Topology

### Exchanges

| Exchange | Type | Purpose |
|---|---|---|
| `order_events` | topic | Order Service publishes order lifecycle events |
| `inventory_events` | topic | Inventory Service publishes reservation results |

**Why topic exchange?** Allows routing-key-based filtering. Consumers bind with
patterns they care about. New consumers (like Notification Service in Phase 6)
can subscribe to existing events without modifying publishers.

### Queues and Bindings

| Queue | Exchange | Routing Key | Consumer |
|---|---|---|---|
| `order.inventory_response` | `inventory_events` | `inventory.reserved` | Order Service |
| `order.inventory_response` | `inventory_events` | `inventory.failed` | Order Service |
| `inventory.order_created` | `order_events` | `order.created` | Inventory Service |
| `inventory.order_cancelled` | `order_events` | `order.cancelled` | Inventory Service |

### Future Queues (Phase 6)

| Queue | Exchange | Routing Key | Consumer |
|---|---|---|---|
| `notification.order_events` | `order_events` | `order.*` | Notification Service |
| `analytics.order_events` | `order_events` | `order.*` | Analytics Service |

## Event Schemas

### `order.created`

```json
{
  "orderId": "uuid",
  "userId": "uuid",
  "items": [
    {
      "productId": "string (MongoDB ObjectId)",
      "quantity": 2,
      "unitPrice": 29.99
    }
  ],
  "totalAmount": 59.98,
  "timestamp": "2026-08-31T18:00:00.000Z"
}
```

### `order.cancelled`

```json
{
  "orderId": "uuid",
  "userId": "uuid",
  "previousStatus": "PENDING",
  "timestamp": "2026-08-31T18:05:00.000Z"
}
```

### `inventory.reserved`

```json
{
  "orderId": "uuid",
  "userId": "uuid",
  "reservedItems": [
    { "productId": "string", "quantity": 2 }
  ],
  "timestamp": "2026-08-31T18:00:01.000Z"
}
```

### `inventory.failed`

```json
{
  "orderId": "uuid",
  "userId": "uuid",
  "reason": "Insufficient stock for one or more items",
  "failedItems": [
    {
      "productId": "string",
      "requestedQuantity": 5,
      "availableStock": 2,
      "reason": "Insufficient stock"
    }
  ],
  "timestamp": "2026-08-31T18:00:01.000Z"
}
```

## Consumer Patterns

### Acknowledgment Strategy

- **ack** on successful processing
- **nack + requeue** on transient errors (DB down, temporary network issue)
- **ack** on permanent errors (malformed message, order not found) to avoid
  infinite retry loops

### Prefetch

All consumers use `prefetch(1)` — process one message at a time. This ensures:
1. Reliable processing (no message lost if the consumer crashes mid-batch)
2. No concurrent stock operations on the same inventory record
3. Backpressure: if processing is slow, RabbitMQ holds messages in the queue

### Message Durability

- Exchanges: `durable: true` — survive broker restarts
- Queues: `durable: true` — survive broker restarts
- Messages: `persistent: true` — written to disk (survive broker restarts)

This combination ensures **at-least-once delivery**. Messages may be processed
more than once (e.g., after a crash before ack), so consumers should be
idempotent where possible.

## Connection Management

Both services connect to RabbitMQ with:
- **Retry logic:** Up to 5 attempts with exponential backoff (1s, 2s, 4s, 8s, 16s)
- **Error handling:** Connection errors are logged; connection close triggers
  channel/connection nulling
- **Graceful shutdown:** `closeRabbitMQ()` exported for clean shutdown

## Dead-Letter Queue (Stretch Goal)

Currently, messages that fail permanently (malformed JSON, missing order) are
acknowledged and discarded. In production, these should go to a **dead-letter
queue** (DLQ) for:
1. Manual inspection and replay
2. Alerting on high DLQ message rates
3. Debugging data flow issues

To implement: add `x-dead-letter-exchange` and `x-dead-letter-routing-key`
arguments when asserting queues.

## Monitoring

RabbitMQ Management UI is available at `http://localhost:15672` (credentials in
`.env`). Use it to:
- Verify exchanges, queues, and bindings are created
- Monitor message rates and queue depth
- Check consumer connections
- Manually publish test messages

## Flow Diagram

```
┌──────────────┐     order.created      ┌───────────────────┐
│ Order Service │ ──────────────────────→│ Inventory Service │
│  (publisher)  │                        │   (consumer)      │
│               │     inventory.reserved │                   │
│  (consumer)   │←──────────────────────│   (publisher)     │
│               │     inventory.failed   │                   │
│  (consumer)   │←──────────────────────│   (publisher)     │
└──────────────┘                        └───────────────────┘
       │           order.cancelled              ↑
       └────────────────────────────────────────┘
```
