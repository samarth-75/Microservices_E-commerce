/**
 * RefreshToken Model — Auth Service
 *
 * Stores hashed refresh tokens in Postgres. Why store them at all?
 *   - Enables server-side revocation (logout, password change, compromise).
 *   - Enables rotation detection: if a revoked token is reused, it means the
 *     token was stolen — we can revoke ALL tokens for that user (family rotation).
 *
 * Design decisions:
 *   - tokenHash is SHA-256 of the raw JWT refresh token. We don't store the raw
 *     token — just like passwords, the DB should never hold usable credentials.
 *     SHA-256 (not bcrypt) because refresh tokens are high-entropy random strings,
 *     not human-chosen passwords — dictionary attacks don't apply, and SHA-256 is
 *     fast enough for lookups.
 *   - expiresAt lets us clean up expired tokens with a periodic job or on lookup.
 *   - isRevoked flag supports immediate revocation without deleting the row
 *     (useful for audit trails and rotation-reuse detection).
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RefreshToken = sequelize.define('RefreshToken', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    tokenHash: {
        type: DataTypes.STRING(64), // SHA-256 hex digest is exactly 64 chars
        allowNull: false,
        unique: true,
        field: 'token_hash',
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: {
            model: 'users',
            key: 'id',
        },
    },
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
    },
    isRevoked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: 'is_revoked',
    },
}, {
    tableName: 'refresh_tokens',
    timestamps: true,
    underscored: true,
});

module.exports = RefreshToken;
