/**
 * 组合计算工具：从若干个数中任选 k 个，求所有组合的「乘积之和」。
 *
 * 例：输入 2,3,2，选 2 个数，组合有 (2,3)、(2,2)、(3,2)，
 *     乘积之和 = 6 + 4 + 6 = 16。
 *
 * 支持一次计算多个 k（例如同时算 2 个、3 个、4 个数的组合），
 * 结果是各 k 的结果再相加，只产出一个总数。
 *
 * 说明：数值按「输入位置」区分，重复的数字（如两个 2）算作不同的数，
 * 也就是标准的「从 n 个元素中任取 k 个」——组合个数为 C(n, k)。
 * 数学上这是初等对称多项式 e_k，用动态规划计算，不必逐个枚举组合。
 */

/** 解析输入为数字数组：支持中英文逗号、顿号、分号、空格、换行分隔 */
function parseNumbers(text) {
  const tokens = String(text == null ? '' : text)
    .split(/[\s,，、;；]+/)
    .filter((item) => item !== '');

  const values = [];
  const invalid = [];
  tokens.forEach((token) => {
    const num = Number(token);
    if (Number.isFinite(num)) values.push(num);
    else invalid.push(token);
  });

  return { values, invalid, total: tokens.length };
}

/** 组合数 C(n, k) */
function combinationCount(n, k) {
  if (k < 0 || k > n) return 0;
  const small = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= small; i += 1) {
    result = (result * (n - small + i)) / i;
  }
  return Math.round(result);
}

/**
 * 所有 k 元组合的乘积之和。
 *
 * coeff[i] 表示「已处理的数里任取 i 个的乘积之和」，初始 coeff[0] = 1。
 * 每读入一个数就倒序更新（i 从 k 到 1），这样同一个数在一次组合中只会被用一次。
 * 时间复杂度 O(n · k)，n 很大时也不会因为枚举组合而卡住。
 */
function combinationSum(values, k) {
  const coeff = new Array(k + 1).fill(0);
  coeff[0] = 1;

  values.forEach((num) => {
    for (let i = k; i >= 1; i -= 1) {
      coeff[i] += coeff[i - 1] * num;
    }
  });

  return { sum: coeff[k], count: combinationCount(values.length, k) };
}

/**
 * 同时计算多个 k 的组合乘积之和，返回合计值与组合总组数。
 * ks 会去重、排序并忽略非法值；超过输入个数的 k 由调用方先过滤。
 */
function multiCombinationSum(values, ks) {
  const list = [];
  (Array.isArray(ks) ? ks : []).forEach((k) => {
    const num = Math.trunc(Number(k));
    if (Number.isFinite(num) && num > 0 && list.indexOf(num) < 0) list.push(num);
  });
  list.sort((a, b) => a - b);

  let sum = 0;
  let count = 0;
  list.forEach((k) => {
    const result = combinationSum(values, k);
    sum += result.sum;
    count += result.count;
  });

  return { sum, count, ks: list };
}

/** 结果格式化：抹掉浮点误差，整数不带小数位，小数最多保留 6 位 */
function formatValue(num) {
  if (!Number.isFinite(num)) return '—';
  const fixed = Number(num.toPrecision(12));
  if (Number.isInteger(fixed)) return String(fixed);
  return String(Number(fixed.toFixed(6)));
}

module.exports = {
  parseNumbers,
  combinationSum,
  multiCombinationSum,
  formatValue,
};
