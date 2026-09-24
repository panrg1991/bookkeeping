# 财务记账统计软件

纯 JavaScript（Node.js 原生 HTTP 服务 + 原生前端）实现的财务记账统计工具，数据存储在 SQLite，界面类似 Excel 财务报表。

## 功能

- **收入 / 支出 / 利润**统计：自动计算本期利润、利润率、累计利润
- **按年查看**：12 个月的收入、支出、利润、累计利润、笔数、利润率，并附柱状图
- **按月查看**：当月每一天的支出 / 收入 / 净额，点击任意日期可展开当天多笔流水并直接修改或删除
- **多笔明细**：同一天可记录任意多笔收支
- **录入与维护**：表单录入（日期 / 类型 / 金额 / 分类 / 备注），支持修改、删除、分类自动补全
- **分类统计**：按支出或收入维度查看各分类金额与占比
- **CSV 导出**：月度总览、每日明细、流水记录均可导出为 CSV（Excel 可直接打开）

## 运行

要求 Node.js >= 22.5（使用内置的 `node:sqlite`，无需安装任何依赖）。

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
| category | TEXT | 分类 |
| note | TEXT | 备注 |
| created_at / updated_at | TEXT | 时间戳 |

表 `categories`：分类字典（收入 / 支出各一套，录入新分类时自动入库）。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/records?year=&month=&day=&type=&category=&keyword=&limit=&offset=` | 记录列表（`month=all` 表示全年） |
| POST | `/api/records` | 新增记录 `{date, type, amount, category, note}` |
| PUT | `/api/records/:id` | 修改记录（支持部分字段） |
| DELETE | `/api/records/:id` | 删除记录 |
| GET | `/api/summary/overview?year=&month=` | 本期与全年汇总（收入 / 支出 / 利润 / 笔数） |
| GET | `/api/summary/monthly?year=` | 12 个月统计 |
| GET | `/api/summary/daily?year=&month=` | 每日统计 |
| GET | `/api/summary/category?year=&month=&type=` | 分类统计 |
| GET | `/api/categories` | 分类字典 |
| GET | `/api/meta/years` | 已有数据的年份列表 |
