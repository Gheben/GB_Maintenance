const { Pool } = require('pg');
const logger = require('../utils/logger');

let pool = null;

function getPool() {
  if (!pool) throw new Error('Database not initialized. Call initDb() first.');
  return pool;
}

async function initDb() {
  pool = new Pool({
    host:     process.env.POSTGRES_HOST     || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB       || 'gbmaintenance',
    user:     process.env.POSTGRES_USER     || 'gbmaint',
    password: process.env.POSTGRES_PASSWORD || 'changeme',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Test connection
  const client = await pool.connect();
  logger.info('[DB] Connected to PostgreSQL');
  client.release();

  // Run migrations
  const { runMigrations } = require('./migrations');
  await runMigrations(pool);

  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function getOne(text, params) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

async function getMany(text, params) {
  const result = await query(text, params);
  return result.rows;
}

async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { initDb, getPool, query, getOne, getMany, transaction };
