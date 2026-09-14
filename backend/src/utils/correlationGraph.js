const { getMany, getOne } = require('../db/database');

/**
 * Builds a correlation graph for an asset or service.
 * Returns nodes and edges with relationship types and depths.
 */

async function buildAssetGraph(assetId, depth = 1) {
  // Start with the main asset
  const mainAsset = await getOne(
    `SELECT id, name, category, status, criticality, part_is_relevant FROM assets WHERE id = $1`,
    [assetId]
  );
  if (!mainAsset) return null;

  const nodes = [
    {
      id: assetId,
      label: mainAsset.name,
      type: 'asset',
      category: mainAsset.category,
      status: mainAsset.status,
      criticality: mainAsset.criticality,
      part_is_relevant: mainAsset.part_is_relevant,
      depth: 0,
      is_main: true,
    },
  ];

  const edges = [];
  const nodeIds = new Set([assetId]);

  // Depth 1: Direct service relationships
  if (depth >= 1) {
    const directServices = await getMany(
      `SELECT DISTINCT s.id, s.name, s.status, s.criticality
       FROM service_assets sa
       JOIN services s ON s.id = sa.service_id
       WHERE sa.asset_id = $1 AND s.is_active = true`,
      [assetId]
    );

    for (const svc of directServices) {
      if (!nodeIds.has(svc.id)) {
        nodes.push({
          id: svc.id,
          label: svc.name,
          type: 'service',
          status: svc.status,
          criticality: svc.criticality,
          depth: 1,
        });
        nodeIds.add(svc.id);
      }
      edges.push({
        source: assetId,
        target: svc.id,
        kind: 'asset_service',
        direction: 'asset_to_service',
        is_direct: true,
      });
    }

    // Depth 1: Other assets through same services
    const relatedAssets = await getMany(
      `SELECT DISTINCT a.id, a.name, a.category, a.status, a.criticality, a.part_is_relevant
       FROM service_assets sa1
       JOIN service_assets sa2 ON sa1.service_id = sa2.service_id
       JOIN assets a ON a.id = sa2.asset_id
       WHERE sa1.asset_id = $1 AND a.id != $1 AND a.is_active = true`,
      [assetId]
    );

    for (const ast of relatedAssets) {
      if (!nodeIds.has(ast.id)) {
        nodes.push({
          id: ast.id,
          label: ast.name,
          type: 'asset',
          category: ast.category,
          status: ast.status,
          criticality: ast.criticality,
          part_is_relevant: ast.part_is_relevant,
          depth: 1,
        });
        nodeIds.add(ast.id);
      }
      edges.push({
        source: assetId,
        target: ast.id,
        kind: 'shared_service',
        direction: 'bidirectional',
        is_direct: false,
      });
    }
  }

  // Depth 2: Expand from depth-1 services to other assets
  if (depth >= 2) {
    const depth1ServiceIds = nodes
      .filter(n => n.type === 'service' && n.depth === 1)
      .map(n => n.id);

    if (depth1ServiceIds.length > 0) {
      const depth2Assets = await getMany(
        `SELECT DISTINCT a.id, a.name, a.category, a.status, a.criticality, a.part_is_relevant
         FROM service_assets sa
         JOIN assets a ON a.id = sa.asset_id
         WHERE sa.service_id = ANY($1::uuid[])
         AND a.id != $2 AND a.id NOT IN (
           SELECT id FROM assets WHERE id = ANY(
             SELECT a2.id FROM service_assets sa2
             JOIN assets a2 ON a2.id = sa2.asset_id
             WHERE sa2.service_id IN (
               SELECT service_id FROM service_assets WHERE asset_id = $2
             )
           )
         )
         AND a.is_active = true
         LIMIT 15`,
        [depth1ServiceIds, assetId]
      );

      for (const ast of depth2Assets) {
        if (!nodeIds.has(ast.id)) {
          nodes.push({
            id: ast.id,
            label: ast.name,
            type: 'asset',
            category: ast.category,
            status: ast.status,
            criticality: ast.criticality,
            part_is_relevant: ast.part_is_relevant,
            depth: 2,
          });
          nodeIds.add(ast.id);

          // Connect to all intermediate services
          for (const svcId of depth1ServiceIds) {
            edges.push({
              source: svcId,
              target: ast.id,
              kind: 'asset_service',
              direction: 'service_to_asset',
              is_direct: false,
            });
          }
        }
      }
    }
  }

  return { nodes, edges, depth_limit: depth };
}

