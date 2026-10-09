# 财务记账统计 · 微信小程序版

与仓库根目录的 Web 版功能一致的微信小程序实现：收入 / 支出 / 利润统计，按年、按月、按日查看明细，支持修改与删除，含分类统计、批量导入、CSV 导出。

数据存**微信云开发数据库**：按微信用户（openid）自动关联、多端同步；**每笔数据操作都写入操作日志**，可在小程序内直接查看，便于后续排查。

## 运行

> 云开发需要**真实 AppID**（游客模式 `touristappid` 与测试号不支持云开发）。

1. 微信开发者工具 → 导入项目 → 目录选择本文件夹 `wechat-miniprogram`
2. 填入自己的 AppID
3. 开发者工具顶部「云开发」→ 开通环境 → 复制**环境 ID**
4. 把环境 ID 填到 `utils/config.js` 的 `envId`
5. `cloudfunctions/bookkeeping` 右键 → **上传并部署：云端安装依赖**
6. 执行一次 `initDb` 创建集合（云开发控制台 → 云函数 → 云端测试 → `{ "action": "initDb" }`）
7. 三个集合的安全规则设为「所有用户不可读写」（读写全部收口在云函数）
8. 编译运行

详细步骤、索引与权限配置见 **[docs/cloud-database.md](docs/cloud-database.md)**。

## 功能对照

| 功能 | 说明 |
| --- | --- |
| 月度总览 | 4 张指标卡（本期收入 / 支出 / 利润、年累计利润）+ 12 个月柱状趋势图 + 12 个月明细表（收入、支出、利润、累计利润、笔数，可左右滑动） |
| 每日明细 | 按年 / 月（含全年）查看每天支出、收入、净额；点击任意一天按需拉取并展开当天全部流水，可直接「改」「删」 |
| 流水记录 | 日期 / 类型 / 金额 / 分类（快捷标签）/ 备注录入；修改、删除；类型筛选；分类备注搜索；批量导入；导出 CSV |
| 分类统计 | 支出 / 收入两个维度，各分类金额、占比与条形图 |
| **操作日志** | 新增 / 修改 / 删除 / 导入全部留痕：操作时间、变更前后数据、变更字段、失败原因、客户端版本与机型；支持按类型筛选、分页、清理旧日志 |
| 数据导出 | 「导出 CSV」把当前筛选结果写入剪贴板，粘贴到 Excel 即可 |

## 目录结构

```
app.js / app.json / app.wxss     小程序入口、四个 tabBar 页面配置、全局样式
utils/config.js                  云环境 ID、云函数名、集合名配置
utils/store.js                   数据层：调用云函数（异步），页面唯一数据出入口
utils/store.local.js             原本地存储实现（离线备用，接口同名但为同步）
utils/format.js                  金额（分 -> 元，带千分位）、日期、CSV、粘贴解析等纯工具
pages/monthly/                   月度总览
pages/daily/                     每日明细
pages/records/                   流水记录（录入 / 修改 / 删除 / 导入 / 导出）
pages/category/                  分类统计
pages/logs/                      操作日志（排查用）
cloudfunctions/bookkeeping/      统一业务云函数：数据隔离 + 统计聚合 + 操作日志
docs/data-and-api.md             数据存储与接口调用说明
docs/cloud-database.md           云数据库设计与部署（集合、权限、索引、日志）
docs/release.md                  发布上线指引（AppID、审核、发布步骤）
project.config.json              微信开发者工具工程配置（含云函数目录）
```

## 数据存储与接口调用

> 详细说明见 **[docs/data-and-api.md](docs/data-and-api.md)**，建库与部署见 **[docs/cloud-database.md](docs/cloud-database.md)**

**数据库：微信云开发数据库**（三个集合，文档均带 `_openid`）

| 集合 | 内容 |
| --- | --- |
| `records` | 记账数据：`_openid`、`date`、`type`、`amountCents`（分）、`category`、`note`、时间戳、导入批次 |
| `logs` | 操作日志：`action`、`recordId`、`before`/`after`、`changed`、`summary`、`errors`、`client`、时间 |
| `settings` | 每个用户的分类字典 |

**接口调用：云函数 `bookkeeping`**（页面不直连数据库）

```
页面 → utils/store.js（异步方法） → wx.cloud.callFunction('bookkeeping', { action, ... })
     → 云函数：取 OPENID → 按 _openid 隔离读写 → 云端聚合统计 → 写操作日志 → 返回 { ok, data }
```

