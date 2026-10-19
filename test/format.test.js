'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fmt = require('../wechat-miniprogram/utils/format');

test('金额格式化：千分位与正负号', () => {
  assert.equal(fmt.formatMoney(123456), '1,234.56');
  assert.equal(fmt.formatMoney(-123456), '-1,234.56');
  assert.equal(fmt.formatMoney(0), '0.00');
  assert.equal(fmt.formatSigned(0), '0.00');
  assert.equal(fmt.formatSigned(500), '+5.00');
  assert.equal(fmt.formatSigned(-500), '-5.00');
});

test('百分比与颜色 class', () => {
  assert.equal(fmt.formatPercent(50, 200), '25.0');
  assert.equal(fmt.formatPercent(1, 0), '0.0');
  assert.equal(fmt.moneyClass(0), 'zero');
  assert.equal(fmt.moneyClass(5), 'profit-text');
  assert.equal(fmt.moneyClass(-5), 'profit-text negative');
});

test('元 / 分互转', () => {
  assert.equal(fmt.yuanToCents('¥1,234.56'), 123456);
  assert.equal(fmt.yuanToCents('abc'), null);
  assert.equal(fmt.toAmountCents('¥1,234.56'), 123456);
  assert.equal(fmt.toAmountCents(null), null);
  assert.equal(fmt.centsToYuanInput(3550), '35.5');
});

test('isValidDate：拒绝不存在的日历日期', () => {
  assert.equal(fmt.isValidDate('2026-02-28'), true);
  assert.equal(fmt.isValidDate('2024-02-29'), true);
  assert.equal(fmt.isValidDate('2026-02-30'), false);
  assert.equal(fmt.isValidDate('2026-13-01'), false);
  assert.equal(fmt.isValidDate('2026-00-10'), false);
  assert.equal(fmt.isValidDate('2026-2-1'), false);
  assert.equal(fmt.isValidDate('abc'), false);
});

test('toDateString：多种写法归一化，非法返回 null', () => {
  assert.equal(fmt.toDateString('2026/2/1'), '2026-02-01');
  assert.equal(fmt.toDateString('2026年2月1日'), '2026-02-01');
  assert.equal(fmt.toDateString('20260201'), '2026-02-01');
  assert.equal(fmt.toDateString('2026-02-01'), '2026-02-01');
  assert.equal(fmt.toDateString('20261345'), null);
  assert.equal(fmt.toDateString('2026-02-30'), null);
  assert.equal(fmt.toDateString(null), null);
});

test('toType：类型识别', () => {
  assert.equal(fmt.toType('支出'), 'expense');
  assert.equal(fmt.toType('收入'), 'income');
  assert.equal(fmt.toType('out'), 'expense');
  assert.equal(fmt.toType('+'), 'income');
  assert.equal(fmt.toType('未知'), null);
});

test('toCsv：防公式注入且不误伤负数金额', () => {
  const csv = fmt.toCsv([
    { date: '2026-01-01', type: 'expense', category: '=1+1', amountCents: 3550, note: '@cmd' },
    { date: '2026-01-02', type: 'income', category: '工资', amountCents: 100, note: '含,逗号"引号' },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '日期,类型,分类,金额,备注');
  assert.equal(lines[1], "2026-01-01,支出,'=1+1,-35.50,'@cmd");
  // 负数金额保持原样（可被 Excel 当数字），含逗号/引号的备注正常转义
  assert.equal(lines[2], '2026-01-02,收入,工资,1.00,"含,逗号""引号"');
});
