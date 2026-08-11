/**
 * Rate Limiter Middleware — Auth Service
 *
 * Protects auth endpoints from brute-force attacks and credential stuffing.
 *
 * Configuration:
 *   - 10 requests per 15-minute window per IP on auth routes
 *   - Standard 429 response with Retry-After header
 *
 * Why rate-limit auth specifically?
 *   Login/signup are the most common targets for automated attacks. A brute-force
 *   attacker trying passwords needs thousands of attempts — limiting to 10/window
 *   makes that infeasible while not affecting real users.
 *
 * Production upgrade: use Redis as the store (instead of in-memory) so rate limits
 * work correctly across multiple service instances behind a load balancer.
 */

const rateLimit = require('express-rate-limit');

const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,                   // max 10 requests per window per IP
    standardHeaders: true,     // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,      // Disable the `X-RateLimit-*` headers

    message: {
        error: 'Too Many Requests',
        message: 'You have exceeded the rate limit. Please try again in 15 minutes.',
    },

    // Key by IP. In production behind a reverse proxy, trust the
    // X-Forwarded-For header (app.set('trust proxy', 1) in index.js).
    keyGenerator: (req) => req.ip,
});

module.exports = authRateLimiter;
