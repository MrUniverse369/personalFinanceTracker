-- ============================================================
--  FINTRACK — Database Schema
-- ============================================================
 
-- Users
CREATE TABLE IF NOT EXISTS users (
    user_id    SERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    email      VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
 
-- Categories (seed data below)
CREATE TABLE IF NOT EXISTS categories (
    category_id SERIAL PRIMARY KEY,
    name        VARCHAR(50) UNIQUE NOT NULL
);
 
-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
    transaction_id SERIAL PRIMARY KEY,
    user_id        INT          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    date           DATE         NOT NULL,
    description    VARCHAR(255),
    amount         NUMERIC(10, 2) NOT NULL,
    category_id    INT          NOT NULL REFERENCES categories(category_id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
 
-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date    ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_users_email          ON users(email);
 
-- Seed categories (idempotent)
INSERT INTO categories (name) VALUES
    ('Food'),
    ('Transport'),
    ('Utilities'),
    ('Entertainment'),
    ('Other')
ON CONFLICT (name) DO NOTHING;
-- ============================================================
-- ER DIAGRAM (VISUAL REFERENCE)
-- ============================================================

-- +------------------+
-- |      users       |
-- +------------------+
-- | user_id (PK)     |
-- | name             |
-- | email (UNIQUE)   |
-- | created_at       |
-- +------------------+
--          |
--          | 1
--          |
--          | *
-- +----------------------+
-- |    transactions      |
-- +----------------------+
-- | transaction_id (PK)  |
-- | user_id (FK) --------+----> users.user_id
-- | date                 |
-- | description          |
-- | amount               |
-- | category_id (FK) ----+----> categories.category_id
-- | created_at           |
-- +----------------------+
--          |
--          | *
--          |
--          | 1
-- +------------------+
-- |   categories     |
-- +------------------+
-- | category_id (PK) |
-- | name (UNIQUE)    |
-- +------------------+

-- Relationships:
-- users (1) -------- (*) transactions
-- categories (1) --- (*) transactions