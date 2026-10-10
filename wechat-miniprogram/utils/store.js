'use strict';

/**
 * 数据层门面：按 utils/config.js 里的 `mode` 选择具体实现
 *
 *   mode === 'cloud' → ./store.cloud.js  微信云开发数据库 + 云函数 bookkeeping
 *   其他（默认）      → ./store.local.js  小程序本地存储，离线可用
 *
 * 对外统一为 Promise 风格（本地实现是同步的，这里自动包装成 Promise），
 * 所以页面里 `await store.xxx()` 的写法在两种模式下完全一致，切换模式无需改页面。
 * 工具函数（toCsv / toDateString / toType / toAmountCents）保持同步，可直接调用。
 */

const config = require('./config');

const mode = config.mode === 'cloud' ? 'cloud' : 'local';
const impl = require(mode === 'cloud' ? './store.cloud' : './store.local');

/** 需要对外统一成异步（Promise）的数据方法 */
const ASYNC_METHODS = [
  'init',
  'initDb',
  'whoami',
  'listRecords',
  'getRecord',
  'createRecord',
  'updateRecord',
  'deleteRecord',
  'deleteRecords',
  'importRecords',
  'overview',
  'monthlySummary',
  'dailySummary',
  'categorySummary',
  'years',
  'listCategories',
  'addCategory',
  'listLogs',
  'logStats',
  'clearLogs',
  'exportAll',
  'importAll',
];

/** 工具函数（不涉及存储，保持同步） */
const SYNC_METHODS = ['toCsv', 'toDateString', 'toType', 'toAmountCents'];

const store = { mode };

ASYNC_METHODS.forEach((name) => {
  store[name] = (...args) => {
    const fn = impl[name];
    if (typeof fn !== 'function') {
      return Promise.reject(new Error(`当前模式（${mode}）不支持该操作：${name}`));
    }
    try {
      return Promise.resolve(fn.apply(impl, args));
    } catch (err) {
      return Promise.reject(err);
    }
  };
});

SYNC_METHODS.forEach((name) => {
  store[name] = impl[name];
});

module.exports = store;
