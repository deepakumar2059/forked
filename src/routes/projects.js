const express = require('express');
const { pool } = require('../config/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');
const {
  getProjectRow,
  getRequiredSkillIds,
  getTeamMemberCount,
  isTeamMember,
  canAccessTeamChannel,
  serializeProject,
} = require('../lib/projectHelpers');

const router = express.Router();
const PID = '/:projectId(\\d+)';

const PROJECT_TYPES = new Set(['hobby', 'startup', 'academic']);
const WORKFLOW = new Set(['open', 'in_progress', 'completed']);
const APP_STATUS = new Set(['accepted', 'rejected', 'waitlisted']);

function parsePid(req) {
  return Number(req.params.projectId);
}

async function loadProjectSkills(projectId) {
  const [rows] = await pool.query(
    `SELECT s.id, s.name FROM skills s
     INNER JOIN project_required_skills prs ON prs.skill_id = s.id
     WHERE prs.project_id = ?
     ORDER BY s.name`,
    [projectId]
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

async function setRequiredSkills(conn, projectId, skillIds) {
  await conn.execute('DELETE FROM project_required_skills WHERE project_id = ?', [projectId]);
  for (const sid of skillIds) {
    await conn.execute('INSERT INTO project_required_skills (project_id, skill_id) VALUES (?, ?)', [
      projectId,
      sid,
    ]);
  }
}

/** ---- Recommended (skills holder) ---- */
router.get(
  '/recommended',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [userSkills] = await pool.query(
      'SELECT skill_id FROM user_skills WHERE user_id = ?',
      [req.user.id]
    );
    const ids = userSkills.map((r) => Number(r.skill_id));
    if (ids.length === 0) {
      res.json({ projects: [] });
      return;
    }

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT p.*, u.email AS owner_email,
        (SELECT COUNT(*) FROM project_required_skills prs
         WHERE prs.project_id = p.id AND prs.skill_id IN (${placeholders})
        ) AS match_score
       FROM projects p
       INNER JOIN users u ON u.id = p.owner_id
       WHERE p.recruitment_status = 'open'
         AND EXISTS (
           SELECT 1 FROM project_required_skills prs2
           WHERE prs2.project_id = p.id AND prs2.skill_id IN (${placeholders})
         )
       ORDER BY match_score DESC, p.created_at DESC
       LIMIT 50`,
      [...ids, ...ids]
    );

    const out = [];
    for (const row of rows) {
      const skills = await loadProjectSkills(row.id);
      out.push({
        ...serializeProject(row),
        required_skills: skills,
        match_score: Number(row.match_score),
      });
    }
    res.json({ projects: out });
  })
);

/** ---- Owner dashboard ---- */
router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT p.*, u.email AS owner_email
       FROM projects p
       INNER JOIN users u ON u.id = p.owner_id
       WHERE p.owner_id = ?
       ORDER BY p.updated_at DESC`,
      [req.user.id]
    );
    const out = [];
    for (const row of rows) {
      const skills = await loadProjectSkills(row.id);
      const teamCount = await getTeamMemberCount(row.id);
      out.push({
        ...serializeProject(row),
        required_skills: skills,
        team_member_count: teamCount,
      });
    }
    res.json({ projects: out });
  })
);

