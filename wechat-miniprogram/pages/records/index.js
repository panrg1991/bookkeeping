const store = require('../../utils/store');
const fmt = require('../../utils/format');

const MONTH_OPTIONS = ['全年', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function emptyForm() {
  return { date: fmt.todayStr(), type: 'expense', amount: '', category: '', note: '' };
}

/** 解析粘贴进来的 Excel 内容（Tab 分隔）或 CSV 文本 */
function parsePastedText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length);

  const items = [];
  let skipped = 0;

  lines.forEach((line, index) => {
    const cells = (line.indexOf('\t') >= 0 ? line.split('\t') : line.split(',')).map((cell) =>
      String(cell).trim().replace(/^"(.*)"$/, '$1')
    );

    // 首行是表头则跳过
    if (index === 0) {
      const first = cells[0] || '';
      if (first.indexOf('日期') >= 0 || first.toLowerCase() === 'date') return;
    }
    if (cells.length < 3) {
      skipped += 1;
      return;
    }

    const date = store.toDateString(cells[0]);
    const type = store.toType(cells[1]);
    const amountCents = store.toAmountCents(cells[2]);
    if (!date || !type || !amountCents || amountCents <= 0) {
      skipped += 1;
      return;
    }

    items.push({
      date,
      type,
      amountCents,
      category: cells[3] || '其他',
      note: cells[4] || '',
    });
  });

  return { items, skipped };
}

