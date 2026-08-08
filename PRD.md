# PRD.md — CommerceSphere

## 1. Purpose

CommerceSphere is a portfolio/interview project, not a real business. The product
goal is a single one: **demonstrate that the builder can design and reason about a
distributed, production-shaped system** — not to maximize feature count or acquire
users. Every prioritization call in this doc is made against that goal.

## 2. Target user (fictional, for design purposes)

A small online retailer selling a moderate catalog (hundreds, not millions, of
SKUs) that needs standard e-commerce flows — browse, cart, checkout, pay, track —
built on infrastructure that *could* scale, so design decisions should be
scale-aware even though the seed data won't be large.

Two personas to design against:
- **Customer** — browses, searches, buys, tracks orders.
- **Admin** — manages catalog, views sales analytics, handles order/inventory state.

## 3. In scope (v1)

- Browse/search catalog, product detail pages.
- Guest and authenticated cart, cart persists across login.
- Checkout with sandbox payment, order confirmation.
- Order status tracking (`PENDING → PAID → SHIPPED → DELIVERED → CANCELLED`).
- Email/SMS-style notifications on order state changes (can be simulated/logged
  instead of a real provider if time-constrained — note this explicitly in
  `docs/deployment.md` if simulated).
- Admin catalog CRUD.
- Basic sales analytics dashboard (orders per period, top products).

## 4. Out of scope (v1) — and why

- Multi-currency / multi-region pricing — adds complexity with no architectural
  learning payoff for this project.
- Reviews/ratings moderation, recommendation engine, coupons/promotions — real
  product features, but they don't teach anything new about distributed systems
  that the core flow doesn't already cover. Skip unless Phase 6 finishes early.
- Real SMS/email delivery integration — a logged/simulated notification is fine;
  the interesting part is the event pipeline, not the third-party integration.
- Mobile app — web only.

If asked to add anything from this list, the agent should flag that it's out of
scope per this PRD rather than silently building it.

## 5. Success criteria

This project succeeds if, at the end, the builder can:
1. Stand up the full system locally with one `docker-compose up`.
2. Walk an interviewer through the order-placement flow end to end, service by
   service, without notes.
3. Point to a specific file/function for any claim made in `INTERVIEW_NOTES.md`.
4. Answer "what would you change for real production scale" for at least caching,
   messaging, and database design.

There is no user-adoption or business metric — success is architectural clarity and
interview readiness, tracked via `INTERVIEW_NOTES.md`.

## 6. Non-functional priorities (ranked)

1. **Explainability** — can you describe the design out loud in under 2 minutes?
2. **Correctness of the happy path** — checkout, payment, order status must actually work.
3. **Fault isolation** — one service dying shouldn't take down the whole app.
4. **Performance** — real but secondary; caching is there to demonstrate the
   pattern, not to hit a specific latency number.
5. **Polish/UI** — lowest priority. Functional, clean, not a design showcase.

## 7. Open questions (resolve before/during the relevant phase, then delete from here)

- Guest checkout allowed, or must a user register before paying? → resolve in Phase 3.
- Does search need more than substring/basic full-text (e.g. typo tolerance)? →
  resolve in Phase 2, default to "no" unless time allows.
- Is Payment Service invoked synchronously from Order Service, or does it react to
  `INVENTORY_RESERVED`? → resolve in Phase 4/5, document the choice in `docs/orders.md`.
