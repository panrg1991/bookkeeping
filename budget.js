'use strict';

/**
 * 每月支出预警额度：纯计算逻辑（不做任何 I/O，便于复用与单元测试）。
 *
 * 规则：当月设置过就用当月的；没设置则沿用**最近一次设置**的值（可跨月、跨年）；都没有则为 0（不预警）。
 *
 * 说明：同一份逻辑在三个运行/部署环境各有一份副本，它们彼此无法互相 require：
 *   - Node 后端：            ./budget.js
 *   - 小程序本地存储：        wechat-miniprogram/utils/budget.js
 *   - 云函数：               wechat-miniprogram/cloudfunctions/bookkeeping/budget.js
 * 请勿只改其中一份；test/budget.test.js 会校验三份行为完全一致。
 */

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function pad2(num) {
  const value = Number(num);
  if (!Number.isFinite(value)) return String(num);
  return value < 10 ? `0${value}` : String(value);
}

/** 归一化「已设置额度」表：仅保留 month 形如 YYYY-MM 且金额（分）> 0 的项 */
function normalizeStoredBudget(stored) {
  const out = {};
  Object.keys(stored || {}).forEach((key) => {
    const cents = Number(stored[key]);
    if (MONTH_KEY_RE.test(key) && Number.isFinite(cents) && cents > 0) out[key] = cents;
  });
  return out;
}

/**
 * 计算某年 12 个月的「生效预警额度」（分）。
 * @param {string|number} year
 * @param {object} stored 已设置的额度表 { 'YYYY-MM': 分 }
 * @returns {object} { 'YYYY-MM': { month, budgetValue, budget, budgetFrom } }
 */
function buildBudgetMap(year, stored) {
  const y = Number(year);
  const all = normalizeStoredBudget(stored);

  // 只考虑不晚于本年度 12 月的设置（之后年份的设置不影响今年）
  const self = {};
  Object.keys(all).forEach((key) => {
    if (key <= `${y}-12`) self[key] = all[key];
  });

  const setMonths = Object.keys(self).sort();
  const result = {};

  for (let m = 1; m <= 12; m += 1) {
    const key = `${y}-${pad2(m)}`;
    const own = self[key] || 0;
    let from = '';
    if (!own) {
      for (let i = setMonths.length - 1; i >= 0; i -= 1) {
        if (setMonths[i] < key) {
          from = setMonths[i];
          break;
        }
      }
    }
    result[key] = {
      month: key,
      budgetValue: own,
      budget: own > 0 ? own : (from ? self[from] : 0),
      budgetFrom: own > 0 ? '' : from,
    };
  }

  return result;
}

/** 支出预警：超过额度 over（红）；达到额度 95% near（黄）；否则 none */
function budgetAlert(expenseCents, budgetCents) {
  if (!(budgetCents > 0)) return 'none';
  if (expenseCents > budgetCents) return 'over';
  if (expenseCents >= budgetCents * 0.95) return 'near';
  return 'none';
}

module.exports = { buildBudgetMap, budgetAlert, normalizeStoredBudget };
