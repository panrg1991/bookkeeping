'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const calc = require('../wechat-miniprogram/utils/calculator');

const digit = (value) => ({ type: 'digit', value: String(value) });
const op = (value) => ({ type: 'op', value });
const dot = { type: 'dot' };
const sign = { type: 'sign' };
const back = { type: 'back' };
const equals = { type: 'equals' };
const clear = { type: 'clear' };

/** 依次按键，返回最终状态 */
function run(keys) {
  return keys.reduce((state, key) => calc.press(state, key), calc.initialState());
}

test('初始状态显示 0', () => {
  assert.equal(calc.initialState().display, '0');
});

test('加减乘除', () => {
  assert.equal(run([digit(1), op('+'), digit(2), equals]).display, '3');
  assert.equal(run([digit(9), op('-'), digit(4), equals]).display, '5');
  assert.equal(run([digit(6), op('×'), digit(7), equals]).display, '42');
  assert.equal(run([digit(8), op('÷'), digit(2), equals]).display, '4');
});

test('小数与浮点误差修正', () => {
  assert.equal(run([digit(0), dot, digit(5)]).display, '0.5');
  assert.equal(run([dot, digit(5)]).display, '0.5');
  assert.equal(run([digit(1), dot, digit(2), op('+'), digit(0), dot, digit(3), equals]).display, '1.5');
  // 0.1 + 0.2 应显示 0.3，而不是 0.30000000000000004
  assert.equal(run([dot, digit(1), op('+'), dot, digit(2), equals]).display, '0.3');
  // 重复输入小数点无效
  assert.equal(run([digit(1), dot, dot, digit(2)]).display, '1.2');
});

test('按输入顺序立即计算（非数学优先级）', () => {
  // 2 + 3 × 4 = (2 + 3) × 4 = 20
  assert.equal(run([digit(2), op('+'), digit(3), op('×'), digit(4), equals]).display, '20');
});

test('连续运算展示中间结果', () => {
  const mid = run([digit(2), op('+'), digit(3), op('+')]);
  assert.equal(mid.display, '5');
  assert.equal(mid.operator, '+');
  assert.equal(calc.press(mid, digit(4)).display, '4');
  assert.equal(calc.press(calc.press(mid, digit(4)), equals).display, '9');
});

test('连续按运算符只替换运算符', () => {
  // 5 + × 2 = 10
  assert.equal(run([digit(5), op('+'), op('×'), digit(2), equals]).display, '10');
});

test('除以 0 报错，按 C 恢复', () => {
  const err = run([digit(1), op('÷'), digit(0), equals]);
  assert.equal(err.display, '错误');
  assert.ok(err.error);
  // 出错后按 C 复位
  assert.equal(calc.press(err, clear).display, '0');
  // 出错后直接按数字也能开始新计算
  assert.equal(calc.press(err, digit(7)).display, '7');
});

test('正负号切换', () => {
  assert.equal(run([digit(5), sign]).display, '-5');
  assert.equal(calc.press(run([digit(5), sign]), sign).display, '5');
  assert.equal(run([digit(0), sign]).display, '0');
});

test('退格', () => {
  assert.equal(run([digit(1), digit(2), digit(3), back]).display, '12');
  assert.equal(run([digit(1), digit(2), back, back]).display, '0');
  assert.equal(run([digit(1), digit(2), back, back, back]).display, '0');
});

test('前导 0 与位数上限', () => {
  assert.equal(run([digit(0), digit(0), digit(5)]).display, '5');
  const many = [];
  for (let i = 0; i < 20; i += 1) many.push(digit(1));
  assert.equal(run(many).display.length, calc.MAX_DIGITS);
});

test('按 = 后输入数字重新开始', () => {
  const done = run([digit(1), op('+'), digit(2), equals]);
  assert.equal(done.display, '3');
  assert.equal(calc.press(done, digit(9)).display, '9');
});

test('formatNumber 处理浮点与 -0', () => {
  assert.equal(calc.formatNumber(0.1 + 0.2), '0.3');
  assert.equal(calc.formatNumber(-0), '0');
  assert.equal(calc.formatNumber(6), '6');
});
