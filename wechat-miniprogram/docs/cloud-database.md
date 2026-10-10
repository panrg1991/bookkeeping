# 云开发数据库设计与部署

> **适用范围**：本文只在 `utils/config.js` 中 `mode: 'cloud'` 时生效。
> 小程序**当前默认是本地存储模式**（`mode: 'local'`），不依赖云开发；本地模式下的配置与运行见 [deploy-checklist.md](deploy-checklist.md)。
> 云开发模式的代码（`cloudfunctions/bookkeeping`、`utils/store.cloud.js`）已完整保留，改一个字段即可切回。

云开发模式下，数据存于**微信云开发数据库**，实现**数据跟随微信用户（openid）自动关联、多端同步**，并为**每笔数据操作留下可追溯的日志**。

## 一、整体架构

```
小程序页面（pages/*）
   │  只调用 utils/store.js 暴露的方法（全部为异步）
   ▼
utils/store.js  ── wx.cloud.callFunction ──►  云函数 bookkeeping（唯一数据出入口）
   ▲                                             │
   │  { ok: true, data } / { ok:false, message }  ├─► records   集合（记账数据，带 _openid）
   └───────────────────────────────────────────── ┤─► settings  集合（每个用户的分类字典）
                                                  ├─► logs      集合（操作日志，只增不改）
                                                  └─ 使用 cloud.getWXContext().OPENID 识别用户
```

- **前端不直连数据库**：小程序端没有任何 `db.collection()` 调用，全部走云函数，避免绕过校验与日志。
- **统计在云端聚合完成**（`$.sum` / `$.group`），不把全量数据拉到端上。
- 云函数名为 `bookkeeping`，代码见 `cloudfunctions/bookkeeping/index.js`。

## 二、集合设计

### 2.1 `records`（记账数据）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_openid` | string | **数据归属用户**，由云函数写入微信上下文中的 openid |
| `date` | string | `YYYY-MM-DD`，所有按年/月/日查询都基于它 |
| `type` | string | `income` 收入 / `expense` 支出 |
| `amountCents` | number | 金额，单位「分」的整数，避免浮点误差 |
| `unitPriceCents` | number | 单价（分），`0` 表示该记录不使用「单价 × 数量」计价 |
| `quantity` | number | 数量（可为小数），`0` 表示不使用；与单价同时 > 0 时，金额由 `Math.round(unitPriceCents × quantity)` 计算 |
| `category` | string | 分类 |
| `note` | string | 备注 |
| `createdAt` / `updatedAt` | date | 服务端时间（`db.serverDate()`） |
| `createdAtMs` / `updatedAtMs` | number | 毫秒时间戳，便于排序与日志核对 |
| `importBatch` | string | 导入批次号（仅批量导入产生） |

### 2.2 `logs`（操作日志，只增不改）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_openid` | string | 操作者（数据归属用户） |
| `action` | string | 操作类型，见下表 |
| `target` | string | 作用对象：`records` / `logs` / `db` |
| `recordId` | string | 被操作的记录 `_id`（批量导入时对应每一条） |
| `before` / `after` | object | 变更前 / 变更后的记录内容（仅业务字段） |
| `changed` | array | 变更的字段名，如 `['amountCents','note']` |
| `summary` | string | 人类可读摘要，如 `修改 2026-09-24 支出 40.05 元（餐饮）（字段：amountCents、note）` |
| `batchId` | string | 导入批次号 |
| `count` | number | 影响条数 |
| `errors` | array | 失败明细 `[{ row, message }]` |
| `client` | object | 上报的 `{ version, platform, model }`，便于定位端侧问题 |
| `createdAt` / `createdAtMs` | date / number | 操作时间 |

`action` 取值：

