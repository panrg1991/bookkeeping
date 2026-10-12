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
    cards: [],
    rows: [],
    total: {},
    hasData: false,
  },

  onShow() {
    // 同步自定义 tabBar 的选中项
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
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

  /** 设置某月的支出预警额度；留空表示清除该月设置 */
  onSetBudget(e) {
    const month = e.currentTarget.dataset.month;
    const row = this.data.rows.find((item) => item.monthKey === month);
    const current = row && row.budgetValue > 0 ? String(row.budgetValue / 100) : '';

    wx.showModal({
      title: `设置 ${month} 支出预警额度`,
      editable: true,
      placeholderText: '输入金额（元），留空表示清除',
      content: current,
      success: async (res) => {
        if (!res.confirm) return;

        const text = String(res.content === undefined || res.content === null ? '' : res.content).trim();
        const cents = text === '' ? 0 : Math.round(Number(text) * 100);

        if (text !== '' && (!Number.isFinite(cents) || cents < 0)) {
          wx.showToast({ title: '请输入正确的金额', icon: 'none' });
          return;
        }

        wx.showLoading({ title: '保存中', mask: true });
        try {
          await store.setBudget(month, cents);
          wx.hideLoading();
          wx.showToast({ title: cents > 0 ? '额度已设置' : '已清除额度', icon: 'success' });
          this.refresh();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
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

      const [overview, summary] = await Promise.all([
        store.overview(year, globalData.month),
        store.monthlySummary(year),
      ]);

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

      const rows = summary.map((item) => {
        const monthKey = `${year}-${item.month}`;
        // 预警额度只显示数字；未设置的月份自动沿用最近一次设置的额度（规则见列上方的提示行）
        const budgetText = item.budget > 0 ? fmt.formatMoney(item.budget) : '点击设置';

        return {
          month: item.month,
          monthKey,
          label: monthKey,
          income: fmt.formatMoney(item.income),
          expense: fmt.formatMoney(item.expense),
          budgetText,
          budgetValue: item.budgetValue || 0,
          budgetSet: item.budget > 0,
          profit: fmt.formatSigned(item.profit),
          profitCls: fmt.moneyClass(item.profit),
          cumulative: fmt.formatSigned(item.cumulative),
          cumulativeCls: fmt.moneyClass(item.cumulative),
          count: item.count,
          active: globalData.month === String(Number(item.month)),
          alertCls: item.alert === 'over' ? 'alert-over' : (item.alert === 'near' ? 'alert-near' : ''),
        };
      });

      const sum = summary.reduce(
        (acc, item) => ({
          income: acc.income + item.income,
          expense: acc.expense + item.expense,
          count: acc.count + item.count,
        }),
        { income: 0, expense: 0, count: 0 }
      );
      const totalProfit = sum.income - sum.expense;

      this.setData({
        years,
        year,
        yearIndex: Math.max(years.indexOf(year), 0),
        monthIndex,
        cards,
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
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },
});
