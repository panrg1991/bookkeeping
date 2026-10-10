'use strict';

/**
 * 数据层（本地存储版）
 *
 * - 数据存在小程序本地存储（wx.setStorageSync），**不依赖云开发**，无需 AppID 与网络
 * - 数据仅存于当前设备 + 当前微信账号，换设备不同步；清缓存会丢失
 * - 操作日志同样记录在本地（bk:logs），滚动保留最近 MAX_LOGS 条
 * - 接口与 store.cloud.js 完全一致（返回结构相同），由 store.js 按 config.mode 选择
 * - 本文件内的方法为同步实现，对外由 store.js 统一包装成 Promise
 */

const fmt = require('./format');

const RECORDS_KEY = 'bk:records';
const CATEGORIES_KEY = 'bk:categories';
const SEQ_KEY = 'bk:seq';
const LOGS_KEY = 'bk:logs';

const DEFAULT_CATEGORIES = {
  expense: ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '教育', '通讯', '人情', '其他'],
  income: ['工资', '奖金', '兼职', '理财', '租金', '红包', '其他'],
};

/** 本地日志滚动上限：避免日志把本地存储占满 */
const MAX_LOGS = 500;

let recordCache = null;
let logCache = null;

/* --------------------------------- 基础读写 -------------------------------- */

function init() {
  listCategories();
  readRecords();
  readLogs();
  return { mode: 'local', ready: true };
}

function initDb() {
  init();
  return { mode: 'local', collections: { records: RECORDS_KEY, categories: CATEGORIES_KEY, logs: LOGS_KEY } };
}

/** 本地模式没有微信用户身份，返回固定的占位信息 */
function whoami() {
  return {
    openid: '',
    openidMasked: '本地模式（未接入云开发）',
    appid: '',
    envId: '本地存储',
  };
}

function readRecords() {
  if (recordCache) return recordCache;
  const raw = wx.getStorageSync(RECORDS_KEY);
  recordCache = Array.isArray(raw) ? raw : [];
  return recordCache;
}

function writeRecords(records) {
  recordCache = records;
  wx.setStorageSync(RECORDS_KEY, records);
}

function readLogs() {
  if (logCache) return logCache;
  const raw = wx.getStorageSync(LOGS_KEY);
  logCache = Array.isArray(raw) ? raw : [];
  return logCache;
}

function writeLogs(logs) {
  logCache = logs;
  wx.setStorageSync(LOGS_KEY, logs);
}

function nextId() {
  const records = readRecords();
  let seq = Number(wx.getStorageSync(SEQ_KEY)) || 0;
  const maxId = records.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  seq = Math.max(seq, maxId) + 1;
  wx.setStorageSync(SEQ_KEY, seq);
  return seq;
}

/* --------------------------------- 校验规则 -------------------------------- */

