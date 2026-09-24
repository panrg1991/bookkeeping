const store = require('../../utils/store');
const fmt = require('../../utils/format');

const MONTH_OPTIONS = ['全年', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

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
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh();
    wx.stopPullDownRefresh();
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

  refresh() {
    const globalData = getApp().globalData;
    const years = store.years();
    let year = globalData.year;
    if (years.indexOf(year) < 0) year = years[0];
    globalData.year = year;

    const monthIndex = globalData.month ? Number(globalData.month) : 0;
    const periodLabel = globalData.month ? `${year} 年 ${Number(globalData.month)} 月` : `${year} 年（全年）`;
    const type = this.data.type;

    const list = store.categorySummary(year, globalData.month, type);
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
  },
});
