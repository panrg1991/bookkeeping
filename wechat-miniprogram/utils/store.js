/**
 * 数据层：使用小程序本地存储（wx.setStorageSync / getStorageSync）持久化。
 *
 * 记录结构：
 *   {
 *     id: number,
 *     date: 'YYYY-MM-DD',
 *     type: 'income' | 'expense',
 *     amountCents: number,   // 金额，单位「分」，避免浮点误差
 *     category: string,
 *     note: string,
 *     createdAt: number,
 *     updatedAt: number
 *   }
 *
 * 接口与 Web 版 db.js 一一对应，统计逻辑保持完全一致。
 */

const { pad2, parseDate } = require('./format');

const RECORDS_KEY = 'bk:records';
const CATEGORIES_KEY = 'bk:categories';
const SEQ_KEY = 'bk:seq';

const DEFAULT_CATEGORIES = {
  expense: ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '教育', '通讯', '人情', '其他'],
  income: ['工资', '奖金', '兼职', '理财', '租金', '红包', '其他'],
};

let recordCache = null;

/* --------------------------------- 基础读写 -------------------------------- */

function init() {
  listCategories();
  readRecords();
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

  const amountCents = Number(source.amountCents);
  if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error('金额必须大于 0');

  const category = String(source.category || '').trim() || '其他';
  const note = String(source.note || '').trim();

  return { date, type, amountCents, category, note };
}

/* --------------------------------- 记录 CRUD ------------------------------- */

function listRecords(options) {
  const opt = options || {};
  const { year, month, day, type, category, keyword } = opt;

  let list = readRecords();

  if (year) {
    const prefix = month ? `${year}-${pad2(month)}` : `${year}-`;
    list = list.filter((item) => item.date.indexOf(prefix) === 0);
  }
  if (day) list = list.filter((item) => item.date === day);
  if (type === 'income' || type === 'expense') list = list.filter((item) => item.type === type);
  if (category) list = list.filter((item) => item.category === category);
  if (keyword) {
    const kw = String(keyword).trim().toLowerCase();
    if (kw) {
      list = list.filter((item) => `${item.category}${item.note}`.toLowerCase().indexOf(kw) >= 0);
    }
  }

  return list.slice().sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
}

function getRecord(id) {
  const target = Number(id);
  return readRecords().find((item) => Number(item.id) === target) || null;
}

function createRecord(input) {
  const data = normalizeInput(input);
  const now = Date.now();
  const record = Object.assign({ id: nextId() }, data, { createdAt: now, updatedAt: now });
  writeRecords(readRecords().concat([record]));
  ensureCategory(data.category, data.type);
  return record;
}

function updateRecord(id, input) {
  const target = Number(id);
  const records = readRecords();
  const index = records.findIndex((item) => Number(item.id) === target);
  if (index < 0) throw new Error('记录不存在或已被删除');

  const merged = Object.assign({}, records[index], input);
  const data = normalizeInput(merged);
  const next = Object.assign({}, records[index], data, { updatedAt: Date.now() });

  const list = records.slice();
  list[index] = next;
  writeRecords(list);
  ensureCategory(data.category, data.type);
  return next;
}

function deleteRecord(id) {
  const target = Number(id);
  const records = readRecords();
  const list = records.filter((item) => Number(item.id) !== target);
  if (list.length === records.length) throw new Error('记录不存在或已被删除');
  writeRecords(list);
  return { id: target };
}

/** 批量导入：逐条校验，合法的入库，非法的返回错误行 */
function importRecords(items) {
  if (!Array.isArray(items)) throw new Error('导入数据格式不正确');
  if (!items.length) throw new Error('没有可导入的数据');
  if (items.length > 5000) throw new Error('单次最多导入 5000 条记录');

  const records = readRecords().slice();
  const inserted = [];
  const errors = [];
  const now = Date.now();
  let seq = Number(wx.getStorageSync(SEQ_KEY)) || 0;
  const maxId = records.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  seq = Math.max(seq, maxId);

  items.forEach((raw, index) => {
    try {
      const data = normalizeInput(raw);
      seq += 1;
      records.push(Object.assign({ id: seq }, data, { createdAt: now, updatedAt: now }));
      inserted.push(data);
      ensureCategory(data.category, data.type);
    } catch (err) {
      errors.push({ row: index + 1, message: err.message || '数据不合法' });
    }
  });

  writeRecords(records);
  wx.setStorageSync(SEQ_KEY, seq);

  return { inserted: inserted.length, skipped: errors.length, errors };
}

