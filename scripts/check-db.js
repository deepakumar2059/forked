#!/usr/bin/env node
require('../src/config/loadEnv');
const { pool } = require('../src/config/db');

async function main() {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    console.log('Database OK:', rows);
    process.exit(0);
  } catch (err) {
    console.error('Database connection failed.');
    console.error('Code:', err.code);
    console.error('Message:', err.message);
    console.error('');
    console.error('Fix: create .env in the project root (copy .env.example).');
    console.error('- If `mysql -u root -p` works: set MYSQL_PASSWORD in .env.');
    console.error('- If you only use `sudo mysql`: set MYSQL_SOCKET=/var/run/mysqld/mysqld.sock');
    console.error('  and MYSQL_USER=root with MYSQL_PASSWORD empty.');
    console.error('- Ensure the DB exists: mysql ... < db/schema.sql');
    process.exit(1);
  }
}

main();