Page({
  data: {
    years: [],
    yearIndex: 0,
    year: '',
    monthOptions: MONTH_OPTIONS,
    monthIndex: 0,
    periodLabel: '',
    filterType: 'all',
    keyword: '',
    form: emptyForm(),
    categoryOptions: [],
    editingId: null,
    records: [],
    showImport: false,
    importText: '',
  },

  rawRecords: [],

  onLoad() {
    this.setData({ categoryOptions: store.listCategories().expense });
  },

  onShow() {
    const globalData = getApp().globalData;

    // 从「每日明细」页点「修改」跳转过来：进入编辑态
    if (globalData.editId) {
      const record = store.getRecord(globalData.editId);
      globalData.editId = null;
      if (record) {
        this.setData({
          editingId: record.id,
          form: {
            date: record.date,
            type: record.type,
            amount: fmt.centsToYuanInput(record.amountCents),
            category: record.category,
            note: record.note,
          },
          categoryOptions: store.listCategories()[record.type],
        });
        wx.pageScrollTo({ scrollTop: 0, duration: 0 });
      }
    }

    this.refresh();
  },

  onPullDownRefresh() {
    this.resetForm();
    this.refresh();
    wx.stopPullDownRefresh();
  },

  /* ------------------------------ 筛选条 ------------------------------ */

  onYearChange(e) {
    getApp().globalData.year = this.data.years[Number(e.detail.value)];
    this.refresh();
  },

  onMonthChange(e) {
    const index = Number(e.detail.value);
    getApp().globalData.month = index === 0 ? '' : String(index);
    this.refresh();
  },

  onFilterTypeChange(e) {
    this.setData({ filterType: e.currentTarget.dataset.value });
    this.refresh();
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
    this.refresh();
  },

  /* ------------------------------ 录入表单 ----------------------------- */

  onDateChange(e) {
    this.setData({ 'form.date': e.detail.value });
  },

  onTypeChange(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      'form.type': type,
      categoryOptions: store.listCategories()[type],
    });
  },

  onAmountInput(e) {
    this.setData({ 'form.amount': e.detail.value });
  },

  onCategoryInput(e) {
    this.setData({ 'form.category': e.detail.value });
  },

  onCategoryTap(e) {
    this.setData({ 'form.category': e.currentTarget.dataset.name });
  },

  onNoteInput(e) {
    this.setData({ 'form.note': e.detail.value });
  },

  onCancelEdit() {
    this.resetForm();
    wx.showToast({ title: '已退出编辑', icon: 'none' });
  },

  /** 完全恢复默认：日期今天、类型支出 */
  resetForm() {
    this.setData({
      editingId: null,
      form: emptyForm(),
      categoryOptions: store.listCategories().expense,
    });
  },

  onSubmit() {
    const form = this.data.form;
    const amountCents = fmt.yuanToCents(form.amount);

    if (!form.date) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }
    if (!amountCents || amountCents <= 0) {
      wx.showToast({ title: '请输入大于 0 的金额', icon: 'none' });
      return;
    }

    try {
      const payload = {
        date: form.date,
        type: form.type,
        amountCents,
        category: form.category,
        note: form.note,
      };

      if (this.data.editingId) {
        store.updateRecord(this.data.editingId, payload);
        wx.showToast({ title: '已保存修改', icon: 'success' });
      } else {
        store.createRecord(payload);
        wx.showToast({ title: '已保存', icon: 'success' });
      }

      // 保留日期与类型，只清空金额 / 分类 / 备注，方便连续录入
      this.setData({
        editingId: null,
        form: { date: form.date, type: form.type, amount: '', category: '', note: '' },
      });
      this.refresh();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  /* ------------------------------ 记录列表 ----------------------------- */

  onEdit(e) {
    const record = store.getRecord(Number(e.currentTarget.dataset.id));
    if (!record) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      return;
    }
    this.setData({
      editingId: record.id,
      form: {
        date: record.date,
        type: record.type,
        amount: fmt.centsToYuanInput(record.amountCents),
        category: record.category,
        note: record.note,
      },
      categoryOptions: store.listCategories()[record.type],
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 150 });
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
          if (this.data.editingId === id) this.resetForm();
          wx.showToast({ title: '已删除', icon: 'success' });
          this.refresh();
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  /* ------------------------------ 导入导出 ----------------------------- */

  onToggleImport() {
    this.setData({ showImport: !this.data.showImport });
  },

  onImportInput(e) {
    this.setData({ importText: e.detail.value });
  },

  onImportConfirm() {
    const { items, skipped } = parsePastedText(this.data.importText);
    if (!items.length) {
      wx.showToast({ title: '没有解析到有效数据', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '导入确认',
      content: `解析到 ${items.length} 条有效记录${skipped ? `，${skipped} 行无效将被跳过` : ''}，确认导入？`,
      success: (res) => {
        if (!res.confirm) return;
        try {
          const result = store.importRecords(items);
          wx.showToast({ title: `已导入 ${result.inserted} 条`, icon: 'success' });
          this.setData({ showImport: false, importText: '' });
          this.refresh();
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  onExportCsv() {
    if (!this.rawRecords.length) {
      wx.showToast({ title: '当前没有可导出的记录', icon: 'none' });
      return;
    }
    wx.setClipboardData({ data: store.toCsv(this.rawRecords) });
  },

  /* ------------------------------- 数据加载 ---------------------------- */

  refresh() {
    const globalData = getApp().globalData;
    const years = store.years();
    let year = globalData.year;
    if (years.indexOf(year) < 0) year = years[0];
    globalData.year = year;

    const monthIndex = globalData.month ? Number(globalData.month) : 0;
    const periodLabel = globalData.month ? `${year} 年 ${Number(globalData.month)} 月` : `${year} 年（全年）`;

    const list = store.listRecords({
      year,
      month: globalData.month,
      type: this.data.filterType,
      keyword: this.data.keyword,
    });
    this.rawRecords = list;

    this.setData({
      years,
      year,
      yearIndex: Math.max(years.indexOf(year), 0),
      monthIndex,
      periodLabel,
      records: list.map((item) => ({
        id: item.id,
        date: item.date,
        type: item.type,
        typeLabel: item.type === 'income' ? '收入' : '支出',
        category: item.category,
        note: item.note,
        amount: `${item.type === 'income' ? '+' : '-'}${fmt.formatMoney(item.amountCents)}`,
        amountCls: item.type === 'income' ? 'income-text' : 'expense-text',
      })),
    });
  },
});
