# 数据存储与接口调用说明

本文说明小程序版**数据存在哪里、怎么读写、页面怎么调用**，以及后续要接后端 / 云开发时该怎么替换。

## 一、总体结论

| 问题 | 小程序版的处理方式 |
| --- | --- |
| 用什么数据库 | 小程序本地存储（`wx.setStorageSync` / `wx.getStorageSync`），键值对形式，**不依赖 SQLite** |
| 有没有后端服务 | 没有。小程序端不启动 Node 服务，也没有任何 `wx.request` 网络调用 |
| 有没有接口 | 有，但都是**本地函数调用**：页面调用 `utils/store.js` 暴露的方法，方法内部读写本地存储 |
| 需要配置服务器域名吗 | 不需要。因为不发起网络请求，无需在微信后台配置 request/socket 合法域名 |
| 数据在哪台设备上 | 只存在当前手机（当前微信账号 + 当前小程序）本地，换设备不同步 |
| 金额精度怎么保证 | 与 Web 版一致：一律以「分」为单位的整数（`amountCents`）存取，展示时再转成元 |

> 验证方式：打开微信开发者工具 → Network 面板 → 操作增删改查，**不会出现任何请求**；数据变化可在「调试器 → Storage」中看到 `bk:records` 等键。

## 二、存储结构

### 2.1 存储键

| 键名 | 内容 | 说明 |
| --- | --- | --- |
| `bk:records` | 记录数组 | 全部流水记录，是整个应用的主数据 |
| `bk:categories` | `{ income: [], expense: [] }` | 分类字典，首次运行写入默认值，录入新分类时自动追加 |
| `bk:seq` | 数字 | 记录自增 ID 序列，避免删除后 ID 复用 |

### 2.2 记录结构（`bk:records` 数组元素）

```js
{
  id: 1,
  date: '2026-09-24',      // YYYY-MM-DD
  type: 'expense',         // 'income' 收入 / 'expense' 支出
  amountCents: 3550,       // 金额，单位「分」→ 35.50 元
  category: '餐饮',
  note: '午餐',
  createdAt: 1758691200000,
  updatedAt: 1758691200000
}
```

### 2.3 容量与限制（重要）

- 小程序本地存储：**单个 key 上限 1MB，同一小程序整体上限 10MB**
- 单条记录序列化后约 120~160 字节，因此 `bk:records` 大约可容纳 **6000 条左右**记录（估算值，中文按 UTF-8 计）
- 超过这个量级的建议：
  1. 迁移到微信云开发数据库（见第五节）
  2. 或按年拆分存储键（如 `bk:records:2026`），`utils/store.js` 中按年份读取
- **数据不会自动云端备份**：开发者工具里「清缓存」、用户删除小程序都会导致数据丢失。建议定期用「导出 CSV」把数据复制出来留档

## 三、数据层 API（`utils/store.js`）

所有方法都是**同步方法**（本地存储本身是同步 API），返回已计算好的结果，页面拿到后直接 `setData`。

### 3.1 初始化与记录读写

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `init()` | `init()` | 应用启动时调用（`app.js` 的 `onLaunch`），初始化分类字典与内存缓存 |
| `listRecords(options)` | `{ year, month, day, type, category, keyword }` | 按条件查询，返回按日期倒序的记录数组；`month` 传空表示全年 |
| `getRecord(id)` | `id` | 取单条记录，用于编辑回填与删除确认文案 |
| `createRecord(input)` | `{ date, type, amountCents, category, note }` | 新增记录，内部校验后落盘 |
| `updateRecord(id, input)` | `id, input` | 修改记录（部分字段合并后整体校验） |
| `deleteRecord(id)` | `id` | 删除记录，找不到时抛错 |
| `importRecords(items)` | `[{ date, type, amountCents, category, note }]` | 批量导入，返回 `{ inserted, skipped, errors }` |

### 3.2 统计（全部在本地内存计算）

| 方法 | 签名 | 返回 |
| --- | --- | --- |
| `overview(year, month)` | 年、月（空为全年） | `{ period: {income, expense, profit, count}, year: {...} }` |
| `monthlySummary(year)` | 年 | 12 条月度数据，含 `profit`、`cumulative`（累计利润）、`count` |
| `dailySummary(year, month)` | 年、月 | 每天一条 `{ date, income, expense, profit, count }`，按日期升序 |
| `categorySummary(year, month, type)` | 年、月、`'income' \| 'expense'` | 各分类 `{ category, amount, count, ratio }`，按金额倒序 |
| `years()` | — | 已有数据的年份列表（倒序，至少含当前年） |

