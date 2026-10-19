'use strict';

/**
 * 数据层（db.js）集成测试。
 * 使用临时数据库文件，避免污染 ./data/bookkeeping.db。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const dataDirExisted = fs.existsSync(DATA_DIR);
const TMP_DB = path.join(os.tmpdir(), `bk_test_${process.pid}_${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;

const store = require('../db');

after(() => {
  try { fs.rmSync(TMP_DB, { force: true }); } catch { /* 句柄占用时忽略，留在系统临时目录 */ }
  if (!dataDirExisted) {
    try { fs.rmdirSync(DATA_DIR); } catch { /* 非空或不存在则忽略 */ }
  }
});

test('createRecord / listRecords / overview', () => {
  const expense = store.createRecord({ date: '2026-02-10', type: 'expense', amount: 35.5, category: '餐饮', note: '午餐' });
  const unit = store.createRecord({ date: '2026-02-11', type: 'income', unitPrice: 100, quantity: 2.5, category: '兼职' });
  assert.equal(expense.amount, 35.5);
  assert.equal(unit.amount, 250);

  const list = store.listRecords({ year: '2026', month: '02' });
  assert.equal(list.total, 2);
  assert.equal(list.items[0].amount, 250); // 按日期倒序，02-11 在前

  const ov = store.overview('2026', '02');
  assert.equal(ov.period.income, 25000);
  assert.equal(ov.period.expense, 3550);
  assert.equal(ov.period.profit, 21450);
  assert.equal(ov.period.count, 2);
  assert.equal(ov.year.count, 2);
});

test('非法日期与非法金额被拒绝', () => {
  assert.throws(() => store.createRecord({ date: '2026-02-30', type: 'expense', amount: 1, category: 'x' }), /日期/);
  assert.throws(() => store.createRecord({ date: '2026-13-01', type: 'expense', amount: 1, category: 'x' }), /日期/);
  assert.throws(() => store.createRecord({ date: '2026-01-01', type: 'expense', amount: -1, category: 'x' }), /金额/);
  assert.throws(() => store.createRecord({ date: '2026-01-01', type: '其它', amount: 1, category: 'x' }), /类型/);
});

test('updateRecord：改数量会按单价重算金额', () => {
  const created = store.createRecord({ date: '2026-03-01', type: 'expense', unitPrice: 10, quantity: 2, category: '水果' });
  assert.equal(created.amount, 20);

  const updated = store.updateRecord(created.id, { quantity: 3 });
  assert.equal(updated.amount, 30);
  assert.equal(updated.quantity, 3);
  assert.equal(updated.unitPrice, 10);
});

test('deleteRecord：删除后不可再删', () => {
  const created = store.createRecord({ date: '2026-03-02', type: 'expense', amount: 5, category: 'x' });
  assert.deepEqual(store.deleteRecord(created.id), { id: created.id });
  assert.throws(() => store.deleteRecord(created.id), /不存在/);
});

test('importRecords：合法入库、非法收集', () => {
  const res = store.importRecords([
    { date: '2026-04-01', type: 'expense', amount: 10, category: 'a' },
    { date: '2026-04-02', type: 'income', amount: 20, category: 'b' },
    { date: 'bad-date', type: 'expense', amount: 1 },
    { date: '2026-04-03', type: 'expense', amount: -1 },
  ]);
  assert.equal(res.inserted, 2);
  assert.equal(res.skipped, 2);
  assert.equal(res.errors.length, 2);
  assert.equal(store.listRecords({ year: '2026', month: '04' }).total, 2);
});

test('budget：设置、跨月沿用与负数校验', () => {
  store.setBudget('2026-02', 30);
  const list = store.getBudgets('2026');
  assert.equal(list[1].budgetValue, 3000); // 2 月自身设置
  assert.equal(list[1].budget, 3000);
  assert.equal(list[2].budget, 3000); // 3 月沿用 2 月
  assert.equal(list[2].budgetFrom, '2026-02');

  assert.throws(() => store.setBudget('2026-03', -5), /负数/);

  store.setBudget('2026-02', 0); // 清除
  assert.equal(store.getBudgets('2026')[1].budgetValue, 0);
});

test('monthlySummary：支出超额度标记为 over', () => {
  store.createRecord({ date: '2026-06-05', type: 'expense', amount: 100, category: 'x' });
  store.setBudget('2026-06', 50);

  const june = store.monthlySummary('2026')[5];
  assert.equal(june.expense, 10000);
  assert.equal(june.budget, 5000);
  assert.equal(june.alert, 'over');
});

test('years / listCategories', () => {
  assert.ok(store.years().includes('2026'));
  const cats = store.listCategories();
  assert.ok(cats.expense.includes('餐饮'));
  assert.ok(cats.income.includes('工资'));
});
