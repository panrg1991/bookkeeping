'use strict';

/**
 * 统一业务云函数：bookkeeping
 *
 * 设计要点
 * 1. 数据隔离：所有集合都带 `_openid` 字段，且 **只使用云函数上下文里的 OPENID**，
 *    绝不接受前端传入的 openid，避免越权读写他人数据。
 * 2. 读写收口：小程序端不直连数据库，全部通过本云函数（前端只需 wx.cloud.callFunction）。
 * 3. 操作日志：create / update / delete / import 等写操作都会写入 logs 集合，
 *    记录操作人、时间、变更前后数据、变更字段、结果与错误，便于后续排查。
 * 4. 统计在云端用聚合完成，不把全量数据拉到端上。
 *
 * 调用协议
 *   event = { action: 'listRecords', client: { version, platform, model }, ...业务参数 }
 *   返回   = { ok: true, data: {...} } 或 { ok: false, message: '错误信息' }
 */

const cloud = require('wx-server-sdk');
const budget = require('./budget');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

const COLLECTIONS = {
  records: 'records',
  logs: 'logs',
  settings: 'settings',
  budgets: 'budgets',
};

const COLLECTION_NAMES = ['records', 'logs', 'settings', 'budgets'];

const DEFAULT_CATEGORIES = {
  expense: ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '教育', '通讯', '人情', '其他'],
  income: ['工资', '奖金', '兼职', '理财', '租金', '红包', '其他'],
};

const MAX_PAGE = 100; // 云函数单次查询上限
const MAX_LIST = 2000; // 单次返回记录数上限
const MAX_IMPORT = 5000; // 单次导入上限
const WRITE_BATCH = 100; // 批量写入分片大小
/** 是否记录读操作日志（默认关闭，开启后每次查询都会写一条日志，注意云开发配额） */
const LOG_READS = false;

/* ================================ 基础工具 ================================ */