### 3.3 分类与工具

| 方法 | 说明 |
| --- | --- |
| `listCategories()` | 返回 `{ income: [], expense: [] }` |
| `addCategory(name, type)` | 新增分类（去重） |
| `toCsv(records)` | 生成 CSV 文本，用于「导出 CSV」复制到剪贴板 |
| `toDateString(v)` / `toType(v)` / `toAmountCents(v)` | 批量导入时的日期、类型、金额解析 |

### 3.4 内部实现要点

```js
let recordCache = null;                        // 内存缓存：避免每次统计都反序列化

function readRecords() {                       // 读：命中缓存直接返回
  if (recordCache) return recordCache;
  const raw = wx.getStorageSync('bk:records');
  recordCache = Array.isArray(raw) ? raw : [];
  return recordCache;
}

function writeRecords(records) {               // 写：更新缓存 + 整体落盘
  recordCache = records;
  wx.setStorageSync('bk:records', records);
}
```

- **读**：首次从本地存储反序列化到内存，之后所有查询/统计都在内存数组上做，避免频繁 I/O
- **写**：修改内存数组后整体写回存储（数据量在数千条级别时开销可忽略）
- **统计**：`filter` + `reduce` 在内存中完成，等同 SQL 的 `WHERE` + `GROUP BY` + `SUM(CASE WHEN ...)`

## 四、页面如何调用（调用关系）

| 页面 | 触发时机 | 调用的方法 |
| --- | --- | --- |
| `app.js`（启动） | `onLaunch` | `init()` |
| 月度总览 `pages/monthly` | `onShow` / 下拉刷新 / 切换年月 | `years()`、`overview(year, month)`、`monthlySummary(year)` |
| 每日明细 `pages/daily` | `onShow` / 切换年月 | `years()`、`dailySummary(year, month)` |
| 每日明细 · 展开某天 | 点击日期行 | `listRecords({ day })` |
| 每日明细 · 删除 | 点「删」→ `wx.showModal` 确认 | `getRecord(id)`、`deleteRecord(id)` |
| 每日明细 · 修改 | 点「改」 | 写 `globalData.editId` → `switchTab` 到流水记录页 → 该页 `onShow` 用 `getRecord(id)` 回填 |
| 流水记录 `pages/records` | `onShow` / 筛选 / 搜索 | `years()`、`listRecords({ year, month, type, keyword })`、`listCategories()` |
| 流水记录 · 保存 | 点「保存记录 / 保存修改」 | `createRecord(...)` 或 `updateRecord(id, ...)`，成功后按当前条件重新 `listRecords` |
| 流水记录 · 删除 | 点「删除」→ 确认弹窗 | `getRecord(id)`、`deleteRecord(id)` |
| 流水记录 · 批量导入 | 粘贴文本 →「确认导入」 | 本地解析（`toDateString` / `toType` / `toAmountCents`）→ `importRecords(items)` |
| 流水记录 · 导出 CSV | 点「导出 CSV」 | `toCsv(records)` → `wx.setClipboardData` |
| 分类统计 `pages/category` | `onShow` / 切换支出收入 / 切换年月 | `years()`、`categorySummary(year, month, type)` |

一次典型的**读流程**：

```
Page.onShow
  → store.listRecords / overview / monthlySummary …
    → readRecords() 命中内存缓存（首次会 wx.getStorageSync 反序列化）
      → filter / reduce 计算
        → setData(...) 渲染
```

一次典型的**写流程**：

```
点击保存
  → store.createRecord(payload)          // 校验：日期格式、类型、金额 > 0
    → writeRecords(缓存.concat(新记录))   // 更新内存缓存
      → wx.setStorageSync('bk:records')  // 整体落盘
        → 页面 refresh() 重新查询并 setData
```

## 五、如果要接后端 / 云开发

现在的架构把「存储」收敛在 `utils/store.js` 一个文件，页面只依赖它的方法签名，因此替换存储实现时**页面代码基本不用动**（只有异步化需要调整）。

### 5.1 与 Web 版 REST 接口的对照表

