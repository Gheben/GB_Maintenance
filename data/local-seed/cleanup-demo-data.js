#!/usr/bin/env node

const path = require('path');
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const MARKER = process.env.DEMO_SEED_MARKER || 'LOCAL_DEMO_SEED_V1';
const USER_PREFIX = 'zz_demo_owner_';
const ASSET_SLUG_PREFIX = 'demo-asset-';
const SERVICE_SLUG_PREFIX = 'demo-service-';

function makePool() {
  return new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'gbmaintenance',
    user: process.env.POSTGRES_USER || 'gbmaint',
    password: process.env.POSTGRES_PASSWORD || 'changeme',
  });
}

async function main() {
  const pool = makePool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const usersRes = await client.query(
      `SELECT id FROM users WHERE username LIKE $1`,
      [`${USER_PREFIX}%`]
    );
    const assetsRes = await client.query(
      `SELECT id FROM assets WHERE slug LIKE $1 OR description ILIKE $2`,
      [`${ASSET_SLUG_PREFIX}%`, `%${MARKER}%`]
    );
    const servicesRes = await client.query(
      `SELECT id FROM services WHERE slug LIKE $1 OR description ILIKE $2`,
      [`${SERVICE_SLUG_PREFIX}%`, `%${MARKER}%`]
    );
    const suppliersRes = await client.query(
      `SELECT id FROM suppliers WHERE notes ILIKE $1 OR company ILIKE $1`,
      [`%${MARKER}%`]
    );
    const licensesRes = await client.query(
      `SELECT id FROM licenses WHERE notes ILIKE $1 OR description ILIKE $1 OR name ILIKE $1`,
      [`%${MARKER}%`]
    );

    const userIds = usersRes.rows.map((r) => r.id);
    const assetIds = assetsRes.rows.map((r) => r.id);
    const serviceIds = servicesRes.rows.map((r) => r.id);
    const supplierIds = suppliersRes.rows.map((r) => r.id);
    const licenseIds = licensesRes.rows.map((r) => r.id);

    if (licenseIds.length) {
      await client.query(`DELETE FROM license_assets WHERE license_id = ANY($1::uuid[])`, [licenseIds]);
      await client.query(`DELETE FROM license_services WHERE license_id = ANY($1::uuid[])`, [licenseIds]);
    }

    if (assetIds.length) {
      await client.query(`DELETE FROM asset_dependencies WHERE asset_id = ANY($1::uuid[]) OR depends_on_id = ANY($1::uuid[])`, [assetIds]);
      await client.query(`DELETE FROM service_assets WHERE asset_id = ANY($1::uuid[])`, [assetIds]);
      await client.query(`DELETE FROM maintenance_assets WHERE asset_id = ANY($1::uuid[])`, [assetIds]).catch(() => {});
      await client.query(`DELETE FROM incident_assets WHERE asset_id = ANY($1::uuid[])`, [assetIds]).catch(() => {});
    }

    if (serviceIds.length) {
      await client.query(`DELETE FROM service_assets WHERE service_id = ANY($1::uuid[])`, [serviceIds]);
      await client.query(`DELETE FROM service_subscribers WHERE service_id = ANY($1::uuid[])`, [serviceIds]);
      await client.query(`DELETE FROM license_services WHERE service_id = ANY($1::uuid[])`, [serviceIds]);
      await client.query(`DELETE FROM maintenance_services WHERE service_id = ANY($1::uuid[])`, [serviceIds]).catch(() => {});
      await client.query(`DELETE FROM incident_services WHERE service_id = ANY($1::uuid[])`, [serviceIds]).catch(() => {});
      await client.query(`DELETE FROM service_dependencies WHERE service_id = ANY($1::uuid[]) OR depends_on_id = ANY($1::uuid[])`, [serviceIds]).catch(() => {});
    }

    if (userIds.length) {
      await client.query(`DELETE FROM user_group_members WHERE user_id = ANY($1::uuid[])`, [userIds]);
      await client.query(`DELETE FROM service_subscribers WHERE user_id = ANY($1::uuid[])`, [userIds]);
      await client.query(`DELETE FROM maintenance_status_subscribers WHERE user_id = ANY($1::uuid[])`, [userIds]).catch(() => {});
    }

    if (licenseIds.length) {
      await client.query(`DELETE FROM licenses WHERE id = ANY($1::uuid[])`, [licenseIds]);
    }
    if (serviceIds.length) {
      await client.query(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [serviceIds]);
    }
    if (assetIds.length) {
      await client.query(`DELETE FROM assets WHERE id = ANY($1::uuid[])`, [assetIds]);
    }
    if (supplierIds.length) {
      await client.query(`DELETE FROM suppliers WHERE id = ANY($1::uuid[])`, [supplierIds]);
    }
    if (userIds.length) {
      await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
    }

    await client.query('COMMIT');

    console.log('Demo cleanup completed successfully.');
    console.log(`Removed -> users:${userIds.length}, suppliers:${supplierIds.length}, assets:${assetIds.length}, services:${serviceIds.length}, licenses:${licenseIds.length}`);
    console.log(`Marker: ${MARKER}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Demo cleanup failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
