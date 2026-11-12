const app = getApp();
const Engine = require('../../utils/engine.js');
const fm = Engine.formatMoney;

function addMonthsStr(baseStr, months) {
  const src = baseStr && /^\d{4}-\d{2}-\d{2}$/.test(baseStr) ? baseStr : Engine.getTodayDateStr();
  const [y0, m0, d0] = src.split('-').map((n) => parseInt(n, 10));
  const totalM = y0 * 12 + (m0 - 1) + months;
  const ny = Math.floor(totalM / 12);
  const nm = (totalM % 12) + 1;
  const maxDay = new Date(ny, nm, 0).getDate();
  const nd = Math.min(d0, maxDay);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

Page({
  data: {
    currentTab: 'dashboard', // dashboard | add | ledger | dengbao | cards | budget
    activePeriod: Engine.getCurrentPeriodInfo().periodKey,
    lastAutoPeriod: Engine.getCurrentPeriodInfo().periodKey,
    periodOptions: [],
    periodIndex: 9,
    familyCode: 'cq2026',
    syncOnline: false,

    // 视图格式化数据
    view: {},

    // 记一笔表单
    addForm: {
      role: 'c', // c | q | dengbao
      date: Engine.getTodayDateStr(),
      amount: '',
      type: '支出',
      purpose: '日常',
      budgetItemId: '',
      payer: 'q',
      category: '餐饮外卖',
      note: '',
      editingId: null,
      editingRole: null
    },
    typeOptions: ['支出', '收入', '退款', '存入', '取出'],
    purposeOptions: ['日常', '必要开支', '许愿池'],
    budgetItemOptions: [],
    categoryOptions: [],

    // 流水筛选
    ledgerFilter: {
      role: 'all',
      purpose: 'all',
      onlyCurrentPeriod: true,
      chartDim: 'category'
    },
    filteredLedger: [],
    expenseChart: { totalText: '0', items: [], gradient: '' },

    // 会员储值卡表单与列表
    cardFormOpen: false,
    cardForm: {
      name: '',
      cardType: 'stored',
      owner: 'family',
      price: '',
      totalValue: '',
      openDate: Engine.getTodayDateStr(),
      expiryDate: addMonthsStr(Engine.getTodayDateStr(), 12),
      recordedInLedger: false,
      note: ''
    },
    memberCards: [],
    cardsSummary: { activeCount: 0, totalStoredRem: '0', totalPaid: '0', alertCount: 0 },

    // 预算子Tab
    budgetSubTab: 'necessary', // necessary | wish | sync
    budgetRole: 'c',
    newBudgetName: '',
    newBudgetAmount: '',
    newBudgetMonths: '12'
  },

  onLoad() {
    this.syncAutoPeriod(true);
    this.refreshReport();
    this.pullRemote();
  },

  onShow() {
    this.syncAutoPeriod(false);
    this.refreshReport();
  },

  syncAutoPeriod(forceInit) {
    const autoInfo = Engine.getCurrentPeriodInfo();
    if (forceInit || autoInfo.periodKey !== this.data.lastAutoPeriod) {
      this.setData({
        activePeriod: autoInfo.periodKey,
        lastAutoPeriod: autoInfo.periodKey,
        'addForm.date': autoInfo.todayStr
      });
    }
    this.initPeriods();
  },

  initPeriods() {
    const autoInfo = Engine.getCurrentPeriodInfo();
    const maxYear = Math.max(2027, autoInfo.budgetYear + 1);
    const list = [];
    for (let y = 2026; y <= maxYear; y++) {
      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        const r = Engine.getPeriodRange(key);
        list.push({
          ...r,
          label: key === autoInfo.periodKey ? `${r.label} · 当期` : r.label
        });
      }
    }
    const idx = list.findIndex((p) => p.periodKey === this.data.activePeriod);
    this.setData({
      periodOptions: list,
      periodIndex: idx >= 0 ? idx : 0
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
    const tr = r.treasurySummary;

    const view = {
      periodLabel: r.periodRange.label,
      startDate: r.periodRange.startDate,
      endDate: r.periodRange.endDate,
      familyPocket: fm(alloc.family.remainingPocket, false),
      cPocket: fm(alloc.c.remainingPocket, false),
      qPocket: fm(alloc.q.remainingPocket, false),
      cDaily: fm(alloc.c.dailyAllowance, false),
      qDaily: fm(alloc.q.dailyAllowance, false),
      cDailySpent: fm(alloc.c.dailyNetSpent, false),
      qDailySpent: fm(alloc.q.dailyNetSpent, false),
      famDailySpent: fm(alloc.family.dailyNetSpent, false),
      cPrevBal: fm(alloc.c.prevBalance, false),
      qPrevBal: fm(alloc.q.prevBalance, false),

      // 家庭金蛋与心愿金库
      goldenTotal: fm(tr.goldenEgg.totalDeposit, false),
      goldenC: fm(tr.goldenEgg.cDeposit, false),
      goldenQ: fm(tr.goldenEgg.qDeposit, false),
      goldenPct: Math.round(tr.goldenEgg.yearProgressPct || 0),
      wishPoolBal: fm(tr.wishPool.availableBalance, false),
      wishPoolLabel: tr.wishPool.hasExplicitDeposit ? '许愿池专户余' : '许愿池预留余',
      wishYearSpent: fm(tr.wishPool.totalSpent, false),

      // 分配表
      cSalary: fm(alloc.c.salary, false),
      qSalary: fm(alloc.q.salary, false),
      famSalary: fm(alloc.family.salary, false),
      cNecMon: fm(alloc.c.necessaryMonthly, false),
      qNecMon: fm(alloc.q.necessaryMonthly, false),
      famNecMon: fm(alloc.family.necessaryMonthly, false),
      cGoldFixed: fm(alloc.c.fixedGoldenEgg, false),
      qGoldFixed: fm(alloc.q.fixedGoldenEgg, false),
      famGoldFixed: fm(alloc.family.fixedGoldenEgg, false),
      cGoldSup: fm(alloc.c.goldenEggSupplement, false),
      qGoldSup: fm(alloc.q.goldenEggSupplement, false),
      famGoldSup: fm(alloc.family.goldenEggSupplement, false),
      cGoldTotal: fm(alloc.c.goldenEggTotal, false),
      qGoldTotal: fm(alloc.q.goldenEggTotal, false),
      famGoldTotal: fm(alloc.family.goldenEggTotal, false),
      cWishMon: fm(alloc.c.wishMonthly, false),
      qWishMon: fm(alloc.q.wishMonthly, false),
      famWishMon: fm(alloc.family.wishMonthly, false),
      famDaily: fm(alloc.family.dailyAllowance, false),
      cExtraTrans: fm(alloc.c.extraTransfer, false),
      qExtraTrans: fm(alloc.q.extraTransfer, false),
      famExtraTrans: fm(alloc.family.extraTransfer, false),

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

      // 预算清单（含每项已花/剩余进度）
      necessaryList: r.budgets[this.data.budgetRole].necessaryItems.map((it) => ({
        ...it,
        annualBudgetText: it.annualBudget !== null ? fm(it.annualBudget, false) : '未设',
        monthlyText: it.monthly !== null ? fm(it.monthly, false) : '--',
        spentText: fm(it.spent || 0, false),
        remText: it.remaining !== null ? fm(it.remaining, false) : '--',
        pct: Math.min(100, Math.round((it.ratio || 0) * 100))
      })),
      wishList: r.budgets[this.data.budgetRole].wishItems.map((it) => ({
        ...it,
        annualQuotaText: it.annualQuota !== null ? fm(it.annualQuota, false) : '未设',
        monthlyText: it.monthly !== null ? fm(it.monthly, false) : '--',
        spentText: fm(it.spent || 0, false),
        remText: it.remaining !== null ? fm(it.remaining, false) : '--',
        pct: Math.min(100, Math.round((it.ratio || 0) * 100))
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
    const needBudgetItem =
      !isDb && (f.type === '支出' || f.type === '退款') && (f.purpose === '必要开支' || f.purpose === '许愿池');
    const budgetItemOptions = needBudgetItem
      ? (f.purpose === '必要开支' ? r.budgets[f.role].necessaryItems : r.budgets[f.role].wishItems)
          .filter((it) => it.name && it.name !== '噔宝' && !it.isOffset)
          .map((it) => ({
            id: it.id,
            name: it.name,
            remText: it.remaining !== null ? fm(it.remaining, false) : null
          }))
      : [];

    // 整理会员储值卡数据
    const cr = r.memberCardsReport;
    const ownerLabelMap = { family: '家庭共用', c: 'c', q: 'q', dengbao: '噔宝' };
    const typeLabelMap = { stored: '储值卡', times: '计次卡', period: '期限会员' };
    const memberCards = cr.cards.map((c) => ({
      ...c,
      ownerLabel: ownerLabelMap[c.owner] || '家庭共用',
      typeLabel: typeLabelMap[c.cardType] || '储值卡',
      priceText: fm(c.price, false),
      remText: fm(c.remainingValue, false),
      totalText: fm(c.totalValue, false)
    }));

    this.setData({
      familyCode: rawData.familyCode || 'cq2026',
      view,
      filteredLedger,
      expenseChart: this.buildExpenseChart(filteredLedger, lf.chartDim || 'category'),
      typeOptions,
      purposeOptions,
      budgetItemOptions,
      categoryOptions,
      memberCards,
      cardsSummary: {
        activeCount: cr.activeCount,
        totalStoredRem: fm(cr.totalStoredRemaining, false),
        totalPaid: fm(cr.totalPaidPrice, false),
        alertCount: cr.alertCount
      }
    });
  },

  buildExpenseChart(list, dim) {
    const palette = ['#0d9488', '#3b82f6', '#ec4899', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#64748b'];
    const groupMap = {};
    (list || []).forEach((tx) => {
      if (tx.type !== '支出' && tx.type !== '退款') return;
      const amt = Number(tx.amount) || 0;
      const net = tx.type === '支出' ? amt : -amt;
      let key = '';
      if (dim === 'category') {
        key = tx.category || (tx.member === 'dengbao' ? '孩子用品' : tx.purpose || '其他');
      } else if (dim === 'purpose') {
        key = tx.member === 'dengbao' ? '噔宝支出' : tx.purpose || '其他';
      } else {
        key = tx.member === 'dengbao' ? `噔宝(${tx.payer}付)` : tx.member === 'c' ? 'c（你）' : 'q（她）';
      }
      groupMap[key] = (groupMap[key] || 0) + net;
    });

    const entries = Object.entries(groupMap)
      .filter(([, val]) => val > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((acc, [, v]) => acc + v, 0);

    let display = entries;
    if (entries.length > 6) {
      const top5 = entries.slice(0, 5);
      const other = entries.slice(5).reduce((acc, [, v]) => acc + v, 0);
      display = [...top5, ['其他类目合计', other]];
    }

    let curPct = 0;
    const gradParts = [];
    const items = display.map(([name, val], idx) => {
      const pctNum = total > 0 ? (val / total) * 100 : 0;
      const nextPct = curPct + pctNum;
      const color = palette[idx % palette.length];
      gradParts.push(`${color} ${curPct.toFixed(1)}% ${nextPct.toFixed(1)}%`);
      curPct = nextPct;
      return {
        name,
        valText: fm(val, false),
        pct: pctNum.toFixed(1),
        color
      };
    });

    return {
      totalText: fm(total, false),
      items,
      gradient: gradParts.length > 0 ? `conic-gradient(${gradParts.join(', ')})` : 'conic-gradient(#e2e8f0 0% 100%)'
    };
  },

  selectChartDim(e) {
    this.setData({ 'ledgerFilter.chartDim': e.currentTarget.dataset.dim });
    this.refreshReport();
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
      'addForm.budgetItemId': '',
      'addForm.category': cat
    });
    this.refreshReport();
  },

  selectAddType(e) {
    const type = e.currentTarget.dataset.type;
    const purposes = this.getPurposeListByType(type);
    this.setData({
      'addForm.type': type,
      'addForm.purpose': purposes[0],
      'addForm.budgetItemId': ''
    });
    this.refreshReport();
  },

  selectAddPurpose(e) {
    this.setData({
      'addForm.purpose': e.currentTarget.dataset.purpose,
      'addForm.budgetItemId': ''
    });
    this.refreshReport();
  },

  selectAddBudgetItem(e) {
    this.setData({ 'addForm.budgetItemId': e.currentTarget.dataset.bitem || '' });
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
    const nowIso = new Date().toISOString();

    if (f.role === 'dengbao') {
      const item = {
        id: newId,
        date: f.date,
        amount: Engine.round2(numAmt),
        payer: f.payer || 'q',
        type: f.type,
        category: f.category || '孩子用品',
        note: f.note || '',
        updatedAt: nowIso
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
        amount: Engine.round2(numAmt),
        type: f.type,
        purpose: f.purpose,
        category: f.category || '',
        note: f.note || '',
        updatedAt: nowIso
      };
      if (
        (f.type === '支出' || f.type === '退款') &&
        (f.purpose === '必要开支' || f.purpose === '许愿池') &&
        f.budgetItemId
      ) {
        const srcList =
          f.purpose === '必要开支' ? rawData.necessaryBudgets[f.role] || [] : rawData.wishBudgets[f.role] || [];
        const subObj = srcList.find((x) => x.id === f.budgetItemId);
        item.budgetItemId = f.budgetItemId;
        if (subObj) item.budgetItemName = subObj.name;
      }
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
      'addForm.budgetItemId': '',
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
          rawData.deletedTxIds = rawData.deletedTxIds || [];
          if (!rawData.deletedTxIds.includes(id)) rawData.deletedTxIds.push(id);
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

  // 会员储值卡事件
  toggleCardForm() {
    this.setData({ cardFormOpen: !this.data.cardFormOpen });
  },

  selectCardType(e) {
    this.setData({ 'cardForm.cardType': e.currentTarget.dataset.type });
  },

  selectCardOwner(e) {
    this.setData({ 'cardForm.owner': e.currentTarget.dataset.owner });
  },

  onCardFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`cardForm.${field}`]: e.detail.value });
  },

  onCardDateChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`cardForm.${field}`]: e.detail.value });
  },

  quickCardExpiry(e) {
    const m = e.currentTarget.dataset.months;
    if (m === 'none') {
      this.setData({ 'cardForm.expiryDate': '' });
    } else {
      const nextDate = addMonthsStr(this.data.cardForm.openDate || Engine.getTodayDateStr(), Number(m) || 12);
      this.setData({ 'cardForm.expiryDate': nextDate });
    }
  },

  toggleCardRecorded() {
    this.setData({ 'cardForm.recordedInLedger': !this.data.cardForm.recordedInLedger });
  },

  submitMemberCard() {
    const cf = this.data.cardForm;
    const cleanName = (cf.name || '').trim();
    if (!cleanName) {
      wx.showToast({ title: '请填写卡名称', icon: 'none' });
      return;
    }
    const price = Number(cf.price || 0);
    const totalVal = cf.totalValue !== '' ? Number(cf.totalValue) : price;
    const rawData = app.globalData.ledgerData;
    rawData.memberCards = Array.isArray(rawData.memberCards) ? rawData.memberCards : [];
    rawData.memberCards.push({
      id: 'card_' + Date.now(),
      name: cleanName,
      cardType: cf.cardType || 'stored',
      owner: cf.owner || 'family',
      price: Engine.round2(price),
      totalValue: Engine.round2(totalVal),
      remainingValue: Engine.round2(totalVal),
      openDate: cf.openDate || Engine.getTodayDateStr(),
      expiryDate: cf.expiryDate || '',
      recordedInLedger: !!cf.recordedInLedger,
      note: (cf.note || '').trim(),
      archived: false,
      updatedAt: new Date().toISOString(),
      logs: []
    });
    app.saveLedgerData(rawData);
    this.setData({
      cardFormOpen: false,
      'cardForm.name': '',
      'cardForm.price': '',
      'cardForm.totalValue': '',
      'cardForm.recordedInLedger': false,
      'cardForm.note': ''
    });
    this.refreshReport();
    wx.showToast({ title: '已存入储值卡', icon: 'success' });
  },

  deleteMemberCard(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '确定删除这张会员储值卡记录吗？',
      success: (res) => {
        if (res.confirm) {
          const rawData = app.globalData.ledgerData;
          rawData.deletedCardIds = rawData.deletedCardIds || [];
          if (!rawData.deletedCardIds.includes(id)) rawData.deletedCardIds.push(id);
          rawData.memberCards = (rawData.memberCards || []).filter((c) => c.id !== id);
          app.saveLedgerData(rawData);
          this.refreshReport();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
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
