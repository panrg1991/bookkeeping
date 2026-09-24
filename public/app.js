'use strict';

/* ================================ 工具函数 ================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function fmt(cents) {
  return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtSigned(cents) {
  if (cents === 0) return '0.00';
  return `${cents > 0 ? '+' : '-'}${fmt(Math.abs(cents))}`;
}
function moneyClass(cents) {
  if (cents === 0) return 'zero';
  return cents > 0 ? 'profit-text' : 'profit-text negative';
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let toastTimer = null;
function toast(message, type = 'success') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

async function api(pathname, params = {}, options = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, value);
  }
  const qs = query.toString();
  const res = await fetch(`${pathname}${qs ? `?${qs}` : ''}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `请求失败（${res.status}）`);
  return data;
}

/* ================================ 状态 ================================ */

const state = {
  year: String(new Date().getFullYear()),
  month: String(new Date().getMonth() + 1),
  tab: 'month',
  editingId: null,
  categoryType: 'expense',
  recordFilter: { type: 'all', keyword: '' },
  expandedDay: null,
  data: { overview: null, monthly: [], daily: [], records: [], categories: { income: [], expense: [] } },
};

/* ================================ 图表 ================================ */

function niceMax(value) {
  if (value <= 0) return 100;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}
function shortNum(cents) {
  const v = cents / 100;
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}
function groupedBarChart(labels, series, { width = 960, height = 280 } = {}) {
  const pad = { left: 62, right: 16, top: 14, bottom: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const groupW = plotW / Math.max(labels.length, 1);
  const barW = Math.max(3, (groupW - 12) / series.length);
  const y = (v) => pad.top + plotH - (v / max) * plotH;

  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img">`;
  for (let i = 0; i <= 4; i += 1) {
    const v = (max / 4) * i;
    svg += `<line class="grid-line" x1="${pad.left}" y1="${y(v)}" x2="${width - pad.right}" y2="${y(v)}" />`;
    svg += `<text class="axis-label" x="${pad.left - 8}" y="${y(v) + 4}" text-anchor="end">${shortNum(v)}</text>`;
  }
  labels.forEach((label, i) => {
    const gx = pad.left + i * groupW;
    series.forEach((s, j) => {
      const v = s.values[i] || 0;
      if (v <= 0) return;
      const x = gx + 6 + j * barW;
      const h = Math.max((v / max) * plotH, 1);
      svg += `<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${s.color}">`
        + `<title>${escapeHtml(label)} ${escapeHtml(s.name)}：${fmt(v)}</title></rect>`;
    });
    const step = Math.ceil(labels.length / 16);
    if (i % step === 0) {
      svg += `<text class="axis-label" x="${(gx + groupW / 2).toFixed(1)}" y="${height - 10}" text-anchor="middle">${escapeHtml(label)}</text>`;
    }
  });
  svg += `<line class="axis-line" x1="${pad.left}" y1="${pad.top + plotH}" x2="${width - pad.right}" y2="${pad.top + plotH}" />`;
  svg += '</svg>';
  return svg;
}

/* ================================ 渲染 ================================ */

function renderCards() {
  const { period, year } = state.data.overview || { period: {}, year: {} };
  const cards = [
    { cls: 'income', label: '本期收入', value: fmt(period.income || 0), sub: `${period.count || 0} 笔记录` },
    { cls: 'expense', label: '本期支出', value: fmt(period.expense || 0), sub: `${state.year} 年累计支出 ${fmt(year.expense || 0)}` },
    {
      cls: `profit${(period.profit || 0) < 0 ? ' negative' : ''}`,
      label: '本期利润（收入 - 支出）',
      value: fmtSigned(period.profit || 0),
      sub: `利润率 ${period.income ? ((period.profit / period.income) * 100).toFixed(1) : '0.0'}%`,
    },
    {
      cls: `profit${(year.profit || 0) < 0 ? ' negative' : ''}`,
      label: `${state.year} 年累计利润`,
      value: fmtSigned(year.profit || 0),
      sub: `全年收入 ${fmt(year.income || 0)}`,
    },
  ];
  $('#cards').innerHTML = cards
    .map((c) => `<div class="card ${c.cls}"><div class="label">${c.label}</div><div class="value">${c.value}</div><div class="sub">${c.sub}</div></div>`)
    .join('');
}

function renderMonth() {
  const rows = state.data.monthly;
  $('#monthTitle').textContent = `${state.year} 年`;
  $('#monthChart').innerHTML = groupedBarChart(
    rows.map((r) => `${Number(r.month)}月`),
    [
      { name: '收入', color: '#16a34a', values: rows.map((r) => r.income) },
      { name: '支出', color: '#dc2626', values: rows.map((r) => r.expense) },
    ]
  );

  const total = rows.reduce((acc, r) => ({ income: acc.income + r.income, expense: acc.expense + r.expense, count: acc.count + r.count }), { income: 0, expense: 0, count: 0 });
  const body = rows
    .map((r) => {
      const rate = r.income ? ((r.profit / r.income) * 100).toFixed(1) : '0.0';
      const active = Number(r.month) === Number(state.month) ? ' style="background:#eff6ff"' : '';
      return `<tr${active}>
        <td>${state.year}-${r.month}</td>
        <td class="num income-text">${fmt(r.income)}</td>
        <td class="num expense-text">${fmt(r.expense)}</td>
        <td class="num ${moneyClass(r.profit)}">${fmtSigned(r.profit)}</td>
        <td class="num ${moneyClass(r.cumulative)}">${fmtSigned(r.cumulative)}</td>
        <td class="num">${r.count}</td>
        <td class="num">${rate}%</td>
      </tr>`;
    })
    .join('');

  $('#monthTable').innerHTML = `
    <thead><tr>
      <th>月份</th><th class="num">收入</th><th class="num">支出</th>
      <th class="num">利润</th><th class="num">累计利润</th><th class="num">笔数</th><th class="num">利润率</th>
    </tr></thead>
    <tbody>${body || `<tr><td colspan="7" class="empty">${state.year} 年暂无数据</td></tr>`}</tbody>
    <tfoot><tr>
      <td>合计</td>
      <td class="num income-text">${fmt(total.income)}</td>
      <td class="num expense-text">${fmt(total.expense)}</td>
      <td class="num ${moneyClass(total.income - total.expense)}">${fmtSigned(total.income - total.expense)}</td>
      <td class="num">-</td>
      <td class="num">${total.count}</td>
      <td class="num">-</td>
    </tr></tfoot>`;
}

function renderDaily() {
  const days = state.data.daily;
  const byDate = new Map();
  for (const record of state.data.records) {
    if (!byDate.has(record.date)) byDate.set(record.date, []);
    byDate.get(record.date).push(record);
  }

  const label = state.month === 'all' ? `${state.year} 年（全年）` : `${state.year} 年 ${state.month} 月`;
  $('#dailyTitle').textContent = label;
  $('#dailyChart').innerHTML = groupedBarChart(
    days.map((d) => d.date.slice(8)),
    [
      { name: '收入', color: '#16a34a', values: days.map((d) => d.income) },
      { name: '支出', color: '#dc2626', values: days.map((d) => d.expense) },
    ]
  );

  const body = days
    .map((d) => {
      const weekday = WEEKDAYS[new Date(`${d.date}T00:00:00`).getDay()];
      const open = state.expandedDay === d.date;
      const records = byDate.get(d.date) || [];
      const detail = open
        ? `<tr class="detail-row"><td colspan="7"><table>
             <thead><tr><th>类型</th><th>分类</th><th class="num">金额</th><th>备注</th><th>操作</th></tr></thead>
             <tbody>${records.map((r) => `<tr>
                 <td><span class="tag ${r.type}">${r.type === 'income' ? '收入' : '支出'}</span></td>
                 <td>${escapeHtml(r.category)}</td>
                 <td class="num ${r.type === 'income' ? 'income-text' : 'expense-text'}">${fmt(Math.round(r.amount * 100))}</td>
                 <td>${escapeHtml(r.note) || '<span class="muted">-</span>'}</td>
                 <td><button class="row-btn" type="button" data-action="edit" data-id="${r.id}">修改</button>
                     <button class="row-btn danger" type="button" data-action="delete" data-id="${r.id}">删除</button></td>
               </tr>`).join('')}</tbody></table></td></tr>`
        : '';
      return `<tr class="day-row" data-action="toggle-day" data-date="${d.date}">
          <td><span class="caret">${open ? '▾' : '▸'}</span>${d.date}</td>
          <td>${weekday}</td>
          <td class="num expense-text">${fmt(d.expense)}</td>
          <td class="num income-text">${fmt(d.income)}</td>
          <td class="num ${moneyClass(d.profit)}">${fmtSigned(d.profit)}</td>
          <td class="num">${d.count}</td>
          <td class="num">${d.count ? `${records.length} 笔已载入` : '-'}</td>
        </tr>${detail}`;
    })
    .join('');

  const sum = days.reduce((acc, d) => ({ income: acc.income + d.income, expense: acc.expense + d.expense, count: acc.count + d.count }), { income: 0, expense: 0, count: 0 });
  $('#dailyTable').innerHTML = `
    <thead><tr>
      <th>日期</th><th>星期</th><th class="num">支出</th><th class="num">收入</th>
      <th class="num">净额</th><th class="num">笔数</th><th class="num">明细</th>
    </tr></thead>
    <tbody>${body || `<tr><td colspan="7" class="empty">${label} 暂无数据</td></tr>`}</tbody>
    <tfoot><tr>
      <td>合计</td><td>${days.length} 天</td>
      <td class="num expense-text">${fmt(sum.expense)}</td>
      <td class="num income-text">${fmt(sum.income)}</td>
      <td class="num ${moneyClass(sum.income - sum.expense)}">${fmtSigned(sum.income - sum.expense)}</td>
      <td class="num">${sum.count}</td><td class="num">-</td>
    </tr></tfoot>`;
}

function renderRecords() {
  const { type, keyword } = state.recordFilter;
  const kw = keyword.trim().toLowerCase();
  const list = state.data.records.filter((r) => {
    if (type !== 'all' && r.type !== type) return false;
    if (kw && !`${r.category}${r.note}`.toLowerCase().includes(kw)) return false;
    return true;
  });

  const label = state.month === 'all' ? `${state.year} 年` : `${state.year} 年 ${state.month} 月`;
  $('#recordsTitle').textContent = `${label} · 共 ${list.length} 笔`;

  const body = list
    .map((r) => `<tr>
        <td>${r.date}</td>
        <td><span class="tag ${r.type}">${r.type === 'income' ? '收入' : '支出'}</span></td>
        <td>${escapeHtml(r.category)}</td>
        <td class="num ${r.type === 'income' ? 'income-text' : 'expense-text'}">${r.type === 'income' ? '+' : '-'}${fmt(Math.round(r.amount * 100))}</td>
        <td class="cell-note">${escapeHtml(r.note) || '<span class="muted">-</span>'}</td>
        <td><button class="row-btn" type="button" data-action="edit" data-id="${r.id}">修改</button>
            <button class="row-btn danger" type="button" data-action="delete" data-id="${r.id}">删除</button></td>
      </tr>`)
    .join('');

  $('#recordTable').innerHTML = `
    <thead><tr>
      <th>日期</th><th>类型</th><th>分类</th><th class="num">金额（元）</th><th>备注</th><th>操作</th>
    </tr></thead>
    <tbody>${body || '<tr><td colspan="6" class="empty">暂无记录，先在上方记一笔吧</td></tr>'}</tbody>`;
}

async function renderCategory() {
  const rows = await api('/api/summary/category', { year: state.year, month: state.month, type: state.categoryType });
  const label = state.month === 'all' ? `${state.year} 年` : `${state.year} 年 ${state.month} 月`;
  const isExpense = state.categoryType === 'expense';
  $('#categoryTitle').textContent = `${label} · ${isExpense ? '支出' : '收入'}结构`;

  if (!rows.length) {
    $('#categoryBody').innerHTML = `<div class="table-wrap"><div class="empty">${label}暂无${isExpense ? '支出' : '收入'}数据</div></div>`;
    return;
  }

  const total = rows.reduce((acc, r) => acc + r.amount, 0);
  $('#categoryBody').innerHTML = `
    <div class="table-wrap" style="padding:14px 16px">
      ${rows.map((r) => `<div class="cat-row">
          <div class="cat-name">${escapeHtml(r.category)}</div>
          <div class="cat-bar-wrap"><div class="cat-bar" style="width:${(r.ratio * 100).toFixed(1)}%;background:${isExpense ? '#dc2626' : '#16a34a'}"></div></div>
          <div class="cat-amount ${isExpense ? 'expense-text' : 'income-text'}">${fmt(r.amount)}</div>
          <div class="cat-ratio">${(r.ratio * 100).toFixed(1)}%</div>
        </div>`).join('')}
      <div class="cat-row" style="border-top:1px solid var(--border);margin-top:8px;font-weight:700">
        <div class="cat-name">合计</div>
        <div class="cat-bar-wrap" style="background:transparent"></div>
        <div class="cat-amount">${fmt(total)}</div>
        <div class="cat-ratio">${rows.length} 类</div>
      </div>
    </div>`;
}

/* ================================ 数据加载 ================================ */

async function refresh() {
  const { year, month } = state;
  const [overview, monthly, daily, records] = await Promise.all([
    api('/api/summary/overview', { year, month }),
    api('/api/summary/monthly', { year }),
    api('/api/summary/daily', { year, month }),
    api('/api/records', { year, month, limit: 5000 }),
  ]);
  state.data.overview = overview;
  state.data.monthly = monthly;
  state.data.daily = daily;
  state.data.records = records.items;

  renderCards();
  renderMonth();
  renderDaily();
  renderRecords();
  await renderCategory();
}

async function loadMeta() {
  const years = await api('/api/meta/years');
  const set = new Set([...years, String(new Date().getFullYear())]);
  $('#yearSelect').innerHTML = [...set].sort((a, b) => Number(b) - Number(a))
    .map((y) => `<option value="${y}"${y === state.year ? ' selected' : ''}>${y} 年</option>`)
    .join('');

  $('#monthSelect').innerHTML = '<option value="all">全年</option>'
    + Array.from({ length: 12 }, (_, i) => i + 1)
      .map((m) => `<option value="${m}"${String(m) === state.month ? ' selected' : ''}>${m} 月</option>`)
      .join('');

  const categories = await api('/api/categories');
  state.data.categories = categories;
  syncCategoryOptions();
}

function syncCategoryOptions() {
  const type = $('#fType').value;
  const list = state.data.categories[type] || [];
  $('#categoryList').innerHTML = list.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
}

/* ================================ 交互 ================================ */

function startEdit(record) {
  state.editingId = record.id;
  $('#fDate').value = record.date;
  $('#fType').value = record.type;
  $('#fAmount').value = record.amount;
  $('#fCategory').value = record.category;
  $('#fNote').value = record.note;
  $('#entryTitle').textContent = `修改记录 #${record.id}`;
  $('#submitBtn').textContent = '保存修改';
  $('#cancelEditBtn').hidden = false;
  $('#recordForm').classList.add('is-editing');
  switchTab('records');
  const form = $('#recordForm');
  if (form) {
    try {
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      form.scrollIntoView();
    }
  }
}

function exitEditMode() {
  state.editingId = null;
  $('#entryTitle').textContent = '记一笔';
  $('#submitBtn').textContent = '保存记录';
  $('#cancelEditBtn').hidden = true;
  $('#recordForm').classList.remove('is-editing');
}

// 记完一笔后：保留日期与类型，仅清空金额 / 分类 / 备注，方便连续录入
function clearFormForNext() {
  exitEditMode();
  $('#fAmount').value = '';
  $('#fCategory').value = '';
  $('#fNote').value = '';
  syncCategoryOptions();
}

// 完全恢复默认：日期回到今天、类型回到支出（用于取消编辑、刷新等操作）
function resetForm() {
  exitEditMode();
  $('#recordForm').reset();
  $('#fDate').value = todayStr();
  $('#fCategory').value = '';
  syncCategoryOptions();
}

function switchTab(tab) {
  state.tab = tab;
  $$('#tabs .tab').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tab === tab));
  $$('main .panel').forEach((panel) => panel.classList.toggle('is-active', panel.id === `panel-${tab}`));
}

