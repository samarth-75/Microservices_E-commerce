# docs/notifications.md — Notification Service

## Overview

The Notification Service is a pure RabbitMQ consumer. It has no database, no REST API
endpoints (beyond `/health`), and no synchronous callers. Its sole job is to consume
order and inventory events and log simulated email/SMS notifications.

**Port:** 3007
**Database:** None
**Messaging:** RabbitMQ (consumer only — never publishes)

---

## Architecture Decision: Why Consumer-Only?

Per PRD.md §4: "Real SMS/email delivery integration — a logged/simulated notification
is fine; the interesting part is the event pipeline, not the third-party integration."

The Notification Service demonstrates:
1. **Fan-out pattern** — it consumes the same events as Inventory and Analytics, using
   its own dedicated queues. Adding it required zero changes to the Order Service.
2. **Fault isolation** — if Notification Service crashes, orders still work. Events
   queue up in RabbitMQ and are processed when the service recovers.
3. **Simulated providers** — structured JSON logs that mirror real API payloads, making
   the production swap path obvious.

---

## Events Consumed

### From `order_events` exchange (queue: `notification.order_events`)

| Routing Key | Notification |
|---|---|
| `order.created` | Email + SMS: "Order #{id} received — we're processing it!" |
| `order.cancelled` | Email + SMS: "Order #{id} has been cancelled." |

### From `inventory_events` exchange (queue: `notification.inventory_events`)

| Routing Key | Notification |
|---|---|
| `inventory.reserved` | Email + SMS: "Order #{id} confirmed — inventory reserved!" |
| `inventory.failed` | Email + SMS: "Order #{id} — some items are out of stock." |

---

## Simulated Notification Format

Each notification is logged as structured JSON:

```json
{
  "timestamp": "2026-09-04T12:00:00.000Z",
  "level": "info",
  "service": "notification-service",
  "channel": "email",
  "action": "SEND_EMAIL",
  "to": "user-abc123@example.com",
  "subject": "Order #12345678 — Received!",
  "body": "Your order with 3 item(s) totaling ₹2999 has been received...",
  "orderId": "12345678-1234-1234-1234-123456789012",
  "userId": "abc123",
  "event": "order.created",
  "note": "SIMULATED — replace with SendGrid/Mailgun/SES in production"
}
```

---

## Production Swap Path

To integrate a real email/SMS provider:

1. Install the provider SDK (e.g., `npm install @sendgrid/mail`)
2. Replace `sendEmail()` in `src/services/notifier.js` with the real SDK call
3. Add API key to `.env.example` and `docker-compose.yml`
4. Everything else stays unchanged — RabbitMQ topology, consumer logic, retry handling

The function signatures (`{ to, subject, body }`) are designed to match typical provider APIs.

---

## File Structure

```
services/notification-service/
├── package.json
├── Dockerfile
├── .dockerignore
├── .env.example
└── src/
    ├── index.js                              # Express /health + RabbitMQ startup
    ├── config/
    │   └── rabbitmq.js                       # Connection, topology, queue bindings
    ├── consumers/
    │   ├── orderEvents.consumer.js           # order.created, order.cancelled
    │   └── inventoryEvents.consumer.js       # inventory.reserved, inventory.failed
    └── services/
        └── notifier.js                       # Simulated sendEmail/sendSMS
```

---

## Health Check

```bash
curl http://localhost:3007/health
```

```json
{
  "status": "ok",
  "service": "notification-service",
  "uptime": 42.5,
  "timestamp": "2026-09-04T12:00:00.000Z",
  "dependencies": {
    "rabbitmq": "ok"
  }
}
```

Status is `degraded` if RabbitMQ connection is lost. Events queue up in RabbitMQ
and are processed when the connection is restored.
