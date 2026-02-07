const express = require("express");
const cors = require("cors");
const { db } = require("./db");
const { z } = require("zod");

const app = express();
app.use(cors());
app.use(express.json());

// --- COUNT cache (in-memory)
const COUNT_CACHE_TTL_MS = 30_000;
const countCache = new Map();

/**
 * key -> { value: number, expiresAt: number }
 */
function getCountCache(key) {
  const hit = countCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    countCache.delete(key);
    return null;
  }
  return hit.value;
}
function setCountCache(key, value) {
  countCache.set(key, { value, expiresAt: Date.now() + COUNT_CACHE_TTL_MS });
}

// --- validate query
const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000000).default(50),
  search: z.string().optional().default(""),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  sort: z.string().optional().default("createdAt:desc"), // e.g. "name:asc"
});

function parseSort(sortStr) {
  const [fieldRaw, dirRaw] = (sortStr || "").split(":");
  const field = fieldRaw || "createdAt";
  const dir = (dirRaw || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

  // allowlist to prevent SQL injection
  const allowed = new Set(["id", "name", "email", "status", "createdAt"]);
  return {
    field: allowed.has(field) ? field : "createdAt",
    dir,
  };
}

app.get("/api/users", (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid query", issues: parsed.error.issues });
  }

  const { page, pageSize, search, status, sort } = parsed.data;
  const { field, dir } = parseSort(sort);

  const where = [];
  const params = {};

  if (status) {
    where.push("status = @status");
    params.status = status;
  }

  if (search && search.trim().length > 0) {
    where.push("(name LIKE @q OR email LIKE @q)");
    params.q = `%${search.trim()}%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;

  // --- normalize for cache key
  const normalized = {
    status: status ?? null,
    // search는 trim 후 빈문자면 null로 통일
    search: (search && search.trim().length > 0) ? search.trim() : null,
  };

  const t0 = Date.now();

  const rowsStmt = db.prepare(`
    SELECT id, name, email, status, createdAt
    FROM users
    ${whereSql}
    ORDER BY ${field} ${dir}
    LIMIT @limit OFFSET @offset
  `);

  const rows = rowsStmt.all({ ...params, limit: pageSize, offset });

  const t1 = Date.now();

  // const countStmt = db.prepare(`
  //   SELECT COUNT(*) as totalCount
  //   FROM users
  //   ${whereSql}
  // `);

  // const totalCount = countStmt.get(params).totalCount;

  // const t2 = Date.now();
  // 캐시 키는 "조건"만 포함 (page/limit/offset 제외)
  const countCacheKey = JSON.stringify({
    whereSql,
    normalized,
  });
  
  let totalCount;
  let countFromCache = false;

  const cached = getCountCache(countCacheKey);
  if (cached !== null) {
    totalCount = cached;
    countFromCache = true;
  } else {
    const countStmt = db.prepare(`
      SELECT COUNT(*) as totalCount
      FROM users
      ${whereSql}
    `);

    totalCount = countStmt.get(params).totalCount;
    setCountCache(countCacheKey, totalCount);
  }

  const t2 = Date.now();

  res.json({
    rows,
    totalCount,
    request: {
      page,
      pageSize,
      sort,
      status: status ?? null,
      search,
    },
    meta: {
      queryTimeMs: t1 - t0,
      countTimeMs: t2 - t1,
      countFromCache,
      countCacheTtlMs: COUNT_CACHE_TTL_MS,
      page,
      pageSize,
      sort: `${field}:${dir.toLowerCase()}`,
      status: status ?? null,
      search,
    },
  });
});

app.get("/api/users-cursor", (req, res) => {
  // cursor: 마지막으로 받은 row의 createdAt(ISO) + id (동일 createdAt tie-break)
  // 예: ?pageSize=100&cursorCreatedAt=2026-02-01T...Z&cursorId=12345&status=ACTIVE&search=User%201

  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || "100", 10), 1), 10000);

  const search = (req.query.search || "").toString().trim();
  const status = req.query.status ? req.query.status.toString() : null;

  const cursorCreatedAt = req.query.cursorCreatedAt ? req.query.cursorCreatedAt.toString() : null;
  const cursorId = req.query.cursorId ? parseInt(req.query.cursorId.toString(), 10) : null;

  const where = [];
  const params = { limit: pageSize };

  if (status === "ACTIVE" || status === "INACTIVE") {
    where.push("status = @status");
    params.status = status;
  }

  if (search.length > 0) {
    where.push("(name LIKE @q OR email LIKE @q)");
    params.q = `%${search}%`;
  }

  // Cursor 조건 (createdAt desc, id desc)
  // "이전 페이지의 마지막 row보다 더 과거(작은) 값들"을 가져오도록 제한
  if (cursorCreatedAt && Number.isInteger(cursorId)) {
    where.push(`
      (
        createdAt < @cursorCreatedAt
        OR (createdAt = @cursorCreatedAt AND id < @cursorId)
      )
    `);
    params.cursorCreatedAt = cursorCreatedAt;
    params.cursorId = cursorId;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const t0 = Date.now();

  const rowsStmt = db.prepare(`
    SELECT id, name, email, status, createdAt
    FROM users
    ${whereSql}
    ORDER BY createdAt DESC, id DESC
    LIMIT @limit
  `);

  const rows = rowsStmt.all(params);

  const t1 = Date.now();

  // 다음 cursor는 "이번에 받은 마지막 row" 기준
  const last = rows.length ? rows[rows.length - 1] : null;

  res.json({
    rows,
    nextCursor: last
      ? { cursorCreatedAt: last.createdAt, cursorId: last.id }
      : null,
    meta: {
      queryTimeMs: t1 - t0,
      pageSize,
      status: status ?? null,
      search,
      usedCursor: cursorCreatedAt ? { cursorCreatedAt, cursorId } : null,
    },
  });
});


app.listen(4000, () => {
  console.log("✅ API running on http://localhost:4000");
  console.log("👉 run: node src/seed.js  (first time)");
});
