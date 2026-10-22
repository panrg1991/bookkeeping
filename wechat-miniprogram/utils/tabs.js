'use strict';

/**
 * 底部导航配置（唯一 JS 数据源）。
 *
 * 新增一个 tab 页面时，只需：
 *   1. app.json 的 pages 中登记页面；
 *   2. app.json 的 tabBar.list 中按**相同顺序**补一项（微信平台静态要求）；
 *   3. 本文件的 TABS 中补一项。
 * 页面里不再需要硬编码 selected 下标（由 sync() 按路由自动匹配）。
 */
const TABS = [
  { pagePath: '/pages/monthly/index', text: '月度总览' },
  { pagePath: '/pages/daily/index', text: '每日明细' },
  { pagePath: '/pages/records/index', text: '流水记录' },
  { pagePath: '/pages/category/index', text: '分类统计' },
  { pagePath: '/pages/calculator/index', text: '计算' },
];

/** 统一路由写法：补上前导 '/'，去掉多余后缀 */
function normalizeRoute(route) {
  return `/${String(route || '').replace(/^\/+/, '')}`;
}

/**
 * 按当前页面路由同步自定义 tabBar 的选中项。
 * 页面在 onShow 中调用 `tabs.sync(this)` 即可，无需关心自己排第几个。
 */
function sync(page) {
  if (!page || typeof page.getTabBar !== 'function') return;
  const bar = page.getTabBar();
  if (!bar) return;

  const route = normalizeRoute(page.route);
  const index = TABS.findIndex((item) => item.pagePath === route);
  if (index >= 0) bar.setData({ selected: index });
}

module.exports = { TABS, sync };
