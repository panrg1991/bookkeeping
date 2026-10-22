const { TABS } = require('../utils/tabs');

Component({
  data: {
    selected: 0,
    // 导航项统一来自 utils/tabs.js，新增 tab 时无需再改这里
    list: TABS,
  },

  methods: {
    onTap(e) {
      const index = Number(e.currentTarget.dataset.index);
      const item = this.data.list[index];
      if (!item || index === this.data.selected) return;

      wx.switchTab({ url: item.pagePath });
    },
  },
});
