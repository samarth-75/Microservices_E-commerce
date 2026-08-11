/**
 * User Model — Auth Service
 *
 * Stores authentication-relevant user data only. Profile info (addresses,
 * preferences) belongs in the User Service (Phase N) — this model stays
 * lean: email, hashed password, role, and basic name fields.
 *
 * Design decisions:
 *   - UUID primary key: avoids sequential enumeration, safe to expose in URLs/JWTs.
 *   - Role as ENUM: simple two-role RBAC (admin/customer). If roles grow complex,
 *     switch to a join table — but for this project, ENUM is explainable and sufficient.
 *   - Password stored as bcrypt hash (see auth routes for hashing logic).
 *   - Email has a unique index for fast duplicate checks on signup.
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true,
        },
    },
    password: {
        type: DataTypes.STRING(255), // bcrypt hash output is ~60 chars
        allowNull: false,
    },
    firstName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'first_name', // snake_case column in Postgres
    },
    lastName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'last_name',
    },
    role: {
        type: DataTypes.ENUM('admin', 'customer'),
        defaultValue: 'customer',
        allowNull: false,
    },
}, {
    tableName: 'users',
    timestamps: true,      // adds createdAt, updatedAt
    underscored: true,     // uses snake_case column names in Postgres
});

module.exports = User;
