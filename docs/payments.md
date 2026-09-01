# docs/payments.md — Payment Service

## Overview

The Payment Service handles all payment processing for CommerceSphere using
**Stripe** in **sandbox/test mode**. It manages the lifecycle from checkout
session creation through webhook-confirmed payment completion to admin-initiated
refunds.

**Port:** 3006  
**Database:** PostgreSQL (`commercesphere_payments`)  
**External:** Stripe API (test mode)

## Why Stripe

Both Stripe and Razorpay are listed in `AGENTS.md`. Stripe was chosen because:
1. Universally recognized by interviewers globally
2. Superior Node.js SDK with TypeScript types
3. Test mode requires no KYC/approval — just test API keys
4. Built-in webhook signature verification (`stripe.webhooks.constructEvent`)
5. Built-in idempotency key support on the API level

## Data Model

### Payment

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| orderId | UUID | From order-service (not a FK — different DB) |
| userId | UUID | From JWT |
| stripeSessionId | STRING (unique) | Stripe Checkout Session ID |
| stripePaymentIntentId | STRING | Extracted from webhook — needed for refunds |
| amount | DECIMAL(10,2) | Order total |
| currency | STRING(3) | Default: 'inr' |
| status | ENUM | PENDING, COMPLETED, FAILED, REFUNDED |
| idempotencyKey | STRING (unique) | = orderId — one payment per order |
| stripeRefundId | STRING | Set when refund is processed |
| metadata | JSONB | Raw Stripe event data for audit trail |
| createdAt, updatedAt | TIMESTAMP | Auto-managed |

### Status Lifecycle

```
PENDING ──→ COMPLETED ──→ REFUNDED
  │
  └──→ FAILED (session expired / payment declined)
```

## Payment Flow

### Stripe Checkout Session Model

We use **Stripe Checkout Sessions** (server-side redirect), NOT the
PaymentIntents API. This means:
- The customer is redirected to Stripe's hosted payment page
- Card details never touch our servers (PCI compliance non-issue)
- Stripe handles 3D Secure, card validation, and error display
- We only need to create the session and handle the webhook

### Step-by-Step Flow

```
1. Customer: POST /api/orders/:id/pay
   (or POST /api/payments/create-session { orderId })

2. Payment Service:
   a. Check idempotency: if Payment exists for orderId...
      - PENDING with valid session → return existing session URL
      - COMPLETED → 400 "already paid"
      - FAILED → delete and allow retry
   b. Fetch order from Order Service (REST, verify CONFIRMED status)
   c. Verify order belongs to the requesting user
   d. Build line items from order items
   e. Create Stripe Checkout Session with line items
   f. Create Payment record (status: PENDING, idempotencyKey: orderId)
   g. Return { sessionUrl } → customer redirects to Stripe

3. Customer pays on Stripe's hosted checkout page
   (test card: 4242 4242 4242 4242, any future expiry, any CVC)

4. Stripe fires webhook: POST /api/payments/webhook
   Event: checkout.session.completed

5. Payment Service webhook handler:
   a. Verify webhook signature (stripe.webhooks.constructEvent)
   b. Find Payment by stripeSessionId
   c. Idempotency: if already COMPLETED → skip (safe re-delivery)
   d. Update Payment status to COMPLETED
   e. Store stripePaymentIntentId (from webhook — needed for refunds)
   f. Call Order Service: PUT /orders/:orderId/status { status: 'PAID' }
   g. Return 200 to Stripe
```

### Flow Diagram