function normalizeInput(input) {
  const source = input || {};

  const date = String(source.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式应为 YYYY-MM-DD');

  const type = source.type;
  if (type !== 'income' && type !== 'expense') throw new Error('类型只能是收入或支出');

  const unitPriceCents = Math.max(0, Math.round(Number(source.unitPriceCents) || 0));
  const quantity = Math.max(0, Number(source.quantity) || 0);
  if (quantity > 1e9) throw new Error('数量超出合理范围');

  // 单价 × 数量 计价：两者都大于 0 时金额由它们计算（以分为单位四舍五入 = 保留两位小数）
  let amountCents;
  if (unitPriceCents > 0 && quantity > 0) {
    amountCents = Math.round(unitPriceCents * quantity);
    if (amountCents <= 0) throw new Error('单价 × 数量 计算出的金额必须大于 0');
  } else {
    amountCents = Math.round(Number(source.amountCents));
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error('金额必须大于 0（也可填写单价与数量自动计算）');
  }

  const category = String(source.category || '').trim().slice(0, 30) || '其他';
  const note = String(source.note || '').trim().slice(0, 200);

  return { date, type, amountCents, unitPriceCents, quantity, category, note };
}

const RECORD_FIELDS = ['date', 'type', 'amountCents', 'unitPriceCents', 'quantity', 'category', 'note'];

function pickRecord(doc) {
  const out = {};
  RECORD_FIELDS.forEach((key) => {
    out[key] = doc[key];
  });
  return out;
}

function diffKeys(before, after) {
  return RECORD_FIELDS.filter((key) => before[key] !== after[key]);
}

function describe(record) {
  if (!record) return '';
  const kind = record.type === 'income' ? '收入' : '支出';
  return `${record.date} ${kind} ${(record.amountCents / 100).toFixed(2)} 元（${record.category}）`;
}

/* ---------------------------------- 日志 ---------------------------------- */

let cachedClient = null;
function clientInfo() {
  if (cachedClient) return cachedClient;
  const info = { version: '', platform: '', model: '' };
  try {
    const account = wx.getAccountInfoSync();
    info.version = (account && account.miniProgram && account.miniProgram.version) || '';
  } catch (err) {
    // 忽略
  }
  try {
    const device = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : wx.getSystemInfoSync();
    info.platform = device.platform || device.system || '';
    info.model = device.model || '';
  } catch (err) {
    // 忽略
  }
  cachedClient = info;
  return cachedClient;
}

function buildLog(payload) {
  return Object.assign(
    {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
      client: clientInfo(),
      time: Date.now(),
    },
    payload
  );
}

function appendLogs(entries) {
  if (!entries || !entries.length) return;
  const logs = readLogs().concat(entries);
  writeLogs(logs.length > MAX_LOGS ? logs.slice(logs.length - MAX_LOGS) : logs);
}

/* --------------------------------- 记录 CRUD ------------------------------- */

function listRecords(options) {
  const opt = options || {};
  const { year, month, day, type, category, keyword } = opt;

  let list = readRecords();

  if (year) {
    const prefix = month ? `${year}-${fmt.pad2(month)}` : `${year}-`;
    list = list.filter((item) => item.date.indexOf(prefix) === 0);
  }
  if (day) list = list.filter((item) => item.date === day);
  if (type === 'income' || type === 'expense') list = list.filter((item) => item.type === type);
  if (category) list = list.filter((item) => item.category === category);
  if (keyword && String(keyword).trim()) {
    const kw = String(keyword).trim().toLowerCase();
    list = list.filter((item) => `${item.category}${item.note}`.toLowerCase().indexOf(kw) >= 0);
  }

  const sorted = list
    .slice()
    .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));

  const total = sorted.length;
  const limit = Math.min(Math.max(Number(opt.limit) || 500, 1), 5000);
  const offset = Math.max(Number(opt.offset) || 0, 0);

  return { total, items: sorted.slice(offset, offset + limit) };
}

function getRecord(id) {
  const target = Number(id);
  const hit = readRecords().find((item) => Number(item.id) === target);
  return hit ? Object.assign({}, hit) : null;
}

function createRecord(input) {
  const data = normalizeInput(input);
  const now = Date.now();
  const record = Object.assign({ id: nextId() }, data, { createdAt: now, updatedAt: now });

  writeRecords(readRecords().concat([record]));
  appendLogs([buildLog({ action: 'create', recordId: String(record.id), after: data, summary: `新增 ${describe(data)}` })]);

  return { id: record.id, record: Object.assign({}, record) };
}

function updateRecord(id, input) {
  const target = Number(id);
  const records = readRecords();
  const index = records.findIndex((item) => Number(item.id) === target);
  if (index < 0) throw new Error('记录不存在或已被删除');

  const before = records[index];
  const merged = normalizeInput(Object.assign({}, pickRecord(before), input || {}));
  const changed = diffKeys(before, merged);

  if (!changed.length) {
    return { id: target, record: Object.assign({}, before), changed, unchanged: true };
  }

  const next = Object.assign({}, before, merged, { updatedAt: Date.now() });
  const list = records.slice();
  list[index] = next;
  writeRecords(list);
  appendLogs([
    buildLog({
      action: 'update',
      recordId: String(target),
      before: pickRecord(before),
      after: merged,
      changed,
      summary: `修改 ${describe(merged)}（字段：${changed.join('、')}）`,
    }),
  ]);

  return { id: target, record: Object.assign({}, next), changed };
}

function deleteRecord(id) {
  const target = Number(id);
  const records = readRecords();
  const index = records.findIndex((item) => Number(item.id) === target);
  if (index < 0) throw new Error('记录不存在或已被删除');

  const before = records[index];
  writeRecords(records.filter((item) => Number(item.id) !== target));
  appendLogs([buildLog({ action: 'delete', recordId: String(target), before: pickRecord(before), summary: `删除 ${describe(before)}` })]);

  return { id: target };
}

