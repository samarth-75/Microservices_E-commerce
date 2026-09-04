-- ============================================================
-- CommerceSphere — PostgreSQL Init Script
-- ============================================================
-- This script runs once when the Postgres container is first created
-- (i.e. when the pg_data volume is empty). It creates separate databases
-- for each service that uses PostgreSQL, enforcing the database-per-service
-- pattern: each service owns its own schema and no service can accidentally
-- query another service's tables.
--
-- To add a new database for a future service, add a CREATE DATABASE line
-- here and reference the new DB name in that service's environment config.
-- ============================================================

-- Auth Service database
CREATE DATABASE commercesphere_auth;

-- Order Service database
CREATE DATABASE commercesphere_orders;

-- Inventory Service database
CREATE DATABASE commercesphere_inventory;

-- Payment Service database
CREATE DATABASE commercesphere_payments;

-- Analytics Service database
CREATE DATABASE commercesphere_analytics;

-- Future services will get their own databases here:
