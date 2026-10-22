'use strict';

const calculator = require('../../utils/calculator');
const combine = require('../../utils/combine');
const tabs = require('../../utils/tabs');

/** 组合计算可选的「几个数组合」，可同时多选 */
const COMBO_K_OPTIONS = [2, 3, 4, 5, 6, 7, 8];

/**
 * 键盘布局（4 列）。新增按键只需在数组里加一项，模板无需改动。
 * type 对应 utils/calculator.js 的按键类型：
 *   digit / dot / sign / back / op / equals / clear
 * cls 仅用于样式：fn（功能键）/ op（运算符）/ equals（等号）/ num（数字）/ span-2（占两列）
 */
const KEYS = [
  { label: 'C', type: 'clear', cls: 'fn' },
  { label: '±', type: 'sign', cls: 'fn' },
  { label: '⌫', type: 'back', cls: 'fn' },
  { label: '÷', type: 'op', value: '÷', cls: 'op' },

  { label: '7', type: 'digit', value: '7', cls: 'num' },
  { label: '8', type: 'digit', value: '8', cls: 'num' },
  { label: '9', type: 'digit', value: '9', cls: 'num' },
  { label: '×', type: 'op', value: '×', cls: 'op' },

  { label: '4', type: 'digit', value: '4', cls: 'num' },
  { label: '5', type: 'digit', value: '5', cls: 'num' },
  { label: '6', type: 'digit', value: '6', cls: 'num' },
  { label: '-', type: 'op', value: '-', cls: 'op' },

  { label: '1', type: 'digit', value: '1', cls: 'num' },
  { label: '2', type: 'digit', value: '2', cls: 'num' },
  { label: '3', type: 'digit', value: '3', cls: 'num' },
  { label: '+', type: 'op', value: '+', cls: 'op' },

  { label: '0', type: 'digit', value: '0', cls: 'num span-2' },
  { label: '.', type: 'dot', cls: 'num' },
  { label: '=', type: 'equals', cls: 'op equals' },
];

