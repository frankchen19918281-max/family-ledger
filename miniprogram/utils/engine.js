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
    }
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
   * 根据日期字符串 "YYYY-MM-DD" 推断所属账期 key "YYYY-MM" 及所属预算年
   * 规则：每月10日~次月9日为当月账期；每年1月10日~次年1月9日为当年预算年度
   */
  function getPeriodFromDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return { periodKey: '2026-10', budgetYear: 2026 };
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
   * 计算必要开支与许愿池预算指标
   */
  function computeBudgets(data) {
    const result = { c: {}, q: {}, dengbao: {} };
    ['c', 'q'].forEach((member) => {
      const necItems = (data.necessaryBudgets[member] || []).map((item) => {
        const hasBudget = item.annualBudget !== null && item.annualBudget !== '' && !isNaN(Number(item.annualBudget));
        const budgetNum = hasBudget ? Number(item.annualBudget) : null;
        const monthly = (item.name && hasBudget) ? budgetNum / 12 : null;
        let tip = '';
        if (!item.name && !hasBudget) tip = '';
        else if (!item.name) tip = '请填项目';
        else if (!hasBudget) tip = '未设金额，暂不计入';
        return {
          ...item,
          annualBudget: budgetNum,
          monthly,
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

      const wishItems = (data.wishBudgets[member] || []).map((item) => {
        const hasQuota = item.annualQuota !== null && item.annualQuota !== '' && !isNaN(Number(item.annualQuota));
        const quotaNum = hasQuota ? Number(item.annualQuota) : null;
        const monthsNum = item.months !== null && item.months !== '' && !isNaN(Number(item.months)) ? Number(item.months) : 12;
        const validMonths = monthsNum >= 1 && monthsNum % 1 === 0;
        const monthly = (item.name && hasQuota && quotaNum >= 0 && validMonths) ? quotaNum / monthsNum : null;
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
          tip
        };
      });
      const wishMonthlyTotal = wishItems.reduce((acc, it) => acc + (isNum(it.monthly) ? it.monthly : 0), 0);
      const wishAnnualQuota = wishItems.reduce((acc, it) => acc + (it.name && isNum(it.annualQuota) && it.annualQuota > 0 ? it.annualQuota : 0), 0);

      result[member] = {
        necessaryItems: necItems,
        necessaryMonthly: necMonthlyTotal,
        necessaryAnnualQuota: necAnnualQuota,
        dengbaoMonthlyReserve,
        wishItems,
        wishMonthly: wishMonthlyTotal,
        wishAnnualQuota
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
    // 预设账期序列（覆盖 2026-01 到 2027-12）
    const allPeriods = [];
    for (let y = 2026; y <= 2027; y++) {
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
        // 金蛋补足 = (工资 - 必要开支月均) * 50% - 固定金蛋
        const goldenEggSupplement = hasSalary ? (salary - necMonthly) * 0.5 - fixedGoldenEgg : null;
        // 金蛋应存合计 = 固定金蛋 + 金蛋补足 = (工资 - 必要开支月均) * 50%
        const goldenEggTotal = isNum(goldenEggSupplement) ? fixedGoldenEgg + goldenEggSupplement : null;
        // daily 零花钱 = 工资 - 必要开支月均 - 固定金蛋 - 许愿池月均 - 金蛋补足
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
    const budgetYear = Number(data.settings.budgetYear) || 2026;
    const yearRange = getBudgetYearRange(budgetYear);
    const curRange = getPeriodRange(currentPeriodKey || data.settings.currentPeriod || '2026-10');
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
  function enrichMemberTransactions(data, budgets, member) {
    const budgetYear = Number(data.settings.budgetYear) || 2026;
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

      if ((tx.type === '支出' || tx.type === '退款') && (tx.purpose === '必要开支' || tx.purpose === '许愿池')) {
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
        alertLevel
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
    // 生成从 2026-10 起的 12 个账期趋势
    const monthlySeries = [];
    let y = 2026;
    let m = 10;
    for (let i = 0; i < 12; i++) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      monthlySeries.push(calcForPeriod(k));
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
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
  function computeAnnualSummary(data) {
    const statYear = Number(data.settings.statYear || data.settings.budgetYear) || 2026;
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
   * 一站式计算全量视图模型
   */
  function computeFullReport(data, selectedPeriodKey) {
    const activePeriod = selectedPeriodKey || data.settings.currentPeriod || '2026-10';
    const budgets = computeBudgets(data);
    const allocationsChain = computeAllocationsChain(data, budgets, activePeriod);
    const currentAllocation = allocationsChain[activePeriod];
    const annualTracking = computeAnnualTracking(data, budgets, activePeriod);
    const annualSummary = computeAnnualSummary(data);
    const dengbaoReport = computeDengbaoReport(data, budgets, activePeriod);
    const cEnrichedTxs = enrichMemberTransactions(data, budgets, 'c');
    const qEnrichedTxs = enrichMemberTransactions(data, budgets, 'q');
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
      periodRange: getPeriodRange(activePeriod),
      budgets,
      allocationsChain,
      currentAllocation,
      annualTracking,
      annualSummary,
      dengbaoReport,
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
    getPeriodRange,
    getPeriodFromDate,
    getBudgetYearRange,
    getYearPeriods,
    validateMemberTx,
    validateDengbaoTx,
    computeBudgets,
    computeAllocationsChain,
    computeAnnualTracking,
    computeAnnualSummary,
    computeDengbaoReport,
    enrichMemberTransactions,
    computeFullReport
  };
});