| action | 含义 |
| --- | --- |
| `create` | 新增记录 |
| `update` | 修改记录（含 `before`/`after`/`changed`） |
| `delete` | 删除记录（含被删内容 `before`）；批量删除时逐条记录，单次上限 200 条 |
| `import` | 批量导入中的单条新增 |
| `importBatch` | 一次导入的汇总（成功数、失败数、失败行） |
| `importRejected` | 导入时被校验拒绝的行 |
| `clearLogs` | 清理旧日志 |
| `initDb` | 初始化集合 |
| `read` | 查询（默认关闭，见下文开关） |
| `<action>Failed` | 任一操作抛错时留痕，如 `createRecordFailed` |

### 2.3 `settings`（分类字典）

每个用户一条：`{ _openid, income: [], expense: [], createdAt, updatedAt }`。录入中出现新分类时由云函数自动追加。

## 三、数据隔离（怎么根据用户关联数据）

1. **身份只来自服务端上下文**：云函数用 `cloud.getWXContext().OPENID` 取用户身份，**完全忽略前端传入的任何 openid/uid** —— 前端也无法伪造。
2. **读写都带归属条件**：查询是 `_.and([{ _openid }, ...])`；云函数拥有管理员权限，若不显式过滤就能读到所有人的数据，因此所有查询都强制拼上 `_openid`。
3. **改/删前先校验归属**：`getOwnedRecord(id, openid)` 用 `where({ _id, _openid }).limit(1)` 查，查不到即抛「记录不存在或无权操作」，避免越权操作他人数据。
4. **日志同样按用户隔离**：日志查询固定带 `_openid`。

已用 mock 云数据库做过越权验证（同一份数据，用户 A 创建，用户 B 访问）：

| 验证项 | 结果 |
| --- | --- |
| B 查询记录列表 | 0 条 |
| B 查询统计 | 全部为 0 |
| B 按 id 读取 A 的记录 | `null` |
| B 修改 A 的记录 | 失败：记录不存在或无权操作 |
| B 删除 A 的记录 | 失败：记录不存在或无权操作 |
| B 查询日志 | 只有 B 自己的失败日志 |
| A 的数据是否受影响 | 未受影响（仍是原有条数） |

## 四、操作日志机制

- **每笔写操作都写日志**：新增 / 修改 / 删除 / 导入（逐条 + 汇总）/ 清理日志 / 初始化，操作失败也会写一条 `xxxFailed`。
- **失败不影响主流程**：日志写失败时业务照常返回，但结果里带 `logError` 字段，前端可据此提示（`wx.cloud.callFunction` 返回的 `data.logError`）。
- **读操作默认不记**：每次查询都写日志会快速消耗云开发配额，因此默认关闭；如需开启，把云函数里 `const LOG_READS = false;` 改为 `true`。
- **导入日志可降噪**：导入逐条写日志会产生大量记录，`importRecords` 支持 `detailLog: false` 只写批次汇总；当前前端默认 `true`（满足逐笔留痕）。可在 `pages/records/index.js` 的 `store.importRecords(items, { detailLog: false })` 处调整。
- **可在小程序内查看**：「流水记录」页右上角 →「操作日志」页面（`pages/logs/index`），支持按新增/修改/删除/导入筛选、分页加载、查看修改前后对比，并可一键清理 30 天前的日志。
- **也可在云开发控制台查看**：数据库 → `logs` 集合，按 `createdAtMs` 倒序。

修改类日志示例：

```json
{
  "action": "update",
  "recordId": "id_3",
  "summary": "修改 2026-10-05 支出 40.05 元（餐饮）（字段：amountCents、note）",
  "before": { "date": "2026-10-05", "type": "expense", "amountCents": 3550, "category": "餐饮", "note": "午餐" },
  "after":  { "date": "2026-10-05", "type": "expense", "amountCents": 4005, "category": "餐饮", "note": "午餐+饮料" },
  "changed": ["amountCents", "note"],
  "client": { "version": "1.0.0", "platform": "devtools", "model": "iPhone X" },
  "createdAtMs": 1791421542000
}
```

## 五、部署步骤

> 精简版逐项清单（「要改哪两个文件、openid 为什么不用配、报错对照」）见 **[deploy-checklist.md](deploy-checklist.md)**。

### 1. 开通云开发