| 小程序 `store.js` 方法 | Web 版 REST 接口 |
| --- | --- |
| `listRecords({ year, month, day, type, category, keyword })` | `GET /api/records?year=&month=&day=&type=&category=&keyword=` |
| `createRecord(input)` | `POST /api/records` |
| `updateRecord(id, input)` | `PUT /api/records/:id` |
| `deleteRecord(id)` | `DELETE /api/records/:id` |
| `importRecords(items)` | `POST /api/import`（body: `{ records: items }`） |
| `overview(year, month)` | `GET /api/summary/overview?year=&month=` |
| `monthlySummary(year)` | `GET /api/summary/monthly?year=` |
| `dailySummary(year, month)` | `GET /api/summary/daily?year=&month=` |
| `categorySummary(year, month, type)` | `GET /api/summary/category?year=&month=&type=` |
| `listCategories()` / `addCategory(name, type)` | `GET /api/categories` / `POST /api/categories` |
| `years()` | `GET /api/meta/years` |

### 5.2 方案 A：复用 Web 版 Node 服务（`wx.request`）

```js
// utils/api.js
const BASE = 'https://your-domain.com';   // 必须是 HTTPS 且已备案/已配置合法域名

function request(path, { method = 'GET', data } = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE + path,
      method,
      data,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error((res.data && res.data.message) || `请求失败（${res.statusCode}）`));
      },
      fail: (err) => reject(new Error(err.errMsg || '网络异常')),
    });
  });
}

module.exports = {
  listRecords: (q) => request('/api/records', { data: q }),
  createRecord: (input) => request('/api/records', { method: 'POST', data: input }),
  updateRecord: (id, input) => request(`/api/records/${id}`, { method: 'PUT', data: input }),
  deleteRecord: (id) => request(`/api/records/${id}`, { method: 'DELETE' }),
  overview: (q) => request('/api/summary/overview', { data: q }),
  // ... 其余同理
};
```

注意点：

- 所有方法变为**异步**，页面里要 `await` 并处理 loading（`wx.showLoading`）与失败 toast
- 需要在微信公众平台「开发管理 → 服务器域名」配置 request 合法域名；本地调试可在开发者工具「详情 → 本地设置」勾选**不校验合法域名**
- 微信要求域名使用 HTTPS

### 5.3 方案 B：微信云开发（推荐，无需自建服务器）

```js
// app.js
wx.cloud.init({ env: 'your-env-id' });

// utils/store.js 内的实现换成云数据库
const db = wx.cloud.database();
const collection = db.collection('records');

async function listRecords({ year, month, type }) {
  const where = {};
  if (type === 'income' || type === 'expense') where.type = type;
  // 日期范围查询：>= '2026-09-01' 且 <= '2026-09-31'
  if (year) {
    where.date = month
      ? db.command.gte(`${year}-${pad2(month)}-01`).and(db.command.lte(`${year}-${pad2(month)}-31`))
      : db.command.gte(`${year}-01-01`).and(db.command.lte(`${year}-12-31`));
  }
  const res = await collection.where(where).orderBy('date', 'desc').limit(100).get();
  return res.data;
}
```

统计类方法建议放在**云函数**里用聚合完成（避免把所有记录拉到端上）：

```js
// cloudfunctions/summary/index.js
const db = cloud.database();
const $ = db.command.aggregate;

exports.main = async (event) => {
  const res = await db.collection('records')
    .aggregate()
    .match({ date: db.command.gte(event.start).and(db.command.lte(event.end)) })
    .group({
      _id: { month: $.substr(['$date', 5, 2]), type: '$type' },
      amount: $.sum('$amountCents'),
      count: $.sum(1),
    })
    .end();
  return res.list;
};
```

云开发的额外好处：数据自动多端同步、有备份、容量远大于本地存储。

### 5.4 方案 C：本地优先 + 云端同步

- 本地存储继续作为「离线缓存 + 快速读写层」
- 写操作先落本地（页面即时响应），再异步推送到云函数
- 记录增加 `synced: false` 标记，联网后补传
- 冲突处理建议以 `updatedAt` 较大者为准

## 六、常见问题

| 问题 | 原因与处理 |
| --- | --- |
| 换了手机数据没了 | 本地存储不跨设备。改用云开发或定期导出 CSV |
| 清缓存后数据消失 | 本地存储随小程序缓存清除而清空，属于预期行为 |
| 数据量大了变卡 | `bk:records` 接近 1MB 上限、或单次 `setData` 数据过大。建议拆键、分页或迁移云开发 |
| 想直接看数据 | 开发者工具「调试器 → Storage」面板可直接查看/修改 `bk:records` |
| 想批量灌数据 | 用「流水记录 → 批量导入」，从 Excel 复制粘贴（见 README 的导入格式） |
