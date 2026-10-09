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
    days: [],
    summary: {},
    hasData: false,
    loading: true,
  },

  onShow() {
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

  /** 展开 / 收起某一天的明细（展开时按需向云端拉取当天流水） */
  async onToggleDay(e) {
    const date = e.currentTarget.dataset.date;
    const target = this.data.days.find((item) => item.date === date);
    if (!target) return;

    if (target.expanded) {
      this.setData({
        days: this.data.days.map((item) => (item.date === date ? Object.assign({}, item, { expanded: false, records: [] }) : item)),
      });
      return;
    }

    wx.showLoading({ title: '加载中', mask: false });
    try {
      const details = await this.buildDetails(date);
      this.setData({
        days: this.data.days.map((item) => {
          if (item.date === date) return Object.assign({}, item, { expanded: true, records: details });
          return item.expanded ? Object.assign({}, item, { expanded: false, records: [] }) : item;
        }),
      });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onEdit(e) {
    getApp().globalData.editId = String(e.currentTarget.dataset.id);
    wx.switchTab({ url: '/pages/records/index' });
  },

  onDelete(e) {
    const id = String(e.currentTarget.dataset.id);

    wx.showModal({
      title: '删除确认',
      content: '确定删除这条记录吗？删除后不可恢复。',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中', mask: true });
        try {
          await store.deleteRecord(id);
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          this.refresh();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  /** 某一天的全部流水（用于展开显示） */
  async buildDetails(date) {
    const res = await store.listRecords({ day: date, limit: 200 });
    return res.items.map((item) => ({
      id: item.id,
      type: item.type,
      typeLabel: item.type === 'income' ? '收入' : '支出',
      category: item.category,
      amount: `${item.type === 'income' ? '+' : '-'}${fmt.formatMoney(item.amountCents)}`,
      amountCls: item.type === 'income' ? 'income-text' : 'expense-text',
      note: item.note,
    }));
  },

  async refresh() {
    const globalData = getApp().globalData;
    this.setData({ loading: true });

    try {
      const years = await store.years();
      let year = globalData.year;
      if (years.indexOf(year) < 0) year = years[0];
      globalData.year = year;

      const monthIndex = globalData.month ? Number(globalData.month) : 0;
      const periodLabel = globalData.month ? `${year} 年 ${Number(globalData.month)} 月` : `${year} 年（全年）`;

      const list = await store.dailySummary(year, globalData.month);
      const days = list.map((item) => ({
        date: item.date,
        dayLabel: item.date.slice(5),
        weekday: fmt.weekday(item.date),
        count: item.count,
        expense: fmt.formatMoney(item.expense),
        income: fmt.formatMoney(item.income),
        profit: fmt.formatSigned(item.profit),
        profitCls: fmt.moneyClass(item.profit),
        expanded: false,
        records: [],
      }));

      const sum = list.reduce(
        (acc, item) => ({
          income: acc.income + item.income,
          expense: acc.expense + item.expense,
          count: acc.count + item.count,
        }),
        { income: 0, expense: 0, count: 0 }
      );
      const profit = sum.income - sum.expense;

      this.setData({
        years,
        year,
        yearIndex: Math.max(years.indexOf(year), 0),
        monthIndex,
        periodLabel,
        days,
        hasData: list.length > 0,
        loading: false,
        summary: {
          income: fmt.formatMoney(sum.income),
          expense: fmt.formatMoney(sum.expense),
          profit: fmt.formatSigned(profit),
          profitCls: fmt.moneyClass(profit),
          days: list.length,
          count: sum.count,
        },
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },
});
