'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'bookkeeping.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT    NOT NULL,
    type         TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    category     TEXT    NOT NULL DEFAULT '其他',
    note         TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_records_date ON records (date);
  CREATE INDEX IF NOT EXISTS idx_records_type ON records (type);

  CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    UNIQUE (name, type)
  );
`);

const DEFAULT_CATEGORIES = {
  expense: ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '教育', '通讯', '人情', '其他'],
  income: ['工资', '奖金', '兼职', '理财', '租金', '红包', '其他'],
};

const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name, type) VALUES (?, ?)');
for (const [type, names] of Object.entries(DEFAULT_CATEGORIES)) {
  for (const name of names) insertCategory.run(name, type);
}

/* ---------------------------------- 工具 ---------------------------------- */

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const ts = new Date(Date.UTC(y, m - 1, d));
  return ts.getUTCFullYear() === y && ts.getUTCMonth() === m - 1 && ts.getUTCDate() === d;
}

function normalizeYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw httpError(400, '年份格式不正确');
  }
  return String(year);
}

function normalizeMonth(value) {
  if (value === undefined || value === null || value === '' || value === 'all') return null;
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw httpError(400, '月份格式不正确（1-12 或 all）');
  }
  return String(month).padStart(2, '0');
}

/** 生成按年 / 按年月的过滤条件 */
function periodFilter(year, month, column = 'date') {
  const y = normalizeYear(year);
  const m = normalizeMonth(month);
  if (m === null) return { sql: `substr(${column}, 1, 4) = ?`, params: [y] };
  return { sql: `substr(${column}, 1, 7) = ?`, params: [`${y}-${m}`] };
}

/** 金额统一以“分”为单位的整数存储，避免浮点误差 */
function normalizeAmount(value) {
  const num = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isFinite(num)) throw httpError(400, '金额必须是有效数字');
  const cents = Math.round(num * 100);
  if (cents <= 0) throw httpError(400, '金额必须大于 0');
  if (cents > 1e14) throw httpError(400, '金额超出合理范围');
  return cents;
}

function normalizeText(value, field, maxLen = 100, defaultValue = '') {
  if (value === undefined || value === null) return defaultValue;
  const text = String(value).trim();
  if (text.length > maxLen) throw httpError(400, `${field}不能超过 ${maxLen} 个字符`);
  return text || defaultValue;
}

function parseRecordInput(payload = {}, { partial = false } = {}) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const out = {};

  if (!partial || body.date !== undefined) {
    if (!isValidDate(body.date)) throw httpError(400, '日期格式不正确，应为 YYYY-MM-DD');
    out.date = body.date;
  }
  if (!partial || body.type !== undefined) {
    if (body.type !== 'income' && body.type !== 'expense') {
      throw httpError(400, '类型只能是 income（收入）或 expense（支出）');
    }
    out.type = body.type;
  }
  if (!partial || body.amount !== undefined) {
    if (body.amount === undefined || body.amount === null || body.amount === '') {
      throw httpError(400, '金额不能为空');
    }
    out.amount_cents = normalizeAmount(body.amount);
  }
  if (!partial || body.category !== undefined) {
    out.category = normalizeText(body.category, '分类', 30, '其他');
  }
  if (!partial || body.note !== undefined) {
    out.note = normalizeText(body.note, '备注', 200, '');
  }
  if (!partial) {
    for (const key of ['date', 'type', 'amount_cents', 'category', 'note']) {
      if (out[key] === undefined) throw httpError(400, '提交的数据不完整');
    }
  }
  return out;
}

function toRecord(row) {
  return {
    id: row.id,
    date: row.date,
    type: row.type,
    amount: row.amount_cents / 100,
    category: row.category,
    note: row.note,
    updatedAt: row.updated_at,
  };
}

/* --------------------------------- 记录 CRUD -------------------------------- */

function listRecords(options = {}) {
  const { year, month, day, type, category, keyword, limit = 1000, offset = 0 } = options;
  const conditions = [];
  const params = [];

  if (year !== undefined || month !== undefined) {
    const f = periodFilter(year ?? new Date().getFullYear(), month ?? 'all');
    conditions.push(f.sql);
    params.push(...f.params);
  }
  if (day !== undefined && day !== null && day !== '') {
    if (!isValidDate(day)) throw httpError(400, '日期格式不正确');
    conditions.push('date = ?');
    params.push(day);
  }
  if (type === 'income' || type === 'expense') {
    conditions.push('type = ?');
    params.push(type);
  }
  if (category) {
    conditions.push('category = ?');
    params.push(String(category));
  }
  if (keyword) {
    conditions.push('(note LIKE ? OR category LIKE ?)');
    const kw = `%${String(keyword).trim()}%`;
    params.push(kw, kw);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(Number(limit) || 1000, 1), 5000);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const rows = db
    .prepare(
      `SELECT * FROM records ${where}
       ORDER BY date DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, safeLimit, safeOffset);

  const total = db.prepare(`SELECT COUNT(*) AS total FROM records ${where}`).get(...params).total;
  return { total, items: rows.map(toRecord) };
}

