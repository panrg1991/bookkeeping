Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/monthly/index', text: '月度总览' },
      { pagePath: '/pages/daily/index', text: '每日明细' },
      { pagePath: '/pages/records/index', text: '流水记录' },
      { pagePath: '/pages/category/index', text: '分类统计' },
    ],
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
