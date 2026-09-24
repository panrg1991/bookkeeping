# 财务记账统计 · 微信小程序版

与仓库根目录的 Web 版功能完全一致的微信小程序实现：收入 / 支出 / 利润统计，按年、按月、按日查看明细，支持修改与删除，含分类统计、批量导入、CSV 导出。

## 运行

1. 打开「微信开发者工具」→ 导入项目
2. 目录选择本文件夹 `wechat-miniprogram`
3. AppID 选择「测试号」或填入自己的 AppID（`project.config.json` 中默认 `touristappid` 可直接本地预览）
4. 编译即可运行，无需安装任何依赖、无需配置服务器

## 功能对照

| 功能 | 说明 |
| --- | --- |
| 月度总览 | 4 张指标卡（本期收入 / 支出 / 利润、年累计利润）+ 12 个月柱状趋势图 + 12 个月明细表（收入、支出、利润、累计利润、笔数，可左右滑动），与 Web 版一致 |
| 每日明细 | 按年 / 月（含全年）查看每天支出、收入、净额；点击任意一天展开当天全部流水，可直接「改」「删」 |
| 流水记录 | 日期 / 类型 / 金额 / 分类（带快捷标签）/ 备注录入；修改、删除；类型筛选；分类备注搜索；批量导入；导出 CSV |
| 分类统计 | 支出 / 收入两个维度，各分类金额、占比与条形图 |
| 数据导出 | 「导出 CSV」把当前筛选结果写入剪贴板，粘贴到 Excel 即可 |

## 目录结构

```
app.js / app.json / app.wxss     小程序入口、四个 tabBar 页面配置、全局样式
utils/format.js                  金额（分 -> 元，带千分位）、日期、百分比等格式化
utils/store.js                   数据层：本地存储持久化 + CRUD + 全部统计
pages/monthly/                   月度总览
pages/daily/                     每日明细
pages/records/                   流水记录（录入 / 修改 / 删除 / 导入 / 导出）
pages/category/                  分类统计
project.config.json              微信开发者工具工程配置
```

## 数据结构

使用小程序本地存储（`wx.setStorageSync`），金额以「分」为单位的整数存储以避免浮点误差：

```js
{
  id: 1,
  date: '2026-09-24',
  type: 'income' | 'expense',
  amountCents: 3550,        // 35.50 元
  category: '餐饮',
  note: '午餐',
  createdAt: 1758691200000,
  updatedAt: 1758691200000
}
```

存储键：`bk:records`（记录）、`bk:categories`（分类字典）、`bk:seq`（自增 ID）。

数据层 `utils/store.js` 的接口与 Web 版 `db.js` 一一对应：`listRecords` / `getRecord` / `createRecord` / `updateRecord` / `deleteRecord` / `importRecords` / `overview` / `monthlySummary` / `dailySummary` / `categorySummary` / `years` / `listCategories`。

## 批量导入格式

小程序端不支持直接解析 `.xlsx`，导入改为「粘贴」方式，在 Excel 中选中数据区域 `Ctrl+C` 后粘贴到导入框即可：

| 日期 | 类型 | 金额 | 分类 | 备注 |
| --- | --- | --- | --- | --- |
| 2026-09-24 | 支出 | 35.5 | 餐饮 | 午餐 |
| 2026-09-24 | 收入 | 12000 | 工资 | 9月工资 |

- 列顺序：日期、类型、金额、分类、备注；分隔符支持 Tab（Excel 复制）或逗号（CSV）
- 首行若是表头会自动跳过；分类、备注可留空
- 类型兼容「支出 / 收入」与 `expense / income`；日期兼容 `2026-09-24`、`2026/9/24`、`20260924`

## 与 Web 版的差异

| 项目 | Web 版 | 小程序版 |
| --- | --- | --- |
| 存储 | SQLite 数据库文件 | 小程序本地存储（`wx.setStorageSync`） |
| 服务 | Node.js HTTP 服务 + REST API | 无服务端，逻辑全部在本地运行 |
| 导入 | 上传 `.xlsx / .xls / .csv` 文件 | 粘贴 Excel 内容（Tab / 逗号分隔） |
| 导出 | 下载 CSV 文件 | 复制 CSV 到剪贴板 |
| 图表 | SVG 柱状图 | WXML + WXSS 柱状图 |

> 需要多端同步数据时，可把 `utils/store.js` 的实现替换为「微信云开发数据库」或调用 Web 版的 REST API，页面层无需改动。
