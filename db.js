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
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    date             TEXT    NOT NULL,
    type             TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
    amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    quantity         REAL    NOT NULL DEFAULT 0,
    category         TEXT    NOT NULL DEFAULT '其他',
    note             TEXT    NOT NULL DEFAULT '',
    created_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_records_date ON records (date);
  CREATE INDEX IF NOT EXISTS idx_records_type ON records (type);

  CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    UNIQUE (name, type)
  );

  -- 每月支出预警额度（month 形如 '2026-10'）；未设置的月份沿用最近一次设置的值
  CREATE TABLE IF NOT EXISTS budgets (
    month        TEXT    PRIMARY KEY,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

/** 老库升级：SQLite 的 ADD COLUMN 不支持 IF NOT EXISTS，这里先查后加 */
function ensureColumn(table, column, ddl) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// 「单价 × 数量」计价模式：单价存分，数量可为小数；两者都大于 0 时金额由后端计算
ensureColumn('records', 'unit_price_cents', 'unit_price_cents INTEGER NOT NULL DEFAULT 0');
ensureColumn('records', 'quantity', 'quantity REAL NOT NULL DEFAULT 0');

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

/** 单价（元）-> 分；空值返回 0，表示该记录不使用「单价 × 数量」计价 */
function normalizeUnitPrice(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isFinite(num) || num < 0) throw httpError(400, '单价必须是不小于 0 的数字');
  const cents = Math.round(num * 100);
  if (cents > 1e14) throw httpError(400, '单价超出合理范围');
  return cents;
}

/** 数量；空值返回 0，表示该记录不使用「单价 × 数量」计价 */
function normalizeQuantity(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isFinite(num) || num < 0) throw httpError(400, '数量必须是不小于 0 的数字');
  if (num > 1e9) throw httpError(400, '数量超出合理范围');
  return num;
}

