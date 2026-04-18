const path = require('path');
require('./config/loadEnv');
const express = require('express');
const cors = require('cors');

const { pool } = require('./config/db');
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const skillsRoutes = require('./routes/skills');
const projectsRoutes = require('./routes/projects');
const invitationsRoutes = require('./routes/invitations');
const candidatesRoutes = require('./routes/candidates');
const categoriesRoutes = require('./routes/categories');
const myRoutes = require('./routes/my');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const api = express.Router();

api.use('/auth', authRoutes);
api.use('/profile', profileRoutes);
api.use('/skills', skillsRoutes);
api.use('/categories', categoriesRoutes);
api.use('/projects', projectsRoutes);
api.use('/invitations', invitationsRoutes);
api.use('/candidates', candidatesRoutes);
api.use('/my', myRoutes);
api.use('/admin', adminRoutes);

api.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, database: 'connected' });
  } catch (err) {
    const body = { ok: false, error: 'database_unavailable' };
    if (process.env.NODE_ENV !== 'production') {
      body.code = err.code;
      body.message = err.message;
    }
    res.status(503).json(body);
  }
});

app.use('/api', api);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'server_error', message: 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