function getRecord(id) {
  const row = db.prepare('SELECT * FROM records WHERE id = ?').get(Number(id));
  return row ? toRecord(row) : null;
}

function createRecord(payload) {
  const data = parseRecordInput(payload);
  ensureCategory(data.category, data.type);
  const info = db
    .prepare(
      `INSERT INTO records (date, type, amount_cents, category, note)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(data.date, data.type, data.amount_cents, data.category, data.note);
  return getRecord(info.lastInsertRowid);
}

function updateRecord(id, payload) {
  const recordId = Number(id);
  const existing = db.prepare('SELECT * FROM records WHERE id = ?').get(recordId);
  if (!existing) throw httpError(404, '记录不存在或已被删除');

  const data = parseRecordInput(payload, { partial: true });
  const keys = Object.keys(data);
  if (!keys.length) throw httpError(400, '没有需要更新的字段');

  ensureCategory(data.category ?? existing.category, data.type ?? existing.type);
  const assignments = keys.map((key) => `${key} = ?`).join(', ');
  db.prepare(
    `UPDATE records SET ${assignments}, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(...keys.map((key) => data[key]), recordId);

  return getRecord(recordId);
}

function deleteRecord(id) {
  const info = db.prepare('DELETE FROM records WHERE id = ?').run(Number(id));
  if (!info.changes) throw httpError(404, '记录不存在或已被删除');
  return { id: Number(id) };
}

/** 批量导入：逐条校验，合法的入库，非法的收集错误信息；整体事务保证一致性 */
function importRecords(records) {
  if (!Array.isArray(records)) throw httpError(400, '导入数据格式不正确，应为数组');
  if (!records.length) throw httpError(400, '没有可导入的数据');
  if (records.length > 5000) throw httpError(400, '单次最多导入 5000 条记录');

  const insert = db.prepare(
    'INSERT INTO records (date, type, amount_cents, category, note) VALUES (?, ?, ?, ?, ?)'
  );

  const insertedIds = [];
  const errors = [];

  db.exec('BEGIN');
  try {
    records.forEach((raw, index) => {
      const rowNo = index + 1;
      try {
        const data = parseRecordInput(raw);
        ensureCategory(data.category, data.type);
        const info = insert.run(data.date, data.type, data.amount_cents, data.category, data.note);
        insertedIds.push(Number(info.lastInsertRowid));
      } catch (err) {
        errors.push({ row: rowNo, message: err.message || '数据不合法' });
      }
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { inserted: insertedIds.length, skipped: errors.length, insertedIds, errors };
}

/* ---------------------------------- 统计 ---------------------------------- */

function totals(year, month) {
  const f = periodFilter(year, month);
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income'  THEN amount_cents END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense,
         COUNT(*) AS count
       FROM records WHERE ${f.sql}`
    )
    .get(...f.params);
  return { income: row.income, expense: row.expense, profit: row.income - row.expense, count: row.count };
}

function overview(year, month) {
  return {
    period: totals(year, month),
    year: totals(year, 'all'),
  };
}

function monthlySummary(year) {
  const y = normalizeYear(year);
  const rows = db
    .prepare(
      `SELECT substr(date, 6, 2) AS month,
              COALESCE(SUM(CASE WHEN type = 'income'  THEN amount_cents END), 0) AS income,
              COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense,
              COUNT(*) AS count
       FROM records
       WHERE substr(date, 1, 4) = ?
       GROUP BY month
       ORDER BY month`
    )
    .all(y);

  const map = new Map(rows.map((r) => [r.month, r]));
  const list = [];
  let cumulative = 0;
  for (let m = 1; m <= 12; m += 1) {
    const key = String(m).padStart(2, '0');
    const income = map.get(key)?.income ?? 0;
    const expense = map.get(key)?.expense ?? 0;
    cumulative += income - expense;
    list.push({
      month: key,
      income,
      expense,
      profit: income - expense,
      count: map.get(key)?.count ?? 0,
      cumulative,
    });
  }
  return list;
}

function dailySummary(year, month) {
  const f = periodFilter(year, month);
  const rows = db
    .prepare(
      `SELECT date,
              COALESCE(SUM(CASE WHEN type = 'income'  THEN amount_cents END), 0) AS income,
              COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense,
              COUNT(*) AS count
       FROM records
       WHERE ${f.sql}
       GROUP BY date
       ORDER BY date`
    )
    .all(...f.params);

  return rows.map((r) => ({
    date: r.date,
    income: r.income,
    expense: r.expense,
    profit: r.income - r.expense,
    count: r.count,
  }));
}

function categorySummary(year, month, type = 'expense') {
  if (type !== 'income' && type !== 'expense') throw httpError(400, '统计类型不正确');
  const f = periodFilter(year, month);
  const rows = db
    .prepare(
      `SELECT category, COALESCE(SUM(amount_cents), 0) AS amount, COUNT(*) AS count
       FROM records
       WHERE ${f.sql} AND type = ?
       GROUP BY category
       ORDER BY amount DESC`
    )
    .all(...f.params, type);

  const sum = rows.reduce((acc, r) => acc + r.amount, 0);
  return rows.map((r) => ({
    category: r.category,
    amount: r.amount,
    count: r.count,
    ratio: sum ? r.amount / sum : 0,
  }));
}

function years() {
  const rows = db.prepare('SELECT DISTINCT substr(date, 1, 4) AS year FROM records ORDER BY year DESC').all();
  const set = new Set(rows.map((r) => r.year));
  set.add(String(new Date().getFullYear()));
  return [...set].sort((a, b) => Number(b) - Number(a));
}

/* --------------------------------- 分类管理 -------------------------------- */

function ensureCategory(name, type) {
  if (!name) return;
  insertCategory.run(String(name).trim(), type);
}

function listCategories() {
  const rows = db.prepare('SELECT name, type FROM categories ORDER BY type, id').all();
  return {
    income: rows.filter((r) => r.type === 'income').map((r) => r.name),
    expense: rows.filter((r) => r.type === 'expense').map((r) => r.name),
  };
}

function addCategory(name, type) {
  const cleanName = normalizeText(name, '分类', 30);
  if (!cleanName) throw httpError(400, '分类名称不能为空');
  if (type !== 'income' && type !== 'expense') throw httpError(400, '分类类型不正确');
  insertCategory.run(cleanName, type);
  return { name: cleanName, type };
}

module.exports = {
  db,
  DB_PATH,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  importRecords,
  overview,
  monthlySummary,
  dailySummary,
  categorySummary,
  years,
  listCategories,
  addCategory,
  httpError,
};
