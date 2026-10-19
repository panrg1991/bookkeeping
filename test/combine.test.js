'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const combine = require('../wechat-miniprogram/utils/combine');

test('parseNumbers：支持中英文分隔符并收集非法项', () => {
  const ok = combine.parseNumbers('1,2，3、4 5\n6');
  assert.deepEqual(ok.values, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ok.invalid, []);
  assert.equal(ok.total, 6);

  const mixed = combine.parseNumbers('1; a；3');
  assert.deepEqual(mixed.values, [1, 3]);
  assert.deepEqual(mixed.invalid, ['a']);
  assert.equal(mixed.total, 3);

  assert.deepEqual(combine.parseNumbers('').values, []);
});

test('combinationSum：k 元组合的乘积之和', () => {
  const r2 = combine.combinationSum([2, 3, 2], 2);
  assert.equal(r2.sum, 16); // 2*3 + 2*2 + 3*2
  assert.equal(r2.count, 3);

  const r3 = combine.combinationSum([1, 2, 3], 3);
  assert.equal(r3.sum, 6);
  assert.equal(r3.count, 1);

  // k 超过元素个数：组合数为 0，和为 0
  const r5 = combine.combinationSum([1, 2], 5);
  assert.equal(r5.sum, 0);
  assert.equal(r5.count, 0);
});

test('multiCombinationSum：多 k 求和并清洗 ks', () => {
  const r = combine.multiCombinationSum([2, 3, 2], [2, 3]);
  assert.equal(r.sum, 28); // e2=16, e3=12
  assert.equal(r.count, 4); // C(3,2)=3, C(3,3)=1
  assert.deepEqual(r.ks, [2, 3]);

  const cleaned = combine.multiCombinationSum([1, 2, 3], [2, 2, 0, -1, 'x', 3]);
  assert.deepEqual(cleaned.ks, [2, 3]);
});

test('formatValue：抹掉浮点误差并控制小数位', () => {
  assert.equal(combine.formatValue(0.1 + 0.2), '0.3');
  assert.equal(combine.formatValue(6), '6');
  assert.equal(combine.formatValue(1 / 3), '0.333333');
  assert.equal(combine.formatValue(NaN), '—');
});
