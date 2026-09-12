const { getMany } = require('../db/database');

async function getAffectedAssets(assetIds = [], serviceIds = []) {
  return getMany(
    `WITH related_services AS (
       SELECT UNNEST($2::uuid[]) AS service_id
       UNION
       SELECT sa.service_id
       FROM service_assets sa
       WHERE sa.asset_id = ANY($1::uuid[])
     ), scoped_assets AS (
       SELECT UNNEST($1::uuid[]) AS asset_id, TRUE AS is_direct
       UNION ALL
       SELECT sa.asset_id, FALSE AS is_direct
       FROM service_assets sa
       WHERE sa.service_id IN (SELECT service_id FROM related_services)
     )
     SELECT a.id, a.name, a.category, a.status, a.criticality, a.part_is_relevant,
            BOOL_OR(scoped_assets.is_direct) AS is_direct
     FROM scoped_assets
     JOIN assets a ON a.id=scoped_assets.asset_id
     GROUP BY a.id, a.name, a.category, a.status, a.criticality, a.part_is_relevant
     ORDER BY BOOL_OR(scoped_assets.is_direct) DESC, a.name`,
    [Array.isArray(assetIds) ? assetIds : [], Array.isArray(serviceIds) ? serviceIds : []]
  );
}

async function getAffectedServices(assetIds = [], serviceIds = []) {
  return getMany(
    `SELECT DISTINCT service_id
     FROM (
       SELECT UNNEST($2::uuid[]) AS service_id
       UNION
       SELECT sa.service_id
       FROM service_assets sa
       WHERE sa.asset_id = ANY($1::uuid[])
     ) related_services`,
    [Array.isArray(assetIds) ? assetIds : [], Array.isArray(serviceIds) ? serviceIds : []]
  );
}

async function getMaintenanceAffectedAssets(maintenanceId) {
  return getMany(
    `WITH related_services AS (
       SELECT service_id
       FROM maintenance_services
       WHERE maintenance_id=$1
       UNION
       SELECT sa.service_id
       FROM maintenance_assets ma
       JOIN service_assets sa ON sa.asset_id=ma.asset_id
       WHERE ma.maintenance_id=$1
     ), scoped_assets AS (
       SELECT asset_id, TRUE AS is_direct
       FROM maintenance_assets
       WHERE maintenance_id=$1
       UNION ALL
       SELECT sa.asset_id, FALSE AS is_direct
       FROM service_assets sa
       WHERE sa.service_id IN (SELECT service_id FROM related_services)
     )
     SELECT a.id, a.name, a.category, a.status, a.criticality, a.part_is_relevant,
            BOOL_OR(scoped_assets.is_direct) AS is_direct
     FROM scoped_assets
     JOIN assets a ON a.id=scoped_assets.asset_id
     GROUP BY a.id, a.name, a.category, a.status, a.criticality, a.part_is_relevant
     ORDER BY BOOL_OR(scoped_assets.is_direct) DESC, a.name`,
    [maintenanceId]
  );
}

async function getMaintenanceAffectedServices(maintenanceId) {
  return getMany(
    `SELECT DISTINCT service_id
     FROM (
       SELECT service_id
       FROM maintenance_services
       WHERE maintenance_id=$1
       UNION
       SELECT sa.service_id
       FROM maintenance_assets ma
       JOIN service_assets sa ON sa.asset_id=ma.asset_id
       WHERE ma.maintenance_id=$1
     ) related_services`,
    [maintenanceId]
  );
}

module.exports = {
  getAffectedAssets,
  getAffectedServices,
  getMaintenanceAffectedAssets,
  getMaintenanceAffectedServices,
};