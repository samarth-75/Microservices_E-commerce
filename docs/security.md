# Security Practices — CommerceSphere

## Overview

This document covers the security measures implemented across the platform,
starting with the Auth Service (Phase 1) and expanding as services are added.

## Password Security

### Hashing: bcrypt
- **Algorithm:** bcrypt with 12 salt rounds (~250ms per hash on modern hardware)
- **Why bcrypt?** Intentionally slow — brute-forcing becomes infeasible even with GPU acceleration
- **Cost factor trade-off:** 12 rounds balances security vs. signup/login UX latency. Production can increase to 14+ if hardware allows.
- **Implementation:** `services/auth-service/src/routes/auth.routes.js` — `bcrypt.hash()` on signup, `bcrypt.compare()` on login

### What we DON'T do (and why)
- No password stored in plaintext or reversible encryption — ever
- No MD5/SHA for passwords (too fast, vulnerable to GPU attacks)
- Login returns generic "Invalid email or password" — never reveals whether the email exists

## Token Security

### Access Tokens (JWT)
- Short-lived (15 min) — limits damage if intercepted
- Signed with HMAC-SHA256 using a dedicated secret (`JWT_ACCESS_SECRET`)
- Payload contains only `{ id, email, role }` — no sensitive data
- Stateless — no server-side storage, so revocation relies on short TTL

### Refresh Tokens (JWT)
- Longer-lived (7 days) — stored as SHA-256 hash in Postgres
- Separate secret (`JWT_REFRESH_SECRET`) — compromising one doesn't break the other
- **One-time use (rotation):** each refresh invalidates the old token
- **Reuse detection:** if a revoked token is presented, it's logged as potential theft
- **Server-side revocation:** logout explicitly revokes the token in the database

### Why Two Secrets?
Defense in depth. If an attacker somehow extracts the access secret (e.g. from a memory dump),
they still can't forge refresh tokens, and vice versa.

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /auth/signup | 10 | 15 min |
| POST /auth/login | 10 | 15 min |
| POST /auth/refresh | 10 | 15 min |

- **Purpose:** prevents brute-force password guessing and credential stuffing
- **Key:** per-IP (via `req.ip` with `trust proxy` enabled)
- **Response:** `429 Too Many Requests` with `Retry-After` header
- **Production upgrade:** use Redis store for multi-instance correctness

## HTTP Security Headers (Helmet)

Applied globally on both the gateway and auth-service:
- `X-Content-Type-Options: nosniff` — prevents MIME type sniffing
- `X-Frame-Options: DENY` — prevents clickjacking
- `Strict-Transport-Security` — enforces HTTPS (when TLS termination is configured)
- `X-XSS-Protection` — legacy XSS filter (for older browsers)
- Content Security Policy — default restrictive policy

## CORS

- **Development:** all origins allowed (`cors()` with defaults)
- **Production:** should be restricted to the frontend domain only
- **Configuration:** gateway-level, not per-service (gateway is the only public entry point)

## Input Validation (Joi)

- Every endpoint validates `req.body` before any business logic
- Invalid requests get `400` with field-level error details
- `stripUnknown: true` — unexpected fields are silently removed
- Password complexity enforced: 8+ chars, mixed case, digit, special char

## RBAC (Role-Based Access Control)

- Two roles: `admin`, `customer` (ENUM on User model)
- Middleware chain: `authenticate → authorize('admin')` on protected routes
- Unauthorized (no token): `401`
- Forbidden (wrong role): `403` with descriptive message

## Secrets Management

- All secrets via environment variables (`.env` file, never committed)
- `.env.example` committed with placeholder values
- Docker Compose passes secrets via `environment:` section
- **Production:** use a secrets manager (AWS Secrets Manager, HashiCorp Vault)

## Database Security

- **Database-per-service:** auth-service can only access `commercesphere_auth`
- **Sequelize ORM:** parameterized queries prevent SQL injection
- **No raw SQL concatenation** — enforced by coding standards in `AGENTS.md`
- Non-root Docker user runs the service process (`appuser`)

## Request Tracing

- Every request gets a UUID (`x-request-id`) at the gateway
- Propagated to all downstream services via HTTP headers
- Structured JSON logs include `requestId` for cross-service correlation
- Enables tracing a single user action across gateway → auth → (future services)

## What's NOT Implemented Yet (and what to say in interviews)

| Missing | Why OK for now | Production version |
|---------|---------------|-------------------|
| HTTPS/TLS termination | Docker dev environment | NGINX/ALB with Let's Encrypt |
| Redis-backed rate limiting | Single instance | `rate-limit-redis` store |
| Refresh token family revocation | Logs warning on reuse | Revoke ALL user tokens on detected reuse |
| Account lockout after N failures | Rate limiter covers this | Exponential backoff + CAPTCHA |
| CSRF protection | API-only (no cookies yet) | Double-submit cookie pattern |
