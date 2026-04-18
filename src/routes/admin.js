const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');

const router = express.Router();

/** Bootstrap first admin (only when no admin exists) — no auth */
router.post(
  '/bootstrap',
  asyncHandler(async (req, res) => {
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_ADMIN_BOOTSTRAP !== 'true'
    ) {
      res.status(403).json({ error: 'forbidden', message: 'Bootstrap disabled in production' });
      return;
    }
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
    if (Number(n) > 0) {
      res.status(403).json({ error: 'forbidden', message: 'Admin already exists' });
      return;
    }
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password || password.length < 8) {
      res.status(400).json({ error: 'validation_error', message: 'email and password (min 8) required' });
      return;
    }
    const hash = await bcrypt.hash(password, 10);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [ins] = await conn.execute(
        "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')",
        [email, hash]
      );
      const id = ins.insertId;
      await conn.execute(
        'INSERT INTO profiles (user_id, display_name, branch, year, bio) VALUES (?, ?, NULL, NULL, NULL)',
        [id, 'Administrator']
      );
      await conn.commit();
      res.status(201).json({ ok: true, user_id: Number(id) });
    } catch (e) {
      await conn.rollback();
      if (e.code === 'ER_DUP_ENTRY') {
        res.status(409).json({ error: 'conflict', message: 'Email already registered' });
        return;
      }
      throw e;
    } finally {
      conn.release();
    }
  })
);

router.use(requireAuth, requireRole('admin'));

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.role, u.is_blocked, u.last_active_at, u.created_at,
              pr.display_name
       FROM users u
       LEFT JOIN profiles pr ON pr.user_id = u.id
       ORDER BY u.id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM users');
    res.json({
      users: rows.map((u) => ({
        id: Number(u.id),
        email: u.email,
        role: u.role,
        is_blocked: Boolean(u.is_blocked),
        last_active_at: u.last_active_at,
        created_at: u.created_at,
        display_name: u.display_name,
      })),
      page,
      limit,
      total: Number(total),
    });
  })
);

router.patch(
  '/users/:userId(\\d+)',
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    if (userId === req.user.id) {
      res.status(400).json({ error: 'validation_error', message: 'Use another admin to change your account' });
      return;
    }
    const { is_blocked: blocked } = req.body || {};
    if (typeof blocked !== 'boolean') {
      res.status(400).json({ error: 'validation_error', message: 'is_blocked boolean required' });
      return;
    }
    const [r] = await pool.execute('UPDATE users SET is_blocked = ? WHERE id = ?', [blocked ? 1 : 0, userId]);
    if (r.affectedRows === 0) {
      res.status(404).json({ error: 'not_found', message: 'User not found' });
      return;
    }
    res.json({ ok: true });
  })
);

router.delete(
  '/users/:userId(\\d+)',
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    if (userId === req.user.id) {
      res.status(400).json({ error: 'validation_error', message: 'Cannot delete yourself' });
      return;
    }
    const [r] = await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    if (r.affectedRows === 0) {
      res.status(404).json({ error: 'not_found', message: 'User not found' });
      return;
    }
    res.sendStatus(204);
  })
);

router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const status = req.query.status;
    let sql = `SELECT r.id, r.project_id, r.reporter_id, r.reason, r.status, r.created_at,
                      p.title AS project_title, u.email AS reporter_email
               FROM project_reports r
               INNER JOIN projects p ON p.id = r.project_id
               INNER JOIN users u ON u.id = r.reporter_id`;
    const params = [];
    if (status) {
      sql += ' WHERE r.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY r.created_at DESC LIMIT 200';
    const [rows] = await pool.query(sql, params);
    res.json({ reports: rows });
  })
);

router.patch(
  '/reports/:reportId(\\d+)',
  asyncHandler(async (req, res) => {
    const reportId = Number(req.params.reportId);
    const { status } = req.body || {};
    const allowed = new Set(['reviewed', 'dismissed', 'removed']);
    if (!allowed.has(status)) {
      res.status(400).json({ error: 'validation_error', message: 'Invalid status' });
      return;
    }

    const [repRows] = await pool.query('SELECT project_id FROM project_reports WHERE id = ? LIMIT 1', [
      reportId,
    ]);
    const rep = repRows[0];
    if (!rep) {
      res.status(404).json({ error: 'not_found', message: 'Report not found' });
      return;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        'UPDATE project_reports SET status = ? WHERE id = ?',
        [status, reportId]
      );
      if (status === 'removed') {
        await conn.execute('DELETE FROM projects WHERE id = ?', [rep.project_id]);
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

router.post(
  '/skills',
  asyncHandler(async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'validation_error', message: 'name required' });
      return;
    }
    try {
      const [ins] = await pool.execute('INSERT INTO skills (name) VALUES (?)', [name.slice(0, 100)]);
      res.status(201).json({ skill: { id: Number(ins.insertId), name: name.slice(0, 100) } });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        res.status(409).json({ error: 'conflict', message: 'Skill already exists' });
        return;
      }
      throw e;
    }
  })
);

