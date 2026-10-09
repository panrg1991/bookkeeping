/**
 * 云开发配置
 *
 * 部署步骤见 docs/cloud-database.md
 */
module.exports = {
  /**
   * 云环境 ID，例如 'bookkeeping-1g2h3i4j5k6l'
   * 留空（''）表示使用小程序的默认云环境。
   */
  envId: '',

  /** 统一业务云函数名（cloudfunctions/bookkeeping） */
  cloudFunction: 'bookkeeping',

  /** 集合名，需与云函数内保持一致 */
  collections: {
    records: 'records',
    logs: 'logs',
    settings: 'settings',
  },

  /** 单次列表拉取上限（云函数内同样有上限保护） */
  maxListSize: 2000,
};
