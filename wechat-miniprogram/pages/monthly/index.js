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
    cards: [],
    bars: [],
    rows: [],
    total: {},
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
    const year = this.data.years[Number(e.detail.value)];
    getApp().globalData.year = year;
    this.refresh();
  },

  onMonthChange(e) {
    const index = Number(e.detail.value);
    getApp().globalData.month = index === 0 ? '' : String(index);
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

    const overview = store.overview(year, globalData.month);
    const summary = store.monthlySummary(year);

    const cards = [
      {
        label: '本期收入',
        value: fmt.formatMoney(overview.period.income),
        sub: `${periodLabel} · ${overview.period.count} 笔`,
        cls: 'income-text',
      },
      {
        label: '本期支出',
        value: fmt.formatMoney(overview.period.expense),
        sub: `全年支出 ${fmt.formatMoney(overview.year.expense)}`,
        cls: 'expense-text',
      },
      {
        label: '本期利润',
        value: fmt.formatSigned(overview.period.profit),
        sub: `利润率 ${fmt.formatPercent(overview.period.profit, overview.period.income)}%`,
        cls: overview.period.profit < 0 ? 'profit-text negative' : 'profit-text',
      },
      {
        label: `${year} 年累计利润`,
        value: fmt.formatSigned(overview.year.profit),
        sub: `全年收入 ${fmt.formatMoney(overview.year.income)}`,
        cls: overview.year.profit < 0 ? 'profit-text negative' : 'profit-text',
      },
    ];

    const max = summary.reduce((acc, item) => Math.max(acc, item.income, item.expense), 0) || 1;
    const bars = summary.map((item) => ({
      month: item.month,
      label: String(Number(item.month)),
      incomeH: Math.round((item.income / max) * 190),
      expenseH: Math.round((item.expense / max) * 190),
      income: fmt.formatMoney(item.income),
      expense: fmt.formatMoney(item.expense),
    }));

    const rows = summary.map((item) => ({
      month: item.month,
      label: `${year}-${item.month}`,
      income: fmt.formatMoney(item.income),
      expense: fmt.formatMoney(item.expense),
      profit: fmt.formatSigned(item.profit),
      profitCls: fmt.moneyClass(item.profit),
      cumulative: fmt.formatSigned(item.cumulative),
      cumulativeCls: fmt.moneyClass(item.cumulative),
      count: item.count,
      active: globalData.month === String(Number(item.month)),
    }));

    const sum = summary.reduce(
      (acc, item) => ({ income: acc.income + item.income, expense: acc.expense + item.expense, count: acc.count + item.count }),
      { income: 0, expense: 0, count: 0 }
    );
    const totalProfit = sum.income - sum.expense;

    this.setData({
      years,
      year,
      yearIndex: Math.max(years.indexOf(year), 0),
      monthIndex,
      periodLabel,
      cards,
      bars,
      rows,
      total: {
        income: fmt.formatMoney(sum.income),
        expense: fmt.formatMoney(sum.expense),
        profit: fmt.formatSigned(totalProfit),
        profitCls: fmt.moneyClass(totalProfit),
        count: sum.count,
      },
      hasData: sum.count > 0,
    });
  },
});
