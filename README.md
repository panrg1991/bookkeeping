# 财务记账统计软件

纯 JavaScript（Node.js 原生 HTTP 服务 + 原生前端）实现的财务记账统计工具，数据存储在 SQLite，界面类似 Excel 财务报表。

## 功能

- **收入 / 支出 / 利润**统计：自动计算本期利润、利润率、累计利润
- **按年查看**：12 个月的收入、支出、利润、累计利润、笔数、利润率，并附柱状图
- **按月查看**：当月每一天的支出 / 收入 / 净额，点击任意日期可展开当天多笔流水并直接修改或删除
- **多笔明细**：同一天可记录任意多笔收支
- **录入与维护**：表单录入（日期 / 类型 / 金额 / 分类 / 备注），支持修改、删除、分类自动补全
- **单价 × 数量计价**：录入时可切换到「单价 × 数量」模式，金额由两者自动计算（以「分」为单位四舍五入，即金额保留两位小数）；列表、明细与 CSV 导出会一并显示单价与数量
- **每月支出预警额度**：可为每个月单独设置支出额度（点击月度明细表中的「预警额度」单元格），支出超过额度显示红色背景、达到额度 95% 显示黄色背景；未设置的月份自动沿用最近一次设置的额度（可跨月、跨年）
- **分类统计**：按支出或收入维度查看各分类金额与占比
- **CSV 导出**：月度总览、每日明细、流水记录均可导出为 CSV（Excel 可直接打开）

> **微信小程序版**：功能一致的实现位于 [`wechat-miniprogram/`](wechat-miniprogram/README.md)。小程序端支持两种数据模式，**当前为本地存储模式**（数据存手机本地、无需云开发、导入项目即可运行），同时完整保留**微信云开发数据库模式**（数据按 openid 隔离、多端同步、云端操作日志）—— 改 `utils/config.js` 的 `mode` 一个字段即可切换，页面代码无需改动；两种模式都会为每笔数据操作留存操作日志。配置与模式切换见 [docs/deploy-checklist.md](wechat-miniprogram/docs/deploy-checklist.md)，存储与接口见 [docs/data-and-api.md](wechat-miniprogram/docs/data-and-api.md)，换手机迁移见 [docs/data-migration.md](wechat-miniprogram/docs/data-migration.md)，云模式部署见 [docs/cloud-database.md](wechat-miniprogram/docs/cloud-database.md)，发布流程见 [docs/release.md](wechat-miniprogram/docs/release.md)。

## 运行

要求 Node.js >= 22.5（使用内置的 `node:sqlite`，运行时无需安装任何依赖）。

> `devDependencies` 中的 `xlsx` 仅用于更新 `public/vendor/xlsx.full.min.js`（前端导入 Excel 用的 SheetJS 浏览器版，已随仓库提交），日常运行不需要执行 `npm install`。

```bash
npm start
# 或
node --no-warnings server.js
```

启动后访问 http://127.0.0.1:5173

环境变量：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | 服务端口 | `5173` |
| `HOST` | 监听地址 | `127.0.0.1` |
| `DB_PATH` | SQLite 文件路径 | `./data/bookkeeping.db` |

## 目录结构

```
server.js            HTTP 服务 + REST API（零第三方依赖）
db.js                SQLite 数据层：建表、CRUD、统计查询
public/index.html    页面结构
public/styles.css    Excel 报表风格样式
public/app.js        前端逻辑：渲染、图表、表单、导出
public/vendor/xlsx.full.min.js  导入 Excel 用的 SheetJS 浏览器版（已入库）
data/bookkeeping.db  数据库文件（首次运行自动生成）
```

## 数据结构

表 `records`（金额以「分」为单位的整数存储，避免浮点误差）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER | 主键 |
| date | TEXT | 日期 `YYYY-MM-DD` |
| type | TEXT | `income` 收入 / `expense` 支出 |
| amount_cents | INTEGER | 金额（分） |
| unit_price_cents | INTEGER | 单价（分），`0` 表示该记录不使用「单价 × 数量」计价 |
| quantity | REAL | 数量（可为小数），`0` 表示不使用；与单价同时 > 0 时，金额由 `round(单价 × 数量)` 计算 |
| category | TEXT | 分类 |
| note | TEXT | 备注 |
| created_at / updated_at | TEXT | 时间戳 |

表 `budgets`：每月支出预警额度（`month` 为主键，形如 `2026-10`；`amount_cents` 为该月额度）。未设置的月份自动沿用最近一次设置的额度，可跨月跨年。

表 `categories`：分类字典（收入 / 支出各一套）。

> 下拉框（分类输入框）里显示的分类 = **默认分类 ∪ 字典表 ∪ 记录中实际使用过的分类**。
> 保存记录时**不再**自动把新分类写进字典表 —— 旧实现会这么做，导致录错一次就永久留在下拉框里；
> 现在只要某分类还有记录在用它就会显示，把记录改成别的分类或删掉记录后，它会自动从下拉框消失。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/records?year=&month=&day=&type=&category=&keyword=&limit=&offset=` | 记录列表（`month=all` 表示全年） |
| POST | `/api/records` | 新增记录 `{date, type, amount, category, note}`；也可用 `{unitPrice, quantity}` 替代 `amount`（两者同时 > 0 时金额由它们计算） |
| PUT | `/api/records/:id` | 修改记录（支持部分字段；改单价或数量会自动重算金额） |
| DELETE | `/api/records/:id` | 删除记录 |
| GET | `/api/summary/overview?year=&month=` | 本期与全年汇总（收入 / 支出 / 利润 / 笔数） |
| GET | `/api/summary/monthly?year=` | 12 个月统计（含每月预警额度 `budget` / 本月设置值 `budgetValue` / 沿用来源 `budgetFrom` / 预警状态 `alert`：`over` 超额度、`near` 达 95%、`none`） |
| GET | `/api/budgets?year=` | 某年各月支出预警额度（含沿用来源） |
| PUT | `/api/budgets` | 设置某月额度 `{ month: '2026-10', amount }`（`amount` 为「元」，传 0 表示清除该月设置） |
| GET | `/api/summary/daily?year=&month=` | 每日统计 |
| GET | `/api/summary/category?year=&month=&type=` | 分类统计 |
| GET | `/api/categories` | 分类字典 |
| GET | `/api/meta/years` | 已有数据的年份列表 |