/** 批量删除：一次写入，逐条记录删除日志 */
function deleteRecords(ids) {
  const wanted = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
  if (!wanted.length) throw new Error('没有选择要删除的记录');

  const records = readRecords();
  const keep = [];
  const logs = [];
  let removed = 0;

  records.forEach((item) => {
    if (wanted.indexOf(String(item.id)) >= 0) {
      removed += 1;
      logs.push(
        buildLog({
          action: 'delete',
          recordId: String(item.id),
          before: pickRecord(item),
          summary: `批量删除 ${describe(item)}`,
        })
      );
    } else {
      keep.push(item);
    }
  });

  writeRecords(keep);
  appendLogs(logs);

  return { removed, skipped: wanted.length - removed };
}

function importRecords(items, options) {
  if (!Array.isArray(items)) throw new Error('导入数据格式不正确');
  if (!items.length) throw new Error('没有可导入的数据');
  if (items.length > 5000) throw new Error('单次最多导入 5000 条记录');

  const opt = options || {};
  const detailLog = opt.detailLog !== false;
  const now = Date.now();
  const batchId = `batch_${now}_${Math.random().toString(36).slice(2, 8)}`;

  const records = readRecords().slice();
  let seq = Number(wx.getStorageSync(SEQ_KEY)) || 0;
  seq = Math.max(seq, records.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0));

  const logs = [];
  const errors = [];
  let inserted = 0;

  items.forEach((raw, index) => {
    try {
      const data = normalizeInput(raw);
      seq += 1;
      records.push(Object.assign({ id: seq }, data, { createdAt: now, updatedAt: now, importBatch: batchId }));
      inserted += 1;
      if (detailLog) {
        logs.push(
          buildLog({
            action: 'import',
            batchId,
            recordId: String(seq),
            after: data,
            summary: `导入新增 ${describe(data)}`,
          })
        );
      }
    } catch (err) {
      const message = (err && err.message) || '数据不合法';
      errors.push({ row: index + 1, message });
      logs.push(
        buildLog({
          action: 'importRejected',
          batchId,
          summary: `导入第 ${index + 1} 行被拒绝：${message}`,
          errors: [{ row: index + 1, message }],
        })
      );
    }
  });

  writeRecords(records);
  wx.setStorageSync(SEQ_KEY, seq);

  logs.push(
    buildLog({
      action: 'importBatch',
      batchId,
      count: inserted,
      summary: `批量导入完成：成功 ${inserted} 条，跳过 ${errors.length} 条`,
      errors: errors.slice(0, 100),
    })
  );
  appendLogs(logs);

  return { inserted, skipped: errors.length, errors: errors.slice(0, 100), batchId };
}

/* ---------------------------------- 统计 ---------------------------------- */

function periodRecords(year, month) {
  const all = readRecords();
  if (!year) return all;
  const prefix = month ? `${year}-${fmt.pad2(month)}` : `${year}-`;
  return all.filter((item) => item.date.indexOf(prefix) === 0);
}

function summarize(records) {
  let income = 0;
  let expense = 0;
  records.forEach((item) => {
    if (item.type === 'income') income += item.amountCents;
    else expense += item.amountCents;
  });
  return { income, expense, profit: income - expense, count: records.length };
}

function overview(year, month) {
  return {
    period: summarize(periodRecords(year, month)),
    year: summarize(periodRecords(year, null)),
  };
}

function monthlySummary(year) {
  const grouped = {};
  periodRecords(year, null).forEach((item) => {
    const key = item.date.slice(5, 7);
    if (!grouped[key]) grouped[key] = { income: 0, expense: 0, count: 0 };
    grouped[key].count += 1;
    if (item.type === 'income') grouped[key].income += item.amountCents;
    else grouped[key].expense += item.amountCents;
  });

  const list = [];
  let cumulative = 0;
  for (let m = 1; m <= 12; m += 1) {
    const key = fmt.pad2(m);
    const hit = grouped[key] || { income: 0, expense: 0, count: 0 };
    cumulative += hit.income - hit.expense;
    list.push({
      month: key,
      income: hit.income,
      expense: hit.expense,
      profit: hit.income - hit.expense,
      count: hit.count,
      cumulative,
    });
  }
  return list;
}

