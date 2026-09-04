# CommerceSphere

**Cloud-Native Microservices E-commerce Platform**

CommerceSphere is a cloud-native e-commerce platform built using a microservices architecture, where independent services — authentication, product catalog, cart, orders, payments, inventory, notifications, and analytics — communicate through REST APIs and asynchronous messaging. The platform is designed for scalability, fault isolation, high performance, and production-like deployment using Docker, an API Gateway, Redis caching, and message queues.

> **Note:** This is a resume/interview portfolio project. The goal is to demonstrate backend architecture, distributed systems, and system-design thinking — not to maximize feature count.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         API Gateway (:3000)                        │
│              Express + Helmet + CORS + Request ID                  │
│  Routes: /api/auth  /api/catalog  /api/cart  /api/orders           │
│          /api/inventory  /api/payments  /api/analytics              │
└──────────┬──────────┬──────────┬──────────┬──────────┬─────────────┘
           │          │          │          │          │
    ┌──────▼──┐ ┌─────▼───┐ ┌───▼───┐ ┌───▼────┐ ┌───▼────────┐
    │  Auth   │ │ Catalog │ │ Cart  │ │ Order  │ │  Payment   │
    │ :3001   │ │  :3002  │ │ :3003 │ │ :3004  │ │   :3006    │
    │Postgres │ │ MongoDB │ │ Redis │ │Postgres│ │  Postgres  │
    └─────────┘ │ + Redis │ └───────┘ │+Rabbit │ │  + Stripe  │
                └─────────┘           └───┬────┘ └────────────┘
                                          │ RabbitMQ Events
                          ┌───────────────┼───────────────┐
                    ┌─────▼──────┐  ┌─────▼──────┐  ┌─────▼──────┐
                    │ Inventory  │  │Notification│  │ Analytics  │
                    │   :3005    │  │   :3007    │  │   :3008    │
                    │  Postgres  │  │ (no DB)    │  │  Postgres  │
                    │  +Rabbit   │  │  Consumer  │  │  +Rabbit   │
                    └────────────┘  └────────────┘  └────────────┘
```

### Communication Patterns

| Pattern | When | Example |
|---------|------|---------|
| **REST** (synchronous) | User is waiting for a response | Cart → Catalog (validate product) |
| **RabbitMQ** (async) | Can happen in the background | Order → Inventory (reserve stock) |

**Rule of thumb:** *If the user is staring at a spinner, it's REST. If it can happen in the background, it's an event.*

---

## Tech Stack

| Layer | Technology |
|---|---|
| API Gateway | Express + http-proxy-middleware |
| Backend Services | Node.js + Express |
| Relational Data | PostgreSQL 16 |
| Document Data | MongoDB 7 |
| Cache / Cart | Redis 7 |
| Messaging | RabbitMQ 3 (topic exchanges) |
| Auth | JWT access + refresh token rotation, RBAC |
| Payments | Stripe (sandbox/test mode) |
| Containers | Docker + Docker Compose |
| CI/CD | GitHub Actions |

---

## Services

| Service | Port | Database | Responsibilities |
|---------|------|----------|-----------------|
| API Gateway | 3000 | — | Routing, CORS, Helmet, request ID propagation |
| Auth Service | 3001 | PostgreSQL | Signup, login, JWT issue/refresh, RBAC |
| Catalog Service | 3002 | MongoDB + Redis | Products, categories, search, image upload, caching |
| Cart Service | 3003 | Redis | Cart CRUD, guest carts, merge on login |
| Order Service | 3004 | PostgreSQL + RabbitMQ | Order lifecycle, event publishing |
| Inventory Service | 3005 | PostgreSQL + RabbitMQ | Stock reservation, release on cancel |
| Payment Service | 3006 | PostgreSQL + Stripe | Checkout sessions, webhooks, refunds |
| Notification Service | 3007 | — (consumer only) | Simulated email/SMS on order events |
| Analytics Service | 3008 | PostgreSQL + RabbitMQ | Sales metrics, top products, daily orders |

---

## Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/)
- (Optional) [Stripe CLI](https://stripe.com/docs/stripe-cli) for webhook testing

### 1. Clone and configure
```bash
git clone https://github.com/samarth-75/Microservices_E-commerce.git
cd Microservices_E-commerce
cp .env.example .env
# Edit .env with your Stripe test keys (optional — service runs without them)
```

### 2. Start everything
```bash
docker-compose up -d
```

This starts **13 containers**: PostgreSQL, MongoDB, Redis, RabbitMQ, 8 application services, and the API Gateway.

### 3. Verify
```bash
# Gateway health
curl http://localhost:3000/health

# All services should respond
curl http://localhost:3001/health  # Auth
curl http://localhost:3002/health  # Catalog
curl http://localhost:3003/health  # Cart
curl http://localhost:3004/health  # Order
curl http://localhost:3005/health  # Inventory
curl http://localhost:3006/health  # Payment
curl http://localhost:3007/health  # Notification
curl http://localhost:3008/health  # Analytics
```

### 4. Test the flow
```bash
# 1. Create an admin account
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"Admin123!","role":"admin"}'

# 2. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"Admin123!"}'
# → Save the accessToken

# 3. Create a product (admin)
curl -X POST http://localhost:3000/api/catalog/products \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Product","price":999,"description":"A test product","category":"test"}'

