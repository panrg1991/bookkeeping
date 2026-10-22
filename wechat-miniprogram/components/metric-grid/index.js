'use strict';

/**
 * 通用指标卡网格（两列）。
 *
 * 用法：<metric-grid items="{{cards}}" />
 * items: [{ label, value, cls?, sub? }]
 *   - cls：数值颜色类，如 income-text / expense-text / profit-text / negative
 *   - sub：可选的次要说明文字
 */
Component({
  options: {
    // 让 app.wxss 中的 .income-text / .expense-text / .profit-text 等全局类对组件生效
    addGlobalClass: true,
  },

  properties: {
    items: { type: Array, value: [] },
  },
});
