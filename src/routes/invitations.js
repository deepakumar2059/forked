const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');
const { getProjectRow, getTeamMemberCount } = require('../lib/projectHelpers');

const router = express.Router();
const IID = '/:invitationId(\\d+)';

router.get(
  '/inbox',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT pi.id, pi.project_id, pi.created_at, p.title, p.recruitment_status,
              u.email AS inviter_email, pr.display_name AS inviter_name
       FROM project_invitations pi
       INNER JOIN projects p ON p.id = pi.project_id
       INNER JOIN users u ON u.id = pi.inviter_id
       LEFT JOIN profiles pr ON pr.user_id = pi.inviter_id
       WHERE pi.invitee_id = ? AND pi.status = 'pending'
       ORDER BY pi.created_at DESC`,
      [req.user.id]
    );
    res.json({ invitations: rows });
  })
);

router.patch(
  IID,
  requireAuth,
  asyncHandler(async (req, res) => {
    const invitationId = Number(req.params.invitationId);
    const { status } = req.body || {};
    if (status !== 'accepted' && status !== 'rejected') {
      res.status(400).json({ error: 'validation_error', message: 'status must be accepted or rejected' });
      return;
    }

    const [invs] = await pool.query(
      `SELECT * FROM project_invitations WHERE id = ? AND invitee_id = ? LIMIT 1`,
      [invitationId, req.user.id]
    );
    const inv = invs[0];
    if (!inv || inv.status !== 'pending') {
      res.status(404).json({ error: 'not_found', message: 'Invitation not found' });
      return;
    }

    if (status === 'rejected') {
      await pool.execute(
        `UPDATE project_invitations SET status = 'rejected', updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [invitationId]
      );
      res.json({ ok: true });
      return;
    }

    const row = await getProjectRow(inv.project_id);
    if (!row) {
      res.status(404).json({ error: 'not_found', message: 'Project not found' });
      return;
    }
    if (row.recruitment_status !== 'open') {
      res.status(400).json({ error: 'validation_error', message: 'Recruitment is closed' });
      return;
    }

    const count = await getTeamMemberCount(inv.project_id);
    if (count >= Number(row.team_size)) {
      res.status(400).json({ error: 'validation_error', message: 'Team is full' });
      return;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `UPDATE project_invitations SET status = 'accepted', updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [invitationId]
      );
      await conn.execute(
        `INSERT IGNORE INTO project_team_members (project_id, user_id) VALUES (?, ?)`,
        [inv.project_id, req.user.id]
      );
      await conn.execute(
        `INSERT INTO project_applications (project_id, applicant_id, status, withdrawn)
         VALUES (?, ?, 'accepted', 0)
         ON DUPLICATE KEY UPDATE status = 'accepted', withdrawn = 0, updated_at = CURRENT_TIMESTAMP(3)`,
        [inv.project_id, req.user.id]
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

module.exports = router;
