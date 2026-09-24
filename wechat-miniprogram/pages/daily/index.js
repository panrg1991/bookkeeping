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

  /** 展开 / 收起某一天的明细 */
  onToggleDay(e) {
    const date = e.currentTarget.dataset.date;
    const days = this.data.days.map((item) => {
      if (item.date !== date) {
        return item.expanded ? Object.assign({}, item, { expanded: false, records: [] }) : item;
      }
      const expanded = !item.expanded;
      return Object.assign({}, item, { expanded, records: expanded ? this.buildDetails(date) : [] });
    });
    this.setData({ days });
  },

  onEdit(e) {
    getApp().globalData.editId = Number(e.currentTarget.dataset.id);
    wx.switchTab({ url: '/pages/records/index' });
  },

  onDelete(e) {
    const id = Number(e.currentTarget.dataset.id);
    const record = store.getRecord(id);
    const label = record
      ? `${record.date} ${record.type === 'income' ? '收入' : '支出'} ${fmt.formatMoney(record.amountCents)} 元（${record.category}）`
      : `记录 #${id}`;

    wx.showModal({
      title: '删除确认',
      content: `确定删除这条记录吗？删除后不可恢复。\n${label}`,
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) return;
        try {
          store.deleteRecord(id);
          wx.showToast({ title: '已删除', icon: 'success' });
          this.refresh();
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  /** 某一天的全部流水（用于展开显示） */
  buildDetails(date) {
    return store.listRecords({ day: date }).map((item) => ({
      id: item.id,
      type: item.type,
      typeLabel: item.type === 'income' ? '收入' : '支出',
      category: item.category,
      amount: `${item.type === 'income' ? '+' : '-'}${fmt.formatMoney(item.amountCents)}`,
      amountCls: item.type === 'income' ? 'income-text' : 'expense-text',
      note: item.note,
    }));
  },

  refresh() {
    const globalData = getApp().globalData;
    const years = store.years();
    let year = globalData.year;
    if (years.indexOf(year) < 0) year = years[0];
    globalData.year = year;

    const monthIndex = globalData.month ? Number(globalData.month) : 0;
    const periodLabel = globalData.month ? `${year} 年 ${Number(globalData.month)} 月` : `${year} 年（全年）`;

    const list = store.dailySummary(year, globalData.month);
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
      (acc, item) => ({ income: acc.income + item.income, expense: acc.expense + item.expense, count: acc.count + item.count }),
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
      summary: {
        income: fmt.formatMoney(sum.income),
        expense: fmt.formatMoney(sum.expense),
        profit: fmt.formatSigned(profit),
        profitCls: fmt.moneyClass(profit),
        days: list.length,
        count: sum.count,
      },
    });
  },
});
