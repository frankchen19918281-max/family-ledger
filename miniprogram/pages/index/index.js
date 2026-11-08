const app = getApp();
const Engine = require('../../utils/engine.js');
const fm = Engine.formatMoney;

Page({
  data: {
    currentTab: 'dashboard', // dashboard | add | ledger | dengbao | budget
    activePeriod: '2026-10',
    periodOptions: [],
    periodIndex: 9,
    familyCode: 'cq2026',
    syncOnline: false,

    // 视图格式化数据
    view: {},

    // 记一笔表单
    addForm: {
      role: 'c', // c | q | dengbao
      date: '2026-11-01',
      amount: '',
      type: '支出',
      purpose: '日常',
      payer: 'q',
      category: '餐饮外卖',
      note: '',
      editingId: null,
      editingRole: null
    },
    typeOptions: ['支出', '收入', '退款', '存入', '取出'],
    purposeOptions: ['日常', '必要开支', '许愿池'],
    categoryOptions: [],

    // 流水筛选
    ledgerFilter: {
      role: 'all',
      purpose: 'all',
      onlyCurrentPeriod: true
    },
    filteredLedger: [],

    // 预算子Tab
    budgetSubTab: 'necessary', // necessary | wish | sync
    budgetRole: 'c',
    newBudgetName: '',
    newBudgetAmount: '',
    newBudgetMonths: '12'
  },

  onLoad() {
    this.initPeriods();
    this.refreshReport();
    this.pullRemote();
  },

  initPeriods() {
    const list = [];
    for (let y = 2026; y <= 2027; y++) {
      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        list.push(Engine.getPeriodRange(key));
      }
    }
    const idx = list.findIndex((p) => p.periodKey === this.data.activePeriod);
    this.setData({
      periodOptions: list,
      periodIndex: idx >= 0 ? idx : 9
    });
  },

  pullRemote() {
    app.pullFromRemote((ok) => {
      this.setData({ syncOnline: !!ok });
      this.refreshReport();
    });
  },

  getPurposeListByType(type) {
    if (type === '支出' || type === '退款') return ['日常', '必要开支', '许愿池'];
    if (type === '收入') return ['工资', '意外之喜', '日常', '必要开支'];
    if (type === '存入' || type === '取出') return ['金蛋', '许愿池', '其他储蓄'];
    return ['日常'];
  },

  refreshReport() {
    const rawData = app.globalData.ledgerData;
    const r = Engine.computeFullReport(rawData, this.data.activePeriod);
    const alloc = r.currentAllocation;
    const track = r.annualTracking;
    const db = r.dengbaoReport;

    const view = {
      periodLabel: r.periodRange.label,
      startDate: r.periodRange.startDate,
      endDate: r.periodRange.endDate,
      familyPocket: fm(alloc.family.remainingPocket),
      cPocket: fm(alloc.c.remainingPocket),
      qPocket: fm(alloc.q.remainingPocket),
      cDaily: fm(alloc.c.dailyAllowance),
      qDaily: fm(alloc.q.dailyAllowance),
      cDailySpent: fm(alloc.c.dailyNetSpent, false),
      qDailySpent: fm(alloc.q.dailyNetSpent, false),
      cPrevBal: fm(alloc.c.prevBalance),
      qPrevBal: fm(alloc.q.prevBalance),

      // 分配表
      cSalary: fm(alloc.c.salary),
      qSalary: fm(alloc.q.salary),
      famSalary: fm(alloc.family.salary),
      cNecMon: fm(alloc.c.necessaryMonthly),
      qNecMon: fm(alloc.q.necessaryMonthly),
      famNecMon: fm(alloc.family.necessaryMonthly),
      cGoldFixed: fm(alloc.c.fixedGoldenEgg),
      qGoldFixed: fm(alloc.q.fixedGoldenEgg),
      famGoldFixed: fm(alloc.family.fixedGoldenEgg),
      cGoldSup: fm(alloc.c.goldenEggSupplement),
      qGoldSup: fm(alloc.q.goldenEggSupplement),
      famGoldSup: fm(alloc.family.goldenEggSupplement),
      cGoldTotal: fm(alloc.c.goldenEggTotal),
      qGoldTotal: fm(alloc.q.goldenEggTotal),
      famGoldTotal: fm(alloc.family.goldenEggTotal),
      cWishMon: fm(alloc.c.wishMonthly),
      qWishMon: fm(alloc.q.wishMonthly),
      famWishMon: fm(alloc.family.wishMonthly),
      famDaily: fm(alloc.family.dailyAllowance),
      cExtraTrans: fm(alloc.c.extraTransfer),
      qExtraTrans: fm(alloc.q.extraTransfer),
      famExtraTrans: fm(alloc.family.extraTransfer),

      // 本期消费
      cNecSpent: fm(alloc.c.necessaryNetSpent, false),
      qNecSpent: fm(alloc.q.necessaryNetSpent, false),
      famNecSpent: fm(alloc.family.necessaryNetSpent, false),
      cWishSpent: fm(alloc.c.wishNetSpent, false),
      qWishSpent: fm(alloc.q.wishNetSpent, false),
      famWishSpent: fm(alloc.family.wishNetSpent, false),
      cTotalSpent: fm(alloc.c.totalNetSpent, false),
      qTotalSpent: fm(alloc.q.totalNetSpent, false),
      famTotalSpent: fm(alloc.family.totalNetSpent, false),

      // 年度预算跟踪
      budgetYear: track.budgetYear,
      cNecQuota: fm(track.c.necQuota, false),
      cNecYearSpent: fm(track.c.necSpent, false),
      cNecRem: fm(track.c.necRemaining, false),
      cNecPct: Math.min(100, (track.c.necRatio * 100)).toFixed(1),
      cNecStatus: track.c.necStatus,

      qNecQuota: fm(track.q.necQuota, false),
      qNecYearSpent: fm(track.q.necSpent, false),
      qNecRem: fm(track.q.necRemaining, false),
      qNecPct: Math.min(100, (track.q.necRatio * 100)).toFixed(1),
      qNecStatus: track.q.necStatus,

      cWishQuota: fm(track.c.wishQuota, false),
      cWishYearSpent: fm(track.c.wishSpent, false),
      cWishRem: fm(track.c.wishRemaining, false),
      cWishPct: Math.min(100, (track.c.wishRatio * 100)).toFixed(1),
      cWishStatus: track.c.wishStatus,

      qWishQuota: fm(track.q.wishQuota, false),
      qWishYearSpent: fm(track.q.wishSpent, false),
      qWishRem: fm(track.q.wishRemaining, false),
      qWishPct: Math.min(100, (track.q.wishRatio * 100)).toFixed(1),
      qWishStatus: track.q.wishStatus,

      // 噔宝专区
      dbQuota: fm(db.current.quota, false),
      dbSpent: fm(db.current.spent, false),
      dbBalance: fm(db.current.balance, false),
      dbCPaid: fm(db.current.cPaid, false),
      dbQPaid: fm(db.current.qPaid, false),
      dbStatus: db.current.status,

      // 预算清单
      necessaryList: r.budgets[this.data.budgetRole].necessaryItems.map((it) => ({
        ...it,
        annualBudgetText: it.annualBudget !== null ? fm(it.annualBudget, false) : '未设',
        monthlyText: it.monthly !== null ? fm(it.monthly) : '--'
      })),
      wishList: r.budgets[this.data.budgetRole].wishItems.map((it) => ({
        ...it,
        annualQuotaText: it.annualQuota !== null ? fm(it.annualQuota, false) : '未设',
        monthlyText: it.monthly !== null ? fm(it.monthly) : '--'
      }))
    };

    // 整理流水筛选
    const lf = this.data.ledgerFilter;
    const allTx = [...r.transactions.c, ...r.transactions.q, ...r.transactions.dengbao];
    const filteredLedger = allTx
      .filter((tx) => {
        if (lf.onlyCurrentPeriod && tx.periodKey !== this.data.activePeriod) return false;
        if (lf.role !== 'all' && tx.member !== lf.role) return false;
        if (lf.purpose !== 'all') {
          if (lf.purpose === '孩子') {
            if (tx.member !== 'dengbao') return false;
          } else if (tx.purpose !== lf.purpose) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map((tx) => ({
        ...tx,
        amountText: fm(tx.amount, false),
        afterQuotaText: tx.afterQuota !== null && tx.afterQuota !== undefined ? fm(tx.afterQuota, false) : null
      }));

    // 整理表单选项
    const f = this.data.addForm;
    const isDb = f.role === 'dengbao';
    const typeOptions = isDb ? ['支出', '退款'] : ['支出', '收入', '退款', '存入', '取出'];
    const purposeOptions = this.getPurposeListByType(f.type);
    const categoryOptions = isDb ? rawData.dengbaoCategories : rawData.categories;

    this.setData({
      familyCode: rawData.familyCode || 'cq2026',
      view,
      filteredLedger,
      typeOptions,
      purposeOptions,
      categoryOptions
    });
  },

  // 切换底部 Tab
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
    this.refreshReport();
  },

  // 账期切换
  onPeriodPickerChange(e) {
    const idx = Number(e.detail.value);
    const item = this.data.periodOptions[idx];
    if (!item) return;
    this.setData({
      periodIndex: idx,
      activePeriod: item.periodKey
    });
    this.refreshReport();
  },

  stepPeriod(e) {
    const delta = Number(e.currentTarget.dataset.delta);
    let nextIdx = this.data.periodIndex + delta;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= this.data.periodOptions.length) nextIdx = this.data.periodOptions.length - 1;
    const item = this.data.periodOptions[nextIdx];
    this.setData({
      periodIndex: nextIdx,
      activePeriod: item.periodKey
    });
    this.refreshReport();
  },

  // 记一笔事件
  selectAddRole(e) {
    const role = e.currentTarget.dataset.role;
    const cat = role === 'dengbao' ? '孩子用品' : '餐饮外卖';
    this.setData({
      'addForm.role': role,
      'addForm.type': '支出',
      'addForm.category': cat
    });
    this.refreshReport();
  },

  selectAddType(e) {
    const type = e.currentTarget.dataset.type;
    const purposes = this.getPurposeListByType(type);
    this.setData({
      'addForm.type': type,
      'addForm.purpose': purposes[0]
    });
    this.refreshReport();
  },

  selectAddPurpose(e) {
    this.setData({ 'addForm.purpose': e.currentTarget.dataset.purpose });
  },

  selectAddPayer(e) {
    this.setData({ 'addForm.payer': e.currentTarget.dataset.payer });
  },

  selectAddCategory(e) {
    const cat = e.currentTarget.dataset.cat;
    if (this.data.addForm.role !== 'dengbao' && (cat === '孩子用品' || cat === '噔宝')) {
      wx.showModal({
        title: '噔宝消费专表提醒',
        content: 'Excel 规则：「孩子用品/噔宝」消费需记在【噔宝支出】专表，是否自动切换？',
        success: (res) => {
          if (res.confirm) {
            this.setData({
              'addForm.payer': this.data.addForm.role,
              'addForm.role': 'dengbao',
              'addForm.category': '孩子用品'
            });
            this.refreshReport();
          }
        }
      });
      return;
    }
    this.setData({ 'addForm.category': cat });
  },

  onDateChange(e) {
    this.setData({ 'addForm.date': e.detail.value });
  },

  onAmountInput(e) {
    this.setData({ 'addForm.amount': e.detail.value });
  },

  onNoteInput(e) {
    this.setData({ 'addForm.note': e.detail.value });
  },

  submitTransaction() {
    const f = this.data.addForm;
    const numAmt = Number(f.amount);
    if (!f.date || f.amount === '' || isNaN(numAmt) || numAmt < 0) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      return;
    }

    const rawData = app.globalData.ledgerData;
    const newId = f.editingId || 'tx_' + Date.now();

    if (f.role === 'dengbao') {
      const item = {
        id: newId,
        date: f.date,
        amount: numAmt,
        payer: f.payer || 'q',
        type: f.type,
        category: f.category || '孩子用品',
        note: f.note || ''
      };
      const err = Engine.validateDengbaoTx(item);
      if (err) {
        wx.showToast({ title: err, icon: 'none' });
        return;
      }
      rawData.transactions.dengbao.push(item);
    } else {
      const item = {
        id: newId,
        date: f.date,
        amount: numAmt,
        type: f.type,
        purpose: f.purpose,
        category: f.category || '',
        note: f.note || ''
      };
      const err = Engine.validateMemberTx(item);
      if (err) {
        wx.showToast({ title: err, icon: 'none' });
        return;
      }
      rawData.transactions[f.role].push(item);
    }

    const pInfo = Engine.getPeriodFromDate(f.date);
    app.saveLedgerData(rawData, (ok) => {
      this.setData({ syncOnline: !!ok });
    });

    this.setData({
      activePeriod: pInfo.periodKey,
      'addForm.amount': '',
      'addForm.note': '',
      currentTab: 'dashboard'
    });
    this.refreshReport();
    wx.showToast({ title: '已记入账本', icon: 'success' });
  },

  // 流水筛选与删除
  selectLedgerRole(e) {
    this.setData({ 'ledgerFilter.role': e.currentTarget.dataset.role });
    this.refreshReport();
  },

  selectLedgerPurpose(e) {
    this.setData({ 'ledgerFilter.purpose': e.currentTarget.dataset.purpose });
    this.refreshReport();
  },

  toggleLedgerPeriod() {
    this.setData({ 'ledgerFilter.onlyCurrentPeriod': !this.data.ledgerFilter.onlyCurrentPeriod });
    this.refreshReport();
  },

  deleteTx(e) {
    const { id, role } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: '确定删除这笔流水记录吗？',
      success: (res) => {
        if (res.confirm) {
          const rawData = app.globalData.ledgerData;
          rawData.transactions[role] = (rawData.transactions[role] || []).filter((t) => t.id !== id);
          app.saveLedgerData(rawData);
          this.refreshReport();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  },

  // 预算与同步事件
  selectBudgetSub(e) {
    this.setData({ budgetSubTab: e.currentTarget.dataset.sub });
    this.refreshReport();
  },

  selectBudgetRole(e) {
    this.setData({ budgetRole: e.currentTarget.dataset.role });
    this.refreshReport();
  },

  onFamilyCodeInput(e) {
    this.setData({ familyCode: e.detail.value });
  },

  saveFamilyCode() {
    const rawData = app.globalData.ledgerData;
    rawData.familyCode = this.data.familyCode.trim() || 'cq2026';
    app.saveLedgerData(rawData, () => {
      this.pullRemote();
      wx.showToast({ title: '已同步家庭口令', icon: 'success' });
    });
  },

  resetToInitial() {
    wx.showModal({
      title: '恢复初始 Excel 数据',
      content: '确定重置为 2026-2027年度家庭共同记账.xlsx 初始数据吗？',
      success: (res) => {
        if (res.confirm) {
          const fresh = JSON.parse(JSON.stringify(Engine.INITIAL_DATA));
          app.saveLedgerData(fresh);
          this.refreshReport();
          wx.showToast({ title: '已恢复初始数据', icon: 'success' });
        }
      }
    });
  }
});
