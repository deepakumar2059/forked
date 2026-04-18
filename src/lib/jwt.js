const jwt = require('jsonwebtoken');

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 16) {
  throw new Error('JWT_SECRET must be set to a string at least 16 characters long');
}

const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

function signPayload(payload) {
  return jwt.sign(payload, secret, { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, secret);
}

module.exports = { signPayload, verifyToken };