Page({
  data: {
    display: '0',
    expression: '',
    hasError: false,
    keys: KEYS,

    // 计算器折叠状态：默认收起为右下角悬浮按钮，点击后展开
    calcOpen: false,

    // 临时图片：仅保存在页面内存中，不落盘、不上传；点击「清除」或离开页面即清空
    tempImage: '',

    // 组合计算：comboKs 为已选中的组合方式（可同时选多个），结果只给一个总数
    // comboReady：输入框里有有效数字时才显示组合方式与结果
    comboInput: '',
    comboKs: [2],
    comboOptions: [],
    comboReady: false,
    comboLabel: '2',
    comboSum: '',
    comboCount: 0,
    comboError: '',
    comboNotice: '',
  },

  state: null,

  onLoad() {
    this.state = calculator.initialState();
    this.syncView();
  },

  onShow() {
    // 按路由同步自定义 tabBar 的选中项
    tabs.sync(this);
  },

  onHide() {
    // 切走时收起，避免下次进入仍停留在展开状态
    if (this.data.calcOpen) this.setData({ calcOpen: false });
    // 离开页面即丢弃临时图片，下次进入需重新选择
    if (this.data.tempImage) this.setData({ tempImage: '' });
  },

  /** 展开计算器 */
  openCalc() {
    wx.hideKeyboard(); // 先收起组合计算的键盘，避免与浮层重叠
    this.setData({ calcOpen: true });
  },

  /** 收起计算器 */
  closeCalc() {
    this.setData({ calcOpen: false });
  },

  /* ------------------------------ 临时图片 ------------------------------ */

  /**
   * 选择本地图片并在页面内直接展示。
   * 只在页面 data 中保留临时路径，不写缓存、不上传，点击「清除」或离开页面即失效。
   */
  chooseTempImage() {
    const showImage = (paths) => {
      const tempImage = (paths || [])[0];
      if (!tempImage) return;
      this.setData({ tempImage });
    };

    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: (res) => showImage((res.tempFiles || []).map((file) => file.tempFilePath)),
        fail: () => {},
      });
      return;
    }

    // 兼容旧基础库
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => showImage(res.tempFilePaths),
      fail: () => {},
    });
  },

  /** 放大查看：打开系统图片预览（支持双指缩放），关闭后页面内图片仍保留 */
  previewTempImage() {
    const tempImage = this.data.tempImage;
    if (!tempImage) return;
    wx.previewImage({
      urls: [tempImage],
      current: tempImage,
    });
  },

  /** 清除临时图片，需要查看时重新选择 */
  clearTempImage() {
    this.setData({ tempImage: '' });
  },

  onKeyTap(e) {
    const { type, value } = e.currentTarget.dataset;
    this.state = calculator.press(this.state, { type, value });
    this.syncView();
  },

  /* ------------------------------ 组合计算 ------------------------------ */

  onComboInput(e) {
    this.setData({ comboInput: e.detail.value });
    this.computeCombo(e.detail.value, this.data.comboKs);
  },

  /** 点击切换一种组合方式（可同时选多个：2 个、3 个、4 个……） */
  onComboKToggle(e) {
    const k = Number(e.currentTarget.dataset.k);
    if (!k) return;

    const count = combine.parseNumbers(this.data.comboInput).values.length;
    if (count && k > count) {
      wx.showToast({ title: `只输入了 ${count} 个数，算不了 ${k} 个数的组合`, icon: 'none' });
      return;
    }

    const next = this.data.comboKs.slice();
    const index = next.indexOf(k);
    if (index >= 0) {
      if (next.length === 1) {
        wx.showToast({ title: '至少要保留一种组合方式', icon: 'none' });
        return;
      }
      next.splice(index, 1);
    } else {
      next.push(k);
    }
    next.sort((a, b) => a - b);

    this.setData({ comboKs: next });
    this.computeCombo(this.data.comboInput, next);
  },

  onComboClear() {
    this.setData({
      comboInput: '',
      comboReady: false,
      comboSum: '',
      comboCount: 0,
      comboError: '',
      comboNotice: '',
    });
  },

  /** 计算所有已选组合方式的乘积之和，只输出一个总数 */
  computeCombo(text, ks) {
    const { values, invalid } = combine.parseNumbers(text);
    const total = values.length;
    const tips = [];
    if (invalid.length) tips.push(`已忽略无法识别的内容：${invalid.join('、')}`);

    const comboOptions = COMBO_K_OPTIONS.map((k) => ({
      k,
      active: ks.indexOf(k) >= 0,
      // 输入个数不足的组合方式不可用
      enabled: k <= total,
    }));

    const usable = ks.filter((k) => k <= total);
    if (!usable.length) {
      // 没有有效数字（输入框被清空）时一并隐藏组合方式与结果
      this.setData({
        comboOptions,
        comboReady: false,
        comboSum: '',
        comboCount: 0,
        comboError: total ? `已选的组合方式至少需要 ${Math.min.apply(null, ks)} 个数，当前只有 ${total} 个` : '',
        comboNotice: tips.join('；'),
      });
      return;
    }

    const { sum, count } = combine.multiCombinationSum(values, usable);

    this.setData({
      comboOptions,
      comboReady: true,
      comboError: '',
      comboNotice: tips.join('；'),
      comboLabel: usable.join('、'),
      comboSum: combine.formatValue(sum),
      comboCount: count,
    });
  },

  /** 把计算器状态同步到界面 */
  syncView() {
    const state = this.state;
    let expression = '';

    if (state.error) {
      expression = state.error;
    } else if (state.operator && state.accumulator !== null) {
      expression = `${calculator.formatNumber(state.accumulator)} ${state.operator}`;
    } else if (state.evaluated) {
      expression = '=';
    }

    this.setData({
      display: state.display,
      expression,
      hasError: !!state.error,
    });
  },
});
