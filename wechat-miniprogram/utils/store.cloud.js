'use strict';

/**
 * 数据层（云开发数据库版）
 *
 * - 所有读写都通过统一云函数 `bookkeeping` 完成，小程序端不直连数据库
 * - 数据按微信用户（openid）隔离：openid 由云函数从调用上下文中获取，
 *   前端既不需要也无法传入，杜绝越权访问他人数据
 * - 每次写操作（新增 / 修改 / 删除 / 导入）云函数都会在 `logs` 集合留一条操作日志
 *
 * 注意：与本地存储版（./store.local.js）接口同名，但云版**全部为异步**，
 *      页面里请使用 await / then 处理。
 */

const config = require('./config');
const fmt = require('./format');

/** 调用上下文信息（版本号、机型），随请求上报，写入操作日志便于排查 */
let cachedClient = null;
function clientInfo() {
  if (cachedClient) return cachedClient;

  const info = { version: '', platform: '', model: '' };
  try {
    const account = wx.getAccountInfoSync();
    info.version = (account && account.miniProgram && account.miniProgram.version) || '';
  } catch (err) {
    // 忽略，取不到不影响业务
  }
  try {
    const device = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : wx.getSystemInfoSync();
    info.platform = device.platform || device.system || '';
    info.model = device.model || '';
  } catch (err) {
    // 忽略
  }

  cachedClient = info;
  return cachedClient;
}

/** 统一调用云函数，返回 Promise */
function call(action, payload) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('当前基础库不支持云开发，请升级基础库版本'));
      return;
    }

    wx.cloud.callFunction({
      name: config.cloudFunction,
      data: Object.assign({ action, client: clientInfo() }, payload || {}),
      success: (res) => {
        const result = res && res.result;
        if (result && result.ok) resolve(result.data);
        else reject(new Error((result && result.message) || '操作失败'));
      },
      fail: (err) => {
        const message = (err && err.errMsg) || '';
        if (/FUNCTION_NOT_FOUND|FunctionName parameter could not be found/i.test(message)) {
          reject(new Error('云函数 bookkeeping 未部署，请先在开发者工具中上传部署'));
        } else {
          reject(new Error(message || '云函数调用失败，请检查云环境配置'));
        }
      },
    });
  });
}

module.exports = {
  /** 启动时自检：确认云函数可用 */
  init() {
    return call('ping');
  },

  /** 首次部署时创建集合，可在控制台手动调用或临时调用一次 */
  initDb() {
    return call('initDb');
  },

  /** 当前账号信息（openid 脱敏），用于排查数据归属问题 */
  whoami() {
    return call('whoami');
  },

  /* ------------------------------ 记录读写 ------------------------------ */

  listRecords(options) {
    return call('listRecords', options || {});
  },

  getRecord(id) {
    return call('getRecord', { id });
  },

  createRecord(input) {
    return call('createRecord', { record: input });
  },

  updateRecord(id, input) {
    return call('updateRecord', { id, record: input });
  },

  deleteRecord(id) {
    return call('deleteRecord', { id });
  },

  importRecords(items, options) {
    return call('importRecords', Object.assign({ items }, options || {}));
  },

  /* -------------------------------- 统计 -------------------------------- */

  overview(year, month) {
    return call('overview', { year, month });
  },

  monthlySummary(year) {
    return call('monthlySummary', { year });
  },

  dailySummary(year, month) {
    return call('dailySummary', { year, month });
  },

  categorySummary(year, month, type) {
    return call('categorySummary', { year, month, type });
  },

  years() {
    return call('years');
  },

  /* ------------------------------ 分类字典 ------------------------------ */

  listCategories() {
    return call('getCategories');
  },

  addCategory(name, type) {
    return call('addCategory', { name, type });
  },

  /* ------------------------------ 操作日志 ------------------------------ */

  listLogs(options) {
    return call('listLogs', options || {});
  },

  logStats() {
    return call('logStats');
  },

  clearLogs(days) {
    return call('clearLogs', { days });
  },

  /* --------------------- 纯本地工具函数（不涉及存储） --------------------- */

  toCsv: fmt.toCsv,
  toDateString: fmt.toDateString,
  toType: fmt.toType,
  toAmountCents: fmt.toAmountCents,
};
