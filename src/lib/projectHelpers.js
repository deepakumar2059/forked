const { pool } = require('../config/db');

async function getProjectRow(projectId) {
  const [rows] = await pool.query(
    `SELECT p.*, u.email AS owner_email
     FROM projects p
     INNER JOIN users u ON u.id = p.owner_id
     WHERE p.id = ? LIMIT 1`,
    [projectId]
  );
  return rows[0] || null;
}

async function getRequiredSkillIds(projectId) {
  const [rows] = await pool.query(
    'SELECT skill_id FROM project_required_skills WHERE project_id = ?',
    [projectId]
  );
  return rows.map((r) => Number(r.skill_id));
}

async function getTeamMemberCount(projectId) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS c FROM project_team_members WHERE project_id = ?',
    [projectId]
  );
  return Number(rows[0]?.c || 0);
}

async function isTeamMember(projectId, userId) {
  const [rows] = await pool.query(
    'SELECT 1 FROM project_team_members WHERE project_id = ? AND user_id = ? LIMIT 1',
    [projectId, userId]
  );
  return Boolean(rows[0]);
}

async function canAccessTeamChannel(projectId, userId, ownerId) {
  if (userId === ownerId) return true;
  return isTeamMember(projectId, userId);
}

function serializeProject(row, extra = {}) {
  if (!row) return null;
  return {
    id: Number(row.id),
    owner_id: Number(row.owner_id),
    owner_email: row.owner_email,
    category_id: row.category_id != null ? Number(row.category_id) : null,
    title: row.title,
    description: row.description,
    team_size: Number(row.team_size),
    project_type: row.project_type,
    team_type: row.team_type,
    deadline: row.deadline,
    recruitment_status: row.recruitment_status,
    workflow_status: row.workflow_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...extra,
  };
}

module.exports = {
  getProjectRow,
  getRequiredSkillIds,
  getTeamMemberCount,
  isTeamMember,
  canAccessTeamChannel,
  serializeProject,
};
