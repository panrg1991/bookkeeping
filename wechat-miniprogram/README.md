# 财务记账统计 · 微信小程序版

与仓库根目录的 Web 版功能一致的微信小程序实现：收入 / 支出 / 利润统计，按年、按月、按日查看明细，支持修改与删除，含分类统计、批量导入、CSV 导出，以及**每笔数据操作的操作日志**。

> **当前数据模式：本地存储（`mode: 'local'`）** —— 数据存在手机本地，**不需要云开发、不需要网络、不需要真实 AppID**，用游客模式打开即可跑。
> 云开发数据库实现已完整保留（`cloudfunctions/` + `utils/store.cloud.js`），改一个字段即可切回，见 [两种模式](#两种数据模式)。

## 运行与部署

1. 微信开发者工具 → 导入项目 → 目录选本文件夹 `wechat-miniprogram`
2. AppID 填自己的（仅本地预览用「测试号」或游客模式也可以）
3. 编译运行 —— 完成，没有任何服务器 / 云环境配置

> 发布上线时才需要一个真实 AppID。逐项清单见 **[docs/deploy-checklist.md](docs/deploy-checklist.md)**。

## 两种数据模式

| 项目 | 本地存储（当前默认） | 云开发数据库 |
| --- | --- | --- |
| 开关 | `utils/config.js` → `mode: 'local'` | `utils/config.js` → `mode: 'cloud'` |
| 实现文件 | `utils/store.local.js` | `utils/store.cloud.js` + `cloudfunctions/bookkeeping` |
| 数据位置 | 手机本地存储（`bk:records` 等） | 微信云开发数据库（`records`/`logs`/`settings`） |
| 多端同步 | ❌ 仅本机 | ✅ 同一微信账号自动同步 |
| 数据隔离 | 按设备 + 微信账号 | 按 openid（由云函数自动识别） |
| 需要云环境 | ❌ 不需要 | ✅ 需开通环境 + 部署云函数 + 创建集合并配权限 |
| 操作日志 | 本地保存，滚动保留最近 500 条 | 云端 `logs` 集合，无条数上限 |
| 容量 | 本地存储上限约 10MB | 云开发配额（远大于本地） |

切换方式：改 `utils/config.js` 的 `mode` 一个字段即可，**页面代码完全不用动**（见 [docs/deploy-checklist.md](docs/deploy-checklist.md) 第四节）。

> 两种模式的数据互不相通：从本地切到云端后是空数据，可先在本地模式「导出 CSV」，切云模式后用「批量导入」粘贴导入。

## 功能对照

| 功能 | 说明 |
| --- | --- |
| 月度总览 | 4 张指标卡（本期收入 / 支出 / 利润、年累计利润）+ 12 个月明细表（收入、支出、**预警额度**、利润、累计利润、笔数，可左右滑动）；**每月可单独设置支出预警额度**，支出超额度显示红色背景、达到额度 95% 显示黄色背景，未设置的月份自动沿用最近一次设置的额度（可跨年） |
| 每日明细 | 按年 / 月（含全年）查看每天支出、收入、净额；点击任意一天展开当天全部流水，可直接「改」「删」 |
| 流水记录 | 日期 / 类型 / 金额 / 分类（快捷标签）/ 备注录入；**可切换「单价 × 数量」自动计算金额（保留两位小数）**；修改、删除；**批量管理（多选 / 全选 / 批量删除）**；类型筛选；分类备注搜索；批量导入；导出 CSV |
| 分类统计 | 支出 / 收入两个维度，各分类金额、占比与条形图 |
| 组合计算（在「分类统计」页内） | 输入 2~8 个数，可**同时多选**组合方式（2 个 / 3 个 / 4 个……），结果只输出**一个总数**：各组合方式的乘积之和再相加（如 `2,3,2` 选 2 个 → 2×3 + 2×2 + 3×2 = **16**）；数值按输入位置区分，重复数字算不同的数 |
| **操作日志** | 新增 / 修改 / 删除 / 导入全部留痕：操作时间、变更前后数据、变更字段、失败原因、客户端版本与机型；支持按类型筛选、分页、清理旧日志 |
| 数据导出 | 「导出 CSV」把当前筛选结果写入剪贴板，粘贴到 Excel 即可 |
| **备份 / 恢复** | 一键把全部记录（含分类字典）复制为 JSON 文本；换手机时粘贴即可「覆盖恢复」或「合并恢复」 |

> **颜色约定（小程序）**：**收入 = 红，支出 = 绿**；利润为负时显示红色。Web 版仍为收入绿、支出红，两端口径不同，如需统一请告知。

## 目录结构

```
app.js / app.json / app.wxss     小程序入口、四个 tabBar 页面配置、全局样式
custom-tab-bar/                  自定义底部导航（顶部边框与内容区隔开、导航项之间竖线分隔）
utils/config.js                  模式开关（mode: local / cloud）、云环境 ID、云函数名
utils/store.js                   数据层门面：按 mode 选择实现，统一对外 Promise 接口
utils/store.local.js             本地存储实现（当前启用）
utils/store.cloud.js             云开发实现（调用云函数，切回云模式时使用）
utils/format.js                  金额（分 -> 元，带千分位）、日期、CSV、粘贴解析等纯工具
utils/budget.js                  每月支出预警额度：纯计算逻辑（与 Node 后端、云函数保持同一份规则）
utils/combine.js                 组合计算工具（从若干个数中任选 k 个，求组合乘积之和）
pages/monthly/                   月度总览
pages/daily/                     每日明细
pages/records/                   流水记录（录入 / 修改 / 删除 / 导入 / 导出）
pages/category/                  分类统计
pages/logs/                      操作日志（排查用）
cloudfunctions/bookkeeping/      统一业务云函数（云模式使用，本地模式不加载）
docs/deploy-checklist.md         部署配置清单（改哪些配置、模式切换、报错对照）
docs/data-migration.md           数据存放位置与换手机迁移（备份/恢复、云模式同步）
docs/data-and-api.md             数据存储与接口调用说明
docs/cloud-database.md           云数据库设计与部署（集合、权限、索引、日志）
docs/release.md                  发布上线指引（AppID、审核、发布步骤）
project.config.json              微信开发者工具工程配置
```

## 数据存储与接口调用

### 统一入口

页面只认 `utils/store.js`，它根据 `utils/config.mode` 加载具体实现，并把两种实现统一包装成 **Promise**：

```
页面 → utils/store.js（门面，全部 async）
        ├─ mode = 'local' → utils/store.local.js → wx.setStorageSync / getStorageSync
        └─ mode = 'cloud' → utils/store.cloud.js → wx.cloud.callFunction('bookkeeping') → 云数据库
```

因此页面里 `await store.listRecords(...)` 在两种模式下写法完全一致，切换模式无需改动页面。工具函数（`toCsv` / `toDateString` / `toType` / `toAmountCents`）保持同步。

### 本地模式的存储键

| 键 | 内容 |
| --- | --- |
| `bk:records` | 记账数据（`id`、`date`、`type`、`amountCents`（分）、`unitPriceCents`（分）、`quantity`、`category`、`note`、时间戳） |
| `bk:categories` | 分类字典 |
| `bk:seq` | 记录自增 ID |
| `bk:logs` | 操作日志（滚动保留最近 500 条，`MAX_LOGS` 可调） |

> 这些数据存在**微信客户端内部的 Storage**（不是可以拷贝的文件，开发者工具 → 调试器 → Storage 面板可查看）。
> 换手机迁移见 **[docs/data-migration.md](docs/data-migration.md)**：推荐切云模式自动同步，或用「备份/恢复」把 JSON 文本搬过去。

> 分类输入框（下拉提示）里显示的分类 = **默认分类 + 字典 + 记录中实际使用过的分类**。
> 保存记录时不会自动往字典里塞新分类，所以录错的分类只要把记录改掉就会自动消失，不会长期残留。

### 数据层方法（两种模式同名同返回结构）

| 方法 | 说明 |
| --- | --- |
| `init()` / `initDb()` | 初始化（本地：建键；云端：ping / 建集合） |
| `whoami()` | 当前身份（本地：`本地模式`；云端：脱敏 openid + 环境 ID） |
| `listRecords(options)` | 返回 `{ total, items }`，支持 `year / month / day / type / category / keyword / limit / offset` |
| `getRecord` / `createRecord` / `updateRecord` / `deleteRecord` | 单条增删改查，云端版本会写入操作日志 |
| `importRecords(items, options)` | 批量导入，返回 `{ inserted, skipped, errors, batchId }` |
| `overview` / `monthlySummary` / `dailySummary` / `categorySummary` / `years` | 各类统计（云端由聚合完成） |
| `listCategories` / `addCategory` | 分类字典 |
| `listLogs` / `logStats` / `clearLogs` | 操作日志查询、汇总与清理 |
| `exportAll` / `importAll` | 全量备份（记录 + 分类字典）与恢复（`replace` 覆盖 / `merge` 合并） |
| `toCsv` / `toDateString` / `toType` / `toAmountCents` | 纯本地工具（同步） |

详细的调用关系、字段结构与云端对照见 **[docs/data-and-api.md](docs/data-and-api.md)**。

### 关于 openid

- 本地模式不涉及用户体系，**不存在 openid 配置**
- 云模式的 openid 由云函数 `cloud.getWXContext().OPENID` 自动获取并写入数据，**同样不需要配置**，也不需要 AppSecret

## 批量导入格式

小程序端不解析 `.xlsx`，改为「粘贴」方式：在 Excel 选中数据区域 `Ctrl+C`，粘贴到导入框即可（逐条校验，非法行会被跳过并记入日志）。

| 日期 | 类型 | 金额 | 分类 | 备注 | 单价 | 数量 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-24 | 支出 | 35.5 | 餐饮 | 午餐 | | |
| 2026-09-24 | 收入 | 12000 | 工资 | 9月工资 | | |
| 2026-09-25 | 支出 | | 水果 | 按单价 × 数量计价，金额可留空 | 3.5 | 2.5 |

- 列顺序：日期、类型、金额、分类、备注（可选：单价、数量）；分隔符支持 Tab（Excel 复制）或逗号（CSV）
- 首行若是表头会自动跳过；分类、备注可留空
- **单价与数量同时填写时，金额由两者自动计算（金额列可留空）**，结果为「分」为单位的四舍五入值，即保留两位小数
- 类型兼容「支出 / 收入」与 `expense / income`；日期兼容 `2026-09-24`、`2026/9/24`、`20260924`

## 发布上线

> 完整流程、自检清单与常见驳回原因见 **[docs/release.md](docs/release.md)**

**只提供 AppID 和 key 并不能直接发布。** 发布必须由该小程序的管理员用微信登录后台与开发者工具完成：上传代码 → 提交审核 → 审核通过后发布。

当前本地模式下，发布前的必做项只有：

1. 注册小程序、完成主体认证，填写名称 / 头像 / 简介 / 服务类目（建议「工具 → 效率」这类无需资质的类目）
2. 把 `project.config.json` 的 AppID 换成真实 AppID（游客模式无法上传）
3. 开发者工具「上传」→ 后台「版本管理 → 提交审核 → 发布」

需要注意的审核风险：

- 首次进入没有任何数据，审核员可能认为"功能不完整"，请在审核备注里写清体验路径（release.md 提供模板）
- 隐私声明：本地模式说明"数据仅保存在手机本地，不上传、不共享"；若切为云模式，改为"数据存储于微信云开发数据库，仅本人可见"

## 与 Web 版的差异

| 项目 | Web 版 | 小程序版 |
| --- | --- | --- |
| 存储 | 本地 SQLite 文件（服务端） | 本地模式：手机本地存储；云模式：微信云开发数据库 |
| 服务 | Node.js HTTP 服务 + REST API | 无服务端；云模式使用云函数 `bookkeeping` |
| 日志 | 服务端仅打印错误日志 | 本地 / 云端均完整留痕，小程序内可查 |
| 导入 | 上传 `.xlsx / .xls / .csv` 文件 | 粘贴 Excel 内容（Tab / 逗号分隔） |
| 导出 | 下载 CSV 文件 | 复制 CSV 到剪贴板 |
| 图表 | 月度总览含 SVG 柱状趋势图 | 无图表（指标卡 + 明细表，更省包体与渲染开销） |
