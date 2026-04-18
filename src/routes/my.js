const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');

const router = express.Router();

router.get(
  '/applications',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT pa.id, pa.status, pa.withdrawn, pa.created_at, pa.updated_at,
              p.id AS project_id, p.title, p.recruitment_status, p.workflow_status, p.project_type
       FROM project_applications pa
       INNER JOIN projects p ON p.id = pa.project_id
       WHERE pa.applicant_id = ?
       ORDER BY pa.updated_at DESC`,
      [req.user.id]
    );
    res.json({
      applications: rows.map((r) => ({
        id: Number(r.id),
        status: r.status,
        withdrawn: Boolean(r.withdrawn),
        created_at: r.created_at,
        updated_at: r.updated_at,
        project: {
          id: Number(r.project_id),
          title: r.title,
          recruitment_status: r.recruitment_status,
          workflow_status: r.workflow_status,
          project_type: r.project_type,
        },
      })),
    });
  })
);

module.exports = router;
