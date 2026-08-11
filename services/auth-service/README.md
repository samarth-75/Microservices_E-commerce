# Auth Service

> Part of CommerceSphere. See `docs/auth.md` for design.

Handles signup, login, JWT issue/refresh with token rotation, RBAC (Admin/Customer),
bcrypt password hashing, rate limiting, and Joi input validation.

**Status:** Phase 1 — implemented.

## Quick start (standalone, outside Docker)

```bash
cd services/auth-service
cp .env.example .env        # edit DB credentials + JWT secrets
npm install
npm run dev                  # starts with --watch on port 3001
```

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/signup | No | Register |
| POST | /auth/login | No | Log in |
| POST | /auth/refresh | No | Rotate tokens |
| POST | /auth/logout | Bearer | Revoke refresh token |
| GET | /auth/me | Bearer | Current user |
| GET | /health | No | Health + DB status |
