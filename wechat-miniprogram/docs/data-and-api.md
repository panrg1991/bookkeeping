# 数据存储与接口调用说明

本文说明小程序版**数据存在哪里、怎么按用户隔离、页面怎么调用**，以及日志与模式切换。
云数据库的建库、权限、索引与部署细节见 **[cloud-database.md](cloud-database.md)**；配置与切换清单见 **[deploy-checklist.md](deploy-checklist.md)**。

## 一、两种模式与总体结论

小程序端有**两种数据模式**，由 `utils/config.js` 的 `mode` 决定，**页面代码完全一致**：

| | 本地存储（当前默认，`mode: 'local'`） | 云开发数据库（`mode: 'cloud'`） |
| --- | --- | --- |
| 实现文件 | `utils/store.local.js` | `utils/store.cloud.js` + 云函数 `bookkeeping` |
| 数据位置 | `wx.setStorageSync`：`bk:records` / `bk:categories` / `bk:seq` / `bk:logs` | 云数据库集合：`records` / `logs` / `settings` |
| 用户隔离 | 按设备 + 微信账号（无用户体系，不涉及 openid） | 按 `_openid`（云函数自动识别，前端无法伪造） |
| 后端服务 | 无 | 云函数（无需自建服务器、域名、备案） |
| 多端同步 | ❌ 仅本机 | ✅ 同一微信账号自动同步 |
| 需要云环境 | ❌ 不需要（游客模式也能跑） | ✅ 需要（`envId` + 部署云函数 + 建集合 + 配权限） |
| 操作日志 | 本地 `bk:logs`，滚动保留 500 条 | 云端 `logs` 集合，无条数上限 |
| 需要真实 AppID | 仅发布时需要 | **是**（游客模式无法使用云开发） |

两种模式的共同点：

- 页面只调用 `utils/store.js`（门面），它按 `mode` 加载实现并**统一包装成 Promise**，因此页面里 `await store.xxx()` 的写法在两种模式下都一样，切换模式不用改页面
- 每次写操作都会留一条操作日志（含前后数据、变更字段、失败原因），可在「流水记录 → 操作日志」查看
- `listRecords` 等查询返回结构一致：`{ total, items }`
- 均**无需配置服务器合法域名**（本地模式不发请求；云模式走微信内部通道）
- 金额一律以「分」为单位的整数（`amountCents`）存取，避免浮点误差

> 下面第二～五节的字段与集合结构描述**云开发模式**；本地模式的存储键见上表与 [README](../README.md)。

## 二、集合结构（云开发模式）

### `records`（记账数据）

```js
{
  _id: 'xxx',
  _openid: 'oXXXX',        // 数据归属用户（云函数写入）
  date: '2026-09-24',      // YYYY-MM-DD
  type: 'expense',         // 'income' 收入 / 'expense' 支出
  amountCents: 3550,       // 金额（分）→ 35.50 元
  unitPriceCents: 0,       // 单价（分）；与 quantity 同时 > 0 时，金额由两者计算
  quantity: 0,             // 数量（可为小数）
  category: '餐饮',
  note: '午餐',
  createdAt: Date, createdAtMs: 1758691200000,
  updatedAt: Date, updatedAtMs: 1758691200000,
  importBatch: ''          // 批量导入时的批次号
}
```

### `logs`（操作日志，只增不改）

```js
{
  _openid: 'oXXXX',
  action: 'update',                       // create/update/delete/import/importBatch/importRejected/...
  target: 'records',
  recordId: 'xxx',
  before: { date, type, amountCents, category, note },
  after:  { date, type, amountCents, category, note },
  changed: ['amountCents', 'note'],
  summary: '修改 2026-09-24 支出 40.05 元（餐饮）（字段：amountCents、note）',
  batchId: '',  count: 0,  errors: [],
  client: { version: '1.0.0', platform: 'ios', model: 'iPhone 15' },
  createdAt: Date, createdAtMs: 1758691200000
}
```

### `settings`（分类字典）

每个用户一条：`{ _openid, income: [...], expense: [...], createdAt, updatedAt }`。

## 三、数据层 API（`utils/store.js`）

所有方法都返回 Promise（云函数调用是异步的），与云函数 action 一一对应：

| 小程序 `store.js` 方法 | 云函数 action | 说明 |
| --- | --- | --- |
| `init()` | `ping` | 启动自检，确认云函数可用 |
| `whoami()` | `whoami` | 当前账号 openid（脱敏）与环境 ID，排查数据归属用 |
| `initDb()` | `initDb` | 首次部署创建集合 |
| `listRecords(options)` | `listRecords` | `{ year, month, day, type, category, keyword, limit, offset }`，返回 `{ total, items }` |
| `getRecord(id)` | `getRecord` | 取单条，无权或不存在返回 `null` |
| `createRecord(input)` | `createRecord` | 新增（写 `create` 日志） |
| `updateRecord(id, input)` | `updateRecord` | 修改（写 `update` 日志，含前后值）；内容无变化时返回 `unchanged: true` |
| `deleteRecord(id)` | `deleteRecord` | 删除（写 `delete` 日志，含被删内容） |
| `importRecords(items, options)` | `importRecords` | 批量导入（逐条 + 汇总日志），返回 `{ inserted, skipped, errors, batchId }` |
| `overview(year, month)` | `overview` | 本期 + 全年汇总（云端聚合） |
| `monthlySummary(year)` | `monthlySummary` | 12 个月的收入、支出、利润、累计利润、笔数 |
| `dailySummary(year, month)` | `dailySummary` | 每天的收入、支出、净额、笔数 |
| `categorySummary(year, month, type)` | `categorySummary` | 各分类金额、笔数、占比 |
| `years()` | `years` | 已有数据的年份 |
| `listCategories()` | `getCategories` | 分类字典 |
| `addCategory(name, type)` | `addCategory` | 新增分类 |
| `listLogs(options)` | `listLogs` | 操作日志分页查询 |
| `logStats()` | `logStats` | 日志按操作类型汇总 |
| `clearLogs(days)` | `clearLogs` | 清理 N 天前的日志 |
| `exportAll()` | —（云端用 `listRecords` + `getCategories` 组合） | 全量备份：记录 + 分类字典，用于换手机迁移或留档 |
| `importAll(payload, { mode })` | `importRecords`（云端） | 从备份恢复：`replace` 覆盖 / `merge` 合并（按 id 去重） |
| `toCsv` / `toDateString` / `toType` / `toAmountCents` | — | 纯本地工具函数（`utils/format.js`），不涉及存储 |

