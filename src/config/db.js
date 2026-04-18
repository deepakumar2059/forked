require('./loadEnv');
const mysql = require('mysql2/promise');

function createPool() {
  const user = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD ?? '';
  const database = process.env.MYSQL_DATABASE || 'student_collab';
  const socketPath = process.env.MYSQL_SOCKET?.trim();

  const base = {
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
  };

  if (socketPath) {
    return mysql.createPool({ ...base, socketPath });
  }

  return mysql.createPool({
    ...base,
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
  });
}

const pool = createPool();

module.exports = { pool };
