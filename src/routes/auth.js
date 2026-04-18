const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const { signPayload } = require('../lib/jwt');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../lib/asyncHandler');

const router = express.Router();
const BCRYPT_ROUNDS = 10;
const PASSWORD_MIN = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function displayNameFromEmail(email) {
  const local = String(email).split('@')[0] || 'User';
  return local.slice(0, 120);
}

router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, display_name: displayName } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) {
    res.status(400).json({ error: 'validation_error', message: 'Valid email is required' });
    return;
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    res.status(400).json({
      error: 'validation_error',
      message: `Password must be at least ${PASSWORD_MIN} characters`,
    });
    return;
  }
  // Prefer unified role, but allow legacy DBs until migrated.
  const preferredRole = 'user';
  const legacyFallbackRole = 'skills_holder';

  const name =
    typeof displayName === 'string' && displayName.trim().length > 0
      ? displayName.trim().slice(0, 120)
      : displayNameFromEmail(normalizedEmail);

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let result;
    let role = preferredRole;
    try {
      [result] = await conn.execute('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', [
        normalizedEmail,
        passwordHash,
        role,
      ]);
    } catch (e) {
      const msg = String(e?.message || '');
      const isEnumRoleIssue =
        e?.code === 'ER_WRONG_VALUE_FOR_TYPE' ||
        e?.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' ||
        msg.includes('Incorrect') ||
        msg.includes('role');
      if (!isEnumRoleIssue) throw e;

      role = legacyFallbackRole;
      [result] = await conn.execute('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', [
        normalizedEmail,
        passwordHash,
        role,
      ]);
    }
    const userId = result.insertId;
    await conn.execute(
      'INSERT INTO profiles (user_id, display_name, branch, year, bio) VALUES (?, ?, NULL, NULL, NULL)',
      [userId, name]
    );
    await conn.commit();

    const token = signPayload({ sub: String(userId), role });
    res.status(201).json({
      token,
      user: { id: userId, email: normalizedEmail, role, display_name: name },
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'conflict', message: 'Email already registered' });
      return;
    }
    throw err;
  } finally {
    conn.release();
  }
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || typeof password !== 'string') {
    res.status(400).json({ error: 'validation_error', message: 'Email and password are required' });
    return;
  }

  const [rows] = await pool.query(
    'SELECT id, email, password_hash, role, is_blocked FROM users WHERE email = ? LIMIT 1',
    [normalizedEmail]
  );
  const user = rows[0];
  if (!user) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid email or password' });
    return;
  }
  if (user.is_blocked) {
    res.status(403).json({ error: 'forbidden', message: 'Account is blocked' });
    return;
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid email or password' });
    return;
  }

  await pool.query('UPDATE users SET last_active_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
    user.id,
  ]);

  const token = signPayload({ sub: String(user.id), role: user.role });
  res.json({
    token,
    user: { id: Number(user.id), email: user.email, role: user.role },
  });
}));

router.post('/logout', (_req, res) => {
  res.json({ ok: true });
});

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [prows] = await pool.query(
      'SELECT display_name, branch, year, bio FROM profiles WHERE user_id = ? LIMIT 1',
      [req.user.id]
    );
    const profile = prows[0] || null;
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        profile,
      },
    });
  })
);

module.exports = router;
