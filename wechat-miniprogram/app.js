const config = require('./utils/config');
const store = require('./utils/store');

App({
  globalData: {
    // 全局筛选条件：四个页面共享，切换 tab 时保持一致
    year: String(new Date().getFullYear()),
    month: String(new Date().getMonth() + 1),
    // 跨页面编辑标记：每日明细里点「修改」后跳到流水记录页进入编辑态
    editId: null,
  },

  onLaunch() {
    // 本地模式：只初始化本地存储，不需要云环境
    if (store.mode !== 'cloud') {
      store
        .init()
        .catch((err) => console.error('[bookkeeping] 本地数据初始化失败：', err));
      return;
    }

    // 云开发模式
    if (!wx.cloud) {
      console.error('当前基础库版本过低，无法使用云开发能力，请升级基础库版本');
      return;
    }

    const options = { traceUser: true };
    if (config.envId) options.env = config.envId;
    wx.cloud.init(options);

    // 自检：确认云函数可用，避免每个页面各自报错
    store.init().catch((err) => {
      console.error('[bookkeeping] 云函数自检失败：', err);
      wx.showModal({
        title: '云环境未就绪',
        content: `${err.message}\n\n请确认已开通云开发、已部署 bookkeeping 云函数，并在 utils/config.js 中配置 envId。`,
        showCancel: false,
      });
    });
  },
});
