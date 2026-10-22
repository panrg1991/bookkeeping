'use strict';

/**
 * 简单计算器核心逻辑（纯函数，无任何 wx / 界面依赖，便于单元测试）。
 *
 * 支持：加 +、减 -、乘 ×、除 ÷、小数、正负号、退格、清空。
 * 运算顺序：与普通计算器一致，按输入顺序「立即执行」（非数学优先级），
 * 例如 2 + 3 × 4 = 会得到 (2 + 3) × 4 = 20。
 */

/** 最多输入的整数位数（不含小数点与负号） */
const MAX_DIGITS = 12;

/** 支持的运算符 */
const OPERATORS = ['+', '-', '×', '÷'];

function initialState() {
  return {
    display: '0', // 当前显示的数字串
    accumulator: null, // 已确定的左操作数
    operator: null, // 待执行的运算符
    waiting: false, // 下一个数字是否重新开始输入
    evaluated: false, // 是否刚按过 =
    error: '', // 错误信息（空串表示正常）
  };
}

function errorState(message) {
  return {
    display: '错误',
    accumulator: null,
    operator: null,
    waiting: false,
    evaluated: false,
    error: message || '计算错误',
  };
}

/** 数字 -> 显示字符串：抹掉浮点误差（0.1+0.2 -> 0.3），超大数转科学计数法 */
function formatNumber(num) {
  if (!Number.isFinite(num)) return '错误';
  const rounded = Number(num.toPrecision(12));
  if (Object.is(rounded, -0)) return '0';

  if (Number.isInteger(rounded)) {
    if (Math.abs(rounded) < 1e15) return String(rounded);
    return rounded.toExponential(6).replace(/\.?0+e/, 'e');
  }
  return String(rounded);
}

/** 四则运算；除数为 0 时返回 null 表示错误 */
function compute(a, b, op) {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '×':
      return a * b;
    case '÷':
      return b === 0 ? null : a / b;
    default:
      return null;
  }
}

function inputDigit(state, digit) {
  if (!/^[0-9]$/.test(digit)) return state;

  // 刚按过 =：输入数字表示开始一次新计算
  if (state.evaluated) {
    return Object.assign(initialState(), { display: digit });
  }
  // 刚按过运算符：用新数字替换当前显示
  if (state.waiting) {
    return Object.assign({}, state, { display: digit, waiting: false, evaluated: false });
  }
  // 前导 0：直接替换
  if (state.display === '0') {
    return Object.assign({}, state, { display: digit });
  }
  if (state.display.replace(/[^0-9]/g, '').length >= MAX_DIGITS) return state;
  return Object.assign({}, state, { display: state.display + digit });
}

function inputDot(state) {
  if (state.evaluated) {
    return Object.assign(initialState(), { display: '0.' });
  }
  if (state.waiting) {
    return Object.assign({}, state, { display: '0.', waiting: false, evaluated: false });
  }
  if (state.display.indexOf('.') >= 0) return state;
  return Object.assign({}, state, { display: `${state.display}.` });
}

function toggleSign(state) {
  // 等待输入下一个操作数时，不对已确定的左操作数取反
  if (state.waiting) return state;
  const d = state.display;
  if (d === '0' || d === '0.') return state;
  const next = d.charAt(0) === '-' ? d.slice(1) : `-${d}`;
  return Object.assign({}, state, { display: next });
}

function backspace(state) {
  if (state.evaluated) return initialState();
  if (state.waiting) return state;
  let d = state.display.slice(0, -1);
  if (d === '' || d === '-') d = '0';
  return Object.assign({}, state, { display: d });
}

function chooseOperator(state, op) {
  if (OPERATORS.indexOf(op) < 0) return state;

  let acc = state.accumulator;
  let display = state.display;

  if (state.operator && !state.waiting) {
    // 已有待执行运算：先算出中间结果
    const result = compute(acc, Number(display), state.operator);
    if (result === null) return errorState('不能除以 0');
    acc = result;
    display = formatNumber(result);
  } else if (acc === null) {
    // 首次按运算符，或刚按过 =：把当前显示作为左操作数
    acc = Number(display);
  }
  // 连续按运算符（waiting 为 true）时只替换运算符，保留左操作数

  return {
    display,
    accumulator: acc,
    operator: op,
    waiting: true,
    evaluated: false,
    error: '',
  };
}

function equals(state) {
  if (!state.operator) {
    return Object.assign({}, state, {
      accumulator: null,
      waiting: false,
      evaluated: true,
    });
  }

  const result = compute(state.accumulator, Number(state.display), state.operator);
  if (result === null) return errorState('不能除以 0');

  return {
    display: formatNumber(result),
    accumulator: null,
    operator: null,
    waiting: false,
    evaluated: true,
    error: '',
  };
}

/**
 * 处理一次按键。
 * @param {object} state 当前状态
 * @param {object} key   { type: 'digit'|'dot'|'sign'|'back'|'op'|'equals'|'clear', value? }
 * @returns {object} 新状态（不修改入参）
 */
function press(state, key) {
  const input = key || {};
  let s = state && typeof state === 'object' ? state : initialState();

  if (input.type === 'clear') return initialState();
  // 出错后，除 C 外的任意按键都先复位再继续
  if (s.error) s = initialState();

  switch (input.type) {
    case 'digit':
      return inputDigit(s, String(input.value));
    case 'dot':
      return inputDot(s);
    case 'sign':
      return toggleSign(s);
    case 'back':
      return backspace(s);
    case 'op':
      return chooseOperator(s, input.value);
    case 'equals':
      return equals(s);
    default:
      return s;
  }
}

module.exports = {
  MAX_DIGITS,
  OPERATORS,
  initialState,
  press,
  formatNumber,
  compute,
};
