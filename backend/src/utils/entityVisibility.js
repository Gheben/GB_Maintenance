const { getMany, getOne } = require('../db/database');

const PRIVILEGED_ROLES = new Set(['superadmin', 'admin', 'change_manager']);

async function resolveViewer({ userId = null, email = null, role = null } = {}) {
  if (userId) {
    const user = await getOne(
      `SELECT id, username, email, role, auth_type FROM users WHERE id=$1 AND is_active=true`,
      [userId]
    ).catch(() => null);
    return user || { id: userId, email, role };
  }
  if (!email) return null;
  return getOne(
    `SELECT id, username, email, role, auth_type
     FROM users
     WHERE is_active=true AND LOWER(email)=LOWER($1)
     LIMIT 1`,
    [email]
  ).catch(() => null);
}

async function getVisibleAffectedScope({ userId = null, email = null, role = null } = {}, assets = [], services = []) {
  const viewer = await resolveViewer({ userId, email, role });
  if (viewer && PRIVILEGED_ROLES.has(viewer.role)) return { assets, services };

  const assetIds = assets.map((asset) => asset.id).filter(Boolean);
  const serviceIds = services.map((service) => service.id || service.service_id).filter(Boolean);
  const viewerId = viewer?.id || null;
  const viewerEmail = String(viewer?.email || email || '').trim() || null;

  const visibleServiceRows = serviceIds.length > 0 ? await getMany(
    `WITH viewer_identity AS (
       SELECT u.id, u.username, u.email
       FROM users u
       WHERE u.id=$2::uuid AND u.is_active=true
     ), viewer_ldap AS (
       SELECT lc.*
       FROM ldap_users_cache lc
       LEFT JOIN viewer_identity vi ON true
       WHERE (NULLIF(BTRIM(lc.username), '') IS NOT NULL AND NULLIF(BTRIM(vi.username), '') IS NOT NULL AND LOWER(lc.username)=LOWER(vi.username))
         OR (NULLIF(BTRIM(lc.email), '') IS NOT NULL AND NULLIF(BTRIM(vi.email), '') IS NOT NULL AND LOWER(lc.email)=LOWER(vi.email))
         OR (NULLIF(BTRIM(lc.upn), '') IS NOT NULL AND NULLIF(BTRIM(vi.email), '') IS NOT NULL AND LOWER(lc.upn)=LOWER(vi.email))
          OR ($3::text IS NOT NULL AND LOWER(COALESCE(lc.email, ''))=LOWER($3::text))
     )
     SELECT DISTINCT s.id
     FROM services s
     WHERE s.id=ANY($1::uuid[])
       AND (
         (s.is_public=true AND s.is_active=true)
         OR s.owner_id=$2::uuid
         OR EXISTS (SELECT 1 FROM user_group_members ugm WHERE ugm.group_id=s.owner_group_id AND ugm.user_id=$2::uuid)
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(COALESCE(s.owner_targets, '[]'::jsonb) || COALESCE(s.user_targets, '[]'::jsonb)) target
           WHERE (target->>'type'='user' AND target->>'id'=$2::text)
              OR (target->>'type'='local_group' AND (target->>'id') ~* '^[0-9a-f-]{36}$' AND (
                  EXISTS (SELECT 1 FROM user_group_members ugm WHERE ugm.group_id=(target->>'id')::uuid AND ugm.user_id=$2::uuid)
                  OR EXISTS (
                    SELECT 1 FROM ldap_group_mappings lgm
                    JOIN viewer_ldap vl ON EXISTS (
                      SELECT 1 FROM jsonb_array_elements_text(COALESCE(vl.source_payload->'memberOf', vl.source_payload->'memberof', '[]'::jsonb)) member(dn)
                      WHERE LOWER(member.dn)=LOWER(lgm.ldap_group_dn)
                         OR SPLIT_PART(LOWER(member.dn), ',', 1)=SPLIT_PART(LOWER(lgm.ldap_group_dn), ',', 1)
                    )
                    WHERE lgm.local_group_id=(target->>'id')::uuid
                  )
              ))
              OR (target->>'type'='ldap_user' AND EXISTS (
                  SELECT 1 FROM viewer_ldap vl
                  WHERE (NULLIF(BTRIM(COALESCE(target->>'dn', target->>'id', '')), '') IS NOT NULL AND (
                           LOWER(COALESCE(target->>'dn', target->>'id'))=LOWER(NULLIF(BTRIM(vl.dn), ''))
                           OR LOWER(COALESCE(target->>'dn', target->>'id'))=LOWER(NULLIF(BTRIM(vl.username), ''))
                           OR LOWER(COALESCE(target->>'dn', target->>'id'))=LOWER(NULLIF(BTRIM(vl.upn), ''))
                         ))
                     OR (NULLIF(BTRIM(target->>'email'), '') IS NOT NULL AND NULLIF(BTRIM(vl.email), '') IS NOT NULL
                         AND LOWER(target->>'email')=LOWER(vl.email))
              ))
              OR (target->>'type'='ldap_group' AND EXISTS (
                  SELECT 1 FROM viewer_ldap vl
                  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(vl.source_payload->'memberOf', vl.source_payload->'memberof', '[]'::jsonb)) member(dn)
                  WHERE NULLIF(BTRIM(COALESCE(target->>'dn', target->>'id', '')), '') IS NOT NULL
                    AND (LOWER(member.dn)=LOWER(COALESCE(target->>'dn', target->>'id'))
                         OR SPLIT_PART(LOWER(member.dn), ',', 1)=SPLIT_PART(LOWER(COALESCE(target->>'dn', target->>'id')), ',', 1))
              ))
         )
         OR EXISTS (
           SELECT 1 FROM service_subscribers ss
           WHERE ss.service_id=s.id
             AND (ss.user_id=$2::uuid OR ($3::text IS NOT NULL AND LOWER(ss.email)=LOWER($3::text)))
         )
       )`,
    [serviceIds, viewerId, viewerEmail]
  ).catch(() => []) : [];
  const visibleServiceIds = visibleServiceRows.map((row) => row.id);

  const visibleAssetRows = assetIds.length > 0 ? await getMany(
    `WITH viewer_identity AS (
       SELECT u.id, u.username, u.email
       FROM users u
       WHERE u.id=$2::uuid AND u.is_active=true
     ), viewer_ldap AS (
       SELECT lc.*
       FROM ldap_users_cache lc
       LEFT JOIN viewer_identity vi ON true
       WHERE (NULLIF(BTRIM(lc.username), '') IS NOT NULL AND NULLIF(BTRIM(vi.username), '') IS NOT NULL AND LOWER(lc.username)=LOWER(vi.username))
         OR (NULLIF(BTRIM(lc.email), '') IS NOT NULL AND NULLIF(BTRIM(vi.email), '') IS NOT NULL AND LOWER(lc.email)=LOWER(vi.email))
         OR (NULLIF(BTRIM(lc.upn), '') IS NOT NULL AND NULLIF(BTRIM(vi.email), '') IS NOT NULL AND LOWER(lc.upn)=LOWER(vi.email))
          OR ($3::text IS NOT NULL AND LOWER(COALESCE(lc.email, ''))=LOWER($3::text))
     )
     SELECT DISTINCT a.id
     FROM assets a
     WHERE a.id=ANY($1::uuid[])
       AND (
         a.owner_id=$2::uuid
         OR EXISTS (SELECT 1 FROM user_group_members ugm WHERE ugm.group_id=a.owner_group_id AND ugm.user_id=$2::uuid)
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(COALESCE(a.owner_targets, '[]'::jsonb) || COALESCE(a.user_targets, '[]'::jsonb)) target
           WHERE (target->>'type'='user' AND target->>'id'=$2::text)
              OR (target->>'type'='local_group' AND (target->>'id') ~* '^[0-9a-f-]{36}$' AND (
                  EXISTS (SELECT 1 FROM user_group_members ugm WHERE ugm.group_id=(target->>'id')::uuid AND ugm.user_id=$2::uuid)
                  OR EXISTS (
                    SELECT 1 FROM ldap_group_mappings lgm
                    JOIN viewer_ldap vl ON EXISTS (
                      SELECT 1 FROM jsonb_array_elements_text(COALESCE(vl.source_payload->'memberOf', vl.source_payload->'memberof', '[]'::jsonb)) member(dn)
                      WHERE LOWER(member.dn)=LOWER(lgm.ldap_group_dn)
                         OR SPLIT_PART(LOWER(member.dn), ',', 1)=SPLIT_PART(LOWER(lgm.ldap_group_dn), ',', 1)
                    )
                    WHERE lgm.local_group_id=(target->>'id')::uuid
                  )
              ))
              OR (target->>'type'='ldap_user' AND EXISTS (
                  SELECT 1 FROM viewer_ldap vl
                  WHERE (NULLIF(BTRIM(COALESCE(target->>'dn', target->>'id', '')), '') IS NOT NULL AND (
                           LOWER(COALESCE(target->>'dn', target->>'id'))=LOWER(NULLIF(BTRIM(vl.dn), ''))
                           OR LOWER(COALESCE(target->>'dn', target->>'id'))=LOWER(NULLIF(BTRIM(vl.username), ''))
                           OR LOWER(COALESCE(target->>'dn', target->>'id'))=LOWER(NULLIF(BTRIM(vl.upn), ''))
                         ))
                     OR (NULLIF(BTRIM(target->>'email'), '') IS NOT NULL AND NULLIF(BTRIM(vl.email), '') IS NOT NULL
                         AND LOWER(target->>'email')=LOWER(vl.email))
              ))
              OR (target->>'type'='ldap_group' AND EXISTS (
                  SELECT 1 FROM viewer_ldap vl
                  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(vl.source_payload->'memberOf', vl.source_payload->'memberof', '[]'::jsonb)) member(dn)
                  WHERE NULLIF(BTRIM(COALESCE(target->>'dn', target->>'id', '')), '') IS NOT NULL
                    AND (LOWER(member.dn)=LOWER(COALESCE(target->>'dn', target->>'id'))
                         OR SPLIT_PART(LOWER(member.dn), ',', 1)=SPLIT_PART(LOWER(COALESCE(target->>'dn', target->>'id')), ',', 1))
              ))
         )
       )`,
    [assetIds, viewerId, viewerEmail]
  ).catch(() => []) : [];

  const visibleAssetIds = new Set(visibleAssetRows.map((row) => String(row.id)));
  const visibleServiceIdSet = new Set(visibleServiceIds.map(String));
  return {
    assets: assets.filter((asset) => visibleAssetIds.has(String(asset.id))),
    services: services.filter((service) => visibleServiceIdSet.has(String(service.id || service.service_id))),
  };
}

module.exports = { getVisibleAffectedScope, PRIVILEGED_ROLES };
