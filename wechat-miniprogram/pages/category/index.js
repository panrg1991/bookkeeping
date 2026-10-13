const store = require('../../utils/store');
const fmt = require('../../utils/format');
const combine = require('../../utils/combine');

const MONTH_OPTIONS = ['全年', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

/** 组合计算可选的「几个数组合」，可同时多选 */
const COMBO_K_OPTIONS = [2, 3, 4, 5, 6, 7, 8];

Page({
  data: {
    years: [],
    yearIndex: 0,
    year: '',
    monthOptions: MONTH_OPTIONS,
    monthIndex: 0,
    periodLabel: '',
    type: 'expense',
    rows: [],
    total: { amount: '0.00', count: 0, kinds: 0 },
    hasData: false,
    // 组合计算：comboKs 为已选中的组合方式（可同时选多个），结果只给一个总数
    comboInput: '',
    comboKs: [2],
    comboOptions: [],
    comboLabel: '2',
    comboSum: '',
    comboCount: 0,
    comboError: '',
    comboNotice: '',
  },

  onShow() {
    // 同步自定义 tabBar 的选中项
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  onYearChange(e) {
    getApp().globalData.year = this.data.years[Number(e.detail.value)];
    this.refresh();
  },

  onMonthChange(e) {
    const index = Number(e.detail.value);
    getApp().globalData.month = index === 0 ? '' : String(index);
    this.refresh();
  },

  onTypeChange(e) {
    this.setData({ type: e.currentTarget.dataset.type });
    this.refresh();
  },

  /* ------------------------------ 组合计算 ------------------------------ */

  onComboInput(e) {
    this.setData({ comboInput: e.detail.value });
    this.computeCombo(e.detail.value, this.data.comboKs);
  },

  /** 点击切换一种组合方式（可同时选多个：2 个、3 个、4 个……） */
  onComboKToggle(e) {
    const k = Number(e.currentTarget.dataset.k);
    if (!k) return;

    const count = combine.parseNumbers(this.data.comboInput).values.length;
    if (count && k > count) {
      wx.showToast({ title: `只输入了 ${count} 个数，算不了 ${k} 个数的组合`, icon: 'none' });
      return;
    }

    const next = this.data.comboKs.slice();
    const index = next.indexOf(k);
    if (index >= 0) {
      if (next.length === 1) {
        wx.showToast({ title: '至少要保留一种组合方式', icon: 'none' });
        return;
      }
      next.splice(index, 1);
    } else {
      next.push(k);
    }
    next.sort((a, b) => a - b);

    this.setData({ comboKs: next });
    this.computeCombo(this.data.comboInput, next);
  },

  onComboClear() {
    this.setData({
      comboInput: '',
      comboSum: '',
      comboCount: 0,
      comboError: '',
      comboNotice: '',
    });
  },

  /** 计算所有已选组合方式的乘积之和，只输出一个总数 */
  computeCombo(text, ks) {
    const { values, invalid } = combine.parseNumbers(text);
    const total = values.length;
    const tips = [];
    if (invalid.length) tips.push(`已忽略无法识别的内容：${invalid.join('、')}`);

    const comboOptions = COMBO_K_OPTIONS.map((k) => ({
      k,
      active: ks.indexOf(k) >= 0,
      // 输入个数不足的组合方式不可用（还没输入时都允许选）
      enabled: !total || k <= total,
    }));

    const usable = ks.filter((k) => k <= total);
    if (!usable.length) {
      this.setData({
        comboOptions,
        comboSum: '',
        comboCount: 0,
        comboError: total ? `已选的组合方式至少需要 ${Math.min.apply(null, ks)} 个数，当前只有 ${total} 个` : '',
        comboNotice: tips.join('；'),
      });
      return;
    }

    const { sum, count } = combine.multiCombinationSum(values, usable);

    this.setData({
      comboOptions,
      comboError: '',
      comboNotice: tips.join('；'),
      comboLabel: usable.join('、'),
      comboSum: combine.formatValue(sum),
      comboCount: count,
    });
  },

  async refresh() {
    const globalData = getApp().globalData;

    try {
      const years = await store.years();
      let year = globalData.year;
      if (years.indexOf(year) < 0) year = years[0];
      globalData.year = year;

      const monthIndex = globalData.month ? Number(globalData.month) : 0;
      const periodLabel = globalData.month ? `${year} 年 ${Number(globalData.month)} 月` : `${year} 年（全年）`;
      const type = this.data.type;

      const list = await store.categorySummary(year, globalData.month, type);
      const totalCents = list.reduce((sum, item) => sum + item.amount, 0);
      const totalCount = list.reduce((sum, item) => sum + item.count, 0);

      this.setData({
        years,
        year,
        yearIndex: Math.max(years.indexOf(year), 0),
        monthIndex,
        periodLabel,
        hasData: list.length > 0,
        rows: list.map((item) => ({
          category: item.category,
          count: item.count,
          amount: fmt.formatMoney(item.amount),
          ratioText: fmt.formatPercent(item.amount, totalCents),
          percent: totalCents ? ((item.amount / totalCents) * 100).toFixed(1) : '0.0',
        })),
        total: {
          amount: fmt.formatMoney(totalCents),
          count: totalCount,
          kinds: list.length,
        },
      });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },
});
