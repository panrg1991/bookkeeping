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
    store.init();
  },
});
