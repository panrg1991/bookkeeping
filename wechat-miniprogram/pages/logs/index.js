const store = require('../../utils/store');
const fmt = require('../../utils/format');

const ACTION_META = {
  create: { label: '新增', cls: 'income' },
  update: { label: '修改', cls: 'update' },
  delete: { label: '删除', cls: 'expense' },
  import: { label: '导入', cls: 'income' },
  importBatch: { label: '导入汇总', cls: 'update' },
  importRejected: { label: '导入拒绝', cls: 'expense' },
  clearLogs: { label: '清理日志', cls: 'update' },
  initDb: { label: '初始化', cls: 'update' },
  read: { label: '查询', cls: 'update' },
};

const FIELD_LABELS = {
  date: '日期',
  type: '类型',
  amountCents: '金额',
  category: '分类',
  note: '备注',
};

const FILTERS = [
  { value: '', label: '全部' },
  { value: 'create', label: '新增' },
  { value: 'update', label: '修改' },
  { value: 'delete', label: '删除' },
  { value: 'import', label: '导入' },
];

const PAGE_SIZE = 50;

function formatTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${fmt.pad2(d.getMonth() + 1)}-${fmt.pad2(d.getDate())} ${fmt.pad2(d.getHours())}:${fmt.pad2(d.getMinutes())}:${fmt.pad2(d.getSeconds())}`;
}

function formatField(key, data) {
  if (!data) return '-';
  if (key === 'amountCents') return `${(Number(data.amountCents || 0) / 100).toFixed(2)} 元`;
  if (key === 'type') return data.type === 'income' ? '收入' : '支出';
  return String(data[key] == null || data[key] === '' ? '-' : data[key]);
}

function buildDetail(log) {
  if (log.action === 'update' && log.changed && log.changed.length) {
    return log.changed
      .map((key) => `${FIELD_LABELS[key] || key}：${formatField(key, log.before)} → ${formatField(key, log.after)}`)
      .join('；');
  }
  return '';
}

function buildClientText(client) {
  if (!client) return '';
  const parts = [];
  if (client.version) parts.push(`版本 ${client.version}`);
  if (client.platform) parts.push(client.platform);
  if (client.model) parts.push(client.model);
  return parts.join(' · ');
}

Page({
  data: {
    filters: FILTERS,
    filterAction: '',
    stats: [],
    total: 0,
    logs: [],
    hasMore: false,
    loading: true,
    mode: store.mode,
    account: { masked: '', env: '', full: '' },
  },

  offset: 0,

  onShow() {
    this.loadAccount();
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  onFilterChange(e) {
    this.setData({ filterAction: e.currentTarget.dataset.value });
    this.refresh();
  },

  /** 当前账号信息：openid 由微信自动注入，这里只用于排查数据归属 */
  async loadAccount() {
    try {
      const info = await store.whoami();
      this.setData({
        account: {
          masked: info.openidMasked || '(未获取到)',
          env: info.envId || '默认环境',
          full: info.openid || '',
        },
      });
    } catch (err) {
      // 账号信息仅用于排查，拉取失败不影响日志展示
    }
  },

  onCopyOpenid() {
    if (!this.data.account.full) {
      wx.showToast({
        title: store.mode === 'cloud' ? '未获取到 openid' : '本地模式没有 openid',
        icon: 'none',
      });
      return;
    }
    wx.setClipboardData({ data: this.data.account.full });
  },

  async refresh() {
    this.offset = 0;
    this.setData({ loading: true });

    try {
      const [stats, res] = await Promise.all([
        store.logStats(),
        store.listLogs({ filterAction: this.data.filterAction, limit: PAGE_SIZE, offset: 0 }),
      ]);

      this.offset = res.items.length;

      this.setData({
        loading: false,
        total: res.total,
        hasMore: this.offset < res.total,
        stats: Object.keys(stats.stats || {})
          .sort((a, b) => stats.stats[b] - stats.stats[a])
          .map((key) => ({
            key,
            label: (ACTION_META[key] && ACTION_META[key].label) || key,
            value: stats.stats[key],
          })),
        logs: res.items.map(this.decorate),
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async onLoadMore() {
    if (this.data.loading) return;
    try {
      const res = await store.listLogs({ filterAction: this.data.filterAction, limit: PAGE_SIZE, offset: this.offset });
      this.offset += res.items.length;
      this.setData({
        logs: this.data.logs.concat(res.items.map(this.decorate)),
        hasMore: this.offset < res.total,
      });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  /** 日志项 -> 展示用数据 */
  decorate(log) {
    const meta = ACTION_META[log.action] || { label: log.action || '未知', cls: 'update' };
    return {
      id: log.id,
      label: meta.label,
      cls: meta.cls,
      summary: log.summary || '',
      detail: buildDetail(log),
      time: formatTime(log.time),
      client: buildClientText(log.client),
    };
  },

  onClearLogs() {
    wx.showModal({
      title: '清理日志',
      content: '将删除 30 天前的操作日志（单次最多 500 条），确定继续吗？',
      confirmText: '清理',
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '清理中', mask: true });
        try {
          const result = await store.clearLogs(30);
          wx.hideLoading();
          wx.showToast({ title: `已清理 ${result.removed} 条`, icon: 'success' });
          this.refresh();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },
});
