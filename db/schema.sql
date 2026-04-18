-- Student Collaboration Platform — MySQL schema
-- Run: mysql -u root -p < db/schema.sql

CREATE DATABASE IF NOT EXISTS student_collab
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE student_collab;

-- ---------- Core users & auth ----------
CREATE TABLE users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  is_blocked    TINYINT(1) NOT NULL DEFAULT 0,
  last_active_at DATETIME(3) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role),
  KEY idx_users_blocked (is_blocked)
);

CREATE TABLE profiles (
  user_id       BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  display_name  VARCHAR(120) NOT NULL,
  branch        VARCHAR(120) NULL,
  year          VARCHAR(32) NULL,
  bio           TEXT NULL,
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE user_interests (
  user_id BIGINT UNSIGNED NOT NULL,
  tag     VARCHAR(80) NOT NULL,
  PRIMARY KEY (user_id, tag),
  CONSTRAINT fk_ui_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE past_projects (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  title       VARCHAR(200) NOT NULL,
  description TEXT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  KEY idx_pp_user (user_id)
);

-- ---------- Admin-managed taxonomy ----------
CREATE TABLE skills (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_skills_name (name)
);

CREATE TABLE project_categories (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pc_name (name)
);

CREATE TABLE user_skills (
  user_id  BIGINT UNSIGNED NOT NULL,
  skill_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, skill_id),
  CONSTRAINT fk_us_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_us_skill FOREIGN KEY (skill_id) REFERENCES skills (id) ON DELETE CASCADE
);

-- ---------- Projects ----------
CREATE TABLE projects (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_id           BIGINT UNSIGNED NOT NULL,
  category_id        BIGINT UNSIGNED NULL,
  title              VARCHAR(200) NOT NULL,
  description        TEXT NOT NULL,
  team_size          INT UNSIGNED NOT NULL DEFAULT 1,
  project_type       ENUM('hobby', 'startup', 'academic') NOT NULL,
  team_type          VARCHAR(80) NULL COMMENT 'e.g. remote, hybrid — filterable',
  deadline           DATE NULL,
  recruitment_status ENUM('open', 'finalized') NOT NULL DEFAULT 'open',
  workflow_status    ENUM('open', 'in_progress', 'completed') NOT NULL DEFAULT 'open',
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_proj_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_proj_cat FOREIGN KEY (category_id) REFERENCES project_categories (id) ON DELETE SET NULL,
  KEY idx_proj_owner (owner_id),
  KEY idx_proj_recruitment (recruitment_status),
  KEY idx_proj_type (project_type),
  KEY idx_proj_workflow (workflow_status)
);

CREATE TABLE project_required_skills (
  project_id BIGINT UNSIGNED NOT NULL,
  skill_id   BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (project_id, skill_id),
  CONSTRAINT fk_prs_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_prs_skill FOREIGN KEY (skill_id) REFERENCES skills (id) ON DELETE CASCADE
);

-- ---------- Applications & invitations ----------
CREATE TABLE project_applications (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id  BIGINT UNSIGNED NOT NULL,
  applicant_id BIGINT UNSIGNED NOT NULL,
  status      ENUM('pending', 'accepted', 'rejected', 'waitlisted') NOT NULL DEFAULT 'pending',
  withdrawn   TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pa_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_user FOREIGN KEY (applicant_id) REFERENCES users (id) ON DELETE CASCADE,
  UNIQUE KEY uq_pa_project_applicant (project_id, applicant_id),
  KEY idx_pa_applicant (applicant_id),
  KEY idx_pa_status (status, withdrawn)
);

CREATE TABLE project_invitations (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id  BIGINT UNSIGNED NOT NULL,
  inviter_id  BIGINT UNSIGNED NOT NULL,
  invitee_id  BIGINT UNSIGNED NOT NULL,
  status      ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pi_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_inviter FOREIGN KEY (inviter_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_invitee FOREIGN KEY (invitee_id) REFERENCES users (id) ON DELETE CASCADE,
  KEY idx_pi_invitee (invitee_id, status)
);

CREATE TABLE project_team_members (
  project_id BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  role_label VARCHAR(80) NULL COMMENT 'optional: e.g. developer',
  joined_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT fk_ptm_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_ptm_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ---------- Messaging (per-project discussion) ----------
CREATE TABLE project_messages (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  body       TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  KEY idx_pm_project_created (project_id, created_at)
);

-- ---------- Moderation ----------
CREATE TABLE project_reports (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id  BIGINT UNSIGNED NOT NULL,
  reporter_id BIGINT UNSIGNED NOT NULL,
  reason      TEXT NOT NULL,
  status      ENUM('open', 'reviewed', 'dismissed', 'removed') NOT NULL DEFAULT 'open',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pr_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_pr_reporter FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE CASCADE,
  KEY idx_pr_status (status)
);