/** 单价 × 数量 -> 金额（分）。以分为单位四舍五入，等价于保留两位小数 */
function amountFromUnitPrice(unitPriceCents, quantity) {
  return Math.round(unitPriceCents * quantity);
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

  if (!partial || body.unitPrice !== undefined) {
    out.unit_price_cents = normalizeUnitPrice(body.unitPrice);
  }
  if (!partial || body.quantity !== undefined) {
    out.quantity = normalizeQuantity(body.quantity);
  }

  // 单价与数量都大于 0 时，金额由它们计算（忽略传入的金额），保证三者一致
  const byUnitPrice = !partial && (out.unit_price_cents || 0) > 0 && (out.quantity || 0) > 0;

  if (!partial || body.amount !== undefined) {
    if (byUnitPrice) {
      const computed = amountFromUnitPrice(out.unit_price_cents, out.quantity);
      if (computed <= 0) throw httpError(400, '单价 × 数量 计算出的金额必须大于 0');
      out.amount_cents = computed;
    } else {
      if (body.amount === undefined || body.amount === null || body.amount === '') {
        throw httpError(400, '金额不能为空（也可填写单价与数量自动计算）');
      }
      out.amount_cents = normalizeAmount(body.amount);
    }
  }

  if (!partial || body.category !== undefined) {
    out.category = normalizeText(body.category, '分类', 30, '其他');
  }
  if (!partial || body.note !== undefined) {
    out.note = normalizeText(body.note, '备注', 200, '');
  }
  if (!partial) {
    for (const key of ['date', 'type', 'amount_cents', 'unit_price_cents', 'quantity', 'category', 'note']) {
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
    unitPrice: (row.unit_price_cents || 0) / 100,
    quantity: Number(row.quantity) || 0,
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
  const info = db
    .prepare(
      `INSERT INTO records (date, type, amount_cents, unit_price_cents, quantity, category, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.date,
      data.type,
      data.amount_cents,
      data.unit_price_cents,
      data.quantity,
      data.category,
      data.note
    );
  return getRecord(info.lastInsertRowid);
}

function updateRecord(id, payload) {
  const recordId = Number(id);
  const existing = db.prepare('SELECT * FROM records WHERE id = ?').get(recordId);
  if (!existing) throw httpError(404, '记录不存在或已被删除');

  const patch = payload && typeof payload === 'object' ? payload : {};
  if (!Object.keys(patch).length) throw httpError(400, '没有需要更新的字段');

  // 与现有数据合并后整体校验：这样只改数量时，金额也会按「单价 × 数量」重新计算
  const merged = parseRecordInput(Object.assign({}, toRecord(existing), patch));
  if (merged.amount_cents <= 0) throw httpError(400, '金额必须大于 0');

  const fields = ['date', 'type', 'amount_cents', 'unit_price_cents', 'quantity', 'category', 'note'];
  db.prepare(
    `UPDATE records SET ${fields.map((key) => `${key} = ?`).join(', ')}, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(...fields.map((key) => merged[key]), recordId);

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
    'INSERT INTO records (date, type, amount_cents, unit_price_cents, quantity, category, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const insertedIds = [];
  const errors = [];

  db.exec('BEGIN');
  try {
    records.forEach((raw, index) => {
      const rowNo = index + 1;
      try {
        const data = parseRecordInput(raw);
        const info = insert.run(
          data.date,
          data.type,
          data.amount_cents,
          data.unit_price_cents,
          data.quantity,
          data.category,
          data.note
        );
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

/* ------------------------------- 支出预警额度 ------------------------------- */

/**
 * 计算某年 12 个月的「生效预警额度」（分）：
 * 当月设置过就用当月的；没设置则沿用**最近一次设置**的值（可跨月、跨年）；都没有则为 0（不预警）
 */
function buildBudgetMap(year) {
  const y = Number(year);
  const rows = db.prepare('SELECT month, amount_cents FROM budgets WHERE amount_cents > 0').all();
  const self = {};
  rows.forEach((row) => {
    if (/^\d{4}-\d{2}$/.test(row.month) && row.month <= `${y}-12`) {
      self[row.month] = row.amount_cents;
    }
  });

  const setMonths = Object.keys(self).sort();
  const result = {};

  for (let m = 1; m <= 12; m += 1) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const own = self[key] || 0;
    let from = '';
    if (!own) {
      for (let i = setMonths.length - 1; i >= 0; i -= 1) {
        if (setMonths[i] < key) {
          from = setMonths[i];
          break;
        }
      }
    }
    result[key] = {
      month: key,
      budgetValue: own,
      budget: own > 0 ? own : (from ? self[from] : 0),
      budgetFrom: own > 0 ? '' : from,
    };
  }

  return result;
}

/** 支出预警：超过额度 over（红）；达到额度 95% near（黄） */
function budgetAlert(expenseCents, budgetCents) {
  if (!(budgetCents > 0)) return 'none';
  if (expenseCents > budgetCents) return 'over';
  if (expenseCents >= budgetCents * 0.95) return 'near';
  return 'none';
}

/** 某年 12 个月的预警额度（含沿用来源） */
function getBudgets(year) {
  const y = normalizeYear(year);
  const map = buildBudgetMap(y);
  return Object.keys(map)
    .sort()
    .map((key) => map[key]);
}

/** 设置某月额度（金额单位为「元」；传 0 表示清除该月设置） */
function setBudget(month, amount) {
  const key = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(key)) throw httpError(400, '月份格式应为 YYYY-MM');

  const cents = Math.max(0, Math.round((Number(amount) || 0) * 100));
  if (cents > 1e14) throw httpError(400, '额度超出合理范围');

  if (cents > 0) {
    db.prepare(
      `INSERT INTO budgets (month, amount_cents, updated_at)
       VALUES (?, ?, datetime('now', 'localtime'))
       ON CONFLICT(month) DO UPDATE SET amount_cents = excluded.amount_cents, updated_at = excluded.updated_at`
    ).run(key, cents);
  } else {
    db.prepare('DELETE FROM budgets WHERE month = ?').run(key);
  }

  return { month: key, amount: cents / 100 };
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
  const budgets = buildBudgetMap(y);

  const list = [];
  let cumulative = 0;
  for (let m = 1; m <= 12; m += 1) {
    const key = String(m).padStart(2, '0');
    const income = map.get(key)?.income ?? 0;
    const expense = map.get(key)?.expense ?? 0;
    cumulative += income - expense;

    const budgetInfo = budgets[`${y}-${key}`] || { budget: 0, budgetValue: 0, budgetFrom: '' };
    list.push({
      month: key,
      income,
      expense,
      profit: income - expense,
      count: map.get(key)?.count ?? 0,
      cumulative,
      budget: budgetInfo.budget,
      budgetValue: budgetInfo.budgetValue,
      budgetFrom: budgetInfo.budgetFrom,
      alert: budgetAlert(expense, budgetInfo.budget),
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

/**
 * 分类字典 = 默认分类 + 字典表（默认种子 + 显式添加）+ 记录中实际使用过的分类
 *
 * 说明：保存记录时**不再**自动把新分类写进字典表（旧实现会这么做，导致录错一次就
 * 永久留在下拉框里）。现在只要某分类还有记录在用它就会出现在下拉框里；把记录改成
 * 别的分类后，它会自动从下拉框消失。
 */
function listCategories() {
  const stored = db.prepare('SELECT name, type FROM categories ORDER BY type, id').all();
  const used = db.prepare('SELECT DISTINCT type, category FROM records').all();

  const build = (kind) => {
    const out = (DEFAULT_CATEGORIES[kind] || []).slice();
    const push = (name) => {
      const clean = String(name || '').trim();
      if (clean && out.indexOf(clean) < 0) out.push(clean);
    };
    stored.filter((r) => r.type === kind).forEach((r) => push(r.name));
    used.filter((r) => r.type === kind).forEach((r) => push(r.category));
    return out;
  };

  return { income: build('income'), expense: build('expense') };
}

function addCategory(name, type) {
  const cleanName = normalizeText(name, '分类', 30);
  if (!cleanName) throw httpError(400, '分类名称不能为空');
  if (type !== 'income' && type !== 'expense') throw httpError(400, '分类类型不正确');
  insertCategory.run(cleanName, type);
  return { name: cleanName, type };
}

module.exports = {
  DB_PATH,
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  importRecords,
  overview,
  monthlySummary,
  getBudgets,
  setBudget,
  dailySummary,
  categorySummary,
  years,
  listCategories,
  addCategory,
  httpError,
};