/** ---- Browse open projects ---- */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { project_type: projectType, team_type: teamType, skill_id: skillIdRaw } = req.query;
    const skillIds = []
      .concat(skillIdRaw || [])
      .flatMap((x) => String(x).split(','))
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);

    let sql = `SELECT p.*, u.email AS owner_email
               FROM projects p
               INNER JOIN users u ON u.id = p.owner_id
               WHERE p.recruitment_status = 'open'`;
    const params = [];

    if (projectType) {
      if (!PROJECT_TYPES.has(projectType)) {
        res.status(400).json({ error: 'validation_error', message: 'Invalid project_type' });
        return;
      }
      sql += ' AND p.project_type = ?';
      params.push(projectType);
    }
    if (teamType && String(teamType).trim()) {
      sql += ' AND p.team_type LIKE ?';
      params.push(`%${String(teamType).trim()}%`);
    }
    if (skillIds.length > 0) {
      sql += ` AND EXISTS (
        SELECT 1 FROM project_required_skills prs
        WHERE prs.project_id = p.id AND prs.skill_id IN (${skillIds.map(() => '?').join(',')})
      )`;
      params.push(...skillIds);
    }

    sql += ' ORDER BY p.created_at DESC LIMIT 100';
    const [rows] = await pool.query(sql, params);
    const out = [];
    for (const row of rows) {
      const skills = await loadProjectSkills(row.id);
      out.push({ ...serializeProject(row), required_skills: skills });
    }
    res.json({ projects: out });
  })
);

/** ---- Create project ---- */
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      title,
      description,
      skill_ids: skillIdsRaw,
      team_size: teamSizeRaw,
      project_type: projectType,
      team_type: teamType,
      deadline,
      category_id: categoryId,
    } = req.body || {};

    const t = typeof title === 'string' ? title.trim() : '';
    const d = typeof description === 'string' ? description.trim() : '';
    if (!t || !d) {
      res.status(400).json({ error: 'validation_error', message: 'title and description are required' });
      return;
    }
    if (!PROJECT_TYPES.has(projectType)) {
      res.status(400).json({ error: 'validation_error', message: 'Invalid project_type' });
      return;
    }
    const teamSize = Number(teamSizeRaw);
    if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 500) {
      res.status(400).json({ error: 'validation_error', message: 'team_size must be 1–500' });
      return;
    }

    const skillIds = Array.isArray(skillIdsRaw)
      ? skillIdsRaw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    const uniqueSkills = [...new Set(skillIds)];

    if (uniqueSkills.length > 0) {
      const [found] = await pool.query('SELECT id FROM skills WHERE id IN (?)', [uniqueSkills]);
      if (found.length !== uniqueSkills.length) {
        res.status(400).json({ error: 'validation_error', message: 'Invalid skill id' });
        return;
      }
    }

    let deadlineVal = null;
    if (deadline !== undefined && deadline !== null && String(deadline).trim()) {
      const dt = String(deadline).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
        res.status(400).json({ error: 'validation_error', message: 'deadline must be YYYY-MM-DD' });
        return;
      }
      deadlineVal = dt;
    }

    let catId = null;
    if (categoryId != null && categoryId !== '') {
      const c = Number(categoryId);
      if (!Number.isInteger(c) || c <= 0) {
        res.status(400).json({ error: 'validation_error', message: 'Invalid category_id' });
        return;
      }
      const [cats] = await pool.query('SELECT id FROM project_categories WHERE id = ? LIMIT 1', [c]);
      if (!cats[0]) {
        res.status(400).json({ error: 'validation_error', message: 'Unknown category' });
        return;
      }
      catId = c;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [ins] = await conn.execute(
        `INSERT INTO projects
         (owner_id, category_id, title, description, team_size, project_type, team_type, deadline,
          recruitment_status, workflow_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 'open')`,
        [
          req.user.id,
          catId,
          t.slice(0, 200),
          d,
          teamSize,
          projectType,
          teamType == null || teamType === '' ? null : String(teamType).trim().slice(0, 80),
          deadlineVal,
        ]
      );
      const projectId = ins.insertId;
      await setRequiredSkills(conn, projectId, uniqueSkills);
      await conn.commit();

      const row = await getProjectRow(projectId);
      const skills = await loadProjectSkills(projectId);
      res.status(201).json({ project: { ...serializeProject(row), required_skills: skills } });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  })
);

