const express = require('express');
const { pool } = require('../config/db');
const { asyncHandler } = require('../lib/asyncHandler');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query('SELECT id, name FROM skills ORDER BY name ASC');
    res.json({ skills: rows.map((r) => ({ id: Number(r.id), name: r.name })) });
  })
);

module.exports = router;