开发者工具 → 顶部「云开发」→ 开通（选择按量付费/包月套餐，有免费额度）→ 记录**环境 ID**（形如 `bookkeeping-1g2h3i4j5k6l`）。

### 2. 填写环境 ID

编辑 `utils/config.js`：

```js
module.exports = {
  envId: 'bookkeeping-1g2h3i4j5k6l',   // ← 换成你的环境 ID（留空则用默认环境）
  cloudFunction: 'bookkeeping',
  ...
};
```

### 3. 部署云函数

开发者工具左侧资源管理器 → `cloudfunctions/bookkeeping` → 右键 → **上传并部署：云端安装依赖**。

> 云函数依赖 `wx-server-sdk`，必须选「云端安装依赖」，本地不用 `npm install`。

### 4. 创建集合

`cloudfunctions/bookkeeping` 提供了 `initDb` 动作，会创建 `records`、`logs`、`settings` 三个集合。两种调用方式任选：

- 开发者工具 → 云开发控制台 → 云函数 → `bookkeeping` → 「云端测试」，事件模板填 `{ "action": "initDb" }`，执行一次；
- 或在云开发控制台 → 数据库 → 手动新建这三个集合。

（集合已存在时 `initDb` 返回 `exists`，不会报错中断。）

### 5. 配置集合权限（重要）

因为所有读写都走云函数，三个集合都应设为「**所有用户不可读写**」（自定义安全规则），彻底禁止客户端直连：

安全规则（每个集合都用同一份）：

```json
{
  "read": false,
  "write": false
}
```

### 6. 建立索引（建议）

| 集合 | 索引字段 | 说明 |
| --- | --- | --- |
| `records` | `_openid`（升序）+ `date`（降序） | 列表与按年月查询 |
| `records` | `_openid` + `createdAtMs`（降序） | 同日期排序 |
| `logs` | `_openid` + `createdAtMs`（降序） | 日志分页 |
| `settings` | `_openid` | 分类字典查询 |

云函数无法创建索引，需要在云开发控制台 → 数据库 → 索引管理里手动添加。

### 7. 验证

1. 打开小程序，控制台无「云环境未就绪」弹窗（`app.js` 启动时会 `ping` 云函数自检）
2. 记一笔 → 「流水记录」列表出现该条
3. 「月度总览」「每日明细」「分类统计」数据正确
4. 修改 / 删除各一次 → 进入「操作日志」页，应看到 `create` / `update`（含前后值）/ `delete` 三类日志，条数与操作次数一致
5. 用另一个微信号（或开发者工具切换账号）打开 → 列表为空白，验证数据隔离
6. 云开发控制台 → 数据库 → `records`，确认每条都有 `_openid` 字段

## 六、配额与成本提示

- 云开发有免费额度（数据库读写次数、存储、云函数调用次数），个人记账用量通常远低于额度。
- **日志比业务数据更占容量**：一次导入 1000 条会额外产生约 1000 条 `import` 日志。若导入频繁，建议关闭逐条日志（`detailLog: false`）并定期用「操作日志 → 清理 30 天前日志」。
- 云函数为按需付费，读写都集中在一次调用里（列表查询自动翻页），比端上直连逐条请求更省调用次数。

## 七、常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 提示「云函数 bookkeeping 未部署」 | 未上传部署，或部署到了别的环境；重新「上传并部署：云端安装依赖」，并核对 `utils/config.js` 的 `envId` |
| 提示「云环境未就绪」 | `envId` 未配置或云开发未开通 |
| 提示「collection not exists」 | 集合未创建，执行一次 `initDb` |
| 日志页一直为空 | 集合权限配置为「所有用户不可读写」时不影响云函数；检查 `logs` 集合是否创建、是否执行过写操作 |
| 数据「丢失」 | 大概率是换了微信账号（openid 不同）；数据是按用户隔离的 |
| 想回到纯离线模式 | 用 `utils/store.local.js` 替换 `utils/store.js`（接口同名，本地版为同步 API，页面需相应改回同步调用） |