function pad2(num) {
  const value = Number(num);
  if (!Number.isFinite(value)) return String(num);
  return value < 10 ? `0${value}` : String(value);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parts = value.split('-').map(Number);
  const ts = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return ts.getUTCFullYear() === parts[0] && ts.getUTCMonth() === parts[1] - 1 && ts.getUTCDate() === parts[2];
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 年 / 月 -> 日期范围条件（month 为空表示全年；year 为空表示全部数据） */
function dateRange(year, month) {
  if (!year) return null;
  const y = String(year);
  if (month) {
    const m = Number(month);
    const days = new Date(Number(y), m, 0).getDate();
    return _.gte(`${y}-${pad2(m)}-01`).and(_.lte(`${y}-${pad2(m)}-${pad2(days)}`));
  }
  return _.gte(`${y}-01-01`).and(_.lte(`${y}-12-31`));
}

function normalizeRecord(input) {
  const source = input || {};

  const date = String(source.date || '').trim();
  if (!isValidDate(date)) throw new Error('日期格式应为 YYYY-MM-DD');

  const type = source.type;
  if (type !== 'income' && type !== 'expense') throw new Error('类型只能是收入或支出');

  const unitPriceCents = Math.max(0, Math.round(Number(source.unitPriceCents) || 0));
  const quantity = Math.max(0, Number(source.quantity) || 0);
  if (quantity > 1e9) throw new Error('数量超出合理范围');
  if (unitPriceCents > 1e14) throw new Error('单价超出合理范围');

  // 单价 × 数量 计价：两者都大于 0 时金额由它们计算（以分为单位四舍五入 = 保留两位小数）
  let amountCents;
  if (unitPriceCents > 0 && quantity > 0) {
    amountCents = Math.round(unitPriceCents * quantity);
    if (amountCents <= 0) throw new Error('单价 × 数量 计算出的金额必须大于 0');
  } else {
    amountCents = Math.round(Number(source.amountCents));
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error('金额必须大于 0（也可填写单价与数量自动计算）');
  }
  if (amountCents > 1e14) throw new Error('金额超出合理范围');

  const category = String(source.category || '').trim().slice(0, 30) || '其他';
  const note = String(source.note || '').trim().slice(0, 200);

  return { date, type, amountCents, unitPriceCents, quantity, category, note };
}

function pickRecord(doc) {
  return {
    date: doc.date,
    type: doc.type,
    amountCents: doc.amountCents,
    unitPriceCents: doc.unitPriceCents || 0,
    quantity: doc.quantity || 0,
    category: doc.category,
    note: doc.note,
  };
}

function toRecord(doc) {
  return Object.assign({ id: doc._id }, pickRecord(doc), {
    createdAt: doc.createdAtMs || 0,
    updatedAt: doc.updatedAtMs || 0,
    importBatch: doc.importBatch || '',
  });
}

const RECORD_FIELDS = ['date', 'type', 'amountCents', 'unitPriceCents', 'quantity', 'category', 'note'];

function diffKeys(before, after) {
  return RECORD_FIELDS.filter((key) => before[key] !== after[key]);
}

function describe(record) {
  if (!record) return '';
  const kind = record.type === 'income' ? '收入' : '支出';
  return `${record.date} ${kind} ${(record.amountCents / 100).toFixed(2)} 元（${record.category}）`;
}

/** 按字段名手工映射，避免把 _id / _openid 等内部字段写进日志 */
function buildLog(ctx, event, payload) {
  const client = (event && event.client) || {};
  return Object.assign(
    {
      _openid: ctx.openid,
      action: '',
      target: 'records',
      recordId: '',
      before: null,
      after: null,
      changed: [],
      summary: '',
      batchId: '',
      count: 0,
      errors: [],
      client: {
        version: client.version || '',
        platform: client.platform || '',
        model: client.model || '',
      },
      createdAt: db.serverDate(),
      createdAtMs: Date.now(),
    },
    payload
  );
}

/** 写日志：失败不影响主流程，但会把错误信息返回给前端 */
async function writeLogs(entries) {
  if (!entries || !entries.length) return null;
  try {
    for (let i = 0; i < entries.length; i += WRITE_BATCH) {
      await db.collection(COLLECTIONS.logs).add({ data: entries.slice(i, i + WRITE_BATCH) });
    }
    return null;
  } catch (err) {
    console.error('[bookkeeping] 写入操作日志失败：', err);
    return (err && err.message) || String(err);
  }
}

/** 分页拉取（云函数单次最多 100 条，这里自动翻页） */
async function fetchPaged(name, where, options) {
  const orderBy = (options && options.orderBy) || [];
  const limit = Math.min(Math.max(Number(options && options.limit) || MAX_PAGE, 1), MAX_LIST);
  let skip = Math.max(Number((options && options.offset) || 0), 0);

  const out = [];
  while (out.length < limit) {
    const size = Math.min(MAX_PAGE, limit - out.length);
    let query = db.collection(name).where(where);
    orderBy.forEach((pair) => {
      query = query.orderBy(pair[0], pair[1]);
    });
    const res = await query.skip(skip).limit(size).get();
    out.push(...res.data);
    if (res.data.length < size) break;
    skip += res.data.length;
  }
  return out;
}

/** 取记录前先校验归属：云函数是管理员权限，必须自己带上 _openid 过滤 */
async function getOwnedRecord(id, openid) {
  const res = await db
    .collection(COLLECTIONS.records)
    .where({ _id: id, _openid: openid })
    .limit(1)
    .get();
  if (!res.data.length) throw new Error('记录不存在或无权操作');
  return res.data[0];
}

/* ================================ 分类字典 ================================ */

async function getSettings(openid) {
  const res = await db.collection(COLLECTIONS.settings).where({ _openid: openid }).limit(1).get();
  if (res.data.length) return res.data[0];

  const doc = {
    _openid: openid,
    income: DEFAULT_CATEGORIES.income.slice(),
    expense: DEFAULT_CATEGORIES.expense.slice(),
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };
  const added = await db.collection(COLLECTIONS.settings).add({ data: doc });
  return Object.assign({ _id: added._id }, doc);
}

async function ensureCategory(openid, name, type) {
  if (!name) return;
  try {
    const settings = await getSettings(openid);
    const list = settings[type] || [];
    if (list.indexOf(name) >= 0) return;
    const patch = {};
    patch[type] = list.concat([name]);
    patch.updatedAt = db.serverDate();
    await db.collection(COLLECTIONS.settings).doc(settings._id).update({ data: patch });
  } catch (err) {
    console.error('[bookkeeping] 保存分类失败：', err);
  }
}

/* ================================ 记录读写 ================================ */

function buildRecordWhere(openid, event) {
  const conditions = [{ _openid: openid }];

  const range = dateRange(event.year, event.month);
  if (range) conditions.push({ date: range });
  if (event.day && isValidDate(event.day)) conditions.push({ date: event.day });
  if (event.type === 'income' || event.type === 'expense') conditions.push({ type: event.type });
  if (event.category) conditions.push({ category: String(event.category) });

  if (event.keyword && String(event.keyword).trim()) {
    const regexp = escapeRegExp(String(event.keyword).trim());
    conditions.push(
      _.or([
        { category: db.RegExp({ regexp, options: 'i' }) },
        { note: db.RegExp({ regexp, options: 'i' }) },
      ])
    );
  }

  return conditions.length === 1 ? conditions[0] : _.and(conditions);
}

async function listRecords(event, ctx) {
  const where = buildRecordWhere(ctx.openid, event);
  const limit = Math.min(Math.max(Number(event.limit) || 500, 1), MAX_LIST);
  const offset = Math.max(Number(event.offset) || 0, 0);

  const [countRes, items] = await Promise.all([
    db.collection(COLLECTIONS.records).where(where).count(),
    fetchPaged(COLLECTIONS.records, where, {
      orderBy: [
        ['date', 'desc'],
        ['createdAtMs', 'desc'],
      ],
      limit,
      offset,
    }),
  ]);

  if (LOG_READS) {
    await writeLogs([
      buildLog(ctx, event, { action: 'read', summary: `查询记录：共 ${countRes.total} 条`, count: countRes.total }),
    ]);
  }

  return { total: countRes.total, items: items.map(toRecord) };
}

async function getRecord(event, ctx) {
  const id = String(event.id || '');
  if (!id) return null;

  const res = await db
    .collection(COLLECTIONS.records)
    .where({ _id: id, _openid: ctx.openid })
    .limit(1)
    .get();

  return res.data.length ? toRecord(res.data[0]) : null;
}

async function createRecord(event, ctx) {
  const data = normalizeRecord(event.record);
  const now = Date.now();

  const res = await db.collection(COLLECTIONS.records).add({
    data: Object.assign(
      {
        _openid: ctx.openid,
        createdAt: db.serverDate(),
        createdAtMs: now,
        updatedAt: db.serverDate(),
        updatedAtMs: now,
      },
      data
    ),
  });

  const logError = await writeLogs([
    buildLog(ctx, event, {
      action: 'create',
      recordId: res._id,
      after: data,
      summary: `新增 ${describe(data)}`,
    }),
  ]);

  return { id: res._id, record: Object.assign({ id: res._id }, data), logError };
}

async function updateRecord(event, ctx) {
  const id = String(event.id || '');
  if (!id) throw new Error('缺少记录 ID');

  const before = await getOwnedRecord(id, ctx.openid);
  const merged = normalizeRecord(Object.assign({}, pickRecord(before), event.record || {}));
  const changed = diffKeys(before, merged);

  if (!changed.length) {
    return { id, record: toRecord(before), changed, logError: null, unchanged: true };
  }

  const patch = { updatedAt: db.serverDate(), updatedAtMs: Date.now() };
  changed.forEach((key) => {
    patch[key] = merged[key];
  });

  await db.collection(COLLECTIONS.records).doc(id).update({ data: patch });

  const logError = await writeLogs([
    buildLog(ctx, event, {
      action: 'update',
      recordId: id,
      before: pickRecord(before),
      after: merged,
      changed,
      summary: `修改 ${describe(merged)}（字段：${changed.join('、')}）`,
    }),
  ]);

  return { id, record: Object.assign({ id }, merged), changed, logError };
}

async function deleteRecord(event, ctx) {
  const id = String(event.id || '');
  if (!id) throw new Error('缺少记录 ID');

  const before = await getOwnedRecord(id, ctx.openid);
  await db.collection(COLLECTIONS.records).doc(id).remove();

  const logError = await writeLogs([
    buildLog(ctx, event, {
      action: 'delete',
      recordId: id,
      before: pickRecord(before),
      summary: `删除 ${describe(before)}`,
    }),
  ]);

  return { id, logError };
}

/** 批量删除：逐条校验归属后删除，每条都写 delete 日志 */
async function deleteRecords(event, ctx) {
  const ids = (Array.isArray(event.ids) ? event.ids : []).map(String).filter(Boolean);
  if (!ids.length) throw new Error('没有选择要删除的记录');
  if (ids.length > 200) throw new Error('单次最多删除 200 条记录');

  const logs = [];
  const errors = [];
  let removed = 0;

  for (const id of ids) {
    try {
      const before = await getOwnedRecord(id, ctx.openid);
      await db.collection(COLLECTIONS.records).doc(id).remove();
      removed += 1;
      logs.push(
        buildLog(ctx, event, {
          action: 'delete',
          recordId: id,
          before: pickRecord(before),
          summary: `批量删除 ${describe(before)}`,
        })
      );
    } catch (err) {
      errors.push({ row: 0, message: (err && err.message) || '删除失败' });
    }
  }

  const logError = await writeLogs(logs);
  return { removed, skipped: ids.length - removed, errors: errors.slice(0, 50), logError };
}

async function importRecords(event, ctx) {
  const rawItems = Array.isArray(event.items) ? event.items : [];
  if (!rawItems.length) throw new Error('没有可导入的数据');
  if (rawItems.length > MAX_IMPORT) throw new Error(`单次最多导入 ${MAX_IMPORT} 条记录`);

  const now = Date.now();
  const batchId = `batch_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const detailLog = event.detailLog !== false; // 默认逐条记录日志

  const valid = [];
  const errors = [];
  const logs = [];

  rawItems.forEach((item, index) => {
    try {
      valid.push(normalizeRecord(item));
    } catch (err) {
      const message = (err && err.message) || '数据不合法';
      errors.push({ row: index + 1, message });
      logs.push(
        buildLog(ctx, event, {
          action: 'importRejected',
          batchId,
          summary: `导入第 ${index + 1} 行被拒绝：${message}`,
          errors: [{ row: index + 1, message }],
        })
      );
    }
  });

  const insertedIds = [];
  for (let i = 0; i < valid.length; i += WRITE_BATCH) {
    const chunk = valid.slice(i, i + WRITE_BATCH);
    const res = await db.collection(COLLECTIONS.records).add({
      data: chunk.map((item) =>
        Object.assign(
          {
            _openid: ctx.openid,
            importBatch: batchId,
            createdAt: db.serverDate(),
            createdAtMs: now,
            updatedAt: db.serverDate(),
            updatedAtMs: now,
          },
          item
        )
      ),
    });

    // 批量插入返回 _ids / ids，不同版本字段名不同，这里都兼容
    const ids = (res && (res._ids || res.ids)) || [];
    ids.forEach((id) => insertedIds.push(id));

    if (detailLog) {
      chunk.forEach((item, index) => {
        logs.push(
          buildLog(ctx, event, {
            action: 'import',
            batchId,
            recordId: ids[index] || '',
            after: item,
            summary: `导入新增 ${describe(item)}`,
          })
        );
      });
    }
  }

  logs.push(
    buildLog(ctx, event, {
      action: 'importBatch',
      batchId,
      count: insertedIds.length,
      summary: `批量导入完成：成功 ${insertedIds.length} 条，跳过 ${errors.length} 条`,
      errors: errors.slice(0, 100),
    })
  );

  const logError = await writeLogs(logs);

  return {
    inserted: insertedIds.length,
    skipped: errors.length,
    errors: errors.slice(0, 100),
    batchId,
    logError,
  };
}

/* ================================== 统计 ================================== */

async function sumOf(openid, year, month) {
  const match = { _openid: openid };
  const range = dateRange(year, month);
  if (range) match.date = range;

  const res = await db
    .collection(COLLECTIONS.records)
    .aggregate()
    .match(match)
    .group({ _id: '$type', amount: $.sum('$amountCents'), count: $.sum(1) })
    .end();

  let income = 0;
  let expense = 0;
  let count = 0;
  (res.list || []).forEach((row) => {
    if (row._id === 'income') income = row.amount;
    else if (row._id === 'expense') expense = row.amount;
    count += row.count || 0;
  });

  return { income, expense, profit: income - expense, count };
}

async function overview(event, ctx) {
  const [period, year] = await Promise.all([
    sumOf(ctx.openid, event.year, event.month),
    sumOf(ctx.openid, event.year, null),
  ]);
  return { period, year };
}

/* ------------------------------- 支出预警额度 ------------------------------- */

/** 读取该用户设置过的额度：{ 'YYYY-MM': 分 } */
async function readBudgets(openid) {
  const res = await db.collection(COLLECTIONS.budgets).where({ _openid: openid }).limit(500).get();
  const map = {};
  res.data.forEach((doc) => {
    if (/^\d{4}-\d{2}$/.test(doc.month) && Number(doc.amountCents) > 0) {
      map[doc.month] = Number(doc.amountCents);
    }
  });
  return map;
}

/**
 * 计算某年 12 个月的「生效预警额度」：
 * 当月设置过就用当月的；没设置则沿用最近一次设置的值（可跨月、跨年）；都没有则为 0（不预警）
 * 纯计算逻辑见 ./budget.js（与 Node 后端、小程序本地存储共享同一份规则）。
 */
function buildBudgetMap(year, stored) {
  return budget.buildBudgetMap(year, stored);
}

/** 支出预警：超过额度 over（红）；达到额度 95% near（黄） */
const budgetAlert = budget.budgetAlert;

async function getBudgets(event, ctx) {
  const stored = await readBudgets(ctx.openid);
  const map = buildBudgetMap(event.year || new Date().getFullYear(), stored);
  return Object.keys(map)
    .sort()
    .map((key) => map[key]);
}

async function setBudget(event, ctx) {
  const key = String(event.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(key)) throw new Error('月份格式应为 YYYY-MM');

  const raw = Number(event.amountCents);
  const cents = Number.isFinite(raw) ? Math.round(raw) : 0;
  if (cents < 0) throw new Error('额度不能为负数');
  if (cents > 1e14) throw new Error('额度超出合理范围');

  // 先清掉同月的旧设置，再按需写入
  const existing = await db
    .collection(COLLECTIONS.budgets)
    .where({ _openid: ctx.openid, month: key })
    .limit(20)
    .get();
  for (const doc of existing.data) {
    await db.collection(COLLECTIONS.budgets).doc(doc._id).remove();
  }

  if (cents > 0) {
    await db.collection(COLLECTIONS.budgets).add({
      data: {
        _openid: ctx.openid,
        month: key,
        amountCents: cents,
        updatedAt: db.serverDate(),
        updatedAtMs: Date.now(),
      },
    });
  }

  const logError = await writeLogs([
    buildLog(ctx, event, {
      action: 'setBudget',
      target: 'budgets',
      summary:
        cents > 0
          ? `设置 ${key} 支出预警额度为 ${(cents / 100).toFixed(2)} 元`
          : `清除 ${key} 的支出预警额度`,
    }),
  ]);

  return { month: key, amountCents: cents, logError };
}

async function monthlySummary(event, ctx) {
  const year = String(event.year || new Date().getFullYear());
  const res = await db
    .collection(COLLECTIONS.records)
    .aggregate()
    .match({ _openid: ctx.openid, date: dateRange(year, null) })
    .group({
      _id: { month: $.substr(['$date', 5, 2]), type: '$type' },
      amount: $.sum('$amountCents'),
      count: $.sum(1),
    })
    .end();

  const map = {};
  (res.list || []).forEach((row) => {
    const month = row._id.month;
    if (!map[month]) map[month] = { income: 0, expense: 0, count: 0 };
    if (row._id.type === 'income') map[month].income = row.amount;
    else if (row._id.type === 'expense') map[month].expense = row.amount;
    map[month].count += row.count || 0;
  });

  const budgets = buildBudgetMap(year, await readBudgets(ctx.openid));

  const list = [];
  let cumulative = 0;
  for (let m = 1; m <= 12; m += 1) {
    const key = pad2(m);
    const hit = map[key] || { income: 0, expense: 0, count: 0 };
    cumulative += hit.income - hit.expense;

    const budgetInfo = budgets[`${year}-${key}`] || { budget: 0, budgetValue: 0, budgetFrom: '' };
    list.push({
      month: key,
      income: hit.income,
      expense: hit.expense,
      profit: hit.income - hit.expense,
      count: hit.count,
      cumulative,
      budget: budgetInfo.budget,
      budgetValue: budgetInfo.budgetValue,
      budgetFrom: budgetInfo.budgetFrom,
      alert: budgetAlert(hit.expense, budgetInfo.budget),
    });
  }
  return list;
}

async function dailySummary(event, ctx) {
  const match = { _openid: ctx.openid };
  const range = dateRange(event.year, event.month);
  if (range) match.date = range;

  const res = await db
    .collection(COLLECTIONS.records)
    .aggregate()
    .match(match)
    .group({
      _id: { date: '$date', type: '$type' },
      amount: $.sum('$amountCents'),
      count: $.sum(1),
    })
    .end();

  const map = {};
  (res.list || []).forEach((row) => {
    const date = row._id.date;
    if (!map[date]) map[date] = { date, income: 0, expense: 0, count: 0 };
    if (row._id.type === 'income') map[date].income = row.amount;
    else if (row._id.type === 'expense') map[date].expense = row.amount;
    map[date].count += row.count || 0;
  });

  return Object.keys(map)
    .sort()
    .map((date) => {
      const hit = map[date];
      return Object.assign({}, hit, { profit: hit.income - hit.expense });
    });
}

async function categorySummary(event, ctx) {
  const type = event.type === 'income' ? 'income' : 'expense';
  const match = { _openid: ctx.openid, type };
  const range = dateRange(event.year, event.month);
  if (range) match.date = range;

  const res = await db
    .collection(COLLECTIONS.records)
    .aggregate()
    .match(match)
    .group({ _id: '$category', amount: $.sum('$amountCents'), count: $.sum(1) })
    .end();

  const list = (res.list || []).map((row) => ({
    category: row._id || '其他',
    amount: row.amount,
    count: row.count,
  }));
  const total = list.reduce((sum, item) => sum + item.amount, 0);
  list.sort((a, b) => b.amount - a.amount);
  return list.map((item) => Object.assign({}, item, { ratio: total ? item.amount / total : 0 }));
}

async function years(event, ctx) {
  const res = await db
    .collection(COLLECTIONS.records)
    .aggregate()
    .match({ _openid: ctx.openid })
    .group({ _id: $.substr(['$date', 0, 4]) })
    .end();

  const set = {};
  (res.list || []).forEach((row) => {
    if (row._id) set[row._id] = true;
  });
  set[String(new Date().getFullYear())] = true;
  return Object.keys(set).sort((a, b) => Number(b) - Number(a));
}

/* ================================ 分类 & 日志 ============================== */

/**
 * 分类字典 = 默认分类 + 字典（默认种子 + 显式添加）+ 记录中实际使用过的分类
 *
 * 说明：保存记录时**不再**自动把新分类写进字典（旧实现会这么做，导致录错一次就
 * 长期留在下拉框里）。现在分类还有记录在用时才会出现，把记录改成别的分类后自动消失。
 */
async function getCategories(event, ctx) {
  const settings = await getSettings(ctx.openid);

  const res = await db
    .collection(COLLECTIONS.records)
    .aggregate()
    .match({ _openid: ctx.openid })
    .group({ _id: { type: '$type', category: '$category' } })
    .end();

  const build = (kind) => {
    const out = (DEFAULT_CATEGORIES[kind] || []).slice();
    const push = (name) => {
      const clean = String(name || '').trim();
      if (clean && out.indexOf(clean) < 0) out.push(clean);
    };
    (settings[kind] || []).forEach(push);
    (res.list || []).forEach((row) => {
      if (row._id && row._id.type === kind) push(row._id.category);
    });
    return out;
  };

  return { income: build('income'), expense: build('expense') };
}

async function addCategory(event, ctx) {
  const name = String(event.name || '').trim().slice(0, 30);
  const type = event.type === 'income' ? 'income' : 'expense';
  if (!name) throw new Error('分类名称不能为空');
  await ensureCategory(ctx.openid, name, type);
  return getCategories(event, ctx);
}

function toLog(doc) {
  return {
    id: doc._id,
    action: doc.action || '',
    recordId: doc.recordId || '',
    summary: doc.summary || '',
    before: doc.before || null,
    after: doc.after || null,
    changed: doc.changed || [],
    batchId: doc.batchId || '',
    errors: doc.errors || [],
    client: doc.client || null,
    time: doc.createdAtMs || 0,
  };
}

async function listLogs(event, ctx) {
  const where = { _openid: ctx.openid };
  if (event.filterAction) where.action = String(event.filterAction);

  const limit = Math.min(Math.max(Number(event.limit) || 50, 1), MAX_PAGE);
  const offset = Math.max(Number(event.offset) || 0, 0);

  const [countRes, res] = await Promise.all([
    db.collection(COLLECTIONS.logs).where(where).count(),
    db
      .collection(COLLECTIONS.logs)
      .where(where)
      .orderBy('createdAtMs', 'desc')
      .skip(offset)
      .limit(limit)
      .get(),
  ]);

  return { total: countRes.total, items: res.data.map(toLog) };
}

/** 日志按 action 汇总，用于日志页顶部概览 */
async function logStats(event, ctx) {
  const res = await db
    .collection(COLLECTIONS.logs)
    .aggregate()
    .match({ _openid: ctx.openid })
    .group({ _id: '$action', count: $.sum(1) })
    .end();

  const stats = {};
  let total = 0;
  (res.list || []).forEach((row) => {
    stats[row._id || 'unknown'] = row.count;
    total += row.count;
  });
  return { total, stats };
}

/** 清理旧日志：默认删除 30 天前的记录，单次最多 500 条 */
async function clearLogs(event, ctx) {
  const days = Math.min(Math.max(Number(event.days) || 30, 1), 3650);
  const before = Date.now() - days * 24 * 60 * 60 * 1000;

  const res = await db
    .collection(COLLECTIONS.logs)
    .where({ _openid: ctx.openid, createdAtMs: _.lt(before) })
    .limit(500)
    .get();

  let removed = 0;
  for (const doc of res.data) {
    await db.collection(COLLECTIONS.logs).doc(doc._id).remove();
    removed += 1;
  }

  const logError = await writeLogs([
    buildLog(ctx, event, { action: 'clearLogs', target: 'logs', count: removed, summary: `清理 ${days} 天前的日志，共 ${removed} 条` }),
  ]);

  return { removed, days, logError };
}

/** 初始化集合（首次部署时调用一次） */
async function initDb(event, ctx) {
  const collections = {};
  for (const name of COLLECTION_NAMES) {
    try {
      await db.createCollection(name);
      collections[name] = 'created';
    } catch (err) {
      const message = (err && err.message) || '';
      collections[name] = /exist/i.test(message) ? 'exists' : `failed: ${message}`;
    }
  }
  await getSettings(ctx.openid);
  const logError = await writeLogs([
    buildLog(ctx, event, { action: 'initDb', target: 'db', summary: `初始化集合：${JSON.stringify(collections)}` }),
  ]);
  return { collections, logError };
}

/* ================================== 入口 ================================== */

const ACTIONS = {
  ping,
  whoami,
  initDb,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  deleteRecords,
  importRecords,
  overview,
  monthlySummary,
  getBudgets,
  setBudget,
  dailySummary,
  categorySummary,
  years,
  getCategories,
  addCategory,
  listLogs,
  logStats,
  clearLogs,
};

async function ping() {
  return { pong: true, serverTime: Date.now() };
}

/**
 * 当前调用者信息。
 * openid 完全由微信在调用时注入，前端不需要也无法配置；
 * 这里返回它是为了排查「数据归属」「换账号后看不到数据」这类问题。
 */
async function whoami(event, ctx) {
  const openid = ctx.openid || '';
  return {
    openid,
    openidMasked: openid ? `${openid.slice(0, 6)}****${openid.slice(-4)}` : '',
    appid: ctx.appid || '',
    envId: process.env.TCB_ENV || process.env.SCF_NAMESPACE || '',
  };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const input = event || {};
  const action = input.action;

  // 身份必须来自微信上下文，前端传入的一律忽略
  if (!openid) {
    return { ok: false, message: '无法识别用户身份，请在小程序内调用' };
  }

  const handler = ACTIONS[action];
  if (!handler) {
    return { ok: false, message: `未知操作：${action || '(空)'}` };
  }

  const ctx = {
    openid,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
    clientIp: wxContext.CLIENTIP,
  };

  try {
    const data = await handler(input, ctx);
    return { ok: true, data };
  } catch (err) {
    console.error(`[bookkeeping] action=${action} 执行失败：`, err);
    // 失败也留痕，便于排查（例如导入时某条数据不合法）
    await writeLogs([
      buildLog(ctx, input, {
        action: `${action}Failed`,
        summary: `操作失败：${(err && err.message) || '未知错误'}`,
        errors: [{ row: 0, message: (err && err.message) || '未知错误' }],
      }),
    ]);
    return { ok: false, message: (err && err.message) || '服务异常，请稍后重试' };
  }
};