function dailySummary(year, month) {
  const grouped = {};
  periodRecords(year, month).forEach((item) => {
    if (!grouped[item.date]) grouped[item.date] = { date: item.date, income: 0, expense: 0, count: 0 };
    grouped[item.date].count += 1;
    if (item.type === 'income') grouped[item.date].income += item.amountCents;
    else grouped[item.date].expense += item.amountCents;
  });

  return Object.keys(grouped)
    .sort()
    .map((date) => {
      const hit = grouped[date];
      return Object.assign({}, hit, { profit: hit.income - hit.expense });
    });
}

function categorySummary(year, month, type) {
  const kind = type === 'income' ? 'income' : 'expense';
  const grouped = {};
  periodRecords(year, month).forEach((item) => {
    if (item.type !== kind) return;
    if (!grouped[item.category]) grouped[item.category] = { category: item.category, amount: 0, count: 0 };
    grouped[item.category].amount += item.amountCents;
    grouped[item.category].count += 1;
  });

  const list = Object.keys(grouped).map((key) => grouped[key]);
  const total = list.reduce((sum, item) => sum + item.amount, 0);
  list.sort((a, b) => b.amount - a.amount);
  return list.map((item) => Object.assign({}, item, { ratio: total ? item.amount / total : 0 }));
}

function years() {
  const set = {};
  readRecords().forEach((item) => {
    set[item.date.slice(0, 4)] = true;
  });
  set[String(new Date().getFullYear())] = true;
  return Object.keys(set).sort((a, b) => Number(b) - Number(a));
}

/* --------------------------------- 分类字典 -------------------------------- */

/** 原始分类字典（仅默认种子 + 显式添加，不含记录中使用过的分类） */
function readStoredCategories() {
  const raw = wx.getStorageSync(CATEGORIES_KEY);
  if (raw && Array.isArray(raw.income) && Array.isArray(raw.expense)) return raw;
  const init2 = {
    income: DEFAULT_CATEGORIES.income.slice(),
    expense: DEFAULT_CATEGORIES.expense.slice(),
  };
  wx.setStorageSync(CATEGORIES_KEY, init2);
  return init2;
}

/**
 * 分类字典 = 默认分类 + 字典（默认种子 + 显式添加）+ 记录中实际使用过的分类
 *
 * 说明：保存记录时**不再**自动把新分类写进字典（旧实现会，导致录错一次就长期留在
 * 下拉框里）。现在分类还有记录在用时才会出现，把记录改成别的分类后它会自动消失。
 */
function listCategories() {
  const base = readStoredCategories();
  const records = readRecords();

  const build = (kind) => {
    const out = (DEFAULT_CATEGORIES[kind] || []).slice();
    const push = (name) => {
      const clean = String(name || '').trim();
      if (clean && out.indexOf(clean) < 0) out.push(clean);
    };
    (base[kind] || []).forEach(push);
    records.filter((item) => item.type === kind).forEach((item) => push(item.category));
    return out;
  };

  return { income: build('income'), expense: build('expense') };
}

function addCategory(name, type) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('分类名称不能为空');
  const kind = type === 'income' ? 'income' : 'expense';
  const stored = readStoredCategories();
  if (stored[kind].indexOf(clean) < 0) {
    stored[kind].push(clean);
    wx.setStorageSync(CATEGORIES_KEY, stored);
  }
  return listCategories();
}

/* ---------------------------------- 日志查询 ------------------------------- */

function listLogs(options) {
  const opt = options || {};
  let list = readLogs().slice().sort((a, b) => b.time - a.time);
  if (opt.filterAction) list = list.filter((item) => item.action === opt.filterAction);

  const total = list.length;
  const limit = Math.min(Math.max(Number(opt.limit) || 50, 1), 200);
  const offset = Math.max(Number(opt.offset) || 0, 0);

  return { total, items: list.slice(offset, offset + limit) };
}

function logStats() {
  const stats = {};
  let total = 0;
  readLogs().forEach((item) => {
    stats[item.action] = (stats[item.action] || 0) + 1;
    total += 1;
  });
  return { total, stats, capacity: MAX_LOGS };
}

