/**
 * JWT Utility — Auth Service
 *
 * Centralizes all token generation and verification logic so route handlers
 * stay clean and token config lives in one place.
 *
 * Two token types:
 *   - Access token: short-lived (15 min default), sent in Authorization header,
 *     contains user id + email + role. Stateless — the service never stores it.
 *   - Refresh token: longer-lived (7 days default), stored hashed in Postgres,
 *     used to get a new access token without re-entering credentials.
 *
 * Why two secrets? If the access secret is compromised, refresh tokens remain
 * safe (and vice versa). Defense in depth.
 */

const jwt = require('jsonwebtoken');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_access_secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret';
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * Generate a short-lived access token.
 * Payload: { id, email, role } — keep it small, it's sent on every request.
 */
function generateAccessToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        ACCESS_SECRET,
        { expiresIn: ACCESS_EXPIRES }
    );
}

/**
 * Generate a longer-lived refresh token.
 * Payload: { id } — minimal, since it's only used to issue new access tokens.
 */
function generateRefreshToken(user) {
    return jwt.sign(
        { id: user.id },
        REFRESH_SECRET,
        { expiresIn: REFRESH_EXPIRES }
    );
}

/**
 * Verify and decode an access token.
 * Throws if expired, malformed, or wrong secret.
 */
function verifyAccessToken(token) {
    return jwt.verify(token, ACCESS_SECRET);
}

/**
 * Verify and decode a refresh token.
 * Throws if expired, malformed, or wrong secret.
 */
function verifyRefreshToken(token) {
    return jwt.verify(token, REFRESH_SECRET);
}

/**
 * Get the expiration date for a refresh token.
 * Used to set expiresAt in the database.
 */
function getRefreshTokenExpiry() {
    // Parse the REFRESH_EXPIRES string (e.g. '7d') into milliseconds
    const match = REFRESH_EXPIRES.match(/^(\d+)([smhd])$/);
    if (!match) {
        // Default to 7 days if format is unexpected
        return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return new Date(Date.now() + value * multipliers[unit]);
}

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    getRefreshTokenExpiry,
};