# 4. Add to cart, create order, pay...
```

---

## API Endpoints

### Auth (`/api/auth`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /signup | — | Create account |
| POST | /login | — | Get JWT tokens |
| POST | /refresh | — | Rotate access token |
| POST | /logout | JWT | Invalidate refresh token |
| GET | /me | JWT | Get current user |

### Catalog (`/api/catalog`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /products | — | List (paginated, filtered, sorted) |
| GET | /products/:id | — | Product detail |
| POST | /products | Admin | Create product |
| PUT | /products/:id | Admin | Update product |
| DELETE | /products/:id | Admin | Delete product |
| GET | /products/search?q= | — | Full-text search |
| GET | /categories | — | List categories |
| POST | /categories | Admin | Create category |

### Cart (`/api/cart`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | / | Optional | Get cart |
| POST | /items | Optional | Add item |
| PUT | /items/:productId | Optional | Update quantity |
| DELETE | /items/:productId | Optional | Remove item |
| POST | /merge | JWT | Merge guest → user cart |

### Orders (`/api/orders`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | / | JWT | Create order from cart |
| GET | / | JWT | List my orders |
| GET | /:id | JWT | Order detail |
| PUT | /:id/status | Admin | Update status |
| POST | /:id/cancel | JWT | Cancel order |
| POST | /:id/pay | JWT | Initiate payment |

### Payments (`/api/payments`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /create-session | JWT | Create Stripe Checkout Session |
| POST | /webhook | Stripe | Handle Stripe webhooks |
| GET | /:paymentId | JWT | Get payment detail |
| POST | /:paymentId/refund | Admin | Refund payment |

### Inventory (`/api/inventory`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | / | Admin | List all stock |
| GET | /:productId | Admin | Get stock for product |
| POST | / | Admin | Set initial stock |
| PUT | /:productId | Admin | Update stock |

### Analytics (`/api/analytics`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /orders/summary | Admin | Total orders, revenue, avg value |
| GET | /orders/daily | Admin | Orders per day |
| GET | /products/top | Admin | Top products by quantity |

---

## Event Flow

### Order Placement (End-to-End)

```
1. Customer → POST /api/orders
   Order Service: fetch cart, validate prices, create PENDING order
   Publishes: order.created → RabbitMQ

2. Inventory Service: consumes order.created
   Reserves stock (atomic SQL UPDATE WHERE)
   Publishes: inventory.reserved → RabbitMQ

3. Order Service: consumes inventory.reserved
   Updates order status: PENDING → CONFIRMED

4. Notification Service: consumes order.created + inventory.reserved
   Logs simulated email/SMS notifications

5. Analytics Service: consumes order.created
   Records order in analytics database

6. Customer → POST /api/orders/:id/pay
   Payment Service: creates Stripe Checkout Session
   Customer redirects to Stripe → pays
   Stripe fires webhook → Payment Service updates to COMPLETED
   Payment Service → Order Service: status → PAID
```

---

## Resume Bullet Points

- Designed and built a **cloud-native microservices e-commerce platform** with 8 independently deployable services communicating via REST APIs and RabbitMQ message queues
- Implemented **database-per-service pattern** using PostgreSQL (4 databases), MongoDB, and Redis, ensuring complete data isolation and independent scaling
- Built **event-driven inventory reservation** with atomic SQL operations, RabbitMQ topic exchanges, and fan-out pattern supporting 3 independent consumers
- Integrated **Stripe payment processing** with webhook signature verification (HMAC-SHA256), idempotent charge handling, and server-side Checkout Sessions
- Implemented **Redis cache-aside pattern** with TTL-based invalidation for product catalog, achieving sub-millisecond cache hit latency
- Built **JWT authentication** with access/refresh token rotation, bcrypt password hashing, role-based access control, and per-service token validation
- Containerized all services with **Docker + Docker Compose**, configured **GitHub Actions CI** with matrix builds, and wrote comprehensive API documentation

---

## Project Structure

```
├── gateway/                    # API Gateway (Express proxy)
├── services/
│   ├── auth-service/           # JWT auth, RBAC
│   ├── catalog-service/        # Products, categories, search
│   ├── cart-service/           # Shopping cart (Redis)
│   ├── order-service/          # Order lifecycle, RabbitMQ
│   ├── inventory-service/      # Stock management, RabbitMQ
│   ├── payment-service/        # Stripe integration
│   ├── notification-service/   # Simulated email/SMS
│   └── analytics-service/      # Sales metrics
├── docs/                       # Architecture & service docs
├── infra/                      # Postgres init scripts
├── .github/workflows/          # GitHub Actions CI
├── docker-compose.yml          # Full stack orchestration
├── AGENTS.md                   # Agent instructions
├── MEMORY.md                   # Project state
├── PHASES.md                   # Build phases
├── PRD.md                      # Product requirements
├── Technical_Specification.md  # Architecture spec
└── INTERVIEW_NOTES.md          # Interview prep
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | Service breakdown, communication patterns |
| [Auth](docs/auth.md) | JWT flow, refresh rotation, RBAC |
| [Catalog](docs/catalog.md) | Products, categories, search, image upload |
| [Caching](docs/caching.md) | Redis cache-aside pattern, TTL strategy |
| [Cart](docs/cart.md) | Guest/user carts, merge strategy |
| [Orders](docs/orders.md) | Order lifecycle, RabbitMQ events |
| [Messaging](docs/messaging.md) | RabbitMQ topology, fan-out pattern |
| [Payments](docs/payments.md) | Stripe integration, webhook verification |
| [Security](docs/security.md) | Helmet, CORS, input validation |
| [Deployment](docs/deployment.md) | Docker setup, production considerations |
| [Interview Q&A](docs/interview-qa.md) | Common interview questions & answers |

---

## License

This project is for educational/portfolio purposes.