function clearLogs(days) {
  const keepDays = Math.min(Math.max(Number(days) || 30, 1), 3650);
  const before = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const logs = readLogs();
  const kept = logs.filter((item) => item.time >= before);
  const removed = logs.length - kept.length;
  writeLogs(kept);
  appendLogs([buildLog({ action: 'clearLogs', target: 'logs', count: removed, summary: `清理 ${keepDays} 天前的日志，共 ${removed} 条` })]);
  return { removed, days: keepDays };
}

/* --------------------------------- 备份恢复 -------------------------------- */

const BACKUP_VERSION = 1;

/**
 * 导出全部数据（记录 + 分类字典），用于换手机迁移或留档。
 * 返回可 JSON.stringify 的对象，页面侧复制到剪贴板即可搬运。
 */
function exportAll() {
  return {
    app: 'bookkeeping-miniprogram',
    version: BACKUP_VERSION,
    mode: 'local',
    exportedAt: new Date().toISOString(),
    count: readRecords().length,
    records: readRecords().map((item) => Object.assign({}, item)),
    categories: listCategories(),
  };
}

/**
 * 从备份恢复数据
 * @param {object} payload exportAll() 产出的对象（或同构 JSON）
 * @param {object} options { mode: 'replace' | 'merge' }
 *   - replace：清空现有记录后写入（ID 与时间戳沿用备份里的）
 *   - merge  ：保留现有记录，仅追加备份中不存在的记录（按 id 去重）
 */
function importAll(payload, options) {
  if (!payload || typeof payload !== 'object') throw new Error('备份内容格式不正确（应为 JSON 对象）');
  if (!Array.isArray(payload.records)) throw new Error('备份内容缺少 records 字段');

  const mode = (options && options.mode) === 'merge' ? 'merge' : 'replace';
  const next = mode === 'replace' ? [] : readRecords().slice();
  const existingIds = {};
  next.forEach((item) => {
    existingIds[String(item.id)] = true;
  });

  let seq = Number(wx.getStorageSync(SEQ_KEY)) || 0;
  seq = Math.max(seq, next.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0));

  let inserted = 0;
  let skipped = 0;

  payload.records.forEach((raw) => {
    try {
      const data = normalizeInput(raw);
      const rawId = Number(raw && raw.id);
      const hasId = Number.isInteger(rawId) && rawId > 0;

      if (hasId && existingIds[String(rawId)]) {
        skipped += 1;
        return;
      }

      if (hasId) {
        seq = Math.max(seq, rawId);
      } else {
        seq += 1;
      }
      const id = hasId ? rawId : seq;

      next.push(
        Object.assign({ id }, data, {
          createdAt: Number(raw && raw.createdAt) || Date.now(),
          updatedAt: Number(raw && raw.updatedAt) || Date.now(),
        })
      );
      existingIds[String(id)] = true;
      inserted += 1;
    } catch (err) {
      skipped += 1;
    }
  });

  writeRecords(next);
  wx.setStorageSync(SEQ_KEY, seq);

  // 分类字典：并集合并，不覆盖用户已有分类
  const incoming = payload.categories;
  if (incoming && typeof incoming === 'object') {
    const categories = listCategories();
    ['income', 'expense'].forEach((kind) => {
      const list = Array.isArray(incoming[kind]) ? incoming[kind] : [];
      list.forEach((name) => {
        const clean = String(name || '').trim();
        if (clean && categories[kind].indexOf(clean) < 0) categories[kind].push(clean);
      });
    });
    wx.setStorageSync(CATEGORIES_KEY, categories);
  }

  appendLogs([
    buildLog({
      action: 'restore',
      count: inserted,
      summary: `恢复备份（${mode === 'replace' ? '覆盖' : '合并'}）：写入 ${inserted} 条，跳过 ${skipped} 条`,
    }),
  ]);

  return { mode, inserted, skipped, total: next.length };
}

module.exports = {
  init,
  initDb,
  whoami,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  deleteRecords,
  importRecords,
  overview,
  monthlySummary,
  dailySummary,
  categorySummary,
  years,
  listCategories,
  addCategory,
  listLogs,
  logStats,
  clearLogs,
  exportAll,
  importAll,
  toCsv: fmt.toCsv,
  toDateString: fmt.toDateString,
  toType: fmt.toType,
  toAmountCents: fmt.toAmountCents,
};