| 数据层方法（`utils/store.js`） | 对应的 Web 版 REST 接口 |
| --- | --- |
| `listRecords` / `getRecord` | `GET /api/records` |
| `createRecord` / `updateRecord` / `deleteRecord` | `POST /api/records`、`PUT /api/records/:id`、`DELETE /api/records/:id` |
| `importRecords` | `POST /api/import` |
| `overview` / `monthlySummary` / `dailySummary` / `categorySummary` | `GET /api/summary/*` |
| `listCategories` / `addCategory` | `GET/POST /api/categories` |
| `years` | `GET /api/meta/years` |
| `listLogs` / `logStats` / `clearLogs` | Web 版无对应能力（日志为小程序端新增） |

因为不发起普通 HTTP 请求，**无需配置服务器合法域名与备案**。

### 数据按用户关联

- 云函数只信任 `cloud.getWXContext().OPENID`，**前端传入的 openid 一律忽略**，无法伪造
- 所有查询强制拼接 `_openid` 条件；修改 / 删除前先按 `{ _id, _openid }` 校验归属
- 已用 mock 云数据库验证过越权场景：其他用户查询为 0 条、按 id 读取返回 `null`、修改删除均报「记录不存在或无权操作」

### 操作日志

每次新增 / 修改 / 删除 / 导入都会写一条日志，失败也留痕（`xxxFailed`），记录变更前后数据、变更字段与客户端信息。「流水记录」页右上角 →「操作日志」即可查看，也可在云开发控制台 `logs` 集合查看。读操作默认不记日志（`LOG_READS` 开关），导入逐条日志可用 `detailLog: false` 关闭以节省配额。

## 批量导入格式

小程序端不解析 `.xlsx`，改为「粘贴」方式：在 Excel 选中数据区域 `Ctrl+C`，粘贴到导入框即可（逐条校验，非法行会被跳过并写入日志）。

| 日期 | 类型 | 金额 | 分类 | 备注 |
| --- | --- | --- | --- | --- |
| 2026-09-24 | 支出 | 35.5 | 餐饮 | 午餐 |
| 2026-09-24 | 收入 | 12000 | 工资 | 9月工资 |

- 列顺序：日期、类型、金额、分类、备注；分隔符支持 Tab（Excel 复制）或逗号（CSV）
- 首行若是表头会自动跳过；分类、备注可留空
- 类型兼容「支出 / 收入」与 `expense / income`；日期兼容 `2026-09-24`、`2026/9/24`、`20260924`

## 发布上线

> 完整流程、自检清单与常见驳回原因见 **[docs/release.md](docs/release.md)**

**只提供 AppID 和 key 并不能直接发布。** 发布必须由该小程序的管理员用微信登录后台与开发者工具完成：上传代码 → 提交审核 → 审核通过后发布。AppSecret 只有自建服务端才需要，本小程序不使用（**绝不能写进前端代码**）。

发布前必做：

1. 注册小程序、完成主体认证，填写名称 / 头像 / 简介 / 服务类目（建议「工具 → 效率」这类无需资质的类目）
2. 把 `project.config.json` 的 AppID 换成真实 AppID（游客模式无法使用云开发，也无法上传）
3. **开通云开发并部署云函数**、创建集合（现在数据依赖云环境，这一步是发布前的硬性前提）
4. 开发者工具「上传」→ 后台「版本管理 → 提交审核 → 发布」

需要注意的审核风险：

- 首次进入没有任何数据，审核员可能认为"功能不完整"，请在审核备注里写清体验路径（release.md 提供模板）
- 数据存放在微信云开发数据库，后台填写《用户隐私保护指引》时应如实说明"数据存储于微信云开发，仅本人可见，不向第三方共享"

## 与 Web 版的差异

| 项目 | Web 版 | 小程序版 |
| --- | --- | --- |
| 存储 | 本地 SQLite 文件 | 微信云开发数据库（按 openid 隔离、多端同步） |
| 服务 | Node.js HTTP 服务 + REST API | 云函数 `bookkeeping`（无需自建服务器与备案） |
| 日志 | 服务端仅打印错误日志 | `logs` 集合完整留痕，小程序内可查 |
| 导入 | 上传 `.xlsx / .xls / .csv` 文件 | 粘贴 Excel 内容（Tab / 逗号分隔） |
| 导出 | 下载 CSV 文件 | 复制 CSV 到剪贴板 |
| 图表 | SVG 柱状图 | WXML + WXSS 柱状图 |