function downloadCsv(filename, rows) {
  const content = `﻿${rows.map((row) => row.map((cell) => {
    const text = String(cell ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ================================ 导入 Excel ================================ */

let pendingImport = [];

const HEADER_MAP = {
  date: ['日期', 'date', '时间'],
  type: ['类型', 'type', '收支', '收支类型'],
  amount: ['金额', 'amount', '金额(元)', '金额（元）'],
  category: ['分类', 'category'],
  note: ['备注', 'note', '说明', '描述'],
};

function normalizeType(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (['支出', 'expense', 'out', 'e', '花费'].includes(v)) return 'expense';
  if (['收入', 'income', 'in', 'i', '收'].includes(v)) return 'income';
  return null;
}

function toDateString(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    try {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed && parsed.y) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    } catch { /* ignore */ }
    return null;
  }
  const s = String(value ?? '').trim();
  const m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

function parseAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(String(value ?? '').replace(/[¥￥,，\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function mapHeader(row) {
  const header = {};
  for (const [key, names] of Object.entries(HEADER_MAP)) {
    header[key] = Object.keys(row).find((h) => names.includes(String(h).trim()));
  }
  return header;
}

function convertImportRow(raw, header) {
  const get = (key) => (header[key] !== undefined ? raw[header[key]] : undefined);
  const date = toDateString(get('date'));
  const type = normalizeType(get('type'));
  const amount = parseAmount(get('amount'));
  const category = String(get('category') ?? '').trim() || '其他';
  const note = String(get('note') ?? '').trim();

  if (!date) return { ok: false, error: `日期无效「${String(get('date') ?? '空')}」` };
  if (!type) return { ok: false, error: `类型无效「${String(get('type') ?? '空')}」（应为「支出」或「收入」）` };
  if (amount === null || amount <= 0) return { ok: false, error: `金额无效「${String(get('amount') ?? '空')}」` };

  return { ok: true, record: { date, type, amount, category, note } };
}

async function parseImportFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('文件里没有工作表');
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rawRows.length) throw new Error('工作表里没有数据行');

  const header = mapHeader(rawRows[0]);
  if (header.date === undefined || header.type === undefined || header.amount === undefined) {
    throw new Error('缺少必需列：日期、类型、金额（表头请参照样例文件）');
  }

  const records = [];
  const errors = [];
  rawRows.forEach((row, index) => {
    const res = convertImportRow(row, header);
    if (res.ok) records.push(res.record);
    else errors.push(`第 ${index + 2} 行：${res.error}`);
  });
  return { records, errors, total: rawRows.length };
}

function renderImportPreview(fileName, total, validCount, errors) {
  let html = `<p>文件 <strong>${escapeHtml(fileName)}</strong>：共 ${total} 行数据，其中 <strong class="income-text">${validCount}</strong> 条有效`;
  if (errors.length) html += `，<strong class="expense-text">${errors.length}</strong> 条无效将被跳过`;
  html += '。</p>';

  if (errors.length) {
    html += '<div class="import-errors"><div class="import-errors-title">无效行明细（前 20 条）：</div><ul>';
    html += errors.slice(0, 20).map((er) => `<li>${escapeHtml(er)}</li>`).join('');
    if (errors.length > 20) html += `<li>…其余 ${errors.length - 20} 条已略</li>`;
    html += '</ul></div>';
  }
  $('#importPreview').innerHTML = html;
  $('#importOk').disabled = validCount === 0;
}

function closeImportModal() {
  $('#importModal').hidden = true;
  pendingImport = [];
}

function downloadSample() {
  if (typeof XLSX === 'undefined') {
    toast('样例生成组件未加载，请刷新页面后重试', 'error');
    return;
  }
  const rows = [
    ['日期', '类型', '金额', '分类', '备注'],
    ['2026-09-24', '支出', 35.5, '餐饮', '午餐'],
    ['2026-09-24', '收入', 12000, '工资', '9月工资'],
    ['2026-09-25', '支出', 120.25, '交通', '打车'],
    ['2026-09-26', '收入', 500, '红包', '分类 / 备注可留空'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '流水记录');
  XLSX.writeFile(wb, '流水记录导入样例.xlsx');
  toast('样例文件已下载');
}

async function handleSubmit(event) {
  event.preventDefault();
  const payload = {
    date: $('#fDate').value,
    type: $('#fType').value,
    amount: $('#fAmount').value,
    category: $('#fCategory').value.trim(),
    note: $('#fNote').value.trim(),
  };

  if (!payload.date) return toast('请选择日期', 'error');
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) return toast('请输入大于 0 的金额', 'error');

  try {
    if (state.editingId) {
      await api(`/api/records/${state.editingId}`, {}, { method: 'PUT', body: JSON.stringify(payload) });
      toast('记录已更新');
    } else {
      await api('/api/records', {}, { method: 'POST', body: JSON.stringify(payload) });
      toast('记录已保存');
    }
    clearFormForNext();
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* 页面内确认弹窗：避免浏览器 / 预览 WebView 屏蔽原生 confirm 导致操作无响应 */
let confirmResolver = null;
function askConfirm(message, { title = '确认操作', okText = '确定' } = {}) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = message;
    $('#confirmOk').textContent = okText;
    $('#confirmModal').hidden = false;
    try { $('#confirmOk').focus({ preventScroll: true }); } catch { /* 忽略焦点兼容问题 */ }
  });
}
function closeConfirm(result) {
  if (!confirmResolver) return;
  const resolve = confirmResolver;
  confirmResolver = null;
  $('#confirmModal').hidden = true;
  resolve(result);
}

async function handleDelete(id) {
  const recordId = Number(id);
  const record = state.data.records.find((r) => r.id === recordId);
  const text = record
    ? `${record.date} ${record.type === 'income' ? '收入' : '支出'} ${fmt(Math.round(record.amount * 100))} 元（${record.category}）`
    : `记录 #${recordId}`;

  const ok = await askConfirm(`确定删除这条记录吗？删除后不可恢复。\n${text}`, { title: '删除确认', okText: '删除' });
  if (!ok) return;

  try {
    await api(`/api/records/${recordId}`, {}, { method: 'DELETE' });
    if (state.editingId === recordId) resetForm();
    toast('记录已删除');
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function bindEvents() {
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) switchTab(btn.dataset.tab);
  });

  $('#yearSelect').addEventListener('change', (e) => {
    state.year = e.target.value;
    state.expandedDay = null;
    refresh().catch((err) => toast(err.message, 'error'));
  });

  $('#monthSelect').addEventListener('change', (e) => {
    state.month = e.target.value;
    state.expandedDay = null;
    refresh().catch((err) => toast(err.message, 'error'));
  });

  $('#reloadBtn').addEventListener('click', () => {
    resetForm();
    refresh().catch((err) => toast(err.message, 'error'));
  });

  $('#confirmOk').addEventListener('click', () => closeConfirm(true));
  $('#confirmCancel').addEventListener('click', () => closeConfirm(false));
  $('#confirmModal').addEventListener('click', (e) => {
    if (e.target === $('#confirmModal')) closeConfirm(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeConfirm(false);
  });

  // 导入 Excel
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#sampleBtn').addEventListener('click', downloadSample);
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { records, errors, total } = await parseImportFile(file);
      pendingImport = records;
      renderImportPreview(file.name, total, records.length, errors);
      $('#importModal').hidden = false;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#importOk').addEventListener('click', async () => {
    if (!pendingImport.length) return;
    try {
      const result = await api('/api/import', {}, { method: 'POST', body: JSON.stringify({ records: pendingImport }) });
      closeImportModal();
      toast(`导入成功 ${result.inserted} 条${result.skipped ? `，跳过 ${result.skipped} 条` : ''}`);
      await refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#importCancel').addEventListener('click', closeImportModal);
  $('#importModal').addEventListener('click', (e) => {
    if (e.target === $('#importModal')) closeImportModal();
  });

  $('#fType').addEventListener('change', syncCategoryOptions);
  $('#recordForm').addEventListener('submit', handleSubmit);
  $('#cancelEditBtn').addEventListener('click', resetForm);

  $('#recordTypeFilter').addEventListener('change', (e) => {
    state.recordFilter.type = e.target.value;
    renderRecords();
  });
  $('#recordKeyword').addEventListener('input', (e) => {
    state.recordFilter.keyword = e.target.value;
    renderRecords();
  });

  $('#categoryTypeSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    state.categoryType = btn.dataset.ctype;
    $$('#categoryTypeSwitch .seg').forEach((b) => b.classList.toggle('is-active', b === btn));
    renderCategory().catch((err) => toast(err.message, 'error'));
  });

  // 表格内的操作按钮 / 展开行
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const { action, id, date } = target.dataset;
    if (action === 'edit') {
      const record = state.data.records.find((r) => r.id === Number(id));
      if (record) startEdit(record);
    } else if (action === 'delete') {
      handleDelete(id);
    } else if (action === 'toggle-day') {
      state.expandedDay = state.expandedDay === date ? null : date;
      renderDaily();
    }
  });

  $('#exportMonthBtn').addEventListener('click', () => {
    const rows = [['月份', '收入', '支出', '利润', '累计利润', '笔数', '利润率']];
    for (const r of state.data.monthly) {
      rows.push([`${state.year}-${r.month}`, (r.income / 100).toFixed(2), (r.expense / 100).toFixed(2),
        (r.profit / 100).toFixed(2), (r.cumulative / 100).toFixed(2), r.count,
        `${r.income ? ((r.profit / r.income) * 100).toFixed(1) : '0.0'}%`]);
    }
    downloadCsv(`月度总览_${state.year}.csv`, rows);
  });

  $('#exportDailyBtn').addEventListener('click', () => {
    const rows = [['日期', '支出', '收入', '净额', '笔数']];
    for (const d of state.data.daily) {
      rows.push([d.date, (d.expense / 100).toFixed(2), (d.income / 100).toFixed(2), (d.profit / 100).toFixed(2), d.count]);
    }
    downloadCsv(`每日明细_${state.year}_${state.month}.csv`, rows);
  });

  $('#exportRecordBtn').addEventListener('click', () => {
    const rows = [['日期', '类型', '分类', '金额', '备注']];
    for (const r of state.data.records) {
      rows.push([r.date, r.type === 'income' ? '收入' : '支出', r.category,
        (r.type === 'income' ? '' : '-') + r.amount.toFixed(2), r.note]);
    }
    downloadCsv(`流水记录_${state.year}_${state.month}.csv`, rows);
  });
}

(async function init() {
  $('#fDate').value = todayStr();
  bindEvents();
  try {
    await loadMeta();
    await refresh();
  } catch (err) {
    toast(`初始化失败：${err.message}`, 'error');
  }
})();
