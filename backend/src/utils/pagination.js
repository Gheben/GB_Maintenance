// Clamps page/limit query params so heavy paginated queries can't be forced to scan unbounded row counts.
function parsePagination(query = {}, { defaultLimit = 50, maxLimit = 500 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

module.exports = { parsePagination };