云函数统一返回 `{ ok: true, data }` 或 `{ ok: false, message }`，`store.js` 负责拆包与错误提示。

## 四、页面如何调用（调用关系）

| 页面 | 触发时机 | 调用的方法 |
| --- | --- | --- |
| `app.js` | `onLaunch` | `wx.cloud.init()` → `store.init()` 自检 |
| 月度总览 `pages/monthly` | `onShow` / 下拉刷新 / 切换年月 | `await store.years()`、`await Promise.all([store.overview(), store.monthlySummary()])` |
| 每日明细 `pages/daily` | `onShow` / 切换年月 | `await store.years()`、`await store.dailySummary()` |
| 每日明细 · 展开某天 | 点击日期行 | `await store.listRecords({ day })`（按需拉取，不预加载） |
| 每日明细 · 修改 | 点「改」 | 写 `globalData.editId` → `switchTab` 到流水记录页 → 该页 `onShow` 里 `await store.getRecord(id)` 回填 |
| 每日明细 · 删除 | 点「删」→ 确认弹窗 | `await store.deleteRecord(id)` → 重新 `dailySummary` |
| 流水记录 `pages/records` | `onShow` / 筛选 / 搜索 | `await store.years()`、`await store.listRecords({...})`、`await store.listCategories()` |
| 流水记录 · 保存 | 点「保存记录 / 保存修改」 | `await store.createRecord()` 或 `await store.updateRecord()` |
| 流水记录 · 批量导入 | 粘贴文本 →「确认导入」 | 本地解析（`toDateString/toType/toAmountCents`）→ `await store.importRecords(items)` |
| 流水记录 · 导出 CSV | 点「导出 CSV」 | 本地 `store.toCsv(records)` → `wx.setClipboardData` |
| 操作日志 `pages/logs` | 进入页面 / 切换筛选 / 加载更多 | `await store.logStats()`、`await store.listLogs({ filterAction, limit, offset })`、`await store.clearLogs(30)` |
| 分类统计 `pages/category` | `onShow` / 切换维度 / 切换年月 | `await store.categorySummary(year, month, type)` |

典型读写流程：

```
点击保存
  → store.createRecord(payload)
    → wx.cloud.callFunction({ name:'bookkeeping', data:{ action:'createRecord', record, client } })
      → 云函数：校验 → 写入 records（带 _openid）→ 更新分类字典 → 写入 logs（action=create）
        → 返回 { ok:true, data:{ id, record } }
          → 页面 toast + 重新 listRecords 刷新列表
```

## 五、与 Web 版 REST 接口的对照

小程序云函数的 action 与 Web 版 REST 接口语义一致，方便两套实现互相对照：

| 小程序（云函数 action） | Web 版 REST 接口 |
| --- | --- |
| `listRecords` | `GET /api/records?year=&month=&day=&type=&category=&keyword=` |
| `createRecord` | `POST /api/records` |
| `updateRecord` | `PUT /api/records/:id` |
| `deleteRecord` | `DELETE /api/records/:id` |
| `importRecords` | `POST /api/import` |
| `overview` / `monthlySummary` / `dailySummary` / `categorySummary` | `GET /api/summary/overview` / `monthly` / `daily` / `category` |
| `getCategories` / `addCategory` | `GET /api/categories` / `POST /api/categories` |
| `years` | `GET /api/meta/years` |
| `listLogs` / `logStats` / `clearLogs` | （Web 版无日志能力，本地 SQLite 版仅在服务端打错误日志） |

若要把小程序改成调用 Web 版的 Node 服务，只需把 `utils/store.js` 的 `call()` 换成 `wx.request` 封装（方法签名不变），同时需要 HTTPS 域名与备案。

## 六、本地存储版与切换

- 原本地存储实现保留在 `utils/store.local.js`（接口同名，但**全是同步方法**）。
- 完全离线（不依赖云环境）时：用 `store.local.js` 覆盖 `store.js`，并把页面中的 `await store.xxx()` 改回同步调用。
- 两者数据不互通；从本地版迁到云版需要写一次导入（可先用本地版导出 CSV，再到云版「批量导入」粘贴导入）。

## 七、常见问题

| 问题 | 说明 |
| --- | --- |
| 换手机数据还在吗 | 在。数据存在云数据库，同一微信账号自动同步 |
| 换微信账号数据看不到 | 正常。数据按 openid 隔离，不同账号互不可见 |
| 日志会不会一直涨 | 会。可在「操作日志」页清理 30 天前的日志；导入量大时可把 `detailLog` 设为 `false`（见 cloud-database.md 第四节） |
| 能不能看到别人改了我的数据 | 不能。所有写操作都带 `_openid` 校验，且只有本人日志对自己可见 |
| 云函数报「记录不存在或无权操作」 | 记录不属于当前用户，或已被删除 |
| 统计结果与列表条数不一致 | 列表默认最多返回 500 条（`limit`），统计走聚合不受此限制；数据量大时可调大 `limit` 或加分页 |
