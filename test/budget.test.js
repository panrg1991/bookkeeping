'use strict';

/**
 * 预算逻辑单元测试。
 * 重点：三份副本（Node 后端 / 小程序本地 / 云函数）行为必须完全一致，规则一旦改动可被立即发现。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const serverBudget = require('../budget');
const localBudget = require('../wechat-miniprogram/utils/budget');
const cloudBudget = require('../wechat-miniprogram/cloudfunctions/bookkeeping/budget');

const COPIES = {
  server: serverBudget,
  local: localBudget,
  cloud: cloudBudget,
};

test('三份副本暴露相同的接口', () => {
  for (const [name, mod] of Object.entries(COPIES)) {
    assert.equal(typeof mod.buildBudgetMap, 'function', `${name}.buildBudgetMap`);
    assert.equal(typeof mod.budgetAlert, 'function', `${name}.budgetAlert`);
    assert.equal(typeof mod.normalizeStoredBudget, 'function', `${name}.normalizeStoredBudget`);
  }
});

test('buildBudgetMap：当月设置 / 跨月沿用 / 跨年沿用', () => {
  const stored = {
    '2025-11': 5000,
    '2026-02': 3000,
    '2026-05': 0, // 0 视为未设置
    '2026-13': 200, // 非法月份
    'bad-key': 100, // 非法键
    '2027-03': 900, // 晚于 2026-12，不影响 2026
  };
  const map = serverBudget.buildBudgetMap(2026, stored);

  assert.equal(map['2026-01'].budget, 5000);
  assert.equal(map['2026-01'].budgetFrom, '2025-11');
  assert.equal(map['2026-01'].budgetValue, 0);

  assert.equal(map['2026-02'].budget, 3000);
  assert.equal(map['2026-02'].budgetValue, 3000);
  assert.equal(map['2026-02'].budgetFrom, '');

  // 3~12 月沿用 2026-02
  assert.equal(map['2026-03'].budget, 3000);
  assert.equal(map['2026-03'].budgetFrom, '2026-02');
  assert.equal(map['2026-12'].budget, 3000);
  assert.equal(map['2026-12'].budgetFrom, '2026-02');
});

test('buildBudgetMap：没有任何设置时全部为 0（不预警）', () => {
  const map = serverBudget.buildBudgetMap(2026, {});
  assert.equal(Object.keys(map).length, 12);
  for (const key of Object.keys(map)) {
    assert.equal(map[key].budget, 0, key);
    assert.equal(map[key].budgetValue, 0, key);
    assert.equal(map[key].budgetFrom, '', key);
  }
});

test('normalizeStoredBudget：过滤非法键与非法金额', () => {
  const out = serverBudget.normalizeStoredBudget({
    '2026-01': 100,
    '2026-02': 0,
    '2026-03': -5,
    '2026-4': 200,
    x: 300,
    '2026-05': '400',
  });
  assert.deepEqual(out, { '2026-01': 100, '2026-05': 400 });
});

test('budgetAlert：阈值边界', () => {
  const cases = [
    [0, 0, 'none'],
    [999, 0, 'none'],
    [94, 100, 'none'],
    [95, 100, 'near'],
    [99, 100, 'near'],
    [100, 100, 'near'],
    [101, 100, 'over'],
  ];
  for (const [expense, limit, expected] of cases) {
    assert.equal(serverBudget.budgetAlert(expense, limit), expected, `${expense}/${limit}`);
  }
});

test('三份副本结果完全一致（多组输入）', () => {
  const fixtures = [
    [2026, {}],
    [2026, { '2026-02': 3000 }],
    [2026, { '2025-11': 5000, '2026-02': 3000, '2027-01': 800 }],
    [2024, { '2024-01': 1, '2024-12': 99999 }],
    ['2026', { '2026-06': 12345, '2026-07': 12345 }],
    [2030, { '2019-08': 700, '2030-12': 100, '2031-01': 50 }],
  ];
  for (const [year, stored] of fixtures) {
    const outputs = Object.entries(COPIES).map(([name, mod]) => [name, JSON.stringify(mod.buildBudgetMap(year, stored))]);
    const baseline = outputs[0][1];
    for (const [name, value] of outputs) {
      assert.equal(value, baseline, `${name} 与 ${outputs[0][0]} 在 year=${year} 时结果不一致`);
    }
  }

  const alertFixtures = [[0, 0], [95, 100], [100, 100], [101, 100], [7, 10]];
  for (const [expense, limit] of alertFixtures) {
    const values = Object.values(COPIES).map((mod) => mod.budgetAlert(expense, limit));
    assert.equal(new Set(values).size, 1, `budgetAlert(${expense}, ${limit}) 三份副本不一致`);
  }
});