async function buildServiceGraph(serviceId, depth = 1) {
  // Start with the main service
  const mainService = await getOne(
    `SELECT id, name, status, criticality, is_public FROM services WHERE id = $1 AND is_active = true`,
    [serviceId]
  );
  if (!mainService) return null;

  const nodes = [
    {
      id: serviceId,
      label: mainService.name,
      type: 'service',
      status: mainService.status,
      criticality: mainService.criticality,
      is_public: mainService.is_public,
      depth: 0,
      is_main: true,
    },
  ];

  const edges = [];
  const nodeIds = new Set([serviceId]);

  // Depth 1: Direct asset relationships
  if (depth >= 1) {
    const directAssets = await getMany(
      `SELECT DISTINCT a.id, a.name, a.category, a.status, a.criticality, a.part_is_relevant
       FROM service_assets sa
       JOIN assets a ON a.id = sa.asset_id
       WHERE sa.service_id = $1 AND a.is_active = true`,
      [serviceId]
    );

    for (const ast of directAssets) {
      if (!nodeIds.has(ast.id)) {
        nodes.push({
          id: ast.id,
          label: ast.name,
          type: 'asset',
          category: ast.category,
          status: ast.status,
          criticality: ast.criticality,
          part_is_relevant: ast.part_is_relevant,
          depth: 1,
        });
        nodeIds.add(ast.id);
      }
      edges.push({
        source: serviceId,
        target: ast.id,
        kind: 'asset_service',
        direction: 'service_to_asset',
        is_direct: true,
      });
    }

    // Depth 1: Other services through same assets
    const relatedServices = await getMany(
      `SELECT DISTINCT s.id, s.name, s.status, s.criticality, s.is_public
       FROM service_assets sa1
       JOIN service_assets sa2 ON sa1.asset_id = sa2.asset_id
       JOIN services s ON s.id = sa2.service_id
       WHERE sa1.service_id = $1 AND s.id != $1 AND s.is_active = true`,
      [serviceId]
    );

    for (const svc of relatedServices) {
      if (!nodeIds.has(svc.id)) {
        nodes.push({
          id: svc.id,
          label: svc.name,
          type: 'service',
          status: svc.status,
          criticality: svc.criticality,
          is_public: svc.is_public,
          depth: 1,
        });
        nodeIds.add(svc.id);
      }
      edges.push({
        source: serviceId,
        target: svc.id,
        kind: 'shared_asset',
        direction: 'bidirectional',
        is_direct: false,
      });
    }
  }

  // Depth 2: Expand from depth-1 assets to other services
  if (depth >= 2) {
    const depth1AssetIds = nodes
      .filter(n => n.type === 'asset' && n.depth === 1)
      .map(n => n.id);

    if (depth1AssetIds.length > 0) {
      const depth2Services = await getMany(
        `SELECT DISTINCT s.id, s.name, s.status, s.criticality, s.is_public
         FROM service_assets sa
         JOIN services s ON s.id = sa.service_id
         WHERE sa.asset_id = ANY($1::uuid[])
         AND s.id != $2 AND s.id NOT IN (
           SELECT id FROM services WHERE id = ANY(
             SELECT s2.id FROM service_assets sa2
             JOIN services s2 ON s2.id = sa2.service_id
             WHERE sa2.asset_id IN (
               SELECT asset_id FROM service_assets WHERE service_id = $2
             )
           )
         )
         AND s.is_active = true
         LIMIT 15`,
        [depth1AssetIds, serviceId]
      );

      for (const svc of depth2Services) {
        if (!nodeIds.has(svc.id)) {
          nodes.push({
            id: svc.id,
            label: svc.name,
            type: 'service',
            status: svc.status,
            criticality: svc.criticality,
            is_public: svc.is_public,
            depth: 2,
          });
          nodeIds.add(svc.id);

          // Connect to all intermediate assets
          for (const astId of depth1AssetIds) {
            edges.push({
              source: astId,
              target: svc.id,
              kind: 'asset_service',
              direction: 'asset_to_service',
              is_direct: false,
            });
          }
        }
      }
    }
  }

  return { nodes, edges, depth_limit: depth };
}

module.exports = {
  buildAssetGraph,
  buildServiceGraph,
};
