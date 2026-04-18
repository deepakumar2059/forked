const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');

const router = express.Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { skill_id: skillIdRaw, q, branch, year } = req.query;
    const skillIds = []
      .concat(skillIdRaw || [])
      .flatMap((x) => String(x).split(','))
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);

    let sql = `SELECT DISTINCT u.id, u.email, pr.display_name, pr.branch, pr.year
               FROM users u
               INNER JOIN profiles pr ON pr.user_id = u.id
               WHERE u.role != 'admin' AND u.is_blocked = 0 AND u.id != ?`;
    const params = [];
    params.push(req.user.id);

    if (skillIds.length > 0) {
      sql += ` AND EXISTS (
        SELECT 1 FROM user_skills us
        WHERE us.user_id = u.id AND us.skill_id IN (${skillIds.map(() => '?').join(',')})
      )`;
      params.push(...skillIds);
    }

    if (branch && String(branch).trim()) {
      sql += ' AND pr.branch LIKE ?';
      params.push(`%${String(branch).trim()}%`);
    }
    if (year && String(year).trim()) {
      sql += ' AND pr.year LIKE ?';
      params.push(`%${String(year).trim()}%`);
    }
    if (q && String(q).trim()) {
      const term = `%${String(q).trim()}%`;
      sql += ' AND (pr.display_name LIKE ? OR u.email LIKE ?)';
      params.push(term, term);
    }

    sql += ' ORDER BY pr.display_name ASC LIMIT 80';
    const [rows] = await pool.query(sql, params);

    const out = [];
    for (const r of rows) {
      const [sk] = await pool.query(
        `SELECT s.id, s.name FROM skills s
         INNER JOIN user_skills us ON us.skill_id = s.id
         WHERE us.user_id = ?
         ORDER BY s.name`,
        [r.id]
      );
      out.push({
        user_id: Number(r.id),
        email: r.email,
        display_name: r.display_name,
        branch: r.branch,
        year: r.year,
        skills: sk.map((s) => ({ id: Number(s.id), name: s.name })),
      });
    }
    res.json({ candidates: out });
  })
);

module.exports = router;