/** ---- Suggested candidates (owner) ---- */
router.get(
  `${PID}/suggested-candidates`,
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    if (Number(row.owner_id) !== req.user.id) {
      res.status(403).json({ error: 'forbidden', message: 'Only the owner can view suggestions' });
      return;
    }

    const reqSkillIds = await getRequiredSkillIds(projectId);
    if (reqSkillIds.length === 0) {
      res.json({ candidates: [] });
      return;
    }

    const ph = reqSkillIds.map(() => '?').join(',');
    const [cands] = await pool.query(
      `SELECT u.id, u.email, pr.display_name, pr.branch, pr.year,
        COUNT(DISTINCT us.skill_id) AS match_score
       FROM users u
       INNER JOIN profiles pr ON pr.user_id = u.id
       INNER JOIN user_skills us ON us.user_id = u.id AND us.skill_id IN (${ph})
       WHERE u.role != 'admin' AND u.is_blocked = 0 AND u.id != ?
       GROUP BY u.id, u.email, pr.display_name, pr.branch, pr.year
       ORDER BY match_score DESC, pr.display_name ASC
       LIMIT 50`,
      [...reqSkillIds, row.owner_id]
    );

    const out = [];
    for (const c of cands) {
      const [sk] = await pool.query(
        `SELECT s.id, s.name FROM skills s
         INNER JOIN user_skills us ON us.skill_id = s.id
         WHERE us.user_id = ?
         ORDER BY s.name`,
        [c.id]
      );
      out.push({
        user_id: Number(c.id),
        email: c.email,
        display_name: c.display_name,
        branch: c.branch,
        year: c.year,
        match_score: Number(c.match_score),
        skills: sk.map((s) => ({ id: Number(s.id), name: s.name })),
      });
    }
    res.json({ candidates: out });
  })
);

/** ---- Invite (owner) ---- */
router.post(
  `${PID}/invitations`,
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    if (Number(row.owner_id) !== req.user.id) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    if (row.recruitment_status !== 'open') {
      res.status(400).json({ error: 'validation_error', message: 'Recruitment is closed' });
      return;
    }

    const inviteeId = Number(req.body?.invitee_id);
    if (!Number.isInteger(inviteeId) || inviteeId <= 0) {
      res.status(400).json({ error: 'validation_error', message: 'invitee_id required' });
      return;
    }

    const [users] = await pool.query(
      'SELECT id, role FROM users WHERE id = ? AND is_blocked = 0 LIMIT 1',
      [inviteeId]
    );
    const invitee = users[0];
    if (!invitee || invitee.role === 'admin') {
      res.status(400).json({ error: 'validation_error', message: 'Invalid invitee' });
      return;
    }
    if (inviteeId === req.user.id) {
      res.status(400).json({ error: 'validation_error', message: 'Cannot invite yourself' });
      return;
    }

    const [pending] = await pool.query(
      `SELECT id FROM project_invitations
       WHERE project_id = ? AND invitee_id = ? AND status = 'pending' LIMIT 1`,
      [projectId, inviteeId]
    );
    if (pending[0]) {
      res.status(409).json({ error: 'conflict', message: 'Invitation already pending' });
      return;
    }

    const [ins] = await pool.execute(
      `INSERT INTO project_invitations (project_id, inviter_id, invitee_id, status)
       VALUES (?, ?, ?, 'pending')`,
      [projectId, req.user.id, inviteeId]
    );
    res.status(201).json({ invitation: { id: Number(ins.insertId), project_id: projectId, invitee_id: inviteeId } });
  })
);

/** ---- Applications nested ---- */
const applicationsRouter = express.Router({ mergeParams: true });

applicationsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    if (row.recruitment_status !== 'open') {
      res.status(400).json({ error: 'validation_error', message: 'Recruitment is closed' });
      return;
    }
    if (Number(row.owner_id) === req.user.id) {
      res.status(400).json({ error: 'validation_error', message: 'Owner cannot apply' });
      return;
    }

    const [existing] = await pool.query(
      'SELECT id, status, withdrawn FROM project_applications WHERE project_id = ? AND applicant_id = ? LIMIT 1',
      [projectId, req.user.id]
    );

    if (existing[0]) {
      const ex = existing[0];
      if (!ex.withdrawn && ex.status === 'pending') {
        res.status(409).json({ error: 'conflict', message: 'Application already pending' });
        return;
      }
      if (ex.status === 'accepted') {
        res.status(409).json({ error: 'conflict', message: 'Already accepted on this project' });
        return;
      }
      await pool.execute(
        `UPDATE project_applications
         SET withdrawn = 0, status = 'pending', updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [ex.id]
      );
      res.status(200).json({ application: { id: Number(ex.id), status: 'pending', withdrawn: false } });
      return;
    }

    const [ins] = await pool.execute(
      `INSERT INTO project_applications (project_id, applicant_id, status, withdrawn)
       VALUES (?, ?, 'pending', 0)`,
      [projectId, req.user.id]
    );
    res.status(201).json({ application: { id: Number(ins.insertId), status: 'pending', withdrawn: false } });
  })
);

applicationsRouter.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    const [r] = await pool.execute(
      `UPDATE project_applications SET withdrawn = 1, updated_at = CURRENT_TIMESTAMP(3)
       WHERE project_id = ? AND applicant_id = ? AND withdrawn = 0`,
      [projectId, req.user.id]
    );
    if (r.affectedRows === 0) {
      res.status(404).json({ error: 'not_found', message: 'No active application' });
      return;
    }
    res.json({ ok: true });
  })
);

applicationsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    if (Number(row.owner_id) !== req.user.id) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const [apps] = await pool.query(
      `SELECT pa.id, pa.applicant_id, pa.status, pa.withdrawn, pa.created_at,
              u.email, pr.display_name, pr.branch, pr.year
       FROM project_applications pa
       INNER JOIN users u ON u.id = pa.applicant_id
       LEFT JOIN profiles pr ON pr.user_id = pa.applicant_id
       WHERE pa.project_id = ?
       ORDER BY pa.created_at DESC`,
      [projectId]
    );

    const out = [];
    for (const a of apps) {
      const [sk] = await pool.query(
        `SELECT s.id, s.name FROM skills s
         INNER JOIN user_skills us ON us.skill_id = s.id WHERE us.user_id = ? ORDER BY s.name`,
        [a.applicant_id]
      );
      out.push({
        id: Number(a.id),
        applicant_id: Number(a.applicant_id),
        status: a.status,
        withdrawn: Boolean(a.withdrawn),
        created_at: a.created_at,
        email: a.email,
        display_name: a.display_name,
        branch: a.branch,
        year: a.year,
        skills: sk.map((s) => ({ id: Number(s.id), name: s.name })),
      });
    }
    res.json({ applications: out });
  })
);

applicationsRouter.patch(
  '/:applicationId(\\d+)',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const applicationId = Number(req.params.applicationId);
    const { status } = req.body || {};

    if (!APP_STATUS.has(status)) {
      res.status(400).json({ error: 'validation_error', message: 'status must be accepted, rejected, or waitlisted' });
      return;
    }

    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    if (Number(row.owner_id) !== req.user.id) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    if (row.recruitment_status !== 'open') {
      res.status(400).json({ error: 'validation_error', message: 'Recruitment is closed' });
      return;
    }

    const [apps] = await pool.query(
      'SELECT * FROM project_applications WHERE id = ? AND project_id = ? LIMIT 1',
      [applicationId, projectId]
    );
    const appRow = apps[0];
    if (!appRow || appRow.withdrawn) {
      res.status(404).json({ error: 'not_found', message: 'Application not found' });
      return;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (status === 'accepted') {
        const count = await getTeamMemberCount(projectId);
        if (count >= Number(row.team_size)) {
          await conn.rollback();
          res.status(400).json({ error: 'validation_error', message: 'Team is full' });
          return;
        }
        await conn.execute(
          `UPDATE project_applications SET status = 'accepted', updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [applicationId]
        );
        await conn.execute(
          `INSERT IGNORE INTO project_team_members (project_id, user_id) VALUES (?, ?)`,
          [projectId, appRow.applicant_id]
        );
      } else {
        await conn.execute(
          `UPDATE project_applications SET status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [status, applicationId]
        );
        if (appRow.status === 'accepted') {
          await conn.execute('DELETE FROM project_team_members WHERE project_id = ? AND user_id = ?', [
            projectId,
            appRow.applicant_id,
          ]);
        }
      }

      await conn.commit();
      res.json({ ok: true });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  })
);

router.use(`${PID}/applications`, applicationsRouter);

/** ---- Messages ---- */
const messagesRouter = express.Router({ mergeParams: true });

messagesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    const ok = await canAccessTeamChannel(projectId, req.user.id, Number(row.owner_id));
    if (!ok) {
      res.status(403).json({ error: 'forbidden', message: 'Team members only' });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 80, 200);
    const [msgs] = await pool.query(
      `SELECT m.id, m.body, m.created_at, m.user_id, u.email, pr.display_name
       FROM project_messages m
       INNER JOIN users u ON u.id = m.user_id
       LEFT JOIN profiles pr ON pr.user_id = m.user_id
       WHERE m.project_id = ?
       ORDER BY m.created_at DESC
       LIMIT ?`,
      [projectId, limit]
    );
    res.json({
      messages: msgs.map((m) => ({
        id: Number(m.id),
        body: m.body,
        created_at: m.created_at,
        user_id: Number(m.user_id),
        email: m.email,
        display_name: m.display_name,
      })),
    });
  })
);

messagesRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    const ok = await canAccessTeamChannel(projectId, req.user.id, Number(row.owner_id));
    if (!ok) {
      res.status(403).json({ error: 'forbidden', message: 'Team members only' });
      return;
    }
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) {
      res.status(400).json({ error: 'validation_error', message: 'body is required' });
      return;
    }
    const [ins] = await pool.execute(
      'INSERT INTO project_messages (project_id, user_id, body) VALUES (?, ?, ?)',
      [projectId, req.user.id, body.slice(0, 8000)]
    );
    res.status(201).json({ message: { id: Number(ins.insertId) } });
  })
);

router.use(`${PID}/messages`, messagesRouter);

/** ---- Leave team ---- */
router.delete(
  `${PID}/team/me`,
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    if (Number(row.owner_id) === req.user.id) {
      res.status(400).json({ error: 'validation_error', message: 'Owner cannot leave via this action' });
      return;
    }
    if (row.workflow_status === 'completed') {
      res.status(400).json({ error: 'validation_error', message: 'Cannot leave a completed project' });
      return;
    }
    const [del] = await pool.execute(
      'DELETE FROM project_team_members WHERE project_id = ? AND user_id = ?',
      [projectId, req.user.id]
    );
    if (del.affectedRows === 0) {
      res.status(404).json({ error: 'not_found', message: 'You are not on this team' });
      return;
    }
    res.json({ ok: true });
  })
);

/** ---- Report project ---- */
router.post(
  `${PID}/report`,
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) {
      res.status(400).json({ error: 'validation_error', message: 'reason is required' });
      return;
    }
    await pool.execute(
      'INSERT INTO project_reports (project_id, reporter_id, reason, status) VALUES (?, ?, ?, ?)',
      [projectId, req.user.id, reason.slice(0, 4000), 'open']
    );
    res.status(201).json({ ok: true });
  })
);

/** ---- Finalize recruitment ---- */
router.post(
  `${PID}/finalize`,
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    if (Number(row.owner_id) !== req.user.id) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    if (row.recruitment_status !== 'open') {
      res.status(400).json({ error: 'validation_error', message: 'Already finalized' });
      return;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE projects SET recruitment_status = 'finalized', updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [projectId]
      );
      await conn.execute(
        `UPDATE project_applications SET status = 'rejected', updated_at = CURRENT_TIMESTAMP(3)
         WHERE project_id = ? AND status = 'pending' AND withdrawn = 0`,
        [projectId]
      );
      await conn.commit();
      res.json({ ok: true });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  })
);

/** ---- Workflow status ---- */
router.patch(
  `${PID}/workflow`,
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const { workflow_status: ws } = req.body || {};
    if (!WORKFLOW.has(ws)) {
      res.status(400).json({ error: 'validation_error', message: 'Invalid workflow_status' });
      return;
    }
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    if (Number(row.owner_id) !== req.user.id) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    await pool.execute(
      'UPDATE projects SET workflow_status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      [ws, projectId]
    );
    res.json({ ok: true });
  })
);

/** ---- Project detail (public + optional viewer) ---- */
router.get(
  PID,
  optionalAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }

    const [ownerProf] = await pool.query(
      'SELECT display_name FROM profiles WHERE user_id = ? LIMIT 1',
      [row.owner_id]
    );
    const skills = await loadProjectSkills(projectId);
    const teamCount = await getTeamMemberCount(projectId);

    const [members] = await pool.query(
      `SELECT ptm.user_id, ptm.joined_at, p.display_name, u.email
       FROM project_team_members ptm
       INNER JOIN users u ON u.id = ptm.user_id
       LEFT JOIN profiles p ON p.user_id = ptm.user_id
       WHERE ptm.project_id = ?
       ORDER BY ptm.joined_at ASC`,
      [projectId]
    );

    const payload = {
      ...serializeProject(row),
      required_skills: skills,
      team_member_count: teamCount,
      owner_display_name: ownerProf[0]?.display_name || null,
      team_members: members.map((m) => ({
        user_id: Number(m.user_id),
        display_name: m.display_name,
        email: m.email,
        joined_at: m.joined_at,
      })),
    };

    const uid = req.user?.id;
    if (uid) {
      const isOwner = uid === Number(row.owner_id);
      const onTeam = isOwner || (await isTeamMember(projectId, uid));

      const [apps] = await pool.query(
        `SELECT id, status, withdrawn, created_at FROM project_applications
         WHERE project_id = ? AND applicant_id = ? LIMIT 1`,
        [projectId, uid]
      );
      const [invs] = await pool.query(
        `SELECT id, status, created_at FROM project_invitations
         WHERE project_id = ? AND invitee_id = ? AND status = 'pending' LIMIT 1`,
        [projectId, uid]
      );

      payload.viewer = {
        is_owner: isOwner,
        is_team_member: onTeam,
        can_edit: isOwner && row.recruitment_status === 'open',
        application: apps[0]
          ? {
              id: Number(apps[0].id),
              status: apps[0].status,
              withdrawn: Boolean(apps[0].withdrawn),
              created_at: apps[0].created_at,
            }
          : null,
        pending_invitation: invs[0]
          ? { id: Number(invs[0].id), created_at: invs[0].created_at }
          : null,
      };
    }

    res.json({ project: payload });
  })
);

/** ---- Update / delete project ---- */
router.patch(
  PID,
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    if (Number(row.owner_id) !== req.user.id) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const {
      title,
      description,
      skill_ids: skillIdsRaw,
      team_size: teamSizeRaw,
      project_type: projectType,
      team_type: teamType,
      deadline,
      category_id: categoryId,
      workflow_status: workflowStatus,
    } = req.body || {};

    const updates = [];
    const params = [];

    const recruitmentOpen = row.recruitment_status === 'open';

    if (workflowStatus !== undefined) {
      if (!WORKFLOW.has(workflowStatus)) {
        res.status(400).json({ error: 'validation_error', message: 'Invalid workflow_status' });
        return;
      }
      updates.push('workflow_status = ?');
      params.push(workflowStatus);
    }

    if (!recruitmentOpen) {
      if (
        title !== undefined ||
        description !== undefined ||
        skillIdsRaw !== undefined ||
        teamSizeRaw !== undefined ||
        projectType !== undefined ||
        teamType !== undefined ||
        deadline !== undefined ||
        categoryId !== undefined
      ) {
        res.status(400).json({
          error: 'validation_error',
          message: 'Only workflow_status can change after recruitment is finalized',
        });
        return;
      }
    } else {
      if (title !== undefined) {
        const t = String(title).trim();
        if (!t) {
          res.status(400).json({ error: 'validation_error', message: 'title cannot be empty' });
          return;
        }
        updates.push('title = ?');
        params.push(t.slice(0, 200));
      }
      if (description !== undefined) {
        const d = String(description).trim();
        if (!d) {
          res.status(400).json({ error: 'validation_error', message: 'description cannot be empty' });
          return;
        }
        updates.push('description = ?');
        params.push(d);
      }
      if (teamSizeRaw !== undefined) {
        const ts = Number(teamSizeRaw);
        if (!Number.isInteger(ts) || ts < 1 || ts > 500) {
          res.status(400).json({ error: 'validation_error', message: 'Invalid team_size' });
          return;
        }
        const current = await getTeamMemberCount(projectId);
        if (ts < current) {
          res.status(400).json({
            error: 'validation_error',
            message: 'team_size cannot be below current team member count',
          });
          return;
        }
        updates.push('team_size = ?');
        params.push(ts);
      }
      if (projectType !== undefined) {
        if (!PROJECT_TYPES.has(projectType)) {
          res.status(400).json({ error: 'validation_error', message: 'Invalid project_type' });
          return;
        }
        updates.push('project_type = ?');
        params.push(projectType);
      }
      if (teamType !== undefined) {
        updates.push('team_type = ?');
        params.push(teamType == null || teamType === '' ? null : String(teamType).trim().slice(0, 80));
      }
      if (deadline !== undefined) {
        if (deadline === null || String(deadline).trim() === '') {
          updates.push('deadline = NULL');
        } else {
          const dt = String(deadline).slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
            res.status(400).json({ error: 'validation_error', message: 'deadline must be YYYY-MM-DD' });
            return;
          }
          updates.push('deadline = ?');
          params.push(dt);
        }
      }
      if (categoryId !== undefined) {
        if (categoryId === null || categoryId === '') {
          updates.push('category_id = NULL');
        } else {
          const c = Number(categoryId);
          if (!Number.isInteger(c) || c <= 0) {
            res.status(400).json({ error: 'validation_error', message: 'Invalid category_id' });
            return;
          }
          const [cats] = await pool.query('SELECT id FROM project_categories WHERE id = ? LIMIT 1', [c]);
          if (!cats[0]) {
            res.status(400).json({ error: 'validation_error', message: 'Unknown category' });
            return;
          }
          updates.push('category_id = ?');
          params.push(c);
        }
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (recruitmentOpen && skillIdsRaw !== undefined) {
        const skillIds = Array.isArray(skillIdsRaw)
          ? skillIdsRaw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
          : [];
        const uniqueSkills = [...new Set(skillIds)];
        if (uniqueSkills.length > 0) {
          const [found] = await conn.query('SELECT id FROM skills WHERE id IN (?)', [uniqueSkills]);
          if (found.length !== uniqueSkills.length) {
            await conn.rollback();
            res.status(400).json({ error: 'validation_error', message: 'Invalid skill id' });
            return;
          }
        }
        await setRequiredSkills(conn, projectId, uniqueSkills);
      }

      if (updates.length > 0) {
        params.push(projectId);
        await conn.execute(
          `UPDATE projects SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          params
        );
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    const fresh = await getProjectRow(projectId);
    const sk = await loadProjectSkills(projectId);
    res.json({ project: { ...serializeProject(fresh), required_skills: sk } });
  })
);

router.delete(
  PID,
  requireAuth,
  asyncHandler(async (req, res) => {
    const projectId = parsePid(req);
    const row = await getProjectRow(projectId);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    if (Number(row.owner_id) !== req.user.id) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    if (row.recruitment_status !== 'open') {
      res.status(400).json({ error: 'validation_error', message: 'Cannot delete after recruitment is finalized' });
      return;
    }
    await pool.execute('DELETE FROM projects WHERE id = ?', [projectId]);
    res.sendStatus(204);
  })
);

module.exports = router;
