/**
 * 2026-2027 家庭共同记账 - 核心初始数据与计算引擎
 * 100% 还原《2026-2027年度家庭共同记账.xlsx》全部7张表公式与预置数据
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FamilyFinanceEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // 默认预置账本数据（从 Excel 完整提取）
  const INITIAL_DATA = {
    version: '2026.1',
    familyCode: 'cq2026',
    updatedAt: '2026-11-08T00:30:00+08:00',
    settings: {
      budgetYear: 2026,
      statYear: 2026,
      warningThreshold: 0.8,
      currentPeriod: '2026-10', // 对应 2026-10-10 ~ 2026-11-09
      dengbaoPeriod: '2026-10',
      memberNames: {
        c: 'c（你）',
        q: 'q（她）',
        dengbao: '噔宝'
      },
      // 年末结算与前期补录设置 (家庭汇总 B116:C117, B130:C130)
      yearEnd: {
        c: { priorNecessary: null, priorWish: null, actualYearEndFunds: null },
        q: { priorNecessary: null, priorWish: null, actualYearEndFunds: null }
      },
      // 月度分配个性化配置（期初校正、固定金蛋、噔宝特定账期额外额度）
      periodOverrides: {
        '2026-10': {
          c: { initAdjust: 0, fixedGoldenEgg: 2000 },
          q: { initAdjust: 0, fixedGoldenEgg: 2000 },
          dengbaoExtraQuota: 3200 // 首期 J8 = $D$3 + 3200 = 5200
        }
      },
      defaultFixedGoldenEgg: { c: 2000, q: 2000 }
    },
    categories: [
      '餐饮外卖', '买菜水果', '交通出行', '日用品', '服饰鞋包',
      '数码家电', '休闲娱乐', '社交人情', '医疗健康', '学习成长',
      '孩子用品', '旅游出游', '宠物', '其他', '工资',
      '奖金', '红包', '车位收租', '水电燃气', '物业停车',
      '保险', '话费网络', '房贷', '订阅会员', '预算结余转存', '汽车费用'
    ],
    dengbaoCategories: [
      '孩子用品', '托育早教', '餐饮出行', '医疗疫苗', '玩具绘本', '服饰鞋帽', '其他'
    ],
    necessaryBudgets: {
      c: [
        { id: 'nc1', name: '水费', annualBudget: 600, oldSpent: null },
        { id: 'nc2', name: '电费', annualBudget: 3500, oldSpent: null },
        { id: 'nc3', name: '燃气', annualBudget: 500, oldSpent: null },
        { id: 'nc4', name: '物业费', annualBudget: 2500, oldSpent: null },
        { id: 'nc5', name: '汽车保险', annualBudget: 5000, oldSpent: null },
        { id: 'nc6', name: '汽车电费', annualBudget: 1000, oldSpent: null },
        { id: 'nc7', name: '车位管理费', annualBudget: 960, oldSpent: null },
        { id: 'nc8', name: '噔宝', annualBudget: 12000, oldSpent: null },
        { id: 'nc9', name: '服装', annualBudget: 5000, oldSpent: null },
        { id: 'nc10', name: '苹果会员', annualBudget: 300, oldSpent: 198 },
        { id: 'nc11', name: '梯子', annualBudget: 100, oldSpent: null },
        { id: 'nc12', name: '网飞', annualBudget: null, oldSpent: null },
        { id: 'nc13', name: '百万医疗', annualBudget: 3000, oldSpent: null },
        { id: 'nc14', name: '房贷', annualBudget: null, oldSpent: null },
        { id: 'nc15', name: '车位收租', annualBudget: -2200, oldSpent: null },
        { id: 'nc16', name: '话费', annualBudget: null, oldSpent: null },
        { id: 'nc17', name: 'AI', annualBudget: 1000, oldSpent: null }
      ],
      q: [
        { id: 'nq1', name: '车位管理费', annualBudget: 1200, oldSpent: null },
        { id: 'nq2', name: '汽车', annualBudget: 12000, oldSpent: null },
        { id: 'nq3', name: '话费', annualBudget: 1700, oldSpent: null },
        { id: 'nq4', name: '噔宝', annualBudget: 12000, oldSpent: null },
        { id: 'nq5', name: '商业医疗', annualBudget: 2500, oldSpent: null },
        { id: 'nq6', name: '个护', annualBudget: 5000, oldSpent: null },
        { id: 'nq7', name: '保健品', annualBudget: 300, oldSpent: null },
        { id: 'nq8', name: '党费', annualBudget: 600, oldSpent: null },
        { id: 'nq9', name: '慈善一日捐', annualBudget: 200, oldSpent: null },
        { id: 'nq10', name: '各类会员费', annualBudget: 200, oldSpent: null },
        { id: 'nq11', name: '服装费', annualBudget: 5000, oldSpent: null },
        { id: 'nq12', name: '家庭杂物开支', annualBudget: 3000, oldSpent: null }
      ]
    },
    wishBudgets: {
      c: [
        { id: 'wc1', name: 'ultra3', annualQuota: 4000, months: 12, note: '' },
        { id: 'wc2', name: '国内酒店游', annualQuota: 9000, months: 12, note: '' }
      ],
      q: [
        { id: 'wq1', name: '健身', annualQuota: 1000, months: 12, note: '' },
        { id: 'wq2', name: '换手机', annualQuota: null, months: 12, note: '' },
        { id: 'wq3', name: '旅游预算', annualQuota: 7000, months: 12, note: '' },
        { id: 'wq4', name: '换车存钱', annualQuota: null, months: 12, note: '' }
      ]
    },
    transactions: {
      c: [
        { id: 'tc1', date: '2026-10-10', amount: 11747, type: '收入', purpose: '工资', category: '', note: '' },
        { id: 'tc2', date: '2026-10-13', amount: 44.72, type: '支出', purpose: '日常', category: '餐饮外卖', note: '' },
        { id: 'tc3', date: '2026-10-13', amount: 17.2, type: '支出', purpose: '日常', category: '买菜水果', note: '' },
        { id: 'tc4', date: '2026-10-15', amount: 219, type: '支出', purpose: '必要开支', category: '服饰鞋包', note: '' },
        { id: 'tc5', date: '2026-10-15', amount: 22.5, type: '支出', purpose: '日常', category: '买菜水果', note: '' },
        { id: 'tc6', date: '2026-10-17', amount: 198, type: '支出', purpose: '日常', category: '餐饮外卖', note: '' },
        { id: 'tc7', date: '2026-10-17', amount: 250, type: '支出', purpose: '日常', category: '服饰鞋包', note: '' },
        { id: 'tc8', date: '2026-10-17', amount: 979, type: '支出', purpose: '许愿池', category: '旅游出游', note: '' },
        { id: 'tc9', date: '2026-10-18', amount: 87, type: '支出', purpose: '日常', category: '餐饮外卖', note: '' },
        { id: 'tc10', date: '2026-10-25', amount: 11, type: '支出', purpose: '日常', category: '买菜水果', note: '' },
        { id: 'tc11', date: '2026-10-25', amount: 40, type: '支出', purpose: '日常', category: '学习成长', note: '' },
        { id: 'tc12', date: '2026-10-24', amount: 234, type: '支出', purpose: '日常', category: '餐饮外卖', note: '' },
        { id: 'tc13', date: '2026-10-24', amount: 16, type: '支出', purpose: '日常', category: '交通出行', note: '' },
        { id: 'tc14', date: '2026-10-23', amount: 7, type: '支出', purpose: '日常', category: '交通出行', note: '' },
        { id: 'tc15', date: '2026-10-20', amount: 479, type: '支出', purpose: '必要开支', category: '服饰鞋包', note: '' },
        { id: 'tc16', date: '2026-10-26', amount: 22.5, type: '支出', purpose: '日常', category: '买菜水果', note: '' },
        { id: 'tc17', date: '2026-10-26', amount: 210, type: '支出', purpose: '日常', category: '其他', note: '' },
        { id: 'tc18', date: '2026-10-31', amount: 170, type: '支出', purpose: '日常', category: '餐饮外卖', note: '' },
        { id: 'tc19', date: '2026-11-01', amount: 384, type: '支出', purpose: '日常', category: '服饰鞋包', note: '' },
        { id: 'tc20', date: '2026-11-01', amount: 32, type: '支出', purpose: '日常', category: '餐饮外卖', note: '' },
        { id: 'tc21', date: '2026-11-01', amount: 31.35, type: '支出', purpose: '日常', category: '交通出行', note: '' },
        { id: 'tc22', date: '2026-11-01', amount: 245, type: '支出', purpose: '必要开支', category: '订阅会员', note: '' },
        { id: 'tc23', date: '2026-10-31', amount: 955, type: '支出', purpose: '许愿池', category: '旅游出游', note: '' }
      ],
      q: [
        { id: 'tq1', date: '2026-10-14', amount: 8740, type: '收入', purpose: '工资', category: '', note: '' },
        { id: 'tq2', date: '2026-10-15', amount: 22.5, type: '支出', purpose: '日常', category: '买菜水果', note: '' },
        { id: 'tq3', date: '2026-10-17', amount: 73, type: '支出', purpose: '日常', category: '餐饮外卖', note: '' },
        { id: 'tq4', date: '2026-10-18', amount: 200, type: '支出', purpose: '日常', category: '餐饮外卖', note: '' },
        { id: 'tq5', date: '2026-10-18', amount: 138, type: '支出', purpose: '必要开支', category: '服饰鞋包', note: '' },
        { id: 'tq6', date: '2026-10-19', amount: 300, type: '支出', purpose: '必要开支', category: '汽车费用', note: '' },
        { id: 'tq7', date: '2026-10-19', amount: 56, type: '支出', purpose: '日常', category: '餐饮外卖', note: '' },
        { id: 'tq8', date: '2026-10-22', amount: 192, type: '支出', purpose: '必要开支', category: '日用品', note: '' },
        { id: 'tq9', date: '2026-10-22', amount: 478, type: '支出', purpose: '日常', category: '服饰鞋包', note: '' },
        { id: 'tq10', date: '2026-10-22', amount: 6.6, type: '支出', purpose: '日常', category: '交通出行', note: '' },
        { id: 'tq11', date: '2026-10-24', amount: 113, type: '支出', purpose: '日常', category: '餐饮外卖', note: '' },
        { id: 'tq12', date: '2026-10-28', amount: 260, type: '支出', purpose: '许愿池', category: '旅游出游', note: '' },
        { id: 'tq13', date: '2026-10-30', amount: 4100, type: '支出', purpose: '必要开支', category: '汽车费用', note: '' }
      ],
      dengbao: [
        { id: 'td1', date: '2026-10-10', amount: 80, payer: 'c', type: '支出', category: '孩子用品', note: '' },
        { id: 'td2', date: '2026-10-17', amount: 30, payer: 'q', type: '支出', category: '孩子用品', note: '' },
        { id: 'td3', date: '2026-10-17', amount: 936, payer: 'q', type: '支出', category: '孩子用品', note: '' },
        { id: 'td4', date: '2026-10-18', amount: 884, payer: 'q', type: '支出', category: '托育早教', note: '' },
        { id: 'td5', date: '2026-10-22', amount: 92, payer: 'q', type: '支出', category: '餐饮出行', note: '' },
        { id: 'td6', date: '2026-10-29', amount: 274, payer: 'q', type: '支出', category: '孩子用品', note: '' },
        { id: 'td7', date: '2026-11-01', amount: 990, payer: 'q', type: '支出', category: '餐饮出行', note: '' }
      ]
    },
    memberCards: []
  };

  // 工具函数：数值与日期处理
  function isNum(v) {
    return typeof v === 'number' && !isNaN(v);
  }

  function round2(n) {
    if (!isNum(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function formatMoney(n, showEmptyAsDash = true) {
    if (n === null || n === undefined || n === '' || isNaN(n)) {
      return showEmptyAsDash ? '--' : '0';
    }
    const num = Math.round(Number(n));
    return num.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  /**
   * 给定账期 key (如 "2026-10")，返回起始日期 "2026-10-10" 和截止日期 "2026-11-09"
   */
  function getPeriodRange(periodKey) {
    const [yStr, mStr] = periodKey.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const startDate = `${y}-${String(m).padStart(2, '0')}-10`;
    let nextY = y;
    let nextM = m + 1;
    if (nextM > 12) {
      nextM = 1;
      nextY += 1;
    }
    const endDate = `${nextY}-${String(nextM).padStart(2, '0')}-09`;
    const nextStartDate = `${nextY}-${String(nextM).padStart(2, '0')}-10`;
    return {
      periodKey,
      year: y,
      month: m,
      startDate,
      endDate,
      nextStartDate,
      label: `${y}年${m}月账期 (${m}.10-${nextM}.09)`
    };
  }

  /**
   * 获取本地日期字符串 "YYYY-MM-DD"
   */
  function getTodayDateStr(now) {
    const d = now instanceof Date ? now : new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * 根据日期字符串 "YYYY-MM-DD" 推断所属账期 key "YYYY-MM" 及所属预算年
   * 规则：每月10日~次月9日为当月账期；每年1月10日~次年1月9日为当年预算年度
   */
  function getPeriodFromDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
      return getPeriodFromDate(getTodayDateStr());
    }
    const parts = dateStr.split('-');
    if (parts.length < 3) return { periodKey: '2026-10', budgetYear: 2026 };
    let y = parseInt(parts[0], 10);
    let m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (d < 10) {
      m -= 1;
      if (m < 1) {
        m = 12;
        y -= 1;
      }
    }
    const budgetYear = y;
    return {
      periodKey: `${y}-${String(m).padStart(2, '0')}`,
      budgetYear
    };
  }

  /**
   * 获取当前真实日期对应的当期账期信息（每月10日自动进入新账期）
   */
  function getCurrentPeriodInfo(now) {
    const todayStr = getTodayDateStr(now);
    const info = getPeriodFromDate(todayStr);
    return {
      todayStr,
      periodKey: info.periodKey,
      budgetYear: info.budgetYear,
      range: getPeriodRange(info.periodKey)
    };
  }

  /**
   * 获取预算年度范围：如 2026 -> 2026-01-10 ~ 2027-01-09
   */
  function getBudgetYearRange(year) {
    const y = parseInt(year, 10);
    return {
      year: y,
      startDate: `${y}-01-10`,
      endDate: `${y + 1}-01-09`,
      nextStartDate: `${y + 1}-01-10`
    };
  }

  /**
   * 生成某预算年的12个账期列表 (1月~12月)
   */
  function getYearPeriods(year) {
    const list = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      list.push(getPeriodRange(key));
    }
    return list;
  }

  /**
   * 校验单条 c/q 记账流水（完全还原 Excel F列公式）
   */
  function validateMemberTx(tx) {
    if (!tx) return '';
    const { date, amount, type, purpose, category } = tx;
    if ((category === '孩子用品' || category === '噔宝') && (type === '支出' || type === '退款')) {
      return '噔宝消费请移到专表';
    }
    if (!date && (amount === '' || amount === null || amount === undefined) && !type && !purpose && !category) {
      return '';
    }
    if (!date || amount === '' || amount === null || amount === undefined || !type || !purpose) {
      return '请补齐必填项';
    }
    const numAmt = Number(amount);
    if (isNaN(numAmt)) {
      return '请检查日期或金额';
    }
    if (numAmt < 0 || (numAmt === 0 && type !== '收入')) {
      return '请检查金额';
    }
    const validTypes = ['支出', '收入', '退款', '存入', '取出'];
    if (!validTypes.includes(type)) {
      return '请选择有效类型';
    }
    const validPurposes = ['工资', '意外之喜', '日常', '必要开支', '金蛋', '许愿池', '其他储蓄'];
    if (!validPurposes.includes(purpose)) {
      return '请选择有效用途';
    }
    if (type === '收入' && !['工资', '意外之喜', '日常', '必要开支'].includes(purpose)) {
      return '收入用途不匹配';
    }
    if ((type === '支出' || type === '退款') && ['工资', '意外之喜'].includes(purpose)) {
      return '消费用途不匹配';
    }
    if ((type === '存入' || type === '取出') && !['金蛋', '许愿池', '其他储蓄'].includes(purpose)) {
      return '划拨请选择储蓄用途';
    }
    return '';
  }

  /**
   * 校验单条噔宝流水（还原 噔宝支出 F列公式）
   */
  function validateDengbaoTx(tx) {
    if (!tx) return '';
    const { date, amount, payer, type } = tx;
    if (!date && (amount === '' || amount === null || amount === undefined) && !payer && !type) {
      return '';
    }
    if (!date || amount === '' || amount === null || amount === undefined || !payer || !type) {
      return '请补齐前四项';
    }
    const numAmt = Number(amount);
    if (isNaN(numAmt) || numAmt <= 0) {
      return '检查日期和金额';
    }
    if (payer !== 'c' && payer !== 'q') {
      return '付款人选c或q';
    }
    if (type !== '支出' && type !== '退款') {
      return '类型选支出或退款';
    }
    return '';
  }

  /**
   * 匹配单笔 c/q 流水所属的预算子项（支持显式 budgetItemId，并对未绑定的历史流水做无歧义智能归类）
   */
  function resolveTxBudgetItem(tx, purpose, items) {
    if (!tx || tx.purpose !== purpose || (tx.type !== '支出' && tx.type !== '退款')) {
      return null;
    }
    const list = items || [];
    if (tx.budgetItemId !== undefined && tx.budgetItemId !== null) {
      if (tx.budgetItemId === '') return null; // 用户明确选择“不指定子项”
      const byId = list.find((it) => it.id === tx.budgetItemId);
      if (byId) return { item: byId, auto: false };
    }
    if (tx.budgetItemName) {
      const byName = list.find((it) => it.name === tx.budgetItemName);
      if (byName) return { item: byName, auto: false };
    }

    // 兼容旧流水：当未设置 budgetItemId 时，按同名分类/备注或唯一类目映射自动匹配
    const eligible = list.filter((it) => it.name && it.name !== '噔宝' && !(isNum(Number(it.annualBudget)) && Number(it.annualBudget) < 0));
    const cat = (tx.category || '').trim();
    const note = (tx.note || '').trim();

    if (cat) {
      const exactCat = eligible.find((it) => it.name === cat);
      if (exactCat) return { item: exactCat, auto: true };
    }
    if (note) {
      const noteMatches = eligible.filter((it) => it.name.length >= 2 && note.includes(it.name));
      if (noteMatches.length === 1) return { item: noteMatches[0], auto: true };
    }
    if (purpose === '必要开支') {
      if (cat === '服饰鞋包') {
        const clothMatches = eligible.filter((it) => it.name === '服装' || it.name === '服装费');
        if (clothMatches.length === 1) return { item: clothMatches[0], auto: true };
      } else if (cat === '汽车费用') {
        const carMatches = eligible.filter((it) => it.name.includes('汽车') || it.name === '养车');
        if (carMatches.length === 1) return { item: carMatches[0], auto: true };
      } else if (cat === '日用品') {
        const homeMatches = eligible.filter((it) => it.name === '家庭杂物开支' || it.name === '日用品');
        if (homeMatches.length === 1) return { item: homeMatches[0], auto: true };
      }
    } else if (purpose === '许愿池') {
      if (cat === '旅游出游') {
        const travelMatches = eligible.filter((it) => it.name.includes('游') || it.name.includes('旅'));
        if (travelMatches.length === 1) return { item: travelMatches[0], auto: true };
      }
    }
    return null;
  }

  /**
   * 计算必要开支与许愿池预算指标（含预算年度内各子项已花、剩余与进度条状态）
   */
  function computeBudgets(data, targetPeriodKey) {
    const activePKey = targetPeriodKey || (data.settings && data.settings.currentPeriod) || getCurrentPeriodInfo().periodKey || '2026-10';
    const pRange = getPeriodRange(activePKey);
    const budgetYear = pRange.year || Number(data.settings && data.settings.budgetYear) || 2026;
    const yearRange = getBudgetYearRange(budgetYear);
    const threshold = Number(data.settings && data.settings.warningThreshold) || 0.8;

    const result = { budgetYear, yearRange, c: {}, q: {}, dengbao: {} };
    ['c', 'q'].forEach((member) => {
      const rawNecList = data.necessaryBudgets[member] || [];
      const rawWishList = data.wishBudgets[member] || [];
      const yearTxs = filterTxInRange((data.transactions && data.transactions[member]) || [], yearRange.startDate, yearRange.nextStartDate);
      const dbYearTxs = filterTxInRange((data.transactions && data.transactions.dengbao) || [], yearRange.startDate, yearRange.nextStartDate).filter(
        (t) => t.payer === member
      );
      const dbYearPaid =
        dbYearTxs.filter((t) => t.type === '支出').reduce((acc, t) => acc + (Number(t.amount) || 0), 0) -
        dbYearTxs.filter((t) => t.type === '退款').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

      const necSpentMap = {};
      let necUnassignedSpent = 0;
      const wishSpentMap = {};
      let wishUnassignedSpent = 0;

      yearTxs.forEach((tx) => {
        if (tx.type !== '支出' && tx.type !== '退款') return;
        const delta = tx.type === '支出' ? (Number(tx.amount) || 0) : -(Number(tx.amount) || 0);
        if (tx.purpose === '必要开支') {
          const matched = resolveTxBudgetItem(tx, '必要开支', rawNecList);
          if (matched && matched.item) {
            necSpentMap[matched.item.id] = (necSpentMap[matched.item.id] || 0) + delta;
          } else {
            necUnassignedSpent += delta;
          }
        } else if (tx.purpose === '许愿池') {
          const matched = resolveTxBudgetItem(tx, '许愿池', rawWishList);
          if (matched && matched.item) {
            wishSpentMap[matched.item.id] = (wishSpentMap[matched.item.id] || 0) + delta;
          } else {
            wishUnassignedSpent += delta;
          }
        }
      });

      let dengbaoAssigned = false;
      const necItems = rawNecList.map((item) => {
        const hasBudget = item.annualBudget !== null && item.annualBudget !== '' && !isNaN(Number(item.annualBudget));
        const budgetNum = hasBudget ? Number(item.annualBudget) : null;
        const monthly = (item.name && hasBudget) ? budgetNum / 12 : null;
        const isOffset = isNum(budgetNum) && budgetNum < 0;
        let spent = necSpentMap[item.id] || 0;
        if (item.name === '噔宝' && !dengbaoAssigned) {
          spent += dbYearPaid;
          dengbaoAssigned = true;
        }
        spent = round2(spent);
        const remaining = !isOffset && isNum(budgetNum) ? round2(budgetNum - spent) : null;
        const ratio = !isOffset && isNum(budgetNum) && budgetNum > 0
          ? Math.max(0, spent / budgetNum)
          : (!isOffset && spent > 0 ? 1 : 0);

        let level = 'ok';
        if (isOffset) level = 'info';
        else if (!hasBudget) level = spent > 0 ? 'warn' : 'info';
        else if (spent > budgetNum || (budgetNum > 0 && spent === budgetNum)) level = 'danger';
        else if (budgetNum > 0 && spent >= budgetNum * threshold) level = 'warn';

        let tip = '';
        if (!item.name && !hasBudget) tip = '';
        else if (!item.name) tip = '请填项目';
        else if (!hasBudget) tip = '未设金额，暂不计入';
        return {
          ...item,
          annualBudget: budgetNum,
          monthly,
          isOffset,
          spent,
          remaining,
          ratio,
          level,
          tip
        };
      });
      // 月均合计（含负数收租抵减）
      const necMonthlyTotal = necItems.reduce((acc, it) => acc + (isNum(it.monthly) ? it.monthly : 0), 0);
      // 年度消费额度（仅正数预算合计：SUMIFS(..., ">0")）
      const necAnnualQuota = necItems.reduce((acc, it) => acc + (it.name && isNum(it.annualBudget) && it.annualBudget > 0 ? it.annualBudget : 0), 0);
      // 噔宝每月预留
      const dengbaoMonthlyReserve = necItems
        .filter((it) => it.name === '噔宝' && isNum(it.monthly))
        .reduce((acc, it) => acc + it.monthly, 0);

      const wishItems = rawWishList.map((item) => {
        const hasQuota = item.annualQuota !== null && item.annualQuota !== '' && !isNaN(Number(item.annualQuota));
        const quotaNum = hasQuota ? Number(item.annualQuota) : null;
        const monthsNum = item.months !== null && item.months !== '' && !isNaN(Number(item.months)) ? Number(item.months) : 12;
        const validMonths = monthsNum >= 1 && monthsNum % 1 === 0;
        const monthly = (item.name && hasQuota && quotaNum >= 0 && validMonths) ? quotaNum / monthsNum : null;
        const spent = round2(wishSpentMap[item.id] || 0);
        const remaining = isNum(quotaNum) && quotaNum >= 0 ? round2(quotaNum - spent) : null;
        const ratio = isNum(quotaNum) && quotaNum > 0
          ? Math.max(0, spent / quotaNum)
          : (spent > 0 ? 1 : 0);

        let level = 'ok';
        if (!hasQuota) level = spent > 0 ? 'warn' : 'info';
        else if (spent > quotaNum || (quotaNum > 0 && spent === quotaNum)) level = 'danger';
        else if (quotaNum > 0 && spent >= quotaNum * threshold) level = 'warn';

        let tip = '';
        if (!item.name && !hasQuota) tip = '';
        else if (!item.name) tip = '请填项目';
        else if (!hasQuota) tip = '未设金额，暂不计入';
        else if (!validMonths) tip = '月数填正整数';
        return {
          ...item,
          annualQuota: quotaNum,
          months: monthsNum,
          monthly,
          spent,
          remaining,
          ratio,
          level,
          tip
        };
      });
      const wishMonthlyTotal = wishItems.reduce((acc, it) => acc + (isNum(it.monthly) ? it.monthly : 0), 0);
      const wishAnnualQuota = wishItems.reduce((acc, it) => acc + (it.name && isNum(it.annualQuota) && it.annualQuota > 0 ? it.annualQuota : 0), 0);

      result[member] = {
        necessaryItems: necItems,
        necessaryMonthly: necMonthlyTotal,
        necessaryAnnualQuota: necAnnualQuota,
        necUnassignedSpent: round2(necUnassignedSpent),
        dengbaoMonthlyReserve,
        wishItems,
        wishMonthly: wishMonthlyTotal,
        wishAnnualQuota,
        wishUnassignedSpent: round2(wishUnassignedSpent)
      };
    });

    result.dengbao = {
      cReserve: result.c.dengbaoMonthlyReserve,
      qReserve: result.q.dengbaoMonthlyReserve,
      baseMonthlyQuota: result.c.dengbaoMonthlyReserve + result.q.dengbaoMonthlyReserve
    };

    return result;
  }

  /**
   * 过滤时间区间 [startDate, nextStartDate) 内的流水
   */
  function filterTxInRange(txList, startDate, nextStartDate) {
    return (txList || []).filter((tx) => tx.date && tx.date >= startDate && tx.date < nextStartDate);
  }

  /**
   * 计算某个成员在指定日期区间内的分类汇总
   */
  function summarizeMemberRange(data, member, startDate, nextStartDate) {
    const txs = filterTxInRange(data.transactions[member], startDate, nextStartDate);
    const dbTxs = filterTxInRange(data.transactions.dengbao, startDate, nextStartDate).filter((t) => t.payer === member);

    const sumBy = (list, type, purpose) =>
      list
        .filter((t) => t.type === type && (!purpose || t.purpose === purpose))
        .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    // 工资收入（含 收入+工资 与 收入+日常）
    const salaryCount = txs.filter((t) => t.type === '收入' && (t.purpose === '工资' || t.purpose === '日常')).length;
    const salarySum = sumBy(txs, '收入', '工资') + sumBy(txs, '收入', '日常');
    const windfallIncome = sumBy(txs, '收入', '意外之喜');
    const otherIncome = txs
      .filter((t) => t.type === '收入' && t.purpose !== '工资' && t.purpose !== '意外之喜')
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    // 日常净消费
    const dailyNetSpent = sumBy(txs, '支出', '日常') - sumBy(txs, '退款', '日常');

    // 噔宝该付款人净消费
    const dengbaoPaidSpent =
      dbTxs.filter((t) => t.type === '支出').reduce((acc, t) => acc + (Number(t.amount) || 0), 0) -
      dbTxs.filter((t) => t.type === '退款').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    // 必要开支净消费（含个人记账必要开支 + 噔宝对应付款人支出）
    const necessaryNetSpent =
      sumBy(txs, '支出', '必要开支') - sumBy(txs, '退款', '必要开支') + dengbaoPaidSpent;

    // 许愿池净消费
    const wishNetSpent = sumBy(txs, '支出', '许愿池') - sumBy(txs, '退款', '许愿池');

    // 其他净消费
    const otherNetSpent =
      txs
        .filter((t) => t.type === '支出' && !['日常', '必要开支', '许愿池'].includes(t.purpose))
        .reduce((acc, t) => acc + (Number(t.amount) || 0), 0) -
      txs
        .filter((t) => t.type === '退款' && !['日常', '必要开支', '许愿池'].includes(t.purpose))
        .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    // 总消费合计
    const totalNetSpent =
      txs.filter((t) => t.type === '支出').reduce((acc, t) => acc + (Number(t.amount) || 0), 0) -
      txs.filter((t) => t.type === '退款').reduce((acc, t) => acc + (Number(t.amount) || 0), 0) +
      dengbaoPaidSpent;

    // 储蓄净存入
    const goldenEggNetDeposit = sumBy(txs, '存入', '金蛋') - sumBy(txs, '取出', '金蛋');
    const wishNetDeposit = sumBy(txs, '存入', '许愿池') - sumBy(txs, '取出', '许愿池');
    const otherSavingsNetDeposit = sumBy(txs, '存入', '其他储蓄') - sumBy(txs, '取出', '其他储蓄');

    return {
      txCount: txs.length + dbTxs.length,
      salaryCount,
      salaryIncome: salaryCount > 0 ? salarySum : null,
      salarySumRaw: salarySum,
      windfallIncome,
      otherIncome,
      totalIncome: salarySum + windfallIncome + otherIncome,
      dailyNetSpent,
      dengbaoPaidSpent,
      necessaryNetSpent,
      wishNetSpent,
      otherNetSpent,
      totalNetSpent,
      goldenEggNetDeposit,
      wishNetDeposit,
      otherSavingsNetDeposit,
      totalNetDeposit: goldenEggNetDeposit + wishNetDeposit + otherSavingsNetDeposit
    };
  }

  /**
   * 链式计算从 2026-10 开始的月度分配与零花钱结余滚存
   * 完全对齐《月度分配》工作表的跨月结转逻辑
   */
  function computeAllocationsChain(data, budgets, targetPeriodKey) {
    // 动态账期序列（覆盖 2026-01 到 当前/目标年份后一年，无需跨年手动调整）
    const curYear = getCurrentPeriodInfo().budgetYear || 2026;
    const targetYear = targetPeriodKey ? parseInt(String(targetPeriodKey).split('-')[0], 10) || curYear : curYear;
    const maxYear = Math.max(2027, curYear, targetYear);
    const allPeriods = [];
    for (let y = 2026; y <= maxYear; y++) {
      for (let m = 1; m <= 12; m++) {
        allPeriods.push(`${y}-${String(m).padStart(2, '0')}`);
      }
    }
    if (targetPeriodKey && !allPeriods.includes(targetPeriodKey)) {
      allPeriods.push(targetPeriodKey);
      allPeriods.sort();
    }

    const chainMap = {};
    let prevRemaining = { c: null, q: null };

    allPeriods.forEach((pKey) => {
      const range = getPeriodRange(pKey);
      const ov = (data.settings.periodOverrides && data.settings.periodOverrides[pKey]) || {};
      const periodResult = { range, c: {}, q: {}, family: {} };

      ['c', 'q'].forEach((member) => {
        const mOv = ov[member] || {};
        const hasInitAdjust = mOv.initAdjust !== undefined && mOv.initAdjust !== null && mOv.initAdjust !== '';
        const initAdjust = hasInitAdjust ? Number(mOv.initAdjust) : null;
        const fixedGoldenEgg =
          mOv.fixedGoldenEgg !== undefined && mOv.fixedGoldenEgg !== null && mOv.fixedGoldenEgg !== ''
            ? Number(mOv.fixedGoldenEgg)
            : (data.settings.defaultFixedGoldenEgg && data.settings.defaultFixedGoldenEgg[member]) ?? 2000;

        const sumRange = summarizeMemberRange(data, member, range.startDate, range.nextStartDate);
        const salary = sumRange.salaryIncome; // null if no salary recorded in this period
        const necMonthly = budgets[member].necessaryMonthly;
        const wishMonthly = budgets[member].wishMonthly;

        const hasSalary = isNum(salary);
        // 固定金蛋（默认 2000）为最低保底标准：
        // 若 (工资 - 必要月均) * 50% >= 固定金蛋，超出部分作为「金蛋补足」；
        // 若不足固定金蛋，则「金蛋补足」为 0（不出现负数），金蛋仍按保底 2000 存入，不足差额自动从 daily 零花钱中补足
        const rawSupplement = hasSalary ? (salary - necMonthly) * 0.5 - fixedGoldenEgg : null;
        const goldenEggSupplement = hasSalary ? Math.max(0, rawSupplement) : null;
        const goldenEggShortfall = hasSalary && rawSupplement < 0 ? -rawSupplement : 0;
        // 金蛋应存合计 = 固定金蛋 + 金蛋补足 = MAX(固定金蛋, (工资 - 必要开支月均) * 50%)
        const goldenEggTotal = isNum(goldenEggSupplement) ? fixedGoldenEgg + goldenEggSupplement : null;
        // daily 零花钱 = 工资 - 必要开支月均 - 固定金蛋 - 许愿池月均 - 金蛋补足（不足保底部分已自动从零花钱中扣补）
        const dailyAllowance = isNum(goldenEggSupplement)
          ? salary - necMonthly - fixedGoldenEgg - wishMonthly - goldenEggSupplement
          : null;
        // 另需转存 = 金蛋补足 + 许愿池月均
        const extraTransfer = isNum(goldenEggSupplement) ? goldenEggSupplement + wishMonthly : null;

        // 上期结余：若填了期初校正，优先取期初校正；否则取上一期剩余零花钱
        const prevBalance = isNum(initAdjust)
          ? initAdjust
          : isNum(prevRemaining[member])
          ? prevRemaining[member]
          : pKey === '2026-10'
          ? 0
          : null;

        // 剩余零花钱 = daily + 意外之喜 - 日常净消费 + 上期结余
        const remainingPocket =
          isNum(dailyAllowance) && isNum(prevBalance)
            ? dailyAllowance + sumRange.windfallIncome - sumRange.dailyNetSpent + prevBalance
            : null;

        // 本期提示
        let statusTip = '正常';
        if (!hasSalary) {
          statusTip = '请录入工资（无收入填0）';
        } else if (dailyAllowance < 0) {
          statusTip = '日常额度为负，请核对预算';
        } else if (isNum(remainingPocket) && remainingPocket < 0) {
          statusTip = '零花钱已超支';
        }

        const goldenEggStillNeed = isNum(goldenEggTotal) ? goldenEggTotal - sumRange.goldenEggNetDeposit : null;

        periodResult[member] = {
          initAdjust,
          fixedGoldenEgg,
          salary,
          necessaryMonthly: necMonthly,
          goldenEggSupplement,
          goldenEggShortfall,
          goldenEggTotal,
          wishMonthly,
          dailyAllowance,
          extraTransfer,
          prevBalance,
          windfallIncome: sumRange.windfallIncome,
          dailyNetSpent: sumRange.dailyNetSpent,
          remainingPocket,
          statusTip,
          goldenEggNetDeposit: sumRange.goldenEggNetDeposit,
          wishNetDeposit: sumRange.wishNetDeposit,
          goldenEggStillNeed,
          necessaryNetSpent: sumRange.necessaryNetSpent,
          wishNetSpent: sumRange.wishNetSpent,
          dengbaoPaidSpent: sumRange.dengbaoPaidSpent,
          totalNetSpent: sumRange.totalNetSpent
        };

        prevRemaining[member] = remainingPocket;
      });

      // 家庭合计列（还原家庭汇总 D列）
      const bothHaveSalary = isNum(periodResult.c.salary) && isNum(periodResult.q.salary);
      const sumPair = (k, requireBoth = true) => {
        const vc = periodResult.c[k];
        const vq = periodResult.q[k];
        if (requireBoth) {
          return isNum(vc) && isNum(vq) ? vc + vq : null;
        }
        return (Number(vc) || 0) + (Number(vq) || 0);
      };

      periodResult.family = {
        salary: sumPair('salary', true),
        necessaryMonthly: sumPair('necessaryMonthly', false),
        fixedGoldenEgg: sumPair('fixedGoldenEgg', false),
        goldenEggSupplement: sumPair('goldenEggSupplement', true),
        goldenEggTotal: sumPair('goldenEggTotal', true),
        wishMonthly: sumPair('wishMonthly', false),
        dailyAllowance: sumPair('dailyAllowance', true),
        extraTransfer: sumPair('extraTransfer', true),
        prevBalance: sumPair('prevBalance', true),
        windfallIncome: sumPair('windfallIncome', false),
        dailyNetSpent: sumPair('dailyNetSpent', false),
        remainingPocket: sumPair('remainingPocket', true),
        goldenEggNetDeposit: sumPair('goldenEggNetDeposit', false),
        wishNetDeposit: sumPair('wishNetDeposit', false),
        goldenEggStillNeed: sumPair('goldenEggStillNeed', true),
        necessaryNetSpent: sumPair('necessaryNetSpent', false),
        wishNetSpent: sumPair('wishNetSpent', false),
        dengbaoPaidSpent: sumPair('dengbaoPaidSpent', false),
        totalNetSpent: sumPair('totalNetSpent', false),
        bothHaveSalary
      };

      chainMap[pKey] = periodResult;
    });

    return chainMap;
  }

  /**
   * 计算年度预算跟踪、流水逐笔累计额度与年末结余转存
   */
  function computeAnnualTracking(data, budgets, currentPeriodKey) {
    const curRange = getPeriodRange(currentPeriodKey || getCurrentPeriodInfo().periodKey || '2026-10');
    const budgetYear = curRange.year || Number(data.settings.budgetYear) || 2026;
    const yearRange = getBudgetYearRange(budgetYear);
    const threshold = Number(data.settings.warningThreshold) || 0.8;

    // 截至本期截止日的年度范围：[yearRange.startDate, curRange.nextStartDate)
    const cutoffNextDate =
      curRange.year === budgetYear ? curRange.nextStartDate : yearRange.nextStartDate;

    const tracking = {
      budgetYear,
      yearRange,
      cutoffEndDate: curRange.endDate,
      warningThreshold: threshold,
      c: {},
      q: {},
      family: {}
    };

    ['c', 'q'].forEach((member) => {
      const yeCfg = (data.settings.yearEnd && data.settings.yearEnd[member]) || {};
      const hasPriorNec = yeCfg.priorNecessary !== null && yeCfg.priorNecessary !== undefined && yeCfg.priorNecessary !== '';
      const hasPriorWish = yeCfg.priorWish !== null && yeCfg.priorWish !== undefined && yeCfg.priorWish !== '';
      const priorNec = hasPriorNec ? Number(yeCfg.priorNecessary) : 0;
      const priorWish = hasPriorWish ? Number(yeCfg.priorWish) : 0;

      // 截至本期的累计
      const sumUpToPeriod = summarizeMemberRange(data, member, yearRange.startDate, cutoffNextDate);
      // 全年完整累计
      const sumFullYear = summarizeMemberRange(data, member, yearRange.startDate, yearRange.nextStartDate);

      const necQuota = budgets[member].necessaryAnnualQuota;
      const necSpentUpToPeriod = sumUpToPeriod.necessaryNetSpent + priorNec;
      const necRemaining = necQuota - necSpentUpToPeriod;
      const necRatio = necQuota > 0 ? Math.max(0, necSpentUpToPeriod / necQuota) : 0;

      let necStatus = '额度内';
      let necLevel = 'ok'; // ok | warn | danger | info
      if (curRange.year !== budgetYear) {
        necStatus = '切到清单所属年';
        necLevel = 'info';
      } else if (necQuota <= 0) {
        necStatus = necSpentUpToPeriod > 0 ? '超预算：未设额度' : '未设年度额度';
        necLevel = necSpentUpToPeriod > 0 ? 'danger' : 'info';
      } else if (necSpentUpToPeriod > necQuota) {
        necStatus = '超预算';
        necLevel = 'danger';
      } else if (necSpentUpToPeriod === necQuota) {
        necStatus = '额度已用完';
        necLevel = 'danger';
      } else if (necSpentUpToPeriod >= necQuota * threshold) {
        necStatus = '接近上限';
        necLevel = 'warn';
      } else if (!hasPriorNec) {
        necStatus = '待补前期';
        necLevel = 'info';
      }

      const wishQuota = budgets[member].wishAnnualQuota;
      const wishSpentUpToPeriod = sumUpToPeriod.wishNetSpent + priorWish;
      const wishRemaining = wishQuota - wishSpentUpToPeriod;
      const wishRatio = wishQuota > 0 ? Math.max(0, wishSpentUpToPeriod / wishQuota) : 0;

      let wishStatus = '额度内';
      let wishLevel = 'ok';
      if (curRange.year !== budgetYear) {
        wishStatus = '切到清单所属年';
        wishLevel = 'info';
      } else if (wishQuota <= 0) {
        wishStatus = wishSpentUpToPeriod > 0 ? '超预算：未设额度' : '未设年度额度';
        wishLevel = wishSpentUpToPeriod > 0 ? 'danger' : 'info';
      } else if (wishSpentUpToPeriod > wishQuota) {
        wishStatus = '超预算';
        wishLevel = 'danger';
      } else if (wishSpentUpToPeriod === wishQuota) {
        wishStatus = '额度已用完';
        wishLevel = 'danger';
      } else if (wishSpentUpToPeriod >= wishQuota * threshold) {
        wishStatus = '接近上限';
        wishLevel = 'warn';
      } else if (!hasPriorWish) {
        wishStatus = '待补前期';
        wishLevel = 'info';
      }

      // 全年结余与转存 (Rows 119-132)
      const fullYearNecSpent = sumFullYear.necessaryNetSpent + priorNec;
      const fullYearNecSurplus = necQuota - fullYearNecSpent;
      const fullYearWishSpent = sumFullYear.wishNetSpent + priorWish;
      const fullYearWishSurplus = wishQuota - fullYearWishSpent;
      const combinedSurplus = fullYearNecSurplus + fullYearWishSurplus;
      const bothPriorsFilled = hasPriorNec && hasPriorWish;
      const maxRetainable = bothPriorsFilled ? Math.max(0, combinedSurplus) : null;
      const hasActualFunds = yeCfg.actualYearEndFunds !== null && yeCfg.actualYearEndFunds !== undefined && yeCfg.actualYearEndFunds !== '';
      const actualFunds = hasActualFunds ? Number(yeCfg.actualYearEndFunds) : null;
      const transferable =
        bothPriorsFilled && isNum(actualFunds) ? Math.max(0, Math.min(maxRetainable, actualFunds)) : null;

      tracking[member] = {
        hasPriorNec,
        hasPriorWish,
        priorNec,
        priorWish,
        necQuota,
        necSpent: necSpentUpToPeriod,
        necRemaining,
        necRatio,
        necStatus,
        necLevel,
        wishQuota,
        wishSpent: wishSpentUpToPeriod,
        wishRemaining,
        wishRatio,
        wishStatus,
        wishLevel,
        fullYearNecSpent,
        fullYearNecSurplus,
        fullYearWishSpent,
        fullYearWishSurplus,
        combinedSurplus,
        maxRetainable,
        actualFunds,
        transferable
      };
    });

    // 家庭合计
    const necQuotaFam = tracking.c.necQuota + tracking.q.necQuota;
    const necSpentFam = tracking.c.necSpent + tracking.q.necSpent;
    const necRemFam = tracking.c.necRemaining + tracking.q.necRemaining;
    const necRatioFam = necQuotaFam > 0 ? Math.max(0, necSpentFam / necQuotaFam) : 0;

    const wishQuotaFam = tracking.c.wishQuota + tracking.q.wishQuota;
    const wishSpentFam = tracking.c.wishSpent + tracking.q.wishSpent;
    const wishRemFam = tracking.c.wishRemaining + tracking.q.wishRemaining;
    const wishRatioFam = wishQuotaFam > 0 ? Math.max(0, wishSpentFam / wishQuotaFam) : 0;

    const combinedSurplusFam = tracking.c.combinedSurplus + tracking.q.combinedSurplus;

    tracking.family = {
      necQuota: necQuotaFam,
      necSpent: necSpentFam,
      necRemaining: necRemFam,
      necRatio: necRatioFam,
      necStatus:
        tracking.c.necLevel === 'danger' || tracking.q.necLevel === 'danger'
          ? '有人超预算'
          : tracking.c.necLevel === 'warn' || tracking.q.necLevel === 'warn'
          ? '接近上限'
          : !tracking.c.hasPriorNec || !tracking.q.hasPriorNec
          ? '待补前期'
          : '额度内',
      wishQuota: wishQuotaFam,
      wishSpent: wishSpentFam,
      wishRemaining: wishRemFam,
      wishRatio: wishRatioFam,
      wishStatus:
        tracking.c.wishLevel === 'danger' || tracking.q.wishLevel === 'danger'
          ? '有人超预算'
          : tracking.c.wishLevel === 'warn' || tracking.q.wishLevel === 'warn'
          ? '接近上限'
          : !tracking.c.hasPriorWish || !tracking.q.hasPriorWish
          ? '待补前期'
          : '额度内',
      fullYearNecSurplus: tracking.c.fullYearNecSurplus + tracking.q.fullYearNecSurplus,
      fullYearWishSurplus: tracking.c.fullYearWishSurplus + tracking.q.fullYearWishSurplus,
      combinedSurplus: combinedSurplusFam
    };

    return tracking;
  }

  /**
   * 为 c/q 的每一笔流水附加自动检查、本笔后剩余额度、年度预算提醒（还原 G、H、K、L 列）
   */
  function enrichMemberTransactions(data, budgets, member, targetPeriodKey) {
    const curRange = getPeriodRange(targetPeriodKey || getCurrentPeriodInfo().periodKey || '2026-10');
    const budgetYear = curRange.year || Number(data.settings.budgetYear) || 2026;
    const yearRange = getBudgetYearRange(budgetYear);
    const threshold = Number(data.settings.warningThreshold) || 0.8;
    const yeCfg = (data.settings.yearEnd && data.settings.yearEnd[member]) || {};
    const hasPriorNec = yeCfg.priorNecessary !== null && yeCfg.priorNecessary !== undefined && yeCfg.priorNecessary !== '';
    const hasPriorWish = yeCfg.priorWish !== null && yeCfg.priorWish !== undefined && yeCfg.priorWish !== '';
    const priorNec = hasPriorNec ? Number(yeCfg.priorNecessary) : 0;
    const priorWish = hasPriorWish ? Number(yeCfg.priorWish) : 0;

    // 噔宝在当前预算年度中由该成员付款的净消费（Excel K6 起始就计入了整年噔宝支出）
    const dbYearTxs = filterTxInRange(data.transactions.dengbao, yearRange.startDate, yearRange.nextStartDate).filter(
      (t) => t.payer === member
    );
    const dbYearNet =
      dbYearTxs.filter((t) => t.type === '支出').reduce((acc, t) => acc + (Number(t.amount) || 0), 0) -
      dbYearTxs.filter((t) => t.type === '退款').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    let runningNec = priorNec + dbYearNet;
    let runningWish = priorWish;

    const necQuota = budgets[member].necessaryAnnualQuota;
    const wishQuota = budgets[member].wishAnnualQuota;

    return (data.transactions[member] || []).map((tx, idx) => {
      const checkMsg = validateMemberTx(tx);
      const inBudgetYear = tx.date >= yearRange.startDate && tx.date < yearRange.nextStartDate;
      const amt = Number(tx.amount) || 0;

      if (inBudgetYear && tx.purpose === '必要开支') {
        if (tx.type === '支出') runningNec += amt;
        else if (tx.type === '退款') runningNec -= amt;
      }
      if (inBudgetYear && tx.purpose === '许愿池') {
        if (tx.type === '支出') runningWish += amt;
        else if (tx.type === '退款') runningWish -= amt;
      }

      let afterQuota = null;
      let budgetAlert = '';
      let alertLevel = 'ok';
      let resolvedBudgetItemId = '';
      let resolvedBudgetItemName = '';
      let isAutoBudgetItem = false;

      if ((tx.type === '支出' || tx.type === '退款') && (tx.purpose === '必要开支' || tx.purpose === '许愿池')) {
        const bList = tx.purpose === '必要开支' ? (data.necessaryBudgets[member] || []) : (data.wishBudgets[member] || []);
        const matched = resolveTxBudgetItem(tx, tx.purpose, bList);
        if (matched && matched.item) {
          resolvedBudgetItemId = matched.item.id;
          resolvedBudgetItemName = matched.item.name;
          isAutoBudgetItem = !!matched.auto;
        }
        if (!inBudgetYear) {
          budgetAlert = '非本清单年度';
          alertLevel = 'info';
        } else {
          const quota = tx.purpose === '必要开支' ? necQuota : wishQuota;
          const cum = tx.purpose === '必要开支' ? runningNec : runningWish;
          const hasPrior = tx.purpose === '必要开支' ? hasPriorNec : hasPriorWish;
          afterQuota = quota - cum;

          if (quota <= 0) {
            budgetAlert = afterQuota < 0 ? '超预算：未设额度' : '未设年度额度';
            alertLevel = afterQuota < 0 ? 'danger' : 'info';
          } else if (afterQuota < 0) {
            budgetAlert = '超预算';
            alertLevel = 'danger';
          } else if (afterQuota === 0) {
            budgetAlert = '额度已用完';
            alertLevel = 'danger';
          } else if (quota - afterQuota >= quota * threshold) {
            budgetAlert = '接近上限';
            alertLevel = 'warn';
          } else if (hasPrior) {
            budgetAlert = '额度内';
            alertLevel = 'ok';
          } else {
            budgetAlert = '待补前期';
            alertLevel = 'info';
          }
        }
      }

      const periodInfo = getPeriodFromDate(tx.date);

      return {
        ...tx,
        index: idx + 1,
        member,
        periodKey: periodInfo.periodKey,
        checkMsg,
        runningNec,
        runningWish,
        afterQuota,
        budgetAlert,
        alertLevel,
        resolvedBudgetItemId,
        resolvedBudgetItemName,
        isAutoBudgetItem
      };
    });
  }

  /**
   * 计算噔宝专区数据（月度额度、当月消费、结余、12个账期结余表）
   */
  function computeDengbaoReport(data, budgets, targetPeriodKey) {
    const baseQuota = budgets.dengbao.baseMonthlyQuota; // 默认 1000 + 1000 = 2000
    const threshold = Number(data.settings.warningThreshold) || 0.8;
    const pKey = targetPeriodKey || data.settings.dengbaoPeriod || data.settings.currentPeriod || '2026-10';

    const calcForPeriod = (periodKey) => {
      const range = getPeriodRange(periodKey);
      const ov = (data.settings.periodOverrides && data.settings.periodOverrides[periodKey]) || {};
      const extra = Number(ov.dengbaoExtraQuota) || 0;
      const quota = baseQuota + extra;
      const txs = filterTxInRange(data.transactions.dengbao, range.startDate, range.nextStartDate);
      const spent =
        txs.filter((t) => t.type === '支出').reduce((acc, t) => acc + (Number(t.amount) || 0), 0) -
        txs.filter((t) => t.type === '退款').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      const cPaid =
        txs.filter((t) => t.payer === 'c' && t.type === '支出').reduce((acc, t) => acc + (Number(t.amount) || 0), 0) -
        txs.filter((t) => t.payer === 'c' && t.type === '退款').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      const qPaid =
        txs.filter((t) => t.payer === 'q' && t.type === '支出').reduce((acc, t) => acc + (Number(t.amount) || 0), 0) -
        txs.filter((t) => t.payer === 'q' && t.type === '退款').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      const balance = quota - spent;
      const ratio = quota > 0 ? Math.max(0, spent / quota) : 0;

      let status = '本月额度内';
      let level = 'ok';
      if (quota <= 0) {
        status = '请核对噔宝预算';
        level = 'info';
      } else if (balance < 0) {
        status = '本月超预算';
        level = 'danger';
      } else if (balance === 0) {
        status = '本月额度已用完';
        level = 'danger';
      } else if (spent >= quota * threshold) {
        status = '接近月度上限';
        level = 'warn';
      }

      return {
        periodKey,
        range,
        baseQuota,
        extraQuota: extra,
        quota,
        spent,
        cPaid,
        qPaid,
        balance,
        ratio,
        status,
        level,
        txCount: txs.length,
        transactions: txs.map((t) => ({ ...t, checkMsg: validateDengbaoTx(t) }))
      };
    };

    const current = calcForPeriod(pKey);
    // 生成从 2026-10 起的账期趋势，并确保覆盖当前选定账期
    const monthlySeries = [];
    const seenKeys = new Set();
    let y = 2026;
    let m = 10;
    const maxPKey = pKey > '2027-09' ? pKey : '2027-09';
    while (`${y}-${String(m).padStart(2, '0')}` <= maxPKey && monthlySeries.length < 60) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      seenKeys.add(k);
      monthlySeries.push(calcForPeriod(k));
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    if (!seenKeys.has(pKey)) {
      monthlySeries.push(current);
      monthlySeries.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
    }

    return {
      cReserve: budgets.dengbao.cReserve,
      qReserve: budgets.dengbao.qReserve,
      baseQuota,
      current,
      monthlySeries
    };
  }

  /**
   * 计算年度家庭汇总（家庭汇总 Rows 52-92：全年实际收支 & 12个账期趋势）
   */
  function computeAnnualSummary(data, selectedPeriodKey) {
    const curYear = selectedPeriodKey
      ? getPeriodRange(selectedPeriodKey).year
      : Number(data.settings.statYear || data.settings.budgetYear) || getCurrentPeriodInfo().budgetYear || 2026;
    const statYear = curYear || 2026;
    const yearRange = getBudgetYearRange(statYear);

    const cYear = summarizeMemberRange(data, 'c', yearRange.startDate, yearRange.nextStartDate);
    const qYear = summarizeMemberRange(data, 'q', yearRange.startDate, yearRange.nextStartDate);

    const familyYear = {
      salarySumRaw: cYear.salarySumRaw + qYear.salarySumRaw,
      windfallIncome: cYear.windfallIncome + qYear.windfallIncome,
      otherIncome: cYear.otherIncome + qYear.otherIncome,
      totalIncome: cYear.totalIncome + qYear.totalIncome,
      dailyNetSpent: cYear.dailyNetSpent + qYear.dailyNetSpent,
      necessaryNetSpent: cYear.necessaryNetSpent + qYear.necessaryNetSpent,
      wishNetSpent: cYear.wishNetSpent + qYear.wishNetSpent,
      otherNetSpent: cYear.otherNetSpent + qYear.otherNetSpent,
      totalNetSpent: cYear.totalNetSpent + qYear.totalNetSpent,
      netBalance: cYear.totalIncome + qYear.totalIncome - (cYear.totalNetSpent + qYear.totalNetSpent),
      goldenEggNetDeposit: cYear.goldenEggNetDeposit + qYear.goldenEggNetDeposit,
      wishNetDeposit: cYear.wishNetDeposit + qYear.wishNetDeposit,
      otherSavingsNetDeposit: cYear.otherSavingsNetDeposit + qYear.otherSavingsNetDeposit,
      totalNetDeposit: cYear.totalNetDeposit + qYear.totalNetDeposit
    };

    const periods12 = getYearPeriods(statYear).map((p) => {
      const cP = summarizeMemberRange(data, 'c', p.startDate, p.nextStartDate);
      const qP = summarizeMemberRange(data, 'q', p.startDate, p.nextStartDate);
      const hasRecords = cP.txCount + qP.txCount > 0;
      const income = hasRecords ? cP.totalIncome + qP.totalIncome : null;
      const spent = hasRecords ? cP.totalNetSpent + qP.totalNetSpent : null;
      const balance = hasRecords ? income - spent : null;
      return {
        periodKey: p.periodKey,
        startDate: p.startDate,
        endDate: p.endDate,
        hasRecords,
        income,
        spent,
        balance
      };
    });

    return {
      statYear,
      yearRange,
      c: { ...cYear, netBalance: cYear.totalIncome - cYear.totalNetSpent },
      q: { ...qYear, netBalance: qYear.totalIncome - qYear.totalNetSpent },
      family: familyYear,
      periods12
    };
  }

  /**
   * 计算会员储值卡明细（价格、余额/剩余次数、保质期倒计时与临期预警）
   */
  function computeMemberCardsReport(data, todayDateStr) {
    const todayStr = todayDateStr || getTodayDateStr();
    const tToday = new Date(todayStr + 'T00:00:00').getTime();
    const rawCards = Array.isArray(data.memberCards) ? data.memberCards : [];

    const allTxNotes = data && data.transactions
      ? [
          ...(data.transactions.c || []),
          ...(data.transactions.q || []),
          ...(data.transactions.dengbao || [])
        ].map((t) => String((t && t.note) || ''))
      : [];

    const cards = rawCards.map((c) => {
      const cardType = c.cardType || 'stored'; // stored | times | period
      const owner = c.owner || 'family'; // family | c | q | dengbao
      const price = Number(c.price) || 0;
      const hasTotal = c.totalValue !== null && c.totalValue !== undefined && c.totalValue !== '';
      const totalValue = hasTotal ? Number(c.totalValue) : cardType === 'stored' ? price : 0;
      const hasRem = c.remainingValue !== null && c.remainingValue !== undefined && c.remainingValue !== '';
      const remainingValue = hasRem ? Number(c.remainingValue) : totalValue;
      const expiryDate = c.expiryDate ? String(c.expiryDate).trim() : '';
      const openDate = c.openDate ? String(c.openDate).trim() : '';
      const archived = !!c.archived;
      const autoDetectedInLedger =
        (Array.isArray(c.logs) && c.logs.some((lg) => lg && String(lg.note || '').includes('已同步记入账单'))) ||
        (c.name && allTxNotes.some((n) => n.includes(`[办卡] ${c.name}`)));
      const recordedInLedger = c.recordedInLedger !== undefined ? !!c.recordedInLedger : !!autoDetectedInLedger;
      const ledgerBadgeText = recordedInLedger ? '已入账单' : '未记账单';

      let daysLeft = null;
      if (expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
        const tExp = new Date(expiryDate + 'T00:00:00').getTime();
        if (!isNaN(tExp)) {
          daysLeft = Math.round((tExp - tToday) / 86400000);
        }
      }

      const isExpired = daysLeft !== null && daysLeft < 0;
      const isExpiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;
      const isDepleted = (cardType === 'stored' || cardType === 'times') && remainingValue <= 0;
      const isInactive = archived || isDepleted;

      let expiryBadgeText = '长期有效';
      let expiryLevel = 'ok';
      if (daysLeft !== null) {
        if (daysLeft < 0) {
          expiryBadgeText = `已过期 ${Math.abs(daysLeft)} 天`;
          expiryLevel = 'danger';
        } else if (daysLeft === 0) {
          expiryBadgeText = '今日到期';
          expiryLevel = 'danger';
        } else if (daysLeft <= 30) {
          expiryBadgeText = `剩 ${daysLeft} 天到期`;
          expiryLevel = 'warn';
        } else {
          expiryBadgeText = `有效 · 剩 ${daysLeft} 天`;
          expiryLevel = 'ok';
        }
      }

      // 剩余进度百分比 (0-100)
      let remainPct = 100;
      if (cardType === 'stored' || cardType === 'times') {
        remainPct = totalValue > 0 ? Math.max(0, Math.min(100, (remainingValue / totalValue) * 100)) : 0;
      } else if (expiryDate && openDate && daysLeft !== null) {
        const tOpen = new Date(openDate + 'T00:00:00').getTime();
        const tExp = new Date(expiryDate + 'T00:00:00').getTime();
        const totalDays = Math.max(1, Math.round((tExp - tOpen) / 86400000));
        remainPct = Math.max(0, Math.min(100, (Math.max(0, daysLeft) / totalDays) * 100));
      }

      // 折算单价或折扣提示
      let valueHint = '';
      if (cardType === 'times' && totalValue > 0 && price > 0) {
        valueHint = `折合 ¥${formatMoney(price / totalValue, false)}/次`;
      } else if (cardType === 'stored' && totalValue > price && price > 0) {
        const disc = ((price / totalValue) * 10).toFixed(1);
        valueHint = `相当于 ${disc} 折（赠送 ¥${formatMoney(totalValue - price, false)}）`;
      } else if (cardType === 'period' && openDate && expiryDate && price > 0) {
        const tOpen = new Date(openDate + 'T00:00:00').getTime();
        const tExp = new Date(expiryDate + 'T00:00:00').getTime();
        const totalMonths = Math.max(1, Math.round((tExp - tOpen) / (86400000 * 30)));
        valueHint = `约 ${totalMonths} 个月 · 折合 ¥${formatMoney(price / totalMonths, false)}/月`;
      }

      return {
        ...c,
        cardType,
        owner,
        price: round2(price),
        totalValue: round2(totalValue),
        remainingValue: round2(remainingValue),
        openDate,
        expiryDate,
        archived,
        recordedInLedger,
        ledgerBadgeText,
        daysLeft,
        isExpired,
        isExpiringSoon,
        isDepleted,
        isInactive,
        expiryBadgeText,
        expiryLevel,
        remainPct: round2(remainPct),
        valueHint,
        logs: Array.isArray(c.logs) ? c.logs : []
      };
    });

    // 排序：在用且临期/过期的排最前，其次在用卡按开卡日期倒序，已用完/归档排最后
    cards.sort((a, b) => {
      if (a.isInactive !== b.isInactive) return a.isInactive ? 1 : -1;
      const aUrgent = (a.isExpiringSoon || a.isExpired) && !a.isInactive ? 1 : 0;
      const bUrgent = (b.isExpiringSoon || b.isExpired) && !b.isInactive ? 1 : 0;
      if (aUrgent !== bUrgent) return bUrgent - aUrgent;
      if (aUrgent && bUrgent && a.daysLeft !== null && b.daysLeft !== null) {
        return a.daysLeft - b.daysLeft;
      }
      return (b.openDate || '').localeCompare(a.openDate || '');
    });

    const activeCards = cards.filter((c) => !c.isInactive);
    const totalPaidPrice = cards.reduce((acc, c) => acc + c.price, 0);
    const totalStoredRemaining = activeCards
      .filter((c) => c.cardType === 'stored' && !c.isExpired)
      .reduce((acc, c) => acc + Math.max(0, c.remainingValue), 0);
    const expiringSoonCards = activeCards.filter((c) => c.isExpiringSoon);
    const expiredActiveCards = activeCards.filter((c) => c.isExpired);

    return {
      cards,
      activeCount: activeCards.length,
      inactiveCount: cards.length - activeCards.length,
      totalCount: cards.length,
      totalPaidPrice: round2(totalPaidPrice),
      totalStoredRemaining: round2(totalStoredRemaining),
      expiringSoonCards,
      expiredActiveCards,
      alertCount: expiringSoonCards.length + expiredActiveCards.length
    };
  }

  /**
   * 计算「家庭金蛋与心愿金库」累计成就数据（历史累计攒钱 + 当年攒金蛋进度 + 许愿池可用池子余额）
   */
  function computeTreasurySummary(data, budgets, allocationsChain, activePeriod) {
    const cAll = summarizeMemberRange(data, 'c', '0000-01-01', '9999-12-31');
    const qAll = summarizeMemberRange(data, 'q', '0000-01-01', '9999-12-31');

    const pKey = activePeriod || getCurrentPeriodInfo().periodKey || '2026-10';
    const budgetYear = getPeriodRange(pKey).year || 2026;
    const yearRange = getBudgetYearRange(budgetYear);
    const cYear = summarizeMemberRange(data, 'c', yearRange.startDate, yearRange.nextStartDate);
    const qYear = summarizeMemberRange(data, 'q', yearRange.startDate, yearRange.nextStartDate);

    // 统计所有已录入工资账期的应存金蛋与许愿池月度累计预留
    const accruedGolden = { c: 0, q: 0 };
    const accruedWish = { c: 0, q: 0 };
    const salaryPeriods = { c: 0, q: 0 };

    Object.keys(allocationsChain || {}).forEach((k) => {
      const p = allocationsChain[k];
      if (!p) return;
      ['c', 'q'].forEach((m) => {
        if (p[m] && isNum(p[m].salary)) {
          accruedGolden[m] += Number(p[m].goldenEggTotal) || 0;
          accruedWish[m] += Number(p[m].wishMonthly) || 0;
          salaryPeriods[m] += 1;
        }
      });
    });

    const defFixed = (data.settings && data.settings.defaultFixedGoldenEgg) || { c: 2000, q: 2000 };
    const annualBaseTarget = round2(((Number(defFixed.c) || 2000) + (Number(defFixed.q) || 2000)) * 12);

    const cGoldDep = round2(cAll.goldenEggNetDeposit);
    const qGoldDep = round2(qAll.goldenEggNetDeposit);
    const totalGoldDep = round2(cGoldDep + qGoldDep);
    const yearGoldDep = round2(cYear.goldenEggNetDeposit + qYear.goldenEggNetDeposit);
    const totalGoldAccrued = round2(accruedGolden.c + accruedGolden.q);
    const goldStillNeedAll = round2(Math.max(0, totalGoldAccrued - totalGoldDep));
    const yearGoldPct = annualBaseTarget > 0 ? round2(Math.min(100, Math.max(0, (yearGoldDep / annualBaseTarget) * 100))) : 0;

    // 许愿池：支持「显式存入许愿池流水」与「发薪账期自动月均预留」双口径展示
    const cWishDep = round2(cAll.wishNetDeposit);
    const qWishDep = round2(qAll.wishNetDeposit);
    const totalWishDep = round2(cWishDep + qWishDep);
    const cWishAccrued = round2(accruedWish.c);
    const qWishAccrued = round2(accruedWish.q);
    const totalWishAccrued = round2(cWishAccrued + qWishAccrued);
    const cWishSpent = round2(cAll.wishNetSpent);
    const qWishSpent = round2(qAll.wishNetSpent);
    const totalWishSpent = round2(cWishSpent + qWishSpent);

    const hasExplicitWishDeposit = totalWishDep > 0;
    const cPoolIn = cWishDep > 0 ? cWishDep : cWishAccrued;
    const qPoolIn = qWishDep > 0 ? qWishDep : qWishAccrued;
    const cWishAvailable = round2(cPoolIn - cWishSpent);
    const qWishAvailable = round2(qPoolIn - qWishSpent);
    const wishDepositBalance = round2(totalWishDep - totalWishSpent);
    const wishReserveBalance = round2(totalWishAccrued - totalWishSpent);
    const wishAvailableBalance = hasExplicitWishDeposit ? wishDepositBalance : wishReserveBalance;

    const cOtherDep = round2(cAll.otherSavingsNetDeposit);
    const qOtherDep = round2(qAll.otherSavingsNetDeposit);
    const totalOtherDep = round2(cOtherDep + qOtherDep);

    return {
      budgetYear,
      goldenEgg: {
        cDeposit: cGoldDep,
        qDeposit: qGoldDep,
        totalDeposit: totalGoldDep,
        yearDeposit: yearGoldDep,
        annualBaseTarget,
        yearProgressPct: yearGoldPct,
        cAccruedTarget: round2(accruedGolden.c),
        qAccruedTarget: round2(accruedGolden.q),
        totalAccruedTarget: totalGoldAccrued,
        pendingCheckin: goldStillNeedAll
      },
      wishPool: {
        hasExplicitDeposit: hasExplicitWishDeposit,
        cDeposit: cWishDep,
        qDeposit: qWishDep,
        totalDeposit: totalWishDep,
        cAccrued: cWishAccrued,
        qAccrued: qWishAccrued,
        totalAccrued: totalWishAccrued,
        cSpent: cWishSpent,
        qSpent: qWishSpent,
        totalSpent: totalWishSpent,
        cAvailable: cWishAvailable,
        qAvailable: qWishAvailable,
        depositBalance: wishDepositBalance,
        reserveBalance: wishReserveBalance,
        availableBalance: wishAvailableBalance
      },
      otherSavings: {
        cDeposit: cOtherDep,
        qDeposit: qOtherDep,
        totalDeposit: totalOtherDep
      },
      salaryPeriods,
      totalNetDeposit: round2(totalGoldDep + totalWishDep + totalOtherDep)
    };
  }

  /**
   * 一站式计算全量视图模型
   */
  function computeFullReport(data, selectedPeriodKey) {
    const autoPeriodKey = getCurrentPeriodInfo().periodKey;
    const activePeriod = selectedPeriodKey || autoPeriodKey || data.settings.currentPeriod || '2026-10';
    const budgets = computeBudgets(data, activePeriod);
    const allocationsChain = computeAllocationsChain(data, budgets, activePeriod);
    const currentAllocation = allocationsChain[activePeriod];
    const annualTracking = computeAnnualTracking(data, budgets, activePeriod);
    const annualSummary = computeAnnualSummary(data, activePeriod);
    const dengbaoReport = computeDengbaoReport(data, budgets, activePeriod);
    const memberCardsReport = computeMemberCardsReport(data);
    const treasurySummary = computeTreasurySummary(data, budgets, allocationsChain, activePeriod);
    const cEnrichedTxs = enrichMemberTransactions(data, budgets, 'c', activePeriod);
    const qEnrichedTxs = enrichMemberTransactions(data, budgets, 'q', activePeriod);
    const dbEnrichedTxs = (data.transactions.dengbao || []).map((t, i) => ({
      ...t,
      index: i + 1,
      member: 'dengbao',
      periodKey: getPeriodFromDate(t.date).periodKey,
      checkMsg: validateDengbaoTx(t)
    }));

    const invalidCount =
      cEnrichedTxs.filter((t) => t.checkMsg).length +
      qEnrichedTxs.filter((t) => t.checkMsg).length +
      dbEnrichedTxs.filter((t) => t.checkMsg).length;

    return {
      activePeriod,
      autoPeriodKey,
      periodRange: getPeriodRange(activePeriod),
      budgets,
      allocationsChain,
      currentAllocation,
      annualTracking,
      annualSummary,
      dengbaoReport,
      memberCardsReport,
      treasurySummary,
      transactions: {
        c: cEnrichedTxs,
        q: qEnrichedTxs,
        dengbao: dbEnrichedTxs
      },
      invalidCount
    };
  }

  return {
    INITIAL_DATA,
    round2,
    formatMoney,
    getTodayDateStr,
    getCurrentPeriodInfo,
    getPeriodRange,
    getPeriodFromDate,
    getBudgetYearRange,
    getYearPeriods,
    validateMemberTx,
    validateDengbaoTx,
    resolveTxBudgetItem,
    computeBudgets,
    computeAllocationsChain,
    computeAnnualTracking,
    computeAnnualSummary,
    computeDengbaoReport,
    computeMemberCardsReport,
    computeTreasurySummary,
    enrichMemberTransactions,
    computeFullReport
  };
});
