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
utils/store.js                   数据层：本地存储持久化 + CRUD + 全部统计（唯一数据出入口）
pages/monthly/                   月度总览
pages/daily/                     每日明细
pages/records/                   流水记录（录入 / 修改 / 删除 / 导入 / 导出）
pages/category/                  分类统计
docs/data-and-api.md             数据存储与接口调用说明（详细）
docs/release.md                  发布上线指引（AppID/密钥、审核、发布步骤）
project.config.json              微信开发者工具工程配置
```

## 数据存储与接口调用

> 完整说明（含容量限制、页面调用关系、接后端/云开发的改造方案）见 **[docs/data-and-api.md](docs/data-and-api.md)**

### 数据库：小程序本地存储

小程序端没有 Node 环境，**不使用 SQLite**，改用微信提供的本地存储（`wx.setStorageSync` / `wx.getStorageSync`）做键值持久化。金额与 Web 版一致，以「分」为单位的整数存取，避免浮点误差。

| 存储键 | 内容 |
| --- | --- |
| `bk:records` | 全部流水记录（主数据） |
| `bk:categories` | 分类字典 `{ income: [], expense: [] }` |
| `bk:seq` | 记录自增 ID 序列 |

```js
// bk:records 数组元素
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

限制：单个 key 上限 **1MB**、整体 **10MB**；单条记录约 150 字节，`bk:records` 大约可存 **6000 条左右**。超出建议迁移到云开发数据库或按年拆分存储键。数据仅存于本机，**换设备不同步**，清缓存会丢失，建议定期用「导出 CSV」留档。

### 接口调用：本地函数调用，不发起任何网络请求

小程序里没有 HTTP 接口，页面调用的是 `utils/store.js` 暴露的**同步方法**，方法内部完成校验、读写本地存储与统计计算：

```
Page.onShow
  → store.listRecords / overview / monthlySummary …     // 本地函数调用
    → readRecords()（首次 wx.getStorageSync，之后命中内存缓存）
      → filter / reduce 计算                            // 等同 SQL 的 WHERE + GROUP BY
        → setData(...) 渲染
```

| 数据层方法（`utils/store.js`） | 对应的 Web 版 REST 接口 |
| --- | --- |
| `listRecords({ year, month, day, type, category, keyword })` | `GET /api/records?year=&month=&day=&type=&category=&keyword=` |
| `createRecord(input)` | `POST /api/records` |
| `updateRecord(id, input)` | `PUT /api/records/:id` |
| `deleteRecord(id)` | `DELETE /api/records/:id` |
| `importRecords(items)` | `POST /api/import` |
| `overview(year, month)` | `GET /api/summary/overview` |
| `monthlySummary(year)` | `GET /api/summary/monthly` |
| `dailySummary(year, month)` | `GET /api/summary/daily` |
| `categorySummary(year, month, type)` | `GET /api/summary/category` |
| `listCategories()` / `addCategory()` | `GET /api/categories` / `POST /api/categories` |
| `years()` | `GET /api/meta/years` |

因为不发请求，所以**无需配置服务器合法域名**。可在开发者工具 Network 面板验证：增删改查过程中没有任何请求。

### 要换成后端或云开发时

数据出入口都收敛在 `utils/store.js`，页面只依赖方法签名，因此替换存储实现时页面基本不用改：

- **复用 Web 版 Node 服务**：把 `store.js` 换成 `wx.request` 封装（注意方法变为异步、需配置 HTTPS 合法域名）
- **微信云开发**：直接把实现换成 `wx.cloud.database()`，统计类聚合放到云函数里做
- **本地优先 + 云端同步**：本地即时读写，异步补传，用 `synced` 标记与 `updatedAt` 处理冲突

具体代码示例见 [docs/data-and-api.md](docs/data-and-api.md) 第五节。

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

## 发布上线

> 完整流程、自检清单与常见驳回原因见 **[docs/release.md](docs/release.md)**

**先明确一点：只提供 AppID 和 key 并不能直接发布。**

| 名称 | 用途 | 本项目是否需要 |
| --- | --- | --- |
| AppID | 小程序身份标识，写在 `project.config.json`，上传/发布必需 | **必须** |
| AppSecret（密钥） | 服务端调用微信开放接口用（如换 openid），**只能放服务端，绝不能写进小程序代码** | **不需要**（本项目无服务端） |
| 代码上传密钥 | 供 `miniprogram-ci` 命令行/CI 自动化上传 | 可选（仅做 CI 时才要） |

发布必须由**该小程序的管理员**用自己的微信登录后台与开发者工具完成：上传代码 → 后台提交审核 → 审核通过后发布。第三方拿到 AppID / 密钥也无法代你发布。

### 发布前必做

1. 在 `mp.weixin.qq.com` 注册小程序、完成主体认证，填写名称 / 头像 / 简介 / 服务类目（建议选「工具 → 效率」这类无需特殊资质的类目）
2. 把 `project.config.json` 中的 `"appid": "touristappid"` 换成真实 AppID（游客模式只能本地预览，无法上传）
3. 开发者工具「上传」→ 后台「版本管理 → 开发版本 → 提交审核 → 发布」

### 本项目不需要做的事

- **不需要**配置服务器域名、HTTPS 证书、ICP 备案（零网络请求）
- **不需要**开通云开发环境（数据存本地存储）
- **不需要**安装依赖或构建（无第三方依赖，包体仅几十 KB，主包 2MB 上限毫无压力）
- **基本不需要**处理隐私授权（未调用获取头像、位置、相册等隐私接口）

### 唯一需要留意的审核风险

首次进入应用没有任何数据，审核员可能认为"功能不完整"。提交审核时请在**审核备注**中写清体验路径（可直接用 release.md 中的模板），或自行加一个「载入示例数据」入口。