/* ---------------------------------- 统计 ---------------------------------- */

function periodRecords(year, month) {
  const all = readRecords();
  const prefix = month ? `${year}-${pad2(month)}` : `${year}-`;
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

/** 本期 + 全年汇总 */
function overview(year, month) {
  return {
    period: summarize(periodRecords(year, month)),
    year: summarize(periodRecords(year, null)),
  };
}

/** 12 个月统计（含累计利润） */
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
    const key = pad2(m);
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

/** 每日统计（按日期升序） */
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
      return {
        date: hit.date,
        income: hit.income,
        expense: hit.expense,
        profit: hit.income - hit.expense,
        count: hit.count,
      };
    });
}

/** 分类统计（按金额倒序，含占比） */
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
  return list.map((item) => Object.assign({}, item, { ratio: total ? item.amount / total : 0, total }));
}

/** 已有数据的年份（倒序，至少包含当前年） */
function years() {
  const set = {};
  readRecords().forEach((item) => {
    set[item.date.slice(0, 4)] = true;
  });
  set[String(new Date().getFullYear())] = true;
  return Object.keys(set).sort((a, b) => Number(b) - Number(a));
}

/* --------------------------------- 分类管理 -------------------------------- */

function listCategories() {
  const raw = wx.getStorageSync(CATEGORIES_KEY);
  if (raw && Array.isArray(raw.income) && Array.isArray(raw.expense)) return raw;
  const init = {
    income: DEFAULT_CATEGORIES.income.slice(),
    expense: DEFAULT_CATEGORIES.expense.slice(),
  };
  wx.setStorageSync(CATEGORIES_KEY, init);
  return init;
}

function addCategory(name, type) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('分类名称不能为空');
  const kind = type === 'income' ? 'income' : 'expense';
  const categories = listCategories();
  if (categories[kind].indexOf(clean) < 0) {
    categories[kind].push(clean);
    wx.setStorageSync(CATEGORIES_KEY, categories);
  }
  return categories;
}

function ensureCategory(name, type) {
  if (!name) return;
  try {
    addCategory(name, type);
  } catch (err) {
    // 忽略分类记录失败，不影响主流程
  }
}

/* --------------------------------- 导入导出 -------------------------------- */

/** 生成的 CSV 文本（可用于导出到剪贴板，Excel 直接粘贴即可拆分） */
function toCsv(records) {
  const header = ['日期', '类型', '分类', '金额', '备注'];
  const lines = [header.join(',')];
  records.forEach((item) => {
    const cells = [
      item.date,
      item.type === 'income' ? '收入' : '支出',
      item.category,
      (item.type === 'income' ? '' : '-') + (item.amountCents / 100).toFixed(2),
      item.note,
    ].map((cell) => {
      const text = String(cell == null ? '' : cell);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    });
    lines.push(cells.join(','));
  });
  return lines.join('\r\n');
}

/** 简单日期/金额解析，供文本导入使用 */
function toDateString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  let match = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (match) return `${match[1]}-${pad2(Number(match[2]))}-${pad2(Number(match[3]))}`;
  match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return null;
}

function toType(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (['支出', 'expense', 'out', 'e', '花费', '-'].indexOf(text) >= 0) return 'expense';
  if (['收入', 'income', 'in', 'i', '收', '+'].indexOf(text) >= 0) return 'income';
  return null;
}

function toAmountCents(value) {
  if (value == null) return null;
  const text = String(value).replace(/[¥￥,，\s]/g, '');
  const num = Number(text);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

module.exports = {
  init,
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
  toCsv,
  toDateString,
  toType,
  toAmountCents,
  DEFAULT_CATEGORIES,
};
