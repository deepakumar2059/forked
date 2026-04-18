-- Migration: unify idea_owner + skills_holder into one user role
--
-- Use this ONLY if you already have an existing database with old roles.
-- If you're setting up fresh, just re-run db/schema.sql instead.
--
-- Run (adjust DB name if needed):
--   mysql -u root -p student_collab < db/migrate_unify_users.sql

USE student_collab;

-- Expand enum to allow both old + new values temporarily
ALTER TABLE users
  MODIFY role ENUM('idea_owner', 'skills_holder', 'user', 'admin') NOT NULL;

-- Convert legacy roles to unified 'user'
UPDATE users
  SET role = 'user'
  WHERE role IN ('idea_owner', 'skills_holder');

-- Restrict enum to the final set
ALTER TABLE users
  MODIFY role ENUM('user', 'admin') NOT NULL DEFAULT 'user';

