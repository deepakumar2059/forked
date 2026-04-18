const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');

const router = express.Router();

router.use(requireAuth);

async function loadFullProfile(userId) {
  const [profileRows] = await pool.query(
    'SELECT display_name, branch, year, bio FROM profiles WHERE user_id = ? LIMIT 1',
    [userId]
  );
  const profile = profileRows[0] || null;
  const [skillRows] = await pool.query(
    `SELECT s.id, s.name FROM skills s
     INNER JOIN user_skills us ON us.skill_id = s.id
     WHERE us.user_id = ?
     ORDER BY s.name`,
    [userId]
  );
  const [interestRows] = await pool.query(
    'SELECT tag FROM user_interests WHERE user_id = ? ORDER BY tag',
    [userId]
  );
  const [pastRows] = await pool.query(
    `SELECT id, title, description, created_at
     FROM past_projects WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );

  return {
    profile: profile || null,
    skills: skillRows.map((r) => ({ id: Number(r.id), name: r.name })),
    interests: interestRows.map((r) => r.tag),
    past_projects: pastRows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      description: r.description,
      created_at: r.created_at,
    })),
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const data = await loadFullProfile(req.user.id);
    res.json({
      email: req.user.email,
      role: req.user.role,
      ...data,
    });
  })
);

router.patch(
  '/',
  asyncHandler(async (req, res) => {
    const { display_name: displayName, branch, year, bio } = req.body || {};
    const updates = [];
    const params = [];

    if (displayName !== undefined) {
      const name = String(displayName).trim();
      if (!name) {
        res.status(400).json({ error: 'validation_error', message: 'display_name cannot be empty' });
        return;
      }
      updates.push('display_name = ?');
      params.push(name.slice(0, 120));
    }
    if (branch !== undefined) {
      updates.push('branch = ?');
      params.push(branch === null ? null : String(branch).trim().slice(0, 120) || null);
    }
    if (year !== undefined) {
      updates.push('year = ?');
      params.push(year === null ? null : String(year).trim().slice(0, 32) || null);
    }
    if (bio !== undefined) {
      updates.push('bio = ?');
      params.push(bio === null ? null : String(bio) || null);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'validation_error', message: 'No valid fields to update' });
      return;
    }

    params.push(req.user.id);
    await pool.query(`UPDATE profiles SET ${updates.join(', ')} WHERE user_id = ?`, params);

    const data = await loadFullProfile(req.user.id);
    res.json({
      email: req.user.email,
      role: req.user.role,
      ...data,
    });
  })
);

function normalizeSkillIds(raw) {
  if (!Array.isArray(raw)) return null;
  const ids = [];
  const seen = new Set();
  for (const x of raw) {
    const n = Number(x);
    if (!Number.isInteger(n) || n <= 0) return null;
    if (seen.has(n)) continue;
    seen.add(n);
    ids.push(n);
  }
  return ids;
}

router.put(
  '/skills',
  asyncHandler(async (req, res) => {
    const ids = normalizeSkillIds(req.body?.skill_ids);
    if (ids === null) {
      res.status(400).json({ error: 'validation_error', message: 'skill_ids must be an array of positive integers' });
      return;
    }

    if (ids.length > 0) {
      const [found] = await pool.query('SELECT id FROM skills WHERE id IN (?)', [ids]);
      if (found.length !== ids.length) {
        res.status(400).json({ error: 'validation_error', message: 'One or more skill ids are invalid' });
        return;
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM user_skills WHERE user_id = ?', [req.user.id]);
      for (const skillId of ids) {
        await conn.execute('INSERT INTO user_skills (user_id, skill_id) VALUES (?, ?)', [
          req.user.id,
          skillId,
        ]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    const data = await loadFullProfile(req.user.id);
    res.json({
      email: req.user.email,
      role: req.user.role,
      ...data,
    });
  })
);

function normalizeInterestTags(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (let t of raw) {
    if (typeof t !== 'string') return null;
    const tag = t.trim().slice(0, 80);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length > 64) return null;
  }
  return out;
}

router.put(
  '/interests',
  asyncHandler(async (req, res) => {
    const tags = normalizeInterestTags(req.body?.tags);
    if (tags === null) {
      res.status(400).json({
        error: 'validation_error',
        message: 'tags must be an array of strings (max 64 tags, 80 chars each)',
      });
      return;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM user_interests WHERE user_id = ?', [req.user.id]);
      for (const tag of tags) {
        await conn.execute('INSERT INTO user_interests (user_id, tag) VALUES (?, ?)', [
          req.user.id,
          tag,
        ]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    const data = await loadFullProfile(req.user.id);
    res.json({
      email: req.user.email,
      role: req.user.role,
      ...data,
    });
  })
);

router.post(
  '/past-projects',
  asyncHandler(async (req, res) => {
    const { title, description } = req.body || {};
    const t = typeof title === 'string' ? title.trim() : '';
    if (!t) {
      res.status(400).json({ error: 'validation_error', message: 'title is required' });
      return;
    }
    const desc = description === undefined || description === null ? null : String(description);
    const [result] = await pool.execute(
      'INSERT INTO past_projects (user_id, title, description) VALUES (?, ?, ?)',
      [req.user.id, t.slice(0, 200), desc]
    );
    res.status(201).json({
      past_project: {
        id: Number(result.insertId),
        title: t.slice(0, 200),
        description: desc,
      },
    });
  })
);

router.patch(
  '/past-projects/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'validation_error', message: 'Invalid id' });
      return;
    }
    const [rows] = await pool.query(
      'SELECT id FROM past_projects WHERE id = ? AND user_id = ? LIMIT 1',
      [id, req.user.id]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'not_found', message: 'Past project not found' });
      return;
    }

    const { title, description } = req.body || {};
    const updates = [];
    const params = [];
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
      updates.push('description = ?');
      params.push(description === null ? null : String(description));
    }
    if (updates.length === 0) {
      res.status(400).json({ error: 'validation_error', message: 'No valid fields to update' });
      return;
    }
    params.push(id, req.user.id);
    await pool.query(`UPDATE past_projects SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, params);
    res.json({ ok: true });
  })
);

router.delete(
  '/past-projects/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'validation_error', message: 'Invalid id' });
      return;
    }
    const [result] = await pool.execute('DELETE FROM past_projects WHERE id = ? AND user_id = ?', [
      id,
      req.user.id,
    ]);
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'not_found', message: 'Past project not found' });
      return;
    }
    res.sendStatus(204);
  })
);

module.exports = router;
