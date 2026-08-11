/**
 * Auth Routes — Auth Service
 *
 * Endpoints:
 *   POST /signup   — register a new user (customer by default)
 *   POST /login    — authenticate and get token pair
 *   POST /refresh  — exchange a valid refresh token for a new token pair
 *   POST /logout   — revoke the provided refresh token
 *   GET  /me       — return the current user's profile (requires valid access token)
 *
 * All routes use:
 *   - Joi input validation (via validate middleware)
 *   - Rate limiting (10 req/15 min per IP on signup/login/refresh)
 *   - Structured JSON responses
 *
 * Token flow:
 *   1. signup/login → issue access token + refresh token, store refresh hash in DB
 *   2. refresh → verify old refresh token, revoke it, issue new pair (rotation)
 *   3. logout → revoke the refresh token so it can't be reused
 *
 * Refresh token rotation — why?
 *   If a refresh token is stolen and the real user refreshes first, the stolen
 *   token becomes invalid immediately. If the attacker refreshes first, the real
 *   user's next refresh fails, signaling compromise. Either way, the window of
 *   exploitation is reduced to a single use.
 */

const express = require('express');
const bcrypt = require('bcrypt');
const { User, RefreshToken } = require('../models');
const {
    generateAccessToken,
    generateRefreshToken,
    verifyRefreshToken,
    getRefreshTokenExpiry,
} = require('../utils/jwt');
const { hashToken } = require('../utils/hash');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const authRateLimiter = require('../middleware/rateLimiter');
const validate = require('../middleware/validate');
const {
    signupSchema,
    loginSchema,
    refreshSchema,
} = require('../validations/auth.validation');

const router = express.Router();

// bcrypt cost factor — 12 rounds is a good balance between security and speed.
// At ~250ms per hash on modern hardware, it's slow enough to deter brute-force
// but fast enough not to degrade signup/login UX.
const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// POST /signup — Register a new user
// ---------------------------------------------------------------------------
router.post('/signup', authRateLimiter, validate(signupSchema), async (req, res, next) => {
    try {
        const { email, password, firstName, lastName, role } = req.body;

        // 1. Check if email already exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'A user with this email address already exists.',
            });
        }

        // 2. Hash the password with bcrypt
        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

        // 3. Create the user
        const user = await User.create({
            email,
            password: hashedPassword,
            firstName,
            lastName,
            role: role || 'customer',
        });

        // 4. Issue tokens
        const accessToken = generateAccessToken(user);
        const refreshTokenRaw = generateRefreshToken(user);

        // 5. Store the refresh token hash in DB
        await RefreshToken.create({
            tokenHash: hashToken(refreshTokenRaw),
            userId: user.id,
            expiresAt: getRefreshTokenExpiry(),
        });

        // 6. Return tokens + user info (never return the password hash)
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            event: 'user_signup',
            userId: user.id,
            email: user.email,
        }));

        res.status(201).json({
            message: 'User registered successfully.',
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
            },
            accessToken,
            refreshToken: refreshTokenRaw,
        });
    } catch (err) {
        next(err);
    }
});

// ---------------------------------------------------------------------------
// POST /login — Authenticate and get token pair
// ---------------------------------------------------------------------------
router.post('/login', authRateLimiter, validate(loginSchema), async (req, res, next) => {
    try {
        const { email, password } = req.body;

        // 1. Find user by email
        const user = await User.findOne({ where: { email } });
        if (!user) {
            // Generic message — don't reveal whether the email exists
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid email or password.',
            });
        }

        // 2. Compare password hash
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid email or password.',
            });
        }

        // 3. Issue tokens
        const accessToken = generateAccessToken(user);
        const refreshTokenRaw = generateRefreshToken(user);

        // 4. Store refresh token hash
        await RefreshToken.create({
            tokenHash: hashToken(refreshTokenRaw),
            userId: user.id,
            expiresAt: getRefreshTokenExpiry(),
        });

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            event: 'user_login',
            userId: user.id,
            email: user.email,
        }));

        res.json({
            message: 'Login successful.',
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
            },
            accessToken,
            refreshToken: refreshTokenRaw,
        });
    } catch (err) {
        next(err);
    }
});

// ---------------------------------------------------------------------------
// POST /refresh — Rotate refresh token (get new token pair)
// ---------------------------------------------------------------------------
router.post('/refresh', authRateLimiter, validate(refreshSchema), async (req, res, next) => {
    try {
        const { refreshToken: rawToken } = req.body;

        // 1. Verify the JWT signature and expiration
        let decoded;
        try {
            decoded = verifyRefreshToken(rawToken);
        } catch (err) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid or expired refresh token.',
            });
        }

        // 2. Look up the hashed token in DB
        const tokenHash = hashToken(rawToken);
        const storedToken = await RefreshToken.findOne({ where: { tokenHash } });

        if (!storedToken || storedToken.isRevoked) {
            // Token reuse detected — could indicate theft.
            // Production enhancement: revoke ALL tokens for this user (family rotation).
            console.log(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'warn',
                event: 'refresh_token_reuse_detected',
                userId: decoded.id,
                message: 'A revoked or unknown refresh token was used. Possible token theft.',
            }));

            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Refresh token has been revoked. Please log in again.',
            });
        }

        // 3. Check expiry (belt-and-suspenders — JWT expiry should catch this too)
        if (new Date() > storedToken.expiresAt) {
            await storedToken.update({ isRevoked: true });
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Refresh token has expired. Please log in again.',
            });
        }

        // 4. Revoke the old token (one-time use — this is the "rotation" part)
        await storedToken.update({ isRevoked: true });

        // 5. Find the user (they might have been deleted since the token was issued)
        const user = await User.findByPk(decoded.id);
        if (!user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'User no longer exists.',
            });
        }

        // 6. Issue new pair
        const newAccessToken = generateAccessToken(user);
        const newRefreshTokenRaw = generateRefreshToken(user);

        await RefreshToken.create({
            tokenHash: hashToken(newRefreshTokenRaw),
            userId: user.id,
            expiresAt: getRefreshTokenExpiry(),
        });

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            event: 'token_refresh',
            userId: user.id,
        }));

        res.json({
            message: 'Tokens refreshed successfully.',
            accessToken: newAccessToken,
            refreshToken: newRefreshTokenRaw,
        });
    } catch (err) {
        next(err);
    }
});

// ---------------------------------------------------------------------------
// POST /logout — Revoke the refresh token
// ---------------------------------------------------------------------------
router.post('/logout', authenticate, async (req, res, next) => {
    try {
        const { refreshToken: rawToken } = req.body;

        if (!rawToken) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'refreshToken is required in the request body.',
            });
        }

        // Revoke the specific token
        const tokenHash = hashToken(rawToken);
        const storedToken = await RefreshToken.findOne({ where: { tokenHash } });

        if (storedToken && !storedToken.isRevoked) {
            await storedToken.update({ isRevoked: true });
        }

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'info',
            event: 'user_logout',
            userId: req.user.id,
        }));

        // Always return 200 even if the token wasn't found — don't leak info
        res.json({ message: 'Logged out successfully.' });
    } catch (err) {
        next(err);
    }
});

// ---------------------------------------------------------------------------
// GET /me — Return current user info (auth required)
// ---------------------------------------------------------------------------
router.get('/me', authenticate, async (req, res, next) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: { exclude: ['password'] }, // Never return the password hash
        });

        if (!user) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found.',
            });
        }

        res.json({
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                createdAt: user.createdAt,
            },
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
