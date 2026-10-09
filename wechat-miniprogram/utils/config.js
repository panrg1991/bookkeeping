/**
 * 小程序配置
 *
 * 部署与切换说明见 docs/deploy-checklist.md、docs/cloud-database.md
 */
module.exports = {
  /**
   * 数据模式：
   *   'local' —— 本地存储模式（**当前默认**）：数据存在手机本地，无需云开发、
   *              无需真实 AppID、无需网络，用游客模式也能跑
   *   'cloud' —— 微信云开发数据库模式：数据按微信用户 openid 隔离、多端同步，
   *              需要真实 AppID + 开通云环境 + 部署云函数
   *
   * 改这一个字段即可切换，页面代码不用动。
   */
  mode: 'local',

  /**
   * 云环境 ID，仅在 mode === 'cloud' 时使用，例如 'bookkeeping-1g2h3i4j5k6l'
   * 留空（''）表示使用小程序的默认云环境。
   */
  envId: '',

  /** 统一业务云函数名（cloudfunctions/bookkeeping），仅云模式使用 */
  cloudFunction: 'bookkeeping',

  /** 集合名，需与云函数内保持一致，仅云模式使用 */
  collections: {
    records: 'records',
    logs: 'logs',
    settings: 'settings',
  },

  /** 单次列表拉取上限 */
  maxListSize: 2000,
};