```
Customer          Gateway        Order Service     Payment Service     Stripe
   │                 │                │                   │               │
   │ POST /pay       │                │                   │               │
   │────────────────→│                │                   │               │
   │                 │ proxy          │                   │               │
   │                 │───────────────→│                   │               │
   │                 │                │ POST /create-session              │
   │                 │                │──────────────────→│               │
   │                 │                │                   │ verify order  │
   │                 │                │←── GET /orders/:id│               │
   │                 │                │──── order data ──→│               │
   │                 │                │                   │ create session│
   │                 │                │                   │──────────────→│
   │                 │                │                   │←── session ───│
   │                 │                │←── sessionUrl ────│               │
   │                 │←── sessionUrl ─│                   │               │
   │←── sessionUrl ──│                │                   │               │
   │                 │                │                   │               │
   │ redirect to Stripe hosted page  │                   │               │
   │────────────────────────────────────────────────────────────────────→│
   │                 │                │                   │               │
   │                 │                │                   │ webhook       │
   │                 │                │                   │←──────────────│
   │                 │                │                   │ verify sig    │
   │                 │                │                   │ update PAID   │
   │                 │                │←── PUT status:PAID│               │
   │                 │                │                   │──── 200 ─────→│
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /payments/create-session | customer JWT | Create Stripe Checkout Session |
| POST | /payments/webhook | Stripe signature | Handle Stripe webhook events |
| GET | /payments/:paymentId | customer/admin | Get payment details |
| GET | /payments/order/:orderId | customer/admin | Get payment by order ID |
| POST | /payments/:paymentId/refund | admin | Initiate refund via Stripe |

### Convenience Route on Order Service

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /orders/:id/pay | customer JWT | Verifies CONFIRMED status, proxies to payment-service |

## Idempotency Strategy

**Per Technical_Specification.md §6**: "Idempotency keys on the charge endpoint
and the webhook handler — a retried request must never double-charge or
double-fulfill."

### How we implement it:

1. **`orderId` as the idempotency key** — stored in the Payment table with a
   unique constraint. Only one Payment record can exist per order.

2. **`POST /create-session` idempotency:**
   - If a PENDING Payment exists with a valid Stripe session → return the
     existing session URL (customer can retry without creating duplicates)
   - If a COMPLETED Payment exists → return 400 "already paid"
   - If a FAILED Payment exists → delete it and create a new one (allow retry)

3. **Webhook idempotency:**
   - Check `payment.status !== 'COMPLETED'` before processing
   - If already COMPLETED → return 200 without re-processing
   - Stripe may deliver the same webhook multiple times — this is safe

### Why orderId and not a client-generated UUID?

A client-generated idempotency key would require the frontend to generate and
track UUIDs. Using `orderId` is simpler:
- Each order can only be paid once (business rule)
- The unique constraint on `orderId` prevents duplicates at the database level
- No additional client-side state needed

## Webhook Signature Verification

**Per Technical_Specification.md §6**: "Webhook signature verification required
before trusting any payment event."

### How it works:

1. Stripe sends a `stripe-signature` header with every webhook
2. The Payment Service uses `stripe.webhooks.constructEvent(rawBody, sig, secret)`
3. This function:
   - Extracts the timestamp and signature from the header
   - Computes HMAC-SHA256 of `timestamp.rawBody` using the webhook secret
   - Compares the computed signature with the received one
   - Rejects if the timestamp is too old (replay attack protection)

### Critical: Raw Body Requirement

Stripe signature verification requires the **raw request body** (Buffer), NOT
parsed JSON. If `express.json()` runs first, the body becomes a JavaScript
object and verification fails.

**Solution in `src/index.js`:**
```javascript
// Webhook route gets raw body
app.use('/payments/webhook', express.raw({ type: 'application/json' }));
// All other routes get parsed JSON
app.use(express.json());
```

This is the standard pattern recommended by Stripe's documentation. The order
of middleware matters — `express.raw()` must be mounted on the webhook path
BEFORE the global `express.json()`.

## Refund Flow

1. Admin calls `POST /payments/:paymentId/refund` with optional `reason`
2. Payment Service verifies payment is COMPLETED
3. Calls `stripe.refunds.create({ payment_intent: paymentIntentId })`
4. Updates Payment status to REFUNDED, stores `stripeRefundId`
5. Stripe handles the actual refund to the customer's bank

**Note:** The order status is NOT changed to CANCELLED on refund. A refunded
order is still PAID — the refund is a separate financial record. This is
standard accounting practice and matches real-world e-commerce systems.

## Cross-Service Communication

| Direction | Protocol | Why |
|---|---|---|
| Payment → Order (verify order) | REST | User is waiting — need immediate answer |
| Payment → Order (update to PAID) | REST | Must happen before acknowledging webhook |
| Payment → Stripe (create session) | REST (Stripe SDK) | External API call |
| Stripe → Payment (webhook) | REST (inbound) | Stripe calls our endpoint |

### Service Token for Order Status Update

The webhook handler needs to update the order status, but it doesn't have a
user JWT. Solution: the Payment Service signs a short-lived (30s) internal
service token with `role: 'admin'` using the shared `JWT_ACCESS_SECRET`.

```javascript
const serviceToken = jwt.sign(
    { id: 'payment-service', email: 'payment-service@internal', role: 'admin' },
    JWT_ACCESS_SECRET,
    { expiresIn: '30s' }
);
```

In production, this would use service mesh mTLS or a dedicated service account.
For this project, the shared JWT secret within the Docker network is sufficient.

## Error Handling

- **Order not found/not CONFIRMED:** 400 response, no Stripe session created
- **Stripe API failure:** 500 response, no Payment record created
- **Webhook signature invalid:** 400 response (Stripe retries)
- **Payment completed but Order update fails:** CRITICAL logged, Payment is
  COMPLETED but Order stays CONFIRMED — needs manual reconciliation
  (production: alert + reconciliation queue)
- **Duplicate webhook:** Silently succeeds (idempotent) — returns 200

## Testing with Stripe

### Test Cards

| Card Number | Scenario |
|---|---|
| 4242 4242 4242 4242 | Successful payment |
| 4000 0000 0000 0002 | Declined |
| 4000 0025 0000 3155 | Requires 3D Secure |

Use any future expiry date and any 3-digit CVC.

### Webhook Testing

**Option 1: Stripe CLI** (recommended for local development)
```bash
stripe listen --forward-to localhost:3006/payments/webhook
# Copy the webhook signing secret and set STRIPE_WEBHOOK_SECRET
```

**Option 2: Stripe Dashboard**
Set up a webhook endpoint in test mode pointing to your public URL.

### Dashboard
Monitor test events at: https://dashboard.stripe.com/test/events
