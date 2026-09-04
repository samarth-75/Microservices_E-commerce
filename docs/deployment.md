# docs/deployment.md — Deployment Guide

## Local Development (Docker Compose)

### Prerequisites

- **Docker Desktop** (v24+) with Docker Compose v2
- **4 GB RAM minimum** available for Docker (8 GB recommended for all 13 containers)
- **Stripe CLI** (optional — for webhook testing only)

### First-Time Setup

```bash
# 1. Clone the repository
git clone https://github.com/samarth-75/Microservices_E-commerce.git
cd Microservices_E-commerce

# 2. Create environment file
cp .env.example .env

# 3. (Optional) Set Stripe keys for payment testing
# Edit .env and set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET
# Get test keys from: https://dashboard.stripe.com/test/apikeys

# 4. Build and start all services
docker-compose up -d --build

# 5. Watch the logs (optional)
docker-compose logs -f

# 6. Verify all containers are healthy
docker-compose ps
```

### Container Map

| Container | Service | Port | Database |
|-----------|---------|------|----------|
| cs-postgres | PostgreSQL 16 | 5432 | Auth, Orders, Inventory, Payments, Analytics |
| cs-mongo | MongoDB 7 | 27017 | Catalog |
| cs-redis | Redis 7 | 6379 | Cache + Cart |
| cs-rabbitmq | RabbitMQ 3 | 5672 (AMQP), 15672 (UI) | Events |
| cs-auth-service | Auth | 3001 | — |
| cs-catalog-service | Catalog | 3002 | — |
| cs-cart-service | Cart | 3003 | — |
| cs-order-service | Order | 3004 | — |
| cs-inventory-service | Inventory | 3005 | — |
| cs-payment-service | Payment | 3006 | — |
| cs-notification-service | Notification | 3007 | — |
| cs-analytics-service | Analytics | 3008 | — |
| cs-gateway | API Gateway | 3000 | — |

### Startup Order

Docker Compose handles startup ordering via `depends_on` with health checks:

1. **Infrastructure** (parallel): Postgres, MongoDB, Redis, RabbitMQ
2. **Core services** (after infra healthy): Auth, Catalog
3. **Dependent services** (after core healthy): Cart → Order → Inventory → Payment
4. **Event consumers** (after RabbitMQ healthy): Notification, Analytics
5. **Gateway** (after ALL services healthy)

### Common Operations

```bash
# Rebuild a single service after code changes
docker-compose build order-service
docker-compose up -d order-service

# View logs for a specific service
docker-compose logs -f notification-service

# Reset everything (including databases)
docker-compose down -v
docker-compose up -d --build

# Stop without removing volumes
docker-compose down
```

### Known Issue: Postgres Init Script

The `infra/postgres/init.sql` script only runs when the Postgres data volume is first created. If you add a new database to `init.sql` and the volume already exists, the new database won't be created.

**Fix:** `docker-compose down -v` to remove volumes, then `docker-compose up -d`.

---

## Database-per-Service Pattern

Each service that uses PostgreSQL gets its own database, created by `infra/postgres/init.sql`:

| Database | Service |
|----------|---------|
| commercesphere_auth | Auth Service |
| commercesphere_orders | Order Service |
| commercesphere_inventory | Inventory Service |
| commercesphere_payments | Payment Service |
| commercesphere_analytics | Analytics Service |

MongoDB is used only by the Catalog Service (`commercesphere_catalog`).
Redis is shared by Catalog (cache) and Cart (primary store), but they use different key prefixes.

---

## RabbitMQ Management UI

Access at: http://localhost:15672
- **Username:** commercesphere (or value from `RABBITMQ_DEFAULT_USER`)
- **Password:** changeme_rabbit (or value from `RABBITMQ_DEFAULT_PASS`)

Use this to monitor:
- Exchange topology (order_events, inventory_events)
- Queue bindings and message rates
- Consumer connections per queue

---

## Stripe Webhook Testing

### Option 1: Stripe CLI (Recommended)
```bash
# Install Stripe CLI
# https://stripe.com/docs/stripe-cli

# Forward webhooks to local payment service
stripe listen --forward-to localhost:3006/payments/webhook

# Copy the webhook signing secret and set STRIPE_WEBHOOK_SECRET in .env
```

### Option 2: Without Stripe
The Payment Service starts without Stripe keys — it reports `stripe: "not_configured"` in `/health`. All other services work normally. Payment creation returns a configuration error, but the rest of the checkout flow (order creation, inventory reservation) works.

---

## CI/CD (GitHub Actions)

The `.github/workflows/ci.yml` pipeline runs on every push/PR to `main`:

1. **Test job** (matrix): Runs `npm ci`, `npm run lint`, `npm test` for each service in parallel
2. **Docker build job** (on merge to main only): Builds Docker images for all services to verify Dockerfiles

---

## Production Deployment Considerations

> **Note:** This project is designed for local Docker Compose deployment. The following are notes for what a production deployment would look like — useful for interview discussions.

### Container Orchestration
- **Kubernetes** or **AWS ECS** for container orchestration
- Each service as a separate Deployment/Service
- HPA (Horizontal Pod Autoscaler) for scaling based on CPU/memory

### Database
- **Managed PostgreSQL** (AWS RDS, Google Cloud SQL) per service
- Connection pooling with PgBouncer
- Read replicas for Analytics Service (read-heavy workload)

### Caching
- **Managed Redis** (AWS ElastiCache, Redis Cloud) with cluster mode
- Separate Redis instances for cache (Catalog) vs primary store (Cart)

### Messaging
- **Managed RabbitMQ** (CloudAMQP, Amazon MQ) or migration to **Kafka** for higher throughput
- Dead-letter queues for failed messages

### Security
- Service mesh (Istio/Linkerd) for mTLS between services
- API Gateway replaced with AWS API Gateway or Kong
- Secrets managed via Vault, AWS Secrets Manager, or K8s secrets

### Monitoring
- **Prometheus + Grafana** for metrics dashboards
- **ELK Stack** or **Datadog** for centralized logging
- Distributed tracing with **Jaeger** or **OpenTelemetry**

### CDN & Storage
- Product images on **S3 + CloudFront** (currently local disk)
- Static frontend assets on **Vercel** or **CloudFront**

---

## Simulated Components

Per PRD.md, the following are simulated rather than integrated with real providers:

| Component | Simulation | Production Swap |
|-----------|-----------|-----------------|
| Email notifications | Structured JSON log | SendGrid, Mailgun, AWS SES |
| SMS notifications | Structured JSON log | Twilio, AWS SNS |
| Product images | Local disk (multer) | S3 + CloudFront CDN |
| Search | MongoDB text index | Elasticsearch, Algolia |

The simulations are clearly documented in logs so the production swap path is obvious.
