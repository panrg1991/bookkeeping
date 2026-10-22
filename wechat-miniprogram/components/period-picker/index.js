'use strict';

/**
 * 通用「年份 + 月份」选择条。
 *
 * 用法：
 *   <period-picker
 *     years="{{years}}" year-index="{{yearIndex}}"
 *     month-options="{{monthOptions}}" month-index="{{monthIndex}}"
 *     bind:yearchange="onYearChange"
 *     bind:monthchange="onMonthChange"
 *   />
 *
 * 事件 detail 统一为 { value }（picker 的下标），页面原有 onYearChange/onMonthChange 可直接复用。
 */
Component({
  options: {
    // 允许使用 app.wxss 中的全局样式类（如 .muted），组件样式仍不会外泄
    addGlobalClass: true,
  },

  properties: {
    years: { type: Array, value: [] },
    yearIndex: { type: Number, value: 0 },
    monthOptions: { type: Array, value: [] },
    monthIndex: { type: Number, value: 0 },
  },

  methods: {
    onYearChange(e) {
      this.triggerEvent('yearchange', { value: Number(e.detail.value) });
    },
    onMonthChange(e) {
      this.triggerEvent('monthchange', { value: Number(e.detail.value) });
    },
  },
});
