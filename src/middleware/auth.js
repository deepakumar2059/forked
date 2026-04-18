const { pool } = require('../config/db');
const { verifyToken } = require('../lib/jwt');

function extractBearer(req) {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

async function requireAuth(req, res, next) {
  try {
    const token = extractBearer(req);
    if (!token) {
      res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid Authorization header' });
      return;
    }
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
      return;
    }
    const userId = decoded.sub;
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid token payload' });
      return;
    }
    const [rows] = await pool.query(
      'SELECT id, email, role, is_blocked FROM users WHERE id = :id LIMIT 1',
      { id: userId }
    );
    const user = rows[0];
    if (!user) {
      res.status(401).json({ error: 'unauthorized', message: 'User not found' });
      return;
    }
    if (user.is_blocked) {
      res.status(403).json({ error: 'forbidden', message: 'Account is blocked' });
      return;
    }
    req.user = {
      id: Number(user.id),
      email: user.email,
      role: user.role,
    };
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'forbidden', message: 'Insufficient role' });
      return;
    }
    next();
  };
}

async function optionalAuth(req, res, next) {
  try {
    const token = extractBearer(req);
    if (!token) {
      next();
      return;
    }
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      next();
      return;
    }
    const userId = decoded.sub;
    if (!userId) {
      next();
      return;
    }
    const [rows] = await pool.query(
      'SELECT id, email, role, is_blocked FROM users WHERE id = :id LIMIT 1',
      { id: userId }
    );
    const user = rows[0];
    if (!user || user.is_blocked) {
      next();
      return;
    }
    req.user = {
      id: Number(user.id),
      email: user.email,
      role: user.role,
    };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, requireRole, extractBearer, optionalAuth };
