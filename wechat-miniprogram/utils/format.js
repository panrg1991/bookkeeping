/**
 * 通用格式化工具
 * 约定：金额在数据层一律以「分」为单位的整数存储，展示时再转成「元」。
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(num) {
  const value = Number(num);
  if (!Number.isFinite(value)) return String(num);
  return value < 10 ? `0${value}` : String(value);
}

/** 今天的 YYYY-MM-DD */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 安全解析 YYYY-MM-DD（iOS 不支持 new Date('2026-09-24') 这种写法） */
function parseDate(dateStr) {
  const parts = String(dateStr).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function weekday(dateStr) {
  return WEEKDAYS[parseDate(dateStr).getDay()];
}

/** 分 -> 带千分位的元，如 123456 -> "1,234.56" */
function formatMoney(cents) {
  const value = Number(cents || 0) / 100;
  const negative = value < 0;
  const parts = Math.abs(value).toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${parts[0]}.${parts[1]}`;
}

/** 分 -> 带正负号的元，利润列使用 */
function formatSigned(cents) {
  const value = Number(cents || 0);
  if (!value) return '0.00';
  return `${value > 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`;
}

/** 占比百分数（保留一位小数，返回字符串，不含 % 号） */
function formatPercent(part, total) {
  if (!total) return '0.0';
  return ((Number(part || 0) / Number(total)) * 100).toFixed(1);
}

/** 金额的展示颜色 class */
function moneyClass(cents) {
  const value = Number(cents || 0);
  if (!value) return 'zero';
  return value > 0 ? 'profit-text' : 'profit-text negative';
}

/** 把用户输入的元转成分（整数） */
function yuanToCents(input) {
  const num = typeof input === 'string' ? Number(input.replace(/[¥￥,，\s]/g, '')) : Number(input);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

/** 分 -> 用于回填输入框的元字符串，如 3550 -> "35.5" */
function centsToYuanInput(cents) {
  return String(Number(cents || 0) / 100);
}

/* ------------------------- 导入 / 导出用的解析与生成 ------------------------- */

/** 防 CSV 公式注入：以 = + @ 或制表符开头的单元格前置单引号；
 *  负号开头仅在不是纯数字时才处理，避免把负数金额误判为公式 */
function csvSafe(value) {
  const text = String(value == null ? '' : value);
  if (/^[=+@\t\r]/.test(text) || (/^-/.test(text) && !/^-?\d+(\.\d+)?$/.test(text))) {
    return `'${text}`;
  }
  return text;
}

/** 记录数组 -> CSV 文本（导出到剪贴板，粘贴进 Excel 即可） */
function toCsv(records) {
  const lines = [['日期', '类型', '分类', '金额', '备注'].join(',')];
  (records || []).forEach((item) => {
    const cells = [
      item.date,
      item.type === 'income' ? '收入' : '支出',
      item.category,
      `${item.type === 'income' ? '' : '-'}${(item.amountCents / 100).toFixed(2)}`,
      item.note,
    ].map((cell) => {
      const text = csvSafe(cell);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    });
    lines.push(cells.join(','));
  });
  return lines.join('\r\n');
}

/** 单笔金额 / 单价上限（分），与后端 db.js、云函数保持一致 */
const MAX_AMOUNT_CENTS = 1e14;

/** 校验是否为真实存在的日历日期（如 2026-02-30、2026-13-01 均视为非法） */
function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const ts = new Date(Date.UTC(y, m - 1, d));
  return ts.getUTCFullYear() === y && ts.getUTCMonth() === m - 1 && ts.getUTCDate() === d;
}

/** 解析各种日期写法为 YYYY-MM-DD，无法识别或不是有效日期时返回 null */
function toDateString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  let result = null;
  let match = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (match) result = `${match[1]}-${pad2(Number(match[2]))}-${pad2(Number(match[3]))}`;
  else {
    match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (match) result = `${match[1]}-${match[2]}-${match[3]}`;
  }
  return result && isValidDate(result) ? result : null;
}

/** 解析类型写法为 income / expense，无法识别时返回 null */
function toType(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (['支出', 'expense', 'out', 'e', '花费', '-'].indexOf(text) >= 0) return 'expense';
  if (['收入', 'income', 'in', 'i', '收', '+'].indexOf(text) >= 0) return 'income';
  return null;
}

/** 解析金额（元）为分，非法时返回 null */
function toAmountCents(value) {
  if (value == null) return null;
  const num = Number(String(value).replace(/[¥￥,，\s]/g, ''));
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

module.exports = {
  // WEEKDAYS / parseDate 仅本模块内部使用（weekday 依赖），不对外导出
  pad2,
  todayStr,
  weekday,
  isValidDate,
  MAX_AMOUNT_CENTS,
  formatMoney,
  formatSigned,
  formatPercent,
  moneyClass,
  yuanToCents,
  centsToYuanInput,
  toCsv,
  toDateString,
  toType,
  toAmountCents,
};