router.patch(
  '/skills/:skillId(\\d+)',
  asyncHandler(async (req, res) => {
    const skillId = Number(req.params.skillId);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'validation_error', message: 'name required' });
      return;
    }
    try {
      const [r] = await pool.execute('UPDATE skills SET name = ? WHERE id = ?', [name.slice(0, 100), skillId]);
      if (r.affectedRows === 0) {
        res.status(404).json({ error: 'not_found', message: 'Skill not found' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        res.status(409).json({ error: 'conflict', message: 'Skill name already exists' });
        return;
      }
      throw e;
    }
  })
);

router.delete(
  '/skills/:skillId(\\d+)',
  asyncHandler(async (req, res) => {
    const skillId = Number(req.params.skillId);
    try {
      const [r] = await pool.execute('DELETE FROM skills WHERE id = ?', [skillId]);
      if (r.affectedRows === 0) {
        res.status(404).json({ error: 'not_found', message: 'Skill not found' });
        return;
      }
      res.sendStatus(204);
    } catch (e) {
      if (e.code === 'ER_ROW_IS_REFERENCED_2' || e.errno === 1451) {
        res.status(400).json({ error: 'validation_error', message: 'Skill is in use' });
        return;
      }
      throw e;
    }
  })
);

router.post(
  '/categories',
  asyncHandler(async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'validation_error', message: 'name required' });
      return;
    }
    try {
      const [ins] = await pool.execute('INSERT INTO project_categories (name) VALUES (?)', [
        name.slice(0, 100),
      ]);
      res.status(201).json({ category: { id: Number(ins.insertId), name: name.slice(0, 100) } });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        res.status(409).json({ error: 'conflict', message: 'Category already exists' });
        return;
      }
      throw e;
    }
  })
);

router.patch(
  '/categories/:categoryId(\\d+)',
  asyncHandler(async (req, res) => {
    const categoryId = Number(req.params.categoryId);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'validation_error', message: 'name required' });
      return;
    }
    try {
      const [r] = await pool.execute('UPDATE project_categories SET name = ? WHERE id = ?', [
        name.slice(0, 100),
        categoryId,
      ]);
      if (r.affectedRows === 0) {
        res.status(404).json({ error: 'not_found', message: 'Category not found' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        res.status(409).json({ error: 'conflict', message: 'Category name already exists' });
        return;
      }
      throw e;
    }
  })
);

router.delete(
  '/categories/:categoryId(\\d+)',
  asyncHandler(async (req, res) => {
    const categoryId = Number(req.params.categoryId);
    try {
      const [r] = await pool.execute('DELETE FROM project_categories WHERE id = ?', [categoryId]);
      if (r.affectedRows === 0) {
        res.status(404).json({ error: 'not_found', message: 'Category not found' });
        return;
      }
      res.sendStatus(204);
    } catch (e) {
      if (e.code === 'ER_ROW_IS_REFERENCED_2' || e.errno === 1451) {
        res.status(400).json({ error: 'validation_error', message: 'Category is in use' });
        return;
      }
      throw e;
    }
  })
);

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [[userCount]] = await pool.query('SELECT COUNT(*) AS c FROM users');
    const [[activeUsers]] = await pool.query(
      'SELECT COUNT(*) AS c FROM users WHERE last_active_at > DATE_SUB(NOW(), INTERVAL 7 DAY)'
    );
    const [[projectCount]] = await pool.query('SELECT COUNT(*) AS c FROM projects');
    const [[openRecruitment]] = await pool.query(
      "SELECT COUNT(*) AS c FROM projects WHERE recruitment_status = 'open'"
    );
    const [[reportsOpen]] = await pool.query("SELECT COUNT(*) AS c FROM project_reports WHERE status = 'open'");
    res.json({
      users_total: Number(userCount.c),
      users_active_7d: Number(activeUsers.c),
      projects_total: Number(projectCount.c),
      projects_open_recruitment: Number(openRecruitment.c),
      reports_open: Number(reportsOpen.c),
    });
  })
);

module.exports = router;
