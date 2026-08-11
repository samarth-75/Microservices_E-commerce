# Auth Service — Design Document

## Overview

The Auth Service handles all authentication and authorization for CommerceSphere.
It is a standalone microservice with its own PostgreSQL database (`commercesphere_auth`),
following the database-per-service pattern.

**Port:** 3001 (internal, not exposed to host — accessed through the API Gateway at `:3000/api/auth/*`)

## Endpoints

| Method | Path | Auth Required | Rate Limited | Description |
|--------|------|---------------|-------------|-------------|
| POST | /auth/signup | No | Yes (10/15min) | Register a new user |
| POST | /auth/login | No | Yes (10/15min) | Authenticate, receive token pair |
| POST | /auth/refresh | No | Yes (10/15min) | Exchange refresh token for new pair |
| POST | /auth/logout | Yes (Bearer) | No | Revoke a refresh token |
| GET | /auth/me | Yes (Bearer) | No | Get current user info |
| GET | /health | No | No | Service health + DB dependency status |

## Authentication Flow

```
┌──────────┐     POST /signup or /login      ┌──────────────┐
│  Client  │ ──────────────────────────────►  │ Auth Service  │
│          │  ◄──────────────────────────────  │              │
│          │   { accessToken, refreshToken }   │  ┌────────┐  │
│          │                                   │  │Postgres│  │
│          │     GET /me (protected)           │  └────────┘  │
│          │  Authorization: Bearer <access>   │              │
│          │ ──────────────────────────────►   │              │
│          │  ◄──────────────────────────────  │              │
│          │       { user info }               │              │
│          │                                   │              │
│          │     POST /refresh                 │              │
│          │  { refreshToken: <old> }          │              │
│          │ ──────────────────────────────►   │              │
│          │  ◄──────────────────────────────  │              │
│          │   { new accessToken,              │              │
│          │     new refreshToken }            │              │
└──────────┘                                   └──────────────┘
```

## Token Strategy

### Access Token (JWT)
- **Lifetime:** 15 minutes (configurable via `JWT_ACCESS_EXPIRES_IN`)
- **Payload:** `{ id, email, role }`
- **Storage:** client-side (memory or localStorage)
- **Stateless:** the service never stores access tokens in the database

### Refresh Token (JWT)
- **Lifetime:** 7 days (configurable via `JWT_REFRESH_EXPIRES_IN`)
- **Payload:** `{ id }` (minimal — only used to issue new access tokens)
- **Storage:** SHA-256 hash stored in `refresh_tokens` table; raw token sent to client
- **Rotation:** one-time use — each refresh invalidates the old token and issues a new pair

### Why Two Tokens?
- Short-lived access tokens limit the damage window if intercepted.
- Long-lived refresh tokens provide UX convenience (no re-login every 15 min).
- Rotation ensures that if a refresh token is stolen, the theft is detected on next legitimate use.

### Why SHA-256 (not bcrypt) for Refresh Token Storage?
Refresh tokens are high-entropy random strings, not human-chosen passwords. Dictionary
attacks don't apply, so bcrypt's intentional slowness provides no security benefit but
adds unnecessary latency on every refresh operation.

## Refresh Token Rotation (Detailed)

1. Client sends `POST /refresh` with the current refresh token.
2. Server verifies the JWT signature and expiration.
3. Server looks up `SHA256(token)` in the `refresh_tokens` table.
4. If the hash is **not found** or **is_revoked = true** → reject + log a warning (possible token theft).
5. If valid → set `is_revoked = true` on the old token row.
6. Issue a new access token + new refresh token.
7. Store `SHA256(new_refresh_token)` in the database.
8. Return both new tokens to the client.

## RBAC (Role-Based Access Control)

Two roles: `admin` and `customer` (stored as ENUM on User model).

- **Customer** (default): can sign up, log in, view own profile.
- **Admin**: all customer permissions + future admin endpoints (catalog CRUD, order management).

Middleware chain: `authenticate → authorize('admin')` — authorize is a factory that checks `req.user.role`.

## Database Schema

### `users` table
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, auto-generated |
| email | VARCHAR(255) | NOT NULL, UNIQUE |
| password | VARCHAR(255) | NOT NULL (bcrypt hash) |
| first_name | VARCHAR(100) | NOT NULL |
| last_name | VARCHAR(100) | NOT NULL |
| role | ENUM('admin','customer') | NOT NULL, DEFAULT 'customer' |
| created_at | TIMESTAMP | auto |
| updated_at | TIMESTAMP | auto |

### `refresh_tokens` table
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, auto-generated |
| token_hash | VARCHAR(64) | NOT NULL, UNIQUE (SHA-256 hex) |
| user_id | UUID | NOT NULL, FK → users.id, CASCADE DELETE |
| expires_at | TIMESTAMP | NOT NULL |
| is_revoked | BOOLEAN | NOT NULL, DEFAULT false |
| created_at | TIMESTAMP | auto |
| updated_at | TIMESTAMP | auto |

## Rate Limiting

- **Scope:** `/auth/signup`, `/auth/login`, `/auth/refresh`
- **Limit:** 10 requests per 15-minute window per IP
- **Response on excess:** `429 Too Many Requests` with Retry-After header
- **Store:** in-memory (production: use Redis for multi-instance correctness)

## Input Validation

All endpoints validate `req.body` with Joi schemas before any business logic runs.
Invalid requests get a `400` response with field-level error details.

**Password rules:** min 8 chars, at least 1 uppercase, 1 lowercase, 1 digit, 1 special character.

## Code Pointers

| Concern | File |
|---------|------|
| Express app + /health | `services/auth-service/src/index.js` |
| Sequelize config | `services/auth-service/src/config/database.js` |
| User model | `services/auth-service/src/models/User.js` |
| RefreshToken model | `services/auth-service/src/models/RefreshToken.js` |
| Auth routes (signup/login/refresh/logout/me) | `services/auth-service/src/routes/auth.routes.js` |
| JWT generation/verification | `services/auth-service/src/utils/jwt.js` |
| Token hashing (SHA-256) | `services/auth-service/src/utils/hash.js` |
| Auth middleware (Bearer) | `services/auth-service/src/middleware/authenticate.js` |
| RBAC middleware | `services/auth-service/src/middleware/authorize.js` |
| Rate limiter | `services/auth-service/src/middleware/rateLimiter.js` |
| Joi validation middleware | `services/auth-service/src/middleware/validate.js` |
| Joi schemas | `services/auth-service/src/validations/auth.validation.js` |
