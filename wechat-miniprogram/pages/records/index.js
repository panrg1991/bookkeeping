const store = require('../../utils/store');
const fmt = require('../../utils/format');
const tabs = require('../../utils/tabs');

const MONTH_OPTIONS = ['全年', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function emptyForm() {
  return { date: fmt.todayStr(), type: 'expense', amount: '', unitPrice: '', quantity: '', category: '', note: '' };
}

/** 数量展示：整数不带小数，小数最多 3 位 */
function formatQuantity(value) {
  const num = Number(value) || 0;
  return Number.isInteger(num) ? String(num) : String(Number(num.toFixed(3)));
}

/** 「单价 × 数量」展示文本，如 ¥3.50 × 2.5 */
function unitPriceText(record) {
  const unitPriceCents = Number(record.unitPriceCents) || 0;
  const quantity = Number(record.quantity) || 0;
  if (unitPriceCents <= 0 || quantity <= 0) return '';
  return `¥${fmt.formatMoney(unitPriceCents)} × ${formatQuantity(quantity)}`;
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
    // 可选的第 6、7 列：单价、数量（两者都填时金额由它们计算，金额列可留空）
    const unitPriceCents = store.toAmountCents(cells[5]);
    const quantityRaw = cells[6] === undefined ? NaN : Number(cells[6]);
    const quantity = Number.isFinite(quantityRaw) ? quantityRaw : 0;
    const useUnit = !!(unitPriceCents > 0 && quantity > 0);

    if (!date || !type || (!useUnit && !(amountCents > 0))) {
      skipped += 1;
      return;
    }

    const item = { date, type, category: cells[3] || '其他', note: cells[4] || '' };
    if (useUnit) {
      item.unitPriceCents = unitPriceCents;
      item.quantity = quantity;
    } else {
      item.amountCents = amountCents;
    }
    items.push(item);
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
    calcMode: 'amount',
    computedAmount: '0.00',
    categoryOptions: [],
    editingId: null,
    records: [],
    showImport: false,
    importText: '',
    showBackup: false,
    restoreText: '',
    // 批量选择
    selectMode: false,
    selectedIds: [],
    allSelected: false,
  },

  rawRecords: [],
  categories: { income: [], expense: [] },

  onLoad() {
    this.loadCategories();
  },

  async onShow() {
    // 按路由同步自定义 tabBar 的选中项（无需关心自己是第几个 tab）
    tabs.sync(this);

    const globalData = getApp().globalData;

    // 从「每日明细」页点「修改」跳转过来：进入编辑态
    if (globalData.editId) {
      const id = globalData.editId;
      globalData.editId = null;
      try {
        const record = await store.getRecord(id);
        if (record) {
          this.fillForm(record);
          wx.pageScrollTo({ scrollTop: 0, duration: 0 });
        }
      } catch (err) {
        wx.showToast({ title: err.message, icon: 'none' });
      }
    }

    this.refresh();
  },

  onPullDownRefresh() {
    this.resetForm();
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  onUnload() {
    if (this.keywordTimer) {
      clearTimeout(this.keywordTimer);
      this.keywordTimer = null;
    }
  },

  /* ------------------------------ 分类字典 ----------------------------- */

  async loadCategories() {
    try {
      const categories = await store.listCategories();
      this.categories = categories;
      this.syncCategoryOptions(this.data.form.type);
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  syncCategoryOptions(type) {
    const categories = this.categories || { income: [], expense: [] };
    this.setData({ categoryOptions: categories[type] || [] });
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
    const keyword = e.detail.value;
    this.setData({ keyword });
    // 防抖：云模式下每敲一个字就发起一次查询会带来明显延迟与配额消耗
    if (this.keywordTimer) clearTimeout(this.keywordTimer);
    this.keywordTimer = setTimeout(() => {
      this.keywordTimer = null;
      this.refresh();
    }, 300);
  },

  /* ------------------------------ 录入表单 ----------------------------- */

  onDateChange(e) {
    this.setData({ 'form.date': e.detail.value });
  },

  onTypeChange(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ 'form.type': type });
    this.syncCategoryOptions(type);
  },

  /** 切换计价方式：直接填金额 / 单价 × 数量 */
  onCalcModeChange(e) {
    const calcMode = e.currentTarget.dataset.mode === 'unit' ? 'unit' : 'amount';
    this.setData({ calcMode });
    this.updateComputed();
  },

  onAmountInput(e) {
    this.setData({ 'form.amount': e.detail.value });
  },

  onUnitPriceInput(e) {
    this.setData({ 'form.unitPrice': e.detail.value });
    this.updateComputed();
  },

  onQuantityInput(e) {
    this.setData({ 'form.quantity': e.detail.value });
    this.updateComputed();
  },

  /** 单价 × 数量 实时计算，保留两位小数（与数据层 Math.round(单价分 × 数量) 一致） */
  updateComputed() {
    const { form } = this.data;
    const unitPriceCents = fmt.yuanToCents(form.unitPrice);
    const quantity = Number(form.quantity);
    const valid = unitPriceCents > 0 && Number.isFinite(quantity) && quantity > 0;
    this.setData({
      computedAmount: valid ? fmt.formatMoney(Math.round(unitPriceCents * quantity)) : '0.00',
    });
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

  /** 把一条记录回填到表单，并按是否使用「单价 × 数量」自动切换计价方式 */
  fillForm(record) {
    const useUnit = Number(record.unitPriceCents) > 0 && Number(record.quantity) > 0;
    this.setData({
      editingId: record.id,
      calcMode: useUnit ? 'unit' : 'amount',
      form: {
        date: record.date,
        type: record.type,
        amount: useUnit ? '' : fmt.centsToYuanInput(record.amountCents),
        unitPrice: useUnit ? fmt.centsToYuanInput(record.unitPriceCents) : '',
        quantity: useUnit ? formatQuantity(record.quantity) : '',
        category: record.category,
        note: record.note,
      },
    });
    this.syncCategoryOptions(record.type);
    this.updateComputed();
  },

  /** 完全恢复默认：日期今天、类型支出、计价方式为金额 */
  resetForm() {
    const form = emptyForm();
    this.setData({ editingId: null, form, calcMode: 'amount', computedAmount: '0.00' });
    this.syncCategoryOptions(form.type);
  },

  async onSubmit() {
    // 提交期间加锁，避免快速连点写入重复记录
    if (this.saving) return;

    const { form, calcMode } = this.data;
    if (!form.date) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }

    const payload = {
      date: form.date,
      type: form.type,
      category: form.category,
      note: form.note,
    };

    if (calcMode === 'unit') {
      const unitPriceCents = fmt.yuanToCents(form.unitPrice);
      const quantity = Number(form.quantity);
      if (!(unitPriceCents > 0)) {
        wx.showToast({ title: '请输入大于 0 的单价', icon: 'none' });
        return;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        wx.showToast({ title: '请输入大于 0 的数量', icon: 'none' });
        return;
      }
      if (Math.round(unitPriceCents * quantity) <= 0) {
        wx.showToast({ title: '单价 × 数量 计算出的金额必须大于 0', icon: 'none' });
        return;
      }
      payload.unitPriceCents = unitPriceCents;
      payload.quantity = quantity;
    } else {
      const amountCents = fmt.yuanToCents(form.amount);
      if (!(amountCents > 0)) {
        wx.showToast({ title: '请输入大于 0 的金额', icon: 'none' });
        return;
      }
      payload.amountCents = amountCents;
      // 显式清零，避免编辑「单价 × 数量」记录后切回金额模式时金额被旧值覆盖
      payload.unitPriceCents = 0;
      payload.quantity = 0;
    }

    wx.showLoading({ title: '保存中', mask: true });
    this.saving = true;
    try {
      if (this.data.editingId) {
        const res = await store.updateRecord(this.data.editingId, payload);
        wx.hideLoading();
        wx.showToast({ title: res && res.unchanged ? '内容未变化' : '已保存修改', icon: 'success' });
      } else {
        await store.createRecord(payload);
        wx.hideLoading();
        wx.showToast({ title: '已保存', icon: 'success' });
      }

      // 保留日期、类型与计价方式，只清空金额 / 单价 / 数量 / 分类 / 备注，方便连续录入
      this.setData({
        editingId: null,
        form: {
          date: form.date,
          type: form.type,
          amount: '',
          unitPrice: '',
          quantity: '',
          category: '',
          note: '',
        },
      });
      this.updateComputed();
      this.refresh();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.saving = false;
    }
  },

  /* ------------------------------ 记录列表 ----------------------------- */

  async onEdit(e) {
    const id = String(e.currentTarget.dataset.id);
    wx.showLoading({ title: '加载中', mask: false });
    try {
      const record = await store.getRecord(id);
      wx.hideLoading();
      if (!record) {
        wx.showToast({ title: '记录不存在', icon: 'none' });
        return;
      }
      this.fillForm(record);
      wx.pageScrollTo({ scrollTop: 0, duration: 150 });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    }
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
          if (this.data.editingId === id) this.resetForm();
          wx.showToast({ title: '已删除', icon: 'success' });
          this.refresh();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  /* ------------------------------ 批量选择 ----------------------------- */

  onToggleSelectMode() {
    if (this.data.selectMode) {
      this.exitSelectMode();
      return;
    }
    this.setData({ selectMode: true, selectedIds: [], allSelected: false });
    wx.showToast({ title: '点击记录即可多选', icon: 'none' });
  },

  /** 选择模式下点击整张卡片切换选中；非选择模式不响应 */
  onCardTap(e) {
    if (!this.data.selectMode) return;
    this.toggleSelect(e.currentTarget.dataset.id);
  },

  toggleSelect(id) {
    const key = String(id);
    const selected = this.data.selectedIds.slice();
    const index = selected.indexOf(key);
    if (index >= 0) selected.splice(index, 1);
    else selected.push(key);
    this.setSelected(selected);
  },

  setSelected(selectedIds) {
    const records = this.data.records.map((item) =>
      Object.assign({}, item, { checked: selectedIds.indexOf(String(item.id)) >= 0 })
    );
    this.setData({
      selectedIds,
      records,
      allSelected: records.length > 0 && selectedIds.length >= records.length,
    });
  },

  onSelectAll() {
    if (this.data.allSelected) {
      this.setSelected([]);
      return;
    }
    this.setSelected(this.data.records.map((item) => String(item.id)));
  },

  onBatchDelete() {
    const ids = this.data.selectedIds.slice();
    if (!ids.length) {
      wx.showToast({ title: '请先选择要删除的记录', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '批量删除',
      content: `确定删除选中的 ${ids.length} 条记录吗？删除后不可恢复。`,
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中', mask: true });
        try {
          const result = await store.deleteRecords(ids);
          wx.hideLoading();
          wx.showToast({ title: `已删除 ${result.removed} 条`, icon: 'success' });
          if (this.data.editingId && ids.indexOf(String(this.data.editingId)) >= 0) this.resetForm();
          this.exitSelectMode();
          this.refresh();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  exitSelectMode() {
    this.setData({
      selectMode: false,
      selectedIds: [],
      allSelected: false,
      records: this.data.records.map((item) => Object.assign({}, item, { checked: false })),
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
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '导入中', mask: true });
        try {
          const result = await store.importRecords(items);
          wx.hideLoading();
          wx.showToast({ title: `已导入 ${result.inserted} 条`, icon: 'success' });
          this.setData({ showImport: false, importText: '' });
          this.refresh();
        } catch (err) {
          wx.hideLoading();
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

  onOpenLogs() {
    wx.navigateTo({ url: '/pages/logs/index' });
  },

  /* ------------------------------ 备份 / 恢复 ----------------------------- */

  onToggleBackup() {
    this.setData({ showBackup: !this.data.showBackup });
  },

  /** 备份：把全部记录（含分类字典）复制到剪贴板，便于发送到新手机 */
  async onBackup() {
    wx.showLoading({ title: '生成备份', mask: true });
    try {
      const backup = await store.exportAll();
      wx.hideLoading();
      const text = JSON.stringify(backup);
      wx.setClipboardData({
        data: text,
        success: () => {
          wx.showModal({
            title: '备份已复制',
            content: `共 ${backup.count} 条记录已复制到剪贴板（约 ${(text.length / 1024).toFixed(1)} KB）。\n\n请粘贴并发送给「文件传输助手」或自己的聊天窗口；换手机后用本页的「备份/恢复 → 合并/覆盖恢复」把内容粘贴回来。`,
            showCancel: false,
          });
        },
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  onRestoreInput(e) {
    this.setData({ restoreText: e.detail.value });
  },

  /** 恢复备份：mode = merge（合并） / replace（覆盖） */
  onRestore(e) {
    const mode = e.currentTarget.dataset.mode === 'merge' ? 'merge' : 'replace';

    let payload;
    try {
      payload = JSON.parse(this.data.restoreText);
    } catch (err) {
      wx.showToast({ title: '备份内容不是合法 JSON', icon: 'none' });
      return;
    }
    if (!payload || !Array.isArray(payload.records)) {
      wx.showToast({ title: '备份内容缺少 records 字段', icon: 'none' });
      return;
    }

    wx.showModal({
      title: mode === 'replace' ? '覆盖恢复' : '合并恢复',
      content:
        mode === 'replace'
          ? `将清空当前全部记录，再写入备份中的 ${payload.records.length} 条。此操作不可撤销，确定继续？`
          : `将备份中的 ${payload.records.length} 条合并进来（按 id 去重，保留现有记录）。确定继续？`,
      confirmText: '确定恢复',
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '恢复中', mask: true });
        try {
          const result = await store.importAll(payload, { mode });
          wx.hideLoading();
          wx.showToast({ title: `已恢复 ${result.inserted} 条`, icon: 'success' });
          this.setData({ showBackup: false, restoreText: '' });
          this.refresh();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  /* ------------------------------- 数据加载 ---------------------------- */

  async refresh() {
    const globalData = getApp().globalData;

    try {
      const years = await store.years();
      let year = globalData.year;
      if (years.indexOf(year) < 0) year = years[0];
      globalData.year = year;

      const monthIndex = globalData.month ? Number(globalData.month) : 0;
      const periodLabel = globalData.month ? `${year} 年 ${Number(globalData.month)} 月` : `${year} 年（全年）`;

      const res = await store.listRecords({
        year,
        month: globalData.month,
        type: this.data.filterType,
        keyword: this.data.keyword,
        limit: 500,
      });

      this.rawRecords = res.items;

      const items = res.items.map((item) => ({
        id: item.id,
        date: item.date,
        type: item.type,
        typeLabel: item.type === 'income' ? '收入' : '支出',
        category: item.category,
        note: item.note,
        amount: `${item.type === 'income' ? '+' : '-'}${fmt.formatMoney(item.amountCents)}`,
        amountCls: item.type === 'income' ? 'income-text' : 'expense-text',
        unitPriceText: unitPriceText(item),
      }));

      // 让批量选中状态与最新列表保持一致（已删除或被筛掉的会自动移除）
      const validIds = items.map((item) => String(item.id));
      const selectedIds = this.data.selectMode
        ? this.data.selectedIds.filter((id) => validIds.indexOf(id) >= 0)
        : [];

      this.setData({
        years,
        year,
        yearIndex: Math.max(years.indexOf(year), 0),
        monthIndex,
        periodLabel,
        selectedIds,
        allSelected: items.length > 0 && selectedIds.length >= items.length,
        records: items.map((item) =>
          Object.assign({}, item, { checked: selectedIds.indexOf(String(item.id)) >= 0 })
        ),
      });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },
});
