/**
 * 2026-2027 家庭共同记账 - H5 完整交互与双人同步逻辑
 */
(function () {
  const STORAGE_KEY = 'FAMILY_ACCOUNTING_DATA_2026_V1';
  const CLOUD_CFG_KEY = 'FAMILY_ACCOUNTING_CLOUD_CFG_V3';
  const PREF_ROLE_KEY = 'FAMILY_ACCOUNTING_PREF_ROLE_V1';
  const Engine = window.FamilyFinanceEngine;
  const fm = Engine.formatMoney;

  function getTodayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function getRelativeDateStr(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // 支持输入简易加减法公式，例如 "25+18.5" -> 43.5
  function evalMathAmount(expr) {
    if (expr === null || expr === undefined) return NaN;
    const str = String(expr).replace(/\s+/g, '');
    if (!str) return NaN;
    if (/^[0-9.]+$/.test(str)) return Number(str);
    if (!/^[0-9.+\-]+$/.test(str)) return NaN;
    const tokens = str.match(/[+\-]?[0-9.]+/g);
    if (!tokens) return NaN;
    const sum = tokens.reduce((acc, t) => acc + Number(t), 0);
    return Math.round((sum + Number.EPSILON) * 100) / 100;
  }

  function calcPeriodRemainingDays(endDateStr) {
    const todayStr = getTodayStr();
    const t0 = new Date(todayStr + 'T00:00:00');
    const tEnd = new Date(endDateStr + 'T00:00:00');
    const diff = Math.floor((tEnd - t0) / 86400000) + 1;
    if (diff <= 0) return 1;
    if (diff > 31) return 30;
    return diff;
  }

  // 夫妻密码加密保险箱（密码为 cq2026，源代码无任何明文 Token，外人无密码无法进入也无法算出密钥）
  const VAULT_SALT = 'family_ledger_2026_salt_v1';
  const VAULT_CIPHER_HEX =
    '2e66ddcff0ebb5065cdac486c2b05c7e520e2c92c8e6b81d77a6f679ee34a6f13e5139ce5fcb940112c8e74a8b88de87cb47eac04e7f2982d56f0c562724fda781930f0be2751fec550bfb15';

  function deriveStream(pin, length) {
    const out = [];
    const blocks = Math.floor(length / 4) + 2;
    for (let b = 0; b < blocks; b++) {
      const s = `${pin}:${b}:${VAULT_SALT}`;
      let h = 2166136261 >>> 0;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      h ^= (h << 13) >>> 0;
      h ^= h >>> 17;
      h ^= (h << 5) >>> 0;
      h = h >>> 0;
      out.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
    }
    return out.slice(0, length);
  }

  function tryUnlockVault(pin) {
    if (!pin) return null;
    const cleanPin = String(pin).trim();
    const cipherBytes = [];
    for (let i = 0; i < VAULT_CIPHER_HEX.length; i += 2) {
      cipherBytes.push(parseInt(VAULT_CIPHER_HEX.slice(i, i + 2), 16));
    }
    const stream = deriveStream(cleanPin, cipherBytes.length);
    const plainBytes = cipherBytes.map((b, idx) => b ^ stream[idx]);
    const text = String.fromCharCode(...plainBytes);
    if (text.startsWith('OK|')) {
      const parts = text.split('|');
      return {
        provider: 'github',
        token: parts[1],
        gistId: parts[2],
        unlocked: true
      };
    }
    return null;
  }

  function loadCloudConfig() {
    let saved = {
      provider: 'github',
      token: '',
      gistId: '',
      unlocked: false
    };
    try {
      const raw = localStorage.getItem(CLOUD_CFG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.token && parsed.unlocked) {
          saved = { ...saved, ...parsed };
        }
      }
    } catch (e) {}

    // Localhost 本地开发预览自动免密解锁，方便电脑调试
    if (!saved.unlocked && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      saved.unlocked = true;
    }
    return saved;
  }

  const savedPrefRole = localStorage.getItem(PREF_ROLE_KEY) || 'c';

  // 应用状态
  const state = {
    data: loadLocalData(),
    cloudCfg: loadCloudConfig(),
    currentTab: 'dashboard', // dashboard | add | ledger | dengbao | budget
    activePeriod: '2026-10',
    // 记一笔状态（自动记住本机默认角色 + 默认今天日期）
    addForm: {
      role: savedPrefRole, // c | q | dengbao
      date: getTodayStr(),
      amount: '',
      type: '支出',
      purpose: '日常',
      payer: savedPrefRole === 'q' ? 'q' : 'c',
      category: savedPrefRole === 'dengbao' ? '孩子用品' : '餐饮外卖',
      note: '',
      editingId: null,
      editingRole: null
    },
    // 流水筛选状态
    ledgerFilter: {
      role: 'all', // all | c | q | dengbao
      purpose: 'all', // all | 日常 | 必要开支 | 许愿池 | 工资 | 金蛋 | 孩子
      onlyCurrentPeriod: true,
      chartDim: 'category', // category | purpose | member
      searchKeyword: '',
      selectedChartItem: ''
    },
    // 预算/同步页子Tab
    budgetSubTab: 'necessary', // necessary | wish | yearend | sync
    budgetRole: 'c',
    syncOnline: false,
    syncModeLabel: '本地'
  };

  function loadLocalData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.transactions && parsed.necessaryBudgets) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('读取本地缓存失败，使用初始 Excel 预置数据', e);
    }
    return JSON.parse(JSON.stringify(Engine.INITIAL_DATA));
  }

  function saveData(triggerSync = true) {
    state.data.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    if (triggerSync) {
      pushToServer();
    }
  }

  function showToast(msg) {
    const el = document.getElementById('toastEl');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => {
      el.classList.remove('show');
    }, 2200);
  }

  function saveCloudConfig() {
    localStorage.setItem(CLOUD_CFG_KEY, JSON.stringify(state.cloudCfg));
  }

  // 智能合并两份账本数据（你和老婆同时记账也不会互相覆盖，按流水 ID 自动合并去重）
  function mergeLedgerData(local, remote) {
    if (!remote || !remote.transactions) return local;
    if (!local || !local.transactions) return remote;

    const merged = JSON.parse(JSON.stringify(
      (remote.updatedAt || '') > (local.updatedAt || '') ? remote : local
    ));

    // 合并 c、q、dengbao 三张表的流水（按 id 去重，保留最新修改）
    ['c', 'q', 'dengbao'].forEach((role) => {
      const map = new Map();
      const olderList = ((remote.updatedAt || '') > (local.updatedAt || '') ? local : remote).transactions[role] || [];
      const newerList = ((remote.updatedAt || '') > (local.updatedAt || '') ? remote : local).transactions[role] || [];
      olderList.forEach((tx) => {
        if (tx && tx.id) map.set(tx.id, tx);
      });
      newerList.forEach((tx) => {
        if (tx && tx.id) map.set(tx.id, tx);
      });
      // 处理已删除的流水 ID 集合
      const deletedIds = new Set([
        ...(local.deletedTxIds || []),
        ...(remote.deletedTxIds || [])
      ]);
      merged.deletedTxIds = Array.from(deletedIds);
      merged.transactions[role] = Array.from(map.values()).filter((tx) => !deletedIds.has(tx.id));
    });

    // 合并分类标签
    merged.categories = Array.from(new Set([...(local.categories || []), ...(remote.categories || [])]));
    merged.dengbaoCategories = Array.from(new Set([...(local.dengbaoCategories || []), ...(remote.dengbaoCategories || [])]));

    return merged;
  }

  // 双人实时同步（支持 GitHub Gist / Gitee 代码片段 / 局域网服务端 三合一自动同步）
  async function pullFromServer(showFeedback = false) {
    const cfg = state.cloudCfg;
    const code = state.data.familyCode || 'cq2026';
    const fileName = `family_ledger_${code}.json`;

    // 1. 若配置了 GitHub Gist 或 Gitee Gist 云端同步
    if ((cfg.provider === 'github' || cfg.provider === 'gitee') && cfg.token && cfg.gistId) {
      try {
        const ts = Date.now();
        const apiUrl =
          cfg.provider === 'github'
            ? `https://api.github.com/gists/${cfg.gistId}?_t=${ts}`
            : `https://gitee.com/api/v5/gists/${cfg.gistId}?access_token=${encodeURIComponent(cfg.token)}&_t=${ts}`;
        const headers =
          cfg.provider === 'github'
            ? { Authorization: `token ${cfg.token}`, Accept: 'application/vnd.github.v3+json' }
            : {};
        const res = await fetch(apiUrl, { headers, cache: 'no-store' });
        if (res.ok) {
          const gist = await res.json();
          const fileObj = gist.files && (gist.files[fileName] || Object.values(gist.files)[0]);
          if (fileObj && fileObj.content) {
            const remoteData = JSON.parse(fileObj.content);
            state.syncOnline = true;
            state.syncModeLabel = cfg.provider === 'github' ? 'GitHub云' : 'Gitee云';
            updateSyncHeader();

            const localStr = JSON.stringify(state.data.transactions);
            const merged = mergeLedgerData(state.data, remoteData);
            const mergedStr = JSON.stringify(merged.transactions);

            if (localStr !== mergedStr || (remoteData.updatedAt && remoteData.updatedAt > (state.data.updatedAt || ''))) {
              state.data = merged;
              localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
              render();
              if (showFeedback) showToast('🔄 已同步最新云端账本');
            } else if (showFeedback) {
              showToast('✅ 当前已是最新云端数据');
            }
            return true;
          }
        }
      } catch (e) {
        console.warn('云端拉取失败，尝试局域网或本地模式', e);
      }
    }

    // 2. 局域网 / 本地 Python 同步服务
    try {
      const res = await fetch(`/api/ledger?code=${encodeURIComponent(code)}&_t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('not ok');
      const payload = await res.json();
      state.syncOnline = true;
      state.syncModeLabel = 'Wi-Fi同步';
      updateSyncHeader();
      if (payload && payload.data && payload.data.updatedAt) {
        const merged = mergeLedgerData(state.data, payload.data);
        state.data = merged;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
        render();
      }
      return true;
    } catch (e) {
      state.syncOnline = false;
      state.syncModeLabel = '本地离线';
      updateSyncHeader();
      if (showFeedback) showToast('⚠️ 云端连接受阻，已保存在手机本地');
      return false;
    }
  }

  async function pushToServer() {
    const cfg = state.cloudCfg;
    const code = state.data.familyCode || 'cq2026';
    const fileName = `family_ledger_${code}.json`;

    // 推送前先拉取一次远端进行智能合并，防止两人同时记账互相覆盖
    if ((cfg.provider === 'github' || cfg.provider === 'gitee') && cfg.token && cfg.gistId) {
      try {
        const apiUrl =
          cfg.provider === 'github'
            ? `https://api.github.com/gists/${cfg.gistId}?_t=${Date.now()}`
            : `https://gitee.com/api/v5/gists/${cfg.gistId}?access_token=${encodeURIComponent(cfg.token)}&_t=${Date.now()}`;
        const headers =
          cfg.provider === 'github'
            ? { Authorization: `token ${cfg.token}`, Accept: 'application/vnd.github.v3+json' }
            : {};
        const preRes = await fetch(apiUrl, { headers, cache: 'no-store' });
        if (preRes.ok) {
          const gist = await preRes.json();
          const fileObj = gist.files && (gist.files[fileName] || Object.values(gist.files)[0]);
          if (fileObj && fileObj.content) {
            const remoteData = JSON.parse(fileObj.content);
            state.data = mergeLedgerData(state.data, remoteData);
            state.data.updatedAt = new Date().toISOString();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
          }
        }
      } catch (e) {}
    }

    // 1. GitHub / Gitee 云端同步推送
    if ((cfg.provider === 'github' || cfg.provider === 'gitee') && cfg.token) {
      try {
        const isCreating = !cfg.gistId;
        const apiUrl =
          cfg.provider === 'github'
            ? isCreating
              ? 'https://api.github.com/gists'
              : `https://api.github.com/gists/${cfg.gistId}`
            : isCreating
            ? 'https://gitee.com/api/v5/gists'
            : `https://gitee.com/api/v5/gists/${cfg.gistId}`;

        const headers = { 'Content-Type': 'application/json' };
        if (cfg.provider === 'github') {
          headers.Authorization = `token ${cfg.token}`;
          headers.Accept = 'application/vnd.github.v3+json';
        }

        const bodyObj = {
          description: `2026-2027 家庭共同记账 (${code})`,
          public: false,
          files: {
            [fileName]: { content: JSON.stringify(state.data, null, 2) }
          }
        };
        if (cfg.provider === 'gitee') {
          bodyObj.access_token = cfg.token;
        }

        const res = await fetch(apiUrl, {
          method: isCreating ? 'POST' : 'PATCH',
          headers,
          body: JSON.stringify(bodyObj)
        });
        if (res.ok) {
          const result = await res.json();
          if (result && result.id && !cfg.gistId) {
            state.cloudCfg.gistId = result.id;
            saveCloudConfig();
          }
          state.syncOnline = true;
          state.syncModeLabel = cfg.provider === 'github' ? 'GitHub云' : 'Gitee云';
          updateSyncHeader();
          render();
          return;
        }
      } catch (e) {
        console.warn('云端推送失败', e);
      }
    }

    // 2. 局域网 / 本地 Python 同步服务
    try {
      const res = await fetch(`/api/ledger?code=${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: state.data })
      });
      if (res.ok) {
        state.syncOnline = true;
        state.syncModeLabel = 'Wi-Fi同步';
        updateSyncHeader();
      }
    } catch (e) {
      state.syncOnline = false;
      state.syncModeLabel = '本地离线';
      updateSyncHeader();
    }
  }

  function updateSyncHeader() {
    const dot = document.getElementById('syncDot');
    const txt = document.getElementById('syncText');
    if (!dot || !txt) return;
    const code = state.data.familyCode || 'cq2026';
    dot.style.background = state.syncOnline ? '#34d399' : '#fbbf24';
    txt.textContent = `${state.syncModeLabel}: ${code}`;
  }

  // 生成账期下拉选项 (2026-01 ~ 2027-12)
  function initPeriodSelect() {
    const sel = document.getElementById('periodSelect');
    if (!sel) return;
    const periods = [];
    for (let y = 2026; y <= 2027; y++) {
      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        periods.push(Engine.getPeriodRange(key));
      }
    }
    sel.innerHTML = periods
      .map((p) => `<option value="${p.periodKey}" ${p.periodKey === state.activePeriod ? 'selected' : ''}>${p.label}</option>`)
      .join('');

    sel.onchange = (e) => {
      state.activePeriod = e.target.value;
      state.data.settings.currentPeriod = state.activePeriod;
      saveData(false);
      render();
    };

    document.getElementById('prevPeriodBtn').onclick = () => stepPeriod(-1);
    document.getElementById('nextPeriodBtn').onclick = () => stepPeriod(1);
    document.getElementById('syncStatusBtn').onclick = () => {
      showToast('🔄 正在同步最新云端账本...');
      pullFromServer(true);
    };
  }

  function stepPeriod(delta) {
    const [yStr, mStr] = state.activePeriod.split('-');
    let y = parseInt(yStr, 10);
    let m = parseInt(mStr, 10) + delta;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    if (y < 2026) { y = 2026; m = 1; }
    if (y > 2027) { y = 2027; m = 12; }
    state.activePeriod = `${y}-${String(m).padStart(2, '0')}`;
    const sel = document.getElementById('periodSelect');
    if (sel) sel.value = state.activePeriod;
    render();
  }

  function updateTabBarUI() {
    document.querySelectorAll('.tab-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === state.currentTab);
    });
  }

  // ==================== 1. 家庭看板 (Dashboard) ====================
  function renderDashboard(report) {
    const alloc = report.currentAllocation;
    const track = report.annualTracking;
    const annSum = report.annualSummary;
    const remDays = calcPeriodRemainingDays(report.periodRange.endDate);
    const cPerDay = alloc.c.remainingPocket !== null ? Math.max(0, alloc.c.remainingPocket / remDays) : null;
    const qPerDay = alloc.q.remainingPocket !== null ? Math.max(0, alloc.q.remainingPocket / remDays) : null;

    const statusBadge = (level, text) => {
      const map = { ok: 'badge-ok', warn: 'badge-warn', danger: 'badge-danger', info: 'badge-info' };
      return `<span class="badge ${map[level] || 'badge-info'}">${text}</span>`;
    };

    return `
      <!-- 零花钱核心卡片 -->
      <section class="pocket-hero">
        <div class="pocket-hero-top">
          <div>
            <div class="pocket-total-label">本期家庭剩余零花钱 (${report.periodRange.startDate} ~ ${report.periodRange.endDate} · 剩${remDays}天)</div>
            <div class="pocket-total-val">¥ ${fm(alloc.family.remainingPocket)}</div>
          </div>
          <button class="btn-secondary" style="background:rgba(255,255,255,0.14);color:#fff;border:none;" data-action="quickAdd">
            + 记一笔
          </button>
        </div>
        <div class="pocket-person-grid">
          <div class="pocket-person-box">
            <div class="pocket-person-header">
              <span>👦 c（你）剩余零花</span>
              <span class="badge badge-c">daily ¥${fm(alloc.c.dailyAllowance)}</span>
            </div>
            <div class="pocket-person-val">¥ ${fm(alloc.c.remainingPocket)}</div>
            <div class="pocket-person-meta">
              📅 日均可用: <strong style="color:#38bdf8;">¥${fm(cPerDay)}/天</strong><br/>
              本期已花: ¥${fm(alloc.c.dailyNetSpent, false)} | 上期滚存: ¥${fm(alloc.c.prevBalance)}
            </div>
          </div>
          <div class="pocket-person-box">
            <div class="pocket-person-header">
              <span>👧 q（她）剩余零花</span>
              <span class="badge badge-q">daily ¥${fm(alloc.q.dailyAllowance)}</span>
            </div>
            <div class="pocket-person-val">¥ ${fm(alloc.q.remainingPocket)}</div>
            <div class="pocket-person-meta">
              📅 日均可用: <strong style="color:#f472b6;">¥${fm(qPerDay)}/天</strong><br/>
              本期已花: ¥${fm(alloc.q.dailyNetSpent, false)} | 上期滚存: ¥${fm(alloc.q.prevBalance)}
            </div>
          </div>
        </div>
      </section>

      ${(!alloc.family.bothHaveSalary) ? `
        <div class="alert-banner warn">
          💡 <strong>本期分配提醒：</strong>${alloc.c.statusTip !== '正常' ? 'c ' + alloc.c.statusTip + '；' : ''}${alloc.q.statusTip !== '正常' ? 'q ' + alloc.q.statusTip : ''}
          （点击下方“记一笔”选择“收入+工资”即可自动激活当期分配）
        </div>
      ` : ''}

      <!-- 本期工资与月度分配表 -->
      <section class="card">
        <div class="card-header">
          <div>
            <div class="card-title">💰 本期工资分配明细</div>
            <div class="card-subtitle">金蛋=(工资-必要月均)×50% · 另需转存=金蛋补足+许愿池月均</div>
          </div>
          <button class="btn-secondary" data-action="openPeriodOverride">期初/固定金蛋</button>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>分配项目</th>
              <th>c（你）</th>
              <th>q（她）</th>
              <th>家庭合计</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>工资收入</td>
              <td>${fm(alloc.c.salary)}</td>
              <td>${fm(alloc.q.salary)}</td>
              <td><strong>${fm(alloc.family.salary)}</strong></td>
            </tr>
            <tr>
              <td>月均必要开支</td>
              <td>${fm(alloc.c.necessaryMonthly)}</td>
              <td>${fm(alloc.q.necessaryMonthly)}</td>
              <td>${fm(alloc.family.necessaryMonthly)}</td>
            </tr>
            <tr>
              <td>金蛋固定部分</td>
              <td>${fm(alloc.c.fixedGoldenEgg)}</td>
              <td>${fm(alloc.q.fixedGoldenEgg)}</td>
              <td>${fm(alloc.family.fixedGoldenEgg)}</td>
            </tr>
            <tr>
              <td>金蛋补足部分</td>
              <td>${fm(alloc.c.goldenEggSupplement)}</td>
              <td>${fm(alloc.q.goldenEggSupplement)}</td>
              <td>${fm(alloc.family.goldenEggSupplement)}</td>
            </tr>
            <tr class="row-highlight">
              <td>🥚 金蛋应存合计</td>
              <td>${fm(alloc.c.goldenEggTotal)}</td>
              <td>${fm(alloc.q.goldenEggTotal)}</td>
              <td>${fm(alloc.family.goldenEggTotal)}</td>
            </tr>
            <tr>
              <td>✨ 许愿池月均</td>
              <td>${fm(alloc.c.wishMonthly)}</td>
              <td>${fm(alloc.q.wishMonthly)}</td>
              <td>${fm(alloc.family.wishMonthly)}</td>
            </tr>
            <tr class="row-accent">
              <td>👛 daily 零花钱</td>
              <td>${fm(alloc.c.dailyAllowance)}</td>
              <td>${fm(alloc.q.dailyAllowance)}</td>
              <td>${fm(alloc.family.dailyAllowance)}</td>
            </tr>
            <tr class="row-highlight">
              <td>🏦 另需转存提醒</td>
              <td>${fm(alloc.c.extraTransfer)}</td>
              <td>${fm(alloc.q.extraTransfer)}</td>
              <td>${fm(alloc.family.extraTransfer)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 本期实际消费与实际存入 -->
      <section class="card">
        <div class="card-header">
          <div>
            <div class="card-title">🧾 本期实际消费 & 储蓄打卡</div>
            <div class="card-subtitle">噔宝消费按付款人计入必要开支</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn-secondary" style="font-size:11px;padding:5px 8px;" data-action="quickDepositGolden" data-member="c">⚡ c金蛋打卡</button>
            <button class="btn-secondary" style="font-size:11px;padding:5px 8px;" data-action="quickDepositGolden" data-member="q">⚡ q金蛋打卡</button>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>本期项目</th>
              <th>c（你）</th>
              <th>q（她）</th>
              <th>家庭合计</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>日常净消费</td>
              <td>${fm(alloc.c.dailyNetSpent, false)}</td>
              <td>${fm(alloc.q.dailyNetSpent, false)}</td>
              <td>${fm(alloc.family.dailyNetSpent, false)}</td>
            </tr>
            <tr>
              <td>必要开支净消费 <span style="font-size:10px;color:#94a3b8;">(含噔宝)</span></td>
              <td>${fm(alloc.c.necessaryNetSpent, false)}</td>
              <td>${fm(alloc.q.necessaryNetSpent, false)}</td>
              <td>${fm(alloc.family.necessaryNetSpent, false)}</td>
            </tr>
            <tr>
              <td>许愿池净消费</td>
              <td>${fm(alloc.c.wishNetSpent, false)}</td>
              <td>${fm(alloc.q.wishNetSpent, false)}</td>
              <td>${fm(alloc.family.wishNetSpent, false)}</td>
            </tr>
            <tr class="row-highlight">
              <td>🔥 本期消费合计</td>
              <td>${fm(alloc.c.totalNetSpent, false)}</td>
              <td>${fm(alloc.q.totalNetSpent, false)}</td>
              <td>${fm(alloc.family.totalNetSpent, false)}</td>
            </tr>
            <tr>
              <td>金蛋净存入</td>
              <td>${fm(alloc.c.goldenEggNetDeposit, false)}</td>
              <td>${fm(alloc.q.goldenEggNetDeposit, false)}</td>
              <td>${fm(alloc.family.goldenEggNetDeposit, false)}</td>
            </tr>
            <tr>
              <td>金蛋还需存入</td>
              <td>${fm(alloc.c.goldenEggStillNeed)}</td>
              <td>${fm(alloc.q.goldenEggStillNeed)}</td>
              <td>${fm(alloc.family.goldenEggStillNeed)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 年度预算跟踪 (80%预警) -->
      <section class="card">
        <div class="card-header">
          <div>
            <div class="card-title">🎯 ${track.budgetYear}年度预算额度跟踪</div>
            <div class="card-subtitle">周期: ${track.yearRange.startDate} ~ ${track.yearRange.endDate} (80%预警)</div>
          </div>
        </div>

        <!-- 必要开支进度 -->
        <div class="progress-block">
          <div class="progress-top">
            <span><strong>c 必要开支</strong> (已用 ${(track.c.necRatio * 100).toFixed(1)}%)</span>
            ${statusBadge(track.c.necLevel, track.c.necStatus)}
          </div>
          <div class="progress-track">
            <div class="progress-fill ${track.c.necLevel}" style="width:${Math.min(100, track.c.necRatio * 100)}%"></div>
          </div>
          <div class="progress-sub">
            <span>已消费: ¥${fm(track.c.necSpent, false)} / 额度: ¥${fm(track.c.necQuota, false)}</span>
            <span>剩余可用: <strong>¥${fm(track.c.necRemaining, false)}</strong></span>
          </div>
        </div>

        <div class="progress-block">
          <div class="progress-top">
            <span><strong>q 必要开支</strong> (已用 ${(track.q.necRatio * 100).toFixed(1)}%)</span>
            ${statusBadge(track.q.necLevel, track.q.necStatus)}
          </div>
          <div class="progress-track">
            <div class="progress-fill ${track.q.necLevel}" style="width:${Math.min(100, track.q.necRatio * 100)}%"></div>
          </div>
          <div class="progress-sub">
            <span>已消费: ¥${fm(track.q.necSpent, false)} / 额度: ¥${fm(track.q.necQuota, false)}</span>
            <span>剩余可用: <strong>¥${fm(track.q.necRemaining, false)}</strong></span>
          </div>
        </div>

        <hr style="border:none;border-top:1px dashed #e2e8f0;margin:14px 0;" />

        <!-- 许愿池进度 -->
        <div class="progress-block">
          <div class="progress-top">
            <span><strong>c 许愿池</strong> (已用 ${(track.c.wishRatio * 100).toFixed(1)}%)</span>
            ${statusBadge(track.c.wishLevel, track.c.wishStatus)}
          </div>
          <div class="progress-track">
            <div class="progress-fill ${track.c.wishLevel}" style="width:${Math.min(100, track.c.wishRatio * 100)}%"></div>
          </div>
          <div class="progress-sub">
            <span>已消费: ¥${fm(track.c.wishSpent, false)} / 额度: ¥${fm(track.c.wishQuota, false)}</span>
            <span>剩余可用: <strong>¥${fm(track.c.wishRemaining, false)}</strong></span>
          </div>
        </div>

        <div class="progress-block">
          <div class="progress-top">
            <span><strong>q 许愿池</strong> (已用 ${(track.q.wishRatio * 100).toFixed(1)}%)</span>
            ${statusBadge(track.q.wishLevel, track.q.wishStatus)}
          </div>
          <div class="progress-track">
            <div class="progress-fill ${track.q.wishLevel}" style="width:${Math.min(100, track.q.wishRatio * 100)}%"></div>
          </div>
          <div class="progress-sub">
            <span>已消费: ¥${fm(track.q.wishSpent, false)} / 额度: ¥${fm(track.q.wishQuota, false)}</span>
            <span>剩余可用: <strong>¥${fm(track.q.wishRemaining, false)}</strong></span>
          </div>
        </div>
      </section>

      <!-- 全年12个账期收支趋势 -->
      <section class="card">
        <div class="card-header">
          <div>
            <div class="card-title">📅 ${annSum.statYear}年度12个账期汇总</div>
            <div class="card-subtitle">全年收支结余: ¥${fm(annSum.family.netBalance, false)} (存钱不算消费)</div>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>账期起始</th>
              <th>家庭收入</th>
              <th>家庭净消费</th>
              <th>收支结余</th>
            </tr>
          </thead>
          <tbody>
            ${annSum.periods12
              .filter((p) => p.hasRecords || p.periodKey === state.activePeriod)
              .map(
                (p) => `
              <tr class="${p.periodKey === state.activePeriod ? 'row-highlight' : ''}">
                <td>${p.startDate} ${p.periodKey === state.activePeriod ? '<span class="badge badge-info">当前</span>' : ''}</td>
                <td>${fm(p.income)}</td>
                <td>${fm(p.spent)}</td>
                <td>${fm(p.balance)}</td>
              </tr>
            `
              )
              .join('')}
            <tr class="row-accent">
              <td>年度合计</td>
              <td>${fm(annSum.family.totalIncome, false)}</td>
              <td>${fm(annSum.family.totalNetSpent, false)}</td>
              <td>${fm(annSum.family.netBalance, false)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    `;
  }

  // ==================== 2. 记一笔 (Add Transaction) ====================
  function getPurposeOptionsByType(type) {
    if (type === '支出' || type === '退款') return ['日常', '必要开支', '许愿池'];
    if (type === '收入') return ['工资', '意外之喜', '日常', '必要开支'];
    if (type === '存入' || type === '取出') return ['金蛋', '许愿池', '其他储蓄'];
    return ['日常'];
  }

  function renderAdd(report) {
    const f = state.addForm;
    const isDengbao = f.role === 'dengbao';
    const typeOptions = isDengbao ? ['支出', '退款'] : ['支出', '收入', '退款', '存入', '取出'];
    if (!typeOptions.includes(f.type)) f.type = '支出';

    const purposeOptions = getPurposeOptionsByType(f.type);
    if (!isDengbao && !purposeOptions.includes(f.purpose)) {
      f.purpose = purposeOptions[0];
    }

    const cats = isDengbao ? state.data.dengbaoCategories : state.data.categories;

    // 实时预览本笔后剩余年度额度
    let quotaPreviewHtml = '';
    const numAmt = evalMathAmount(f.amount) || 0;
    if (!isDengbao && (f.type === '支出' || f.type === '退款') && (f.purpose === '必要开支' || f.purpose === '许愿池')) {
      const memberTrack = report.annualTracking[f.role];
      const curRem = f.purpose === '必要开支' ? memberTrack.necRemaining : memberTrack.wishRemaining;
      const delta = f.type === '支出' ? -numAmt : numAmt;
      const afterRem = curRem + delta;
      quotaPreviewHtml = `
        <div class="alert-banner ${afterRem < 0 ? 'warn' : 'info'}">
          📊 <strong>年度${f.purpose}额度预览：</strong>当前剩余 ¥${fm(curRem, false)} → 本笔后剩余 <strong>¥${fm(afterRem, false)}</strong>
        </div>
      `;
    } else if (isDengbao) {
      const dbCur = report.dengbaoReport.current;
      const delta = f.type === '支出' ? -numAmt : numAmt;
      const afterRem = dbCur.balance + delta;
      quotaPreviewHtml = `
        <div class="alert-banner ${afterRem < 0 ? 'warn' : 'ok'}">
          👶 <strong>噔宝本月额度预览：</strong>当前结余 ¥${fm(dbCur.balance, false)} → 本笔后结余 <strong>¥${fm(afterRem, false)}</strong>
          （自动计入 <strong>${f.payer}</strong> 的年度必要开支）
        </div>
      `;
    }

    return `
      <section class="card">
        <div class="card-header">
          <div class="card-title">${f.editingId ? '✏️ 编辑流水记录' : '✍️ 记一笔账'}</div>
          ${f.editingId ? `<button class="btn-secondary" data-action="cancelEdit">取消编辑</button>` : ''}
        </div>

        <!-- 记账账本切换 -->
        <div class="form-group">
          <label class="form-label">选择记账本</label>
          <div class="segmented">
            <button class="seg-btn ${f.role === 'c' ? 'active' : ''}" data-role="c">👦 c 记账（你）</button>
            <button class="seg-btn ${f.role === 'q' ? 'active' : ''}" data-role="q">👧 q 记账（她）</button>
            <button class="seg-btn ${f.role === 'dengbao' ? 'active' : ''}" data-role="dengbao">👶 噔宝支出</button>
          </div>
        </div>

        <!-- 交易类型 -->
        <div class="form-group">
          <label class="form-label">收支类型</label>
          <div class="chip-grid">
            ${typeOptions
              .map(
                (t) => `<button type="button" class="chip ${f.type === t ? 'active' : ''}" data-type="${t}">${t}</button>`
              )
              .join('')}
          </div>
        </div>

        ${
          isDengbao
            ? `
          <div class="form-group">
            <label class="form-label">付款人（计入谁的年度必要开支）</label>
            <div class="segmented">
              <button type="button" class="seg-btn ${f.payer === 'c' ? 'active' : ''}" data-payer="c">👦 c 付款</button>
              <button type="button" class="seg-btn ${f.payer === 'q' ? 'active' : ''}" data-payer="q">👧 q 付款</button>
            </div>
          </div>
        `
            : `
          <div class="form-group">
            <label class="form-label">资金用途（已按类型智能过滤防呆）</label>
            <div class="chip-grid">
              ${purposeOptions
                .map(
                  (p) => `<button type="button" class="chip ${f.purpose === p ? 'active' : ''}" data-purpose="${p}">${p}</button>`
                )
                .join('')}
            </div>
          </div>
        `
        }

        <!-- 日期与金额 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="form-group">
            <label class="form-label">发生日期</label>
            <input type="date" class="form-input" id="txDateInput" value="${f.date}" />
            <div class="quick-date-btns">
              <button type="button" class="quick-date-btn" data-qdate="0">今天</button>
              <button type="button" class="quick-date-btn" data-qdate="-1">昨天</button>
              <button type="button" class="quick-date-btn" data-qdate="-2">前天</button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;justify-content:space-between;">
              <span>金额（元）</span>
              <span id="calcPreviewSpan" style="color:#0f766e;font-weight:700;">${/[+\-]/.test(String(f.amount)) && !isNaN(numAmt) ? '= ¥' + fm(numAmt, false) : ''}</span>
            </label>
            <input type="text" inputmode="decimal" placeholder="0.00" class="form-input amount-input" id="txAmountInput" value="${f.amount}" />
            <div class="calc-ops-bar">
              <button type="button" class="calc-op-btn" data-calcop="+">＋加</button>
              <button type="button" class="calc-op-btn" data-calcop="-">－减</button>
              <button type="button" class="calc-op-btn eq" data-calcop="=">＝等于</button>
              <button type="button" class="calc-op-btn" data-calcop="C">清空</button>
            </div>
          </div>
        </div>

        ${quotaPreviewHtml}

        <!-- 分类选择 -->
        <div class="form-group">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <label class="form-label" style="margin:0;">分类标签（选填）</label>
            <button type="button" class="btn-secondary" style="padding:3px 8px;font-size:11px;" data-action="addNewCategory">+ 新增分类</button>
          </div>
          <div class="chip-grid">
            <button type="button" class="chip ${f.category === '' ? 'active' : ''}" data-cat="">不选分类</button>
            ${cats
              .map(
                (c) => `<button type="button" class="chip ${f.category === c ? 'active' : ''}" data-cat="${c}">${c}</button>`
              )
              .join('')}
          </div>
        </div>

        <!-- 备注 -->
        <div class="form-group">
          <label class="form-label">备注说明（选填）</label>
          <input type="text" class="form-input" id="txNoteInput" placeholder="例如：山姆超市采购、京东买书..." value="${f.note || ''}" />
        </div>

        <button type="button" class="btn-primary" id="submitTxBtn">
          ${f.editingId ? '💾 保存修改' : '✅ 确认记入账本'}
        </button>
      </section>
    `;
  }

  // ==================== 3. 流水明细 (Ledger List + 可视化支出比例图) ====================
  function buildExpenseChartHtml(filtered, chartDim) {
    const palette = ['#0d9488', '#3b82f6', '#ec4899', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#64748b'];
    const groupMap = {};

    filtered.forEach((tx) => {
      if (tx.type !== '支出' && tx.type !== '退款') return;
      const amt = Number(tx.amount) || 0;
      const net = tx.type === '支出' ? amt : -amt;
      let key = '';
      if (chartDim === 'category') {
        key = tx.category || (tx.member === 'dengbao' ? '孩子用品' : tx.purpose || '其他');
      } else if (chartDim === 'purpose') {
        key = tx.member === 'dengbao' ? '👶 噔宝支出' : tx.purpose || '其他';
      } else {
        key = tx.member === 'dengbao' ? `👶 噔宝(${tx.payer}付)` : tx.member === 'c' ? '👦 c（你）' : '👧 q（她）';
      }
      groupMap[key] = (groupMap[key] || 0) + net;
    });

    const entries = Object.entries(groupMap)
      .filter(([, val]) => val > 0)
      .sort((a, b) => b[1] - a[1]);

    const totalNet = entries.reduce((acc, [, v]) => acc + v, 0);

    // 若超过 6 项，前 5 项保留，其余合并为“其他汇总”
    let displayEntries = entries;
    if (entries.length > 6) {
      const top5 = entries.slice(0, 5);
      const otherSum = entries.slice(5).reduce((acc, [, v]) => acc + v, 0);
      displayEntries = [...top5, ['其他类目合计', otherSum]];
    }

    const r = 46;
    const circumference = 2 * Math.PI * r;
    let accumRatio = 0;

    const circlesSvg =
      totalNet > 0
        ? displayEntries
            .map(([name, val], idx) => {
              const ratio = val / totalNet;
              const dash = ratio * circumference;
              const gap = circumference - dash;
              const offset = -accumRatio * circumference;
              accumRatio += ratio;
              const color = palette[idx % palette.length];
              return `<circle cx="63" cy="63" r="${r}" fill="transparent" stroke="${color}" stroke-width="18" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 63 63)" />`;
            })
            .join('')
        : `<circle cx="63" cy="63" r="${r}" fill="transparent" stroke="#e2e8f0" stroke-width="18" />`;

    const legendHtml =
      totalNet > 0
        ? displayEntries
            .map(([name, val], idx) => {
              const pct = ((val / totalNet) * 100).toFixed(1);
              const color = palette[idx % palette.length];
              const isSelected = state.ledgerFilter.selectedChartItem === name;
              return `
                <div class="legend-row ${isSelected ? 'active' : ''}" data-chart-item="${name}" title="点击筛选该项明细">
                  <div class="legend-top">
                    <span class="legend-name">
                      <span class="legend-dot" style="background:${color}"></span>
                      <span>${name} ${isSelected ? '✓' : ''}</span>
                    </span>
                    <span class="legend-val">¥${fm(val, false)} (${pct}%)</span>
                  </div>
                  <div class="legend-bar-bg">
                    <div class="legend-bar-fill" style="width:${pct}%;background:${color}"></div>
                  </div>
                </div>
              `;
            })
            .join('')
        : `<div style="color:#94a3b8;font-size:12px;text-align:center;padding:20px 0;">当前筛选条件下暂无净支出记录</div>`;

    return `
      <div class="chart-box">
        <div class="chart-header">
          <div class="chart-title">🍩 净支出构成比例</div>
          <div class="chart-dim-tabs">
            <button type="button" class="chart-dim-btn ${chartDim === 'category' ? 'active' : ''}" data-cdim="category">按分类</button>
            <button type="button" class="chart-dim-btn ${chartDim === 'purpose' ? 'active' : ''}" data-cdim="purpose">按用途</button>
            <button type="button" class="chart-dim-btn ${chartDim === 'member' ? 'active' : ''}" data-cdim="member">按成员</button>
          </div>
        </div>
        <div class="chart-body">
          <div class="donut-wrap">
            <svg width="126" height="126" viewBox="0 0 126 126">
              ${circlesSvg}
            </svg>
            <div class="donut-center">
              <span class="donut-center-label">筛选净支出</span>
              <span class="donut-center-val">¥${fm(totalNet, false)}</span>
            </div>
          </div>
          <div class="chart-legend">
            ${legendHtml}
          </div>
        </div>
      </div>
    `;
  }

  function renderLedger(report) {
    const lf = state.ledgerFilter;
    const allList = [
      ...report.transactions.c,
      ...report.transactions.q,
      ...report.transactions.dengbao
    ];

    const baseFiltered = allList
      .filter((tx) => {
        if (lf.onlyCurrentPeriod && tx.periodKey !== state.activePeriod) return false;
        if (lf.role !== 'all' && tx.member !== lf.role) return false;
        if (lf.purpose !== 'all') {
          if (lf.purpose === '孩子') {
            if (tx.member !== 'dengbao') return false;
          } else if (tx.purpose !== lf.purpose) {
            return false;
          }
        }
        if (lf.searchKeyword && lf.searchKeyword.trim()) {
          const kw = lf.searchKeyword.trim().toLowerCase();
          const hay = `${tx.category || ''} ${tx.purpose || ''} ${tx.note || ''} ${tx.amount || ''} ${tx.date || ''}`.toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const chartHtml = buildExpenseChartHtml(baseFiltered, lf.chartDim || 'category');

    // 如果点击了图表中的某一项，下方列表进一步过滤
    const filtered = lf.selectedChartItem
      ? baseFiltered.filter((tx) => {
          const dim = lf.chartDim || 'category';
          let key = '';
          if (dim === 'category') key = tx.category || (tx.member === 'dengbao' ? '孩子用品' : tx.purpose || '其他');
          else if (dim === 'purpose') key = tx.member === 'dengbao' ? '👶 噔宝支出' : tx.purpose || '其他';
          else key = tx.member === 'dengbao' ? `👶 噔宝(${tx.payer}付)` : tx.member === 'c' ? '👦 c（你）' : '👧 q（她）';
          return key === lf.selectedChartItem;
        })
      : baseFiltered;

    return `
      <section class="card">
        <div class="card-header">
          <div>
            <div class="card-title">📊 账单流水明细 (${filtered.length}笔)</div>
            <div class="card-subtitle">点击图表分类可联动过滤，点击记录可编辑</div>
          </div>
          <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="checkbox" id="toggleOnlyPeriod" ${lf.onlyCurrentPeriod ? 'checked' : ''} />
            仅看当前账期
          </label>
        </div>

        <div class="search-bar-wrap">
          <span class="search-icon">🔍</span>
          <input type="text" class="search-input" id="ledgerSearchInput" placeholder="搜索分类、备注、金额或日期..." value="${lf.searchKeyword || ''}" />
        </div>

        <div class="segmented">
          <button class="seg-btn ${lf.role === 'all' ? 'active' : ''}" data-lrole="all">全部</button>
          <button class="seg-btn ${lf.role === 'c' ? 'active' : ''}" data-lrole="c">c (${report.transactions.c.length})</button>
          <button class="seg-btn ${lf.role === 'q' ? 'active' : ''}" data-lrole="q">q (${report.transactions.q.length})</button>
          <button class="seg-btn ${lf.role === 'dengbao' ? 'active' : ''}" data-lrole="dengbao">噔宝 (${report.transactions.dengbao.length})</button>
        </div>

        <div class="chip-grid" style="margin-bottom:14px;">
          ${['all', '日常', '必要开支', '许愿池', '工资', '孩子', '金蛋']
            .map(
              (p) => `
            <button class="chip ${lf.purpose === p ? 'active' : ''}" data-lpurpose="${p}">
              ${p === 'all' ? '全部用途' : p}
            </button>
          `
            )
            .join('')}
        </div>

        ${chartHtml}

        <div>
          ${
            filtered.length === 0
              ? `<div style="text-align:center;padding:30px 10px;color:#94a3b8;font-size:13px;">暂无符合筛选条件的流水记录</div>`
              : filtered
                  .map((tx) => {
                    const isDb = tx.member === 'dengbao';
                    const roleLabel = isDb ? `👶 噔宝 (${tx.payer}付)` : tx.member === 'c' ? '👦 c' : '👧 q';
                    const amtClass =
                      tx.type === '收入'
                        ? 'income'
                        : tx.type === '退款'
                        ? 'refund'
                        : tx.type === '存入' || tx.type === '取出'
                        ? 'savings'
                        : 'expense';
                    const sign = tx.type === '收入' || tx.type === '退款' ? '+' : tx.type === '支出' ? '-' : '';
                    return `
                    <div class="tx-item">
                      <div class="tx-left">
                        <div class="tx-avatar ${tx.member}">${isDb ? '宝' : tx.member.toUpperCase()}</div>
                        <div>
                          <div class="tx-info-title">
                            <span>${tx.category || tx.purpose || '未分类'}</span>
                            <span class="badge ${isDb ? 'badge-db' : tx.member === 'c' ? 'badge-c' : 'badge-q'}">${roleLabel}</span>
                            <span class="badge badge-info">${tx.type}${tx.purpose ? '·' + tx.purpose : ''}</span>
                          </div>
                          <div class="tx-info-sub">
                            ${tx.date} ${tx.note ? ' · ' + tx.note : ''}
                            ${tx.checkMsg ? `<span style="color:#ef4444;font-weight:600;"> ⚠️ ${tx.checkMsg}</span>` : ''}
                          </div>
                        </div>
                      </div>
                      <div class="tx-right">
                        <div class="tx-amount ${amtClass}">${sign}¥${fm(tx.amount, false)}</div>
                        ${
                          tx.afterQuota !== null && tx.afterQuota !== undefined
                            ? `<div class="tx-quota-note">余下额度 ¥${fm(tx.afterQuota, false)}</div>`
                            : ''
                        }
                        <div style="margin-top:4px;display:flex;gap:6px;justify-content:flex-end;">
                          <button class="btn-secondary" style="padding:2px 7px;font-size:11px;" data-edit-id="${tx.id}" data-edit-role="${tx.member}">编辑</button>
                          <button class="btn-danger-sm" data-del-id="${tx.id}" data-del-role="${tx.member}">删除</button>
                        </div>
                      </div>
                    </div>
                  `;
                  })
                  .join('')
          }
        </div>
      </section>
    `;
  }

  // ==================== 4. 噔宝专区 (Dengbao Special) ====================
  function renderDengbao(report) {
    const db = report.dengbaoReport;
    const cur = db.current;

    return `
      <section class="pocket-hero" style="background:linear-gradient(135deg, #b45309 0%, #d97706 100%);">
        <div class="pocket-hero-top">
          <div>
            <div class="pocket-total-label" style="color:#fef3c7;">👶 噔宝当期可用结余 (${cur.range.startDate} ~ ${cur.range.endDate})</div>
            <div class="pocket-total-val" style="color:#fff;">¥ ${fm(cur.balance, false)}</div>
          </div>
          <button class="btn-secondary" style="background:rgba(255,255,255,0.2);color:#fff;border:none;" data-action="quickAddDengbao">
            + 记噔宝支出
          </button>
        </div>
        <div class="pocket-person-grid">
          <div class="pocket-person-box">
            <div class="pocket-person-header" style="color:#fef3c7;">
              <span>本月总额度</span>
              <span class="badge badge-ok">${cur.status}</span>
            </div>
            <div class="pocket-person-val">¥ ${fm(cur.quota, false)}</div>
            <div class="pocket-person-meta" style="color:#fde68a;">
              基础预留 ¥${fm(cur.baseQuota, false)} (c:${cur.baseQuota / 2} + q:${cur.baseQuota / 2})
              ${cur.extraQuota ? `<br/>本期额外追加: +¥${fm(cur.extraQuota, false)}` : ''}
            </div>
          </div>
          <div class="pocket-person-box">
            <div class="pocket-person-header" style="color:#fef3c7;">
              <span>本月已净消费 (${cur.txCount}笔)</span>
            </div>
            <div class="pocket-person-val">¥ ${fm(cur.spent, false)}</div>
            <div class="pocket-person-meta" style="color:#fde68a;">
              👦 c 付款: ¥${fm(cur.cPaid, false)}<br/>
              👧 q 付款: ¥${fm(cur.qPaid, false)}
            </div>
          </div>
        </div>
      </section>

      <div class="alert-banner info">
        📌 <strong>规则说明：</strong>噔宝消费只在此专表记录一次，系统会自动按付款人（c 或 q）并入各自的年度「必要开支」消费进度，不再重复扣减每月的 daily 零花钱。
      </div>

      <!-- 噔宝逐月结余表 -->
      <section class="card">
        <div class="card-header">
          <div class="card-title">📅 噔宝预算来源与逐月结余</div>
          <button class="btn-secondary" data-action="setDengbaoExtra">调整当期额外额度</button>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>账期起始</th>
              <th>月度额度</th>
              <th>当月净消费</th>
              <th>当月结余</th>
            </tr>
          </thead>
          <tbody>
            ${db.monthlySeries
              .filter((s) => s.txCount > 0 || s.periodKey === state.activePeriod || s.periodKey <= '2027-01')
              .map(
                (s) => `
              <tr class="${s.periodKey === state.activePeriod ? 'row-highlight' : ''}">
                <td>${s.range.startDate}</td>
                <td>${fm(s.quota, false)}</td>
                <td>${s.txCount > 0 || s.periodKey === state.activePeriod ? fm(s.spent, false) : '--'}</td>
                <td><strong>${s.txCount > 0 || s.periodKey === state.activePeriod ? fm(s.balance, false) : '--'}</strong></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </section>
    `;
  }

  // ==================== 5. 预算与双人同步 (Budgets & Cloud Sync) ====================
  function renderBudget(report) {
    const sub = state.budgetSubTab;
    const role = state.budgetRole;
    const bRole = report.budgets[role];
    const track = report.annualTracking;

    let contentHtml = '';

    if (sub === 'necessary') {
      contentHtml = `
        <div class="segmented">
          <button class="seg-btn ${role === 'c' ? 'active' : ''}" data-brole="c">👦 c 必要开支 (月均 ¥${fm(report.budgets.c.necessaryMonthly)})</button>
          <button class="seg-btn ${role === 'q' ? 'active' : ''}" data-brole="q">👧 q 必要开支 (月均 ¥${fm(report.budgets.q.necessaryMonthly)})</button>
        </div>
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">${role.toUpperCase()} · 年度必要开支清单</div>
              <div class="card-subtitle">正数合计年度额度: ¥${fm(bRole.necessaryAnnualQuota, false)} · 负数收租抵减月均预留</div>
            </div>
            <button class="btn-secondary" data-action="addNecessaryItem">+ 新增项目</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>项目名称</th>
                <th>年度预算(元)</th>
                <th>月均预留</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${bRole.necessaryItems
                .map(
                  (it) => `
                <tr>
                  <td>
                    <strong>${it.name}</strong>
                    ${it.tip ? `<div style="font-size:10px;color:#f59e0b;">${it.tip}</div>` : ''}
                  </td>
                  <td>${it.annualBudget !== null ? fm(it.annualBudget, false) : '<span style="color:#94a3b8;">未设</span>'}</td>
                  <td>${it.monthly !== null ? fm(it.monthly) : '--'}</td>
                  <td>
                    <button class="btn-secondary" style="padding:3px 7px;font-size:11px;" data-edit-nec="${it.id}">改额</button>
                    <button class="btn-danger-sm" data-del-nec="${it.id}">删</button>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (sub === 'wish') {
      contentHtml = `
        <div class="segmented">
          <button class="seg-btn ${role === 'c' ? 'active' : ''}" data-brole="c">👦 c 许愿池 (月均 ¥${fm(report.budgets.c.wishMonthly)})</button>
          <button class="seg-btn ${role === 'q' ? 'active' : ''}" data-brole="q">👧 q 许愿池 (月均 ¥${fm(report.budgets.q.wishMonthly)})</button>
        </div>
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">${role.toUpperCase()} · 许愿池心愿单</div>
              <div class="card-subtitle">年度总额度: ¥${fm(bRole.wishAnnualQuota, false)} · 分摊月数仅影响每月预留</div>
            </div>
            <button class="btn-secondary" data-action="addWishItem">+ 新增愿望</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>愿望名称</th>
                <th>年度额度</th>
                <th>分摊月数</th>
                <th>月均预留</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${bRole.wishItems
                .map(
                  (it) => `
                <tr>
                  <td>
                    <strong>${it.name}</strong>
                    ${it.tip ? `<div style="font-size:10px;color:#f59e0b;">${it.tip}</div>` : ''}
                  </td>
                  <td>${it.annualQuota !== null ? fm(it.annualQuota, false) : '<span style="color:#94a3b8;">未设</span>'}</td>
                  <td>${it.months}个月</td>
                  <td>${it.monthly !== null ? fm(it.monthly) : '--'}</td>
                  <td>
                    <button class="btn-secondary" style="padding:3px 7px;font-size:11px;" data-edit-wish="${it.id}">改额</button>
                    <button class="btn-danger-sm" data-del-wish="${it.id}">删</button>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (sub === 'yearend') {
      contentHtml = `
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">🏦 年度结余与可转存核算 (${track.budgetYear}年)</div>
              <div class="card-subtitle">两类结余相抵；一类超支会减少另一类可留存额</div>
            </div>
            <button class="btn-secondary" data-action="editYearEndConfig">补录前期/实有资金</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>核算指标</th>
                <th>c（你）</th>
                <th>q（她）</th>
                <th>家庭合计</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>必要前期未录消费</td>
                <td>${track.c.hasPriorNec ? fm(track.c.priorNec, false) : '待填'}</td>
                <td>${track.q.hasPriorNec ? fm(track.q.priorNec, false) : '待填'}</td>
                <td>${track.c.hasPriorNec && track.q.hasPriorNec ? fm(track.c.priorNec + track.q.priorNec, false) : '--'}</td>
              </tr>
              <tr>
                <td>许愿池前期消费</td>
                <td>${track.c.hasPriorWish ? fm(track.c.priorWish, false) : '待填'}</td>
                <td>${track.q.hasPriorWish ? fm(track.q.priorWish, false) : '待填'}</td>
                <td>${track.c.hasPriorWish && track.q.hasPriorWish ? fm(track.c.priorWish + track.q.priorWish, false) : '--'}</td>
              </tr>
              <tr>
                <td>必要预算全年结余</td>
                <td>${fm(track.c.fullYearNecSurplus, false)}</td>
                <td>${fm(track.q.fullYearNecSurplus, false)}</td>
                <td>${fm(track.family.fullYearNecSurplus, false)}</td>
              </tr>
              <tr>
                <td>许愿池预算全年结余</td>
                <td>${fm(track.c.fullYearWishSurplus, false)}</td>
                <td>${fm(track.q.fullYearWishSurplus, false)}</td>
                <td>${fm(track.family.fullYearWishSurplus, false)}</td>
              </tr>
              <tr class="row-highlight">
                <td>💰 两类结余合计</td>
                <td>${fm(track.c.combinedSurplus, false)}</td>
                <td>${fm(track.q.combinedSurplus, false)}</td>
                <td>${fm(track.family.combinedSurplus, false)}</td>
              </tr>
              <tr>
                <td>预计可留存上限</td>
                <td>${fm(track.c.maxRetainable)}</td>
                <td>${fm(track.q.maxRetainable)}</td>
                <td>${track.c.maxRetainable !== null && track.q.maxRetainable !== null ? fm(Math.max(0, track.family.combinedSurplus)) : '--'}</td>
              </tr>
              <tr>
                <td>年末实有资金</td>
                <td>${fm(track.c.actualFunds)}</td>
                <td>${fm(track.q.actualFunds)}</td>
                <td>${track.c.actualFunds !== null && track.q.actualFunds !== null ? fm(track.c.actualFunds + track.q.actualFunds) : '--'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
    } else if (sub === 'sync') {
      const cfg = state.cloudCfg;
      contentHtml = `
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">☁️ 免费双人实时同步设置</div>
              <div class="card-subtitle">支持 GitHub / Gitee 云端同步 & 家里 Wi-Fi 直连</div>
            </div>
          </div>

          <div class="alert-banner ${state.syncOnline ? 'ok' : 'info'}">
            <strong>当前状态：${state.syncModeLabel}</strong> —
            ${
              state.syncOnline
                ? '✅ 已接通实时同步，你和老婆在各自手机上的记账会自动双向合并。'
                : 'ℹ️ 当前保存在手机本地缓存。配置下方任一方式即可开启双人实时同步。'
            }
          </div>

          <div class="form-group">
            <label class="form-label">1. 家庭共享房间口令 (Family Code)</label>
            <div style="display:flex;gap:8px;">
              <input type="text" class="form-input" id="familyCodeInput" value="${state.data.familyCode || 'cq2026'}" />
              <button class="btn-secondary" style="white-space:nowrap;" data-action="saveFamilyCode">保存口令</button>
            </div>
          </div>

          <hr style="border:none;border-top:1px dashed #e2e8f0;margin:14px 0;" />

          <div class="form-group">
            <label class="form-label">2. 选择免费同步引擎（推荐 GitHub 或 Gitee 私人 Gist）</label>
            <div class="segmented">
              <button type="button" class="seg-btn ${cfg.provider === 'auto' ? 'active' : ''}" data-cprov="auto">🏠 家里Wi-Fi</button>
              <button type="button" class="seg-btn ${cfg.provider === 'github' ? 'active' : ''}" data-cprov="github">🐙 GitHub 云</button>
              <button type="button" class="seg-btn ${cfg.provider === 'gitee' ? 'active' : ''}" data-cprov="gitee">🇨🇳 Gitee 云</button>
            </div>
          </div>

          ${
            cfg.provider === 'github' || cfg.provider === 'gitee'
              ? `
            <div class="form-group">
              <label class="form-label">${cfg.provider === 'github' ? 'GitHub Personal Access Token (需勾选 gist 权限)' : 'Gitee 私人令牌 (需勾选 gists 权限)'}</label>
              <input type="password" class="form-input" id="cloudTokenInput" placeholder="粘贴你的 ${cfg.provider.toUpperCase()} Token..." value="${cfg.token || ''}" />
            </div>
            <div class="form-group">
              <label class="form-label">云端账本 Gist ID（首次留空，点保存会自动创建并生成 ID）</label>
              <input type="text" class="form-input" id="cloudGistIdInput" placeholder="首次留空自动生成，老婆手机填同一个ID" value="${cfg.gistId || ''}" />
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
              <button type="button" class="btn-primary" data-action="saveCloudCfg">☁️ 保存并立即同步云端</button>
              <button type="button" class="btn-secondary" data-action="copyWifeShareLink">🔗 复制给老婆的一键绑定链接</button>
            </div>
          `
              : `
            <div class="alert-banner info">
              📱 <strong>家里同一 Wi-Fi 手机直接使用：</strong><br/>
              你和老婆手机连家里 Wi-Fi 后，直接在手机浏览器/微信打开：<br/>
              <strong style="user-select:all;font-size:13px;">http://192.168.0.121:8080/web/index.html</strong><br/>
              无需任何配置，两人打开即是同一本账！
            </div>
          `
          }

          <hr style="border:none;border-top:1px dashed #e2e8f0;margin:14px 0;" />

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
            <button class="btn-secondary" data-action="exportCsv">📊 导出 Excel 表格 (.csv)</button>
            <button class="btn-secondary" data-action="exportJson">📤 导出 JSON 完整备份</button>
          </div>
          <div style="margin-top:10px;">
            <button class="btn-secondary" style="width:100%;" data-action="importJson">📥 导入 JSON 账本恢复</button>
          </div>
          <div style="margin-top:12px;">
            <button class="btn-danger-sm" style="width:100%;padding:10px;font-weight:600;" data-action="resetInitial">
              🔄 重置为原 Excel 初始数据 (2026-2027年度家庭共同记账.xlsx)
            </button>
          </div>
        </div>
      `;
    }

    return `
      <div class="segmented">
        <button class="seg-btn ${sub === 'necessary' ? 'active' : ''}" data-bsub="necessary">必要开支</button>
        <button class="seg-btn ${sub === 'wish' ? 'active' : ''}" data-bsub="wish">许愿池</button>
        <button class="seg-btn ${sub === 'yearend' ? 'active' : ''}" data-bsub="yearend">年末转存</button>
        <button class="seg-btn ${sub === 'sync' ? 'active' : ''}" data-bsub="sync">双人同步</button>
      </div>
      ${contentHtml}
    `;
  }

  // ==================== 主渲染与事件绑定 ====================
  function render() {
    const report = Engine.computeFullReport(state.data, state.activePeriod);
    const main = document.getElementById('mainView');
    if (!main) return;

    if (state.currentTab === 'dashboard') main.innerHTML = renderDashboard(report);
    else if (state.currentTab === 'add') main.innerHTML = renderAdd(report);
    else if (state.currentTab === 'ledger') main.innerHTML = renderLedger(report);
    else if (state.currentTab === 'dengbao') main.innerHTML = renderDengbao(report);
    else if (state.currentTab === 'budget') main.innerHTML = renderBudget(report);

    bindViewEvents(report);
  }

  function bindViewEvents(report) {
    const main = document.getElementById('mainView');

    // 快捷跳转记一笔
    main.querySelectorAll('[data-action="quickAdd"]').forEach((btn) => {
      btn.onclick = () => {
        state.currentTab = 'add';
        state.addForm.role = localStorage.getItem(PREF_ROLE_KEY) || 'c';
        state.addForm.date = getTodayStr();
        updateTabBarUI();
        render();
      };
    });

    // 发薪后一键金蛋打卡存入
    main.querySelectorAll('[data-action="quickDepositGolden"]').forEach((btn) => {
      btn.onclick = () => {
        const m = btn.dataset.member;
        const mAlloc = report.currentAllocation[m];
        const stillNeed = mAlloc && mAlloc.goldenEggStillNeed ? Engine.round2(mAlloc.goldenEggStillNeed) : 0;
        const defaultAmt = stillNeed > 0 ? stillNeed : 2000;
        const val = prompt(
          `⚡ 一键记入【${m.toUpperCase()} 本期金蛋存入】\n本期应存合计: ¥${fm(mAlloc.goldenEggTotal)}\n当前还需存入: ¥${fm(stillNeed)}\n请输入本次实际存入金额（元）：`,
          defaultAmt
        );
        if (val === null || val.trim() === '') return;
        const num = evalMathAmount(val);
        if (isNaN(num) || num <= 0) {
          alert('请输入有效的正数金额');
          return;
        }
        state.data.transactions[m].push({
          id: 'tx_' + Date.now(),
          date: report.periodRange.startDate,
          amount: num,
          type: '存入',
          purpose: '金蛋',
          category: '预算结余转存',
          note: `${state.activePeriod}账期金蛋存入打卡`
        });
        saveData();
        render();
        showToast(`🥚 已记入 ${m.toUpperCase()} 金蛋存入 ¥${fm(num, false)}`);
      };
    });

    main.querySelectorAll('[data-action="quickAddDengbao"]').forEach((btn) => {
      btn.onclick = () => {
        state.currentTab = 'add';
        state.addForm.role = 'dengbao';
        state.addForm.type = '支出';
        state.addForm.category = '孩子用品';
        updateTabBarUI();
        render();
      };
    });

    // 期初校正与固定金蛋弹窗设置
    main.querySelectorAll('[data-action="openPeriodOverride"]').forEach((btn) => {
      btn.onclick = () => {
        const pKey = state.activePeriod;
        const ov = (state.data.settings.periodOverrides[pKey] = state.data.settings.periodOverrides[pKey] || {
          c: { initAdjust: null, fixedGoldenEgg: 2000 },
          q: { initAdjust: null, fixedGoldenEgg: 2000 }
        });
        const cFg = prompt(`设置【${pKey}账期】c 的固定金蛋金额（元）：`, ov.c?.fixedGoldenEgg ?? 2000);
        if (cFg === null) return;
        const qFg = prompt(`设置【${pKey}账期】q 的固定金蛋金额（元）：`, ov.q?.fixedGoldenEgg ?? 2000);
        if (qFg === null) return;
        const cAdj = prompt(`设置【${pKey}账期】c 的期初零花钱校正（留空则自动滚存上期结余）：`, ov.c?.initAdjust ?? '');
        const qAdj = prompt(`设置【${pKey}账期】q 的期初零花钱校正（留空则自动滚存上期结余）：`, ov.q?.initAdjust ?? '');

        ov.c = {
          fixedGoldenEgg: Number(cFg) || 0,
          initAdjust: cAdj === '' || cAdj === null ? null : Number(cAdj)
        };
        ov.q = {
          fixedGoldenEgg: Number(qFg) || 0,
          initAdjust: qAdj === '' || qAdj === null ? null : Number(qAdj)
        };
        saveData();
        render();
        showToast('已更新当期分配参数');
      };
    });

    // 记一笔表单事件
    main.querySelectorAll('[data-role]').forEach((btn) => {
      btn.onclick = () => {
        state.addForm.role = btn.dataset.role;
        localStorage.setItem(PREF_ROLE_KEY, state.addForm.role);
        if (state.addForm.role === 'dengbao') {
          state.addForm.category = '孩子用品';
        } else if (state.addForm.category === '孩子用品') {
          state.addForm.category = '餐饮外卖';
        }
        render();
      };
    });

    main.querySelectorAll('[data-qdate]').forEach((btn) => {
      btn.onclick = () => {
        const offset = parseInt(btn.dataset.qdate, 10) || 0;
        state.addForm.date = getRelativeDateStr(offset);
        render();
      };
    });

    main.querySelectorAll('[data-type]').forEach((btn) => {
      btn.onclick = () => {
        state.addForm.type = btn.dataset.type;
        const validPurposes = getPurposeOptionsByType(state.addForm.type);
        if (!validPurposes.includes(state.addForm.purpose)) {
          state.addForm.purpose = validPurposes[0];
        }
        render();
      };
    });

    main.querySelectorAll('[data-purpose]').forEach((btn) => {
      btn.onclick = () => {
        state.addForm.purpose = btn.dataset.purpose;
        render();
      };
    });

    main.querySelectorAll('[data-payer]').forEach((btn) => {
      btn.onclick = () => {
        state.addForm.payer = btn.dataset.payer;
        render();
      };
    });

    main.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.onclick = () => {
        const cat = btn.dataset.cat;
        if (state.addForm.role !== 'dengbao' && (cat === '孩子用品' || cat === '噔宝')) {
          if (confirm('Excel 规则提醒：「孩子用品/噔宝」消费需在【噔宝支出】专表记录，是否自动切换为噔宝支出？')) {
            state.addForm.payer = state.addForm.role;
            state.addForm.role = 'dengbao';
            state.addForm.category = '孩子用品';
            render();
            return;
          }
        }
        state.addForm.category = cat;
        render();
      };
    });

    const dateInp = document.getElementById('txDateInput');
    if (dateInp) {
      dateInp.onchange = (e) => {
        state.addForm.date = e.target.value;
      };
    }

    const amtInp = document.getElementById('txAmountInput');
    if (amtInp) {
      amtInp.oninput = (e) => {
        state.addForm.amount = e.target.value;
        const previewEl = document.getElementById('calcPreviewSpan');
        if (previewEl) {
          const calc = evalMathAmount(state.addForm.amount);
          previewEl.textContent =
            /[+\-]/.test(String(state.addForm.amount)) && !isNaN(calc) ? '= ¥' + fm(calc, false) : '';
        }
      };
    }

    main.querySelectorAll('[data-calcop]').forEach((btn) => {
      btn.onclick = () => {
        const op = btn.dataset.calcop;
        const cur = String(state.addForm.amount || '').trim();
        if (op === 'C') {
          state.addForm.amount = '';
        } else if (op === '=') {
          const calc = evalMathAmount(cur);
          if (!isNaN(calc) && calc >= 0) {
            state.addForm.amount = String(calc);
          }
        } else if (op === '+' || op === '-') {
          if (!cur) return;
          if (/[+\-]$/.test(cur)) {
            state.addForm.amount = cur.slice(0, -1) + op;
          } else {
            state.addForm.amount = cur + op;
          }
        }
        render();
        const newInp = document.getElementById('txAmountInput');
        if (newInp) {
          newInp.focus();
          try {
            newInp.setSelectionRange(newInp.value.length, newInp.value.length);
          } catch (e) {}
        }
      };
    });

    const noteInp = document.getElementById('txNoteInput');
    if (noteInp) {
      noteInp.oninput = (e) => {
        state.addForm.note = e.target.value;
      };
    }

    main.querySelectorAll('[data-action="addNewCategory"]').forEach((btn) => {
      btn.onclick = () => {
        const name = prompt('请输入新分类名称：');
        if (!name || !name.trim()) return;
        const clean = name.trim();
        const targetArr = state.addForm.role === 'dengbao' ? state.data.dengbaoCategories : state.data.categories;
        if (!targetArr.includes(clean)) {
          targetArr.push(clean);
        }
        state.addForm.category = clean;
        saveData();
        render();
      };
    });

    main.querySelectorAll('[data-action="cancelEdit"]').forEach((btn) => {
      btn.onclick = () => {
        state.addForm.editingId = null;
        state.addForm.editingRole = null;
        state.addForm.amount = '';
        state.addForm.note = '';
        render();
      };
    });

    const submitBtn = document.getElementById('submitTxBtn');
    if (submitBtn) {
      submitBtn.onclick = () => {
        const f = state.addForm;
        const numAmt = evalMathAmount(f.amount);
        if (!f.date || f.amount === '' || isNaN(numAmt) || numAmt < 0) {
          alert('请填写有效的日期与金额！');
          return;
        }

        // 若是编辑模式且切换了账本角色，先从原列表移除
        if (f.editingId && f.editingRole) {
          state.data.transactions[f.editingRole] = (state.data.transactions[f.editingRole] || []).filter(
            (t) => t.id !== f.editingId
          );
        }

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
            alert(err);
            return;
          }
          state.data.transactions.dengbao.push(item);
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
            alert(err);
            return;
          }
          state.data.transactions[f.role].push(item);
        }

        // 自动切换到对应日期所属账期
        const pInfo = Engine.getPeriodFromDate(f.date);
        state.activePeriod = pInfo.periodKey;
        const sel = document.getElementById('periodSelect');
        if (sel) sel.value = state.activePeriod;

        state.addForm.amount = '';
        state.addForm.note = '';
        state.addForm.editingId = null;
        state.addForm.editingRole = null;

        saveData();
        showToast('✅ 已记入账本，所有汇总已实时更新');
        state.currentTab = 'dashboard';
        updateTabBarUI();
        render();
      };
    }

    // 流水明细筛选与操作
    const toggleOnlyPeriod = document.getElementById('toggleOnlyPeriod');
    if (toggleOnlyPeriod) {
      toggleOnlyPeriod.onchange = (e) => {
        state.ledgerFilter.onlyCurrentPeriod = e.target.checked;
        render();
      };
    }

    main.querySelectorAll('[data-lrole]').forEach((btn) => {
      btn.onclick = () => {
        state.ledgerFilter.role = btn.dataset.lrole;
        render();
      };
    });

    main.querySelectorAll('[data-lpurpose]').forEach((btn) => {
      btn.onclick = () => {
        state.ledgerFilter.purpose = btn.dataset.lpurpose;
        render();
      };
    });

    main.querySelectorAll('[data-cdim]').forEach((btn) => {
      btn.onclick = () => {
        state.ledgerFilter.chartDim = btn.dataset.cdim;
        state.ledgerFilter.selectedChartItem = '';
        render();
      };
    });

    main.querySelectorAll('[data-chart-item]').forEach((row) => {
      row.onclick = () => {
        const item = row.dataset.chartItem;
        if (state.ledgerFilter.selectedChartItem === item) {
          state.ledgerFilter.selectedChartItem = '';
        } else {
          state.ledgerFilter.selectedChartItem = item;
        }
        render();
      };
    });

    const searchInp = document.getElementById('ledgerSearchInput');
    if (searchInp) {
      searchInp.oninput = (e) => {
        state.ledgerFilter.searchKeyword = e.target.value;
        render();
        const newInp = document.getElementById('ledgerSearchInput');
        if (newInp) {
          newInp.focus();
          newInp.setSelectionRange(newInp.value.length, newInp.value.length);
        }
      };
    }

    main.querySelectorAll('[data-del-id]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.delId;
        const role = btn.dataset.delRole;
        if (!confirm('确定要删除这笔流水记录吗？')) return;
        state.data.deletedTxIds = state.data.deletedTxIds || [];
        if (!state.data.deletedTxIds.includes(id)) {
          state.data.deletedTxIds.push(id);
        }
        state.data.transactions[role] = (state.data.transactions[role] || []).filter((t) => t.id !== id);
        saveData();
        showToast('已删除流水');
        render();
      };
    });

    main.querySelectorAll('[data-edit-id]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.editId;
        const role = btn.dataset.editRole;
        const target = (state.data.transactions[role] || []).find((t) => t.id === id);
        if (!target) return;
        state.addForm = {
          role,
          date: target.date,
          amount: target.amount,
          type: target.type,
          purpose: target.purpose || '日常',
          payer: target.payer || 'q',
          category: target.category || '',
          note: target.note || '',
          editingId: target.id,
          editingRole: role
        };
        state.currentTab = 'add';
        updateTabBarUI();
        render();
      };
    });

    // 噔宝额外额度调整
    main.querySelectorAll('[data-action="setDengbaoExtra"]').forEach((btn) => {
      btn.onclick = () => {
        const pKey = state.activePeriod;
        const ov = (state.data.settings.periodOverrides[pKey] = state.data.settings.periodOverrides[pKey] || {});
        const val = prompt(`设置【${pKey}账期】噔宝额外追加额度（元，例如首期为 3200）：`, ov.dengbaoExtraQuota || 0);
        if (val === null) return;
        ov.dengbaoExtraQuota = Number(val) || 0;
        saveData();
        render();
        showToast('已更新噔宝当期额度');
      };
    });

    // 预算与同步页事件
    main.querySelectorAll('[data-bsub]').forEach((btn) => {
      btn.onclick = () => {
        state.budgetSubTab = btn.dataset.bsub;
        render();
      };
    });

    main.querySelectorAll('[data-brole]').forEach((btn) => {
      btn.onclick = () => {
        state.budgetRole = btn.dataset.brole;
        render();
      };
    });

    main.querySelectorAll('[data-action="addNecessaryItem"]').forEach((btn) => {
      btn.onclick = () => {
        const name = prompt(`新增 ${state.budgetRole.toUpperCase()} 的必要开支项目名称：`);
        if (!name || !name.trim()) return;
        const amt = prompt('请输入该项目的年度预算金额（元，如车位收租抵减可填负数）：', '1200');
        state.data.necessaryBudgets[state.budgetRole].push({
          id: 'nec_' + Date.now(),
          name: name.trim(),
          annualBudget: amt === '' || amt === null ? null : Number(amt),
          oldSpent: null
        });
        saveData();
        render();
        showToast('已新增必要开支预算项');
      };
    });

    main.querySelectorAll('[data-edit-nec]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.editNec;
        const item = state.data.necessaryBudgets[state.budgetRole].find((x) => x.id === id);
        if (!item) return;
        const amt = prompt(`修改「${item.name}」的年度预算金额（元，留空表示暂不计入）：`, item.annualBudget ?? '');
        if (amt === null) return;
        item.annualBudget = amt.trim() === '' ? null : Number(amt);
        saveData();
        render();
        showToast('已更新年度预算');
      };
    });

    main.querySelectorAll('[data-del-nec]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.delNec;
        if (!confirm('确定删除该预算项目吗？')) return;
        state.data.necessaryBudgets[state.budgetRole] = state.data.necessaryBudgets[state.budgetRole].filter(
          (x) => x.id !== id
        );
        saveData();
        render();
      };
    });

    main.querySelectorAll('[data-action="addWishItem"]').forEach((btn) => {
      btn.onclick = () => {
        const name = prompt(`新增 ${state.budgetRole.toUpperCase()} 的许愿池愿望名称：`);
        if (!name || !name.trim()) return;
        const amt = prompt('请输入该愿望的年度目标金额（元）：', '3000');
        const months = prompt('请输入分摊月数（正整数，默认12）：', '12');
        state.data.wishBudgets[state.budgetRole].push({
          id: 'wish_' + Date.now(),
          name: name.trim(),
          annualQuota: amt === '' || amt === null ? null : Number(amt),
          months: Number(months) || 12,
          note: ''
        });
        saveData();
        render();
        showToast('已新增许愿池项目');
      };
    });

    main.querySelectorAll('[data-edit-wish]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.editWish;
        const item = state.data.wishBudgets[state.budgetRole].find((x) => x.id === id);
        if (!item) return;
        const amt = prompt(`修改愿望「${item.name}」的年度额度（元）：`, item.annualQuota ?? '');
        if (amt === null) return;
        const months = prompt(`修改「${item.name}」的分摊月数：`, item.months ?? 12);
        if (months === null) return;
        item.annualQuota = amt.trim() === '' ? null : Number(amt);
        item.months = Number(months) || 12;
        saveData();
        render();
        showToast('已更新愿望配置');
      };
    });

    main.querySelectorAll('[data-del-wish]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.delWish;
        if (!confirm('确定删除该许愿池项目吗？')) return;
        state.data.wishBudgets[state.budgetRole] = state.data.wishBudgets[state.budgetRole].filter((x) => x.id !== id);
        saveData();
        render();
      };
    });

    main.querySelectorAll('[data-action="editYearEndConfig"]').forEach((btn) => {
      btn.onclick = () => {
        const ye = state.data.settings.yearEnd;
        const cNec = prompt('c 必要开支前期未录流水净消费（全年已录全请填 0）：', ye.c.priorNecessary ?? 0);
        if (cNec === null) return;
        const cWish = prompt('c 许愿池前期未录流水净消费（全年已录全请填 0）：', ye.c.priorWish ?? 0);
        const qNec = prompt('q 必要开支前期未录流水净消费（全年已录全请填 0）：', ye.q.priorNecessary ?? 0);
        const qWish = prompt('q 许愿池前期未录流水净消费（全年已录全请填 0）：', ye.q.priorWish ?? 0);
        ye.c.priorNecessary = cNec === '' ? null : Number(cNec);
        ye.c.priorWish = cWish === '' ? null : Number(cWish);
        ye.q.priorNecessary = qNec === '' ? null : Number(qNec);
        ye.q.priorWish = qWish === '' ? null : Number(qWish);
        saveData();
        render();
        showToast('已更新前期消费与年末核算参数');
      };
    });

    main.querySelectorAll('[data-cprov]').forEach((btn) => {
      btn.onclick = () => {
        state.cloudCfg.provider = btn.dataset.cprov;
        saveCloudConfig();
        render();
      };
    });

    main.querySelectorAll('[data-action="saveCloudCfg"]').forEach((btn) => {
      btn.onclick = async () => {
        const tokenEl = document.getElementById('cloudTokenInput');
        const gistEl = document.getElementById('cloudGistIdInput');
        if (!tokenEl || !tokenEl.value.trim()) {
          alert('请先粘贴你的 Personal Access Token！');
          return;
        }
        state.cloudCfg.token = tokenEl.value.trim();
        state.cloudCfg.gistId = gistEl ? gistEl.value.trim() : '';
        saveCloudConfig();
        showToast('正在连接云端同步...');
        if (state.cloudCfg.gistId) {
          await pullFromServer();
        }
        await pushToServer();
        render();
        if (state.cloudCfg.gistId) {
          showToast(`✅ 云端同步成功！Gist ID: ${state.cloudCfg.gistId}`);
        } else {
          alert('连接失败，请检查 Token 是否有 gist 权限以及网络是否通畅。');
        }
      };
    });

    main.querySelectorAll('[data-action="copyWifeShareLink"]').forEach((btn) => {
      btn.onclick = () => {
        if (!state.cloudCfg.token || !state.cloudCfg.gistId) {
          alert('请先点击左侧「保存并立即同步云端」生成 Gist ID 后，再复制分享链接！');
          return;
        }
        const baseUrl = window.location.origin + window.location.pathname;
        const shareUrl = `${baseUrl}?provider=${encodeURIComponent(state.cloudCfg.provider)}&token=${encodeURIComponent(state.cloudCfg.token)}&gistId=${encodeURIComponent(state.cloudCfg.gistId)}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareUrl).then(() => {
            showToast('🔗 已复制专属绑定链接！直接微信发给老婆打开即可');
          });
        } else {
          prompt('请复制以下专属链接发给老婆（她点开即自动完成云同步配置）：', shareUrl);
        }
      };
    });

    main.querySelectorAll('[data-action="saveFamilyCode"]').forEach((btn) => {
      btn.onclick = async () => {
        const inp = document.getElementById('familyCodeInput');
        if (!inp || !inp.value.trim()) return;
        state.data.familyCode = inp.value.trim();
        saveData(false);
        await pullFromServer();
        await pushToServer();
        render();
        showToast(`已切换至家庭房间: ${state.data.familyCode}`);
      };
    });

    main.querySelectorAll('[data-action="exportCsv"]').forEach((btn) => {
      btn.onclick = () => {
        const rows = [['账本', '日期', '所属账期', '金额(元)', '收支类型', '用途/付款人', '分类标签', '备注说明']];
        const allTx = [
          ...report.transactions.c.map((t) => ['c记账', t.date, t.periodKey, t.amount, t.type, t.purpose, t.category || '', t.note || '']),
          ...report.transactions.q.map((t) => ['q记账', t.date, t.periodKey, t.amount, t.type, t.purpose, t.category || '', t.note || '']),
          ...report.transactions.dengbao.map((t) => ['噔宝支出', t.date, t.periodKey, t.amount, t.type, `${t.payer}付款`, t.category || '', t.note || ''])
        ];
        allTx.forEach((r) => rows.push(r));
        const csvContent =
          '\uFEFF' +
          rows
            .map((r) =>
              r
                .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
                .join(',')
            )
            .join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `2026-2027家庭共同记账流水_${state.activePeriod}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('📊 已导出 Excel (.csv) 表格文件');
      };
    });

    main.querySelectorAll('[data-action="exportJson"]').forEach((btn) => {
      btn.onclick = () => {
        const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `家庭共同记账_${state.data.familyCode}_${state.activePeriod}.json`;
        a.click();
        URL.revokeObjectURL(url);
      };
    });

    main.querySelectorAll('[data-action="importJson"]').forEach((btn) => {
      btn.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              const obj = JSON.parse(ev.target.result);
              if (obj && obj.transactions && obj.necessaryBudgets) {
                state.data = obj;
                saveData();
                render();
                showToast('✅ 账本导入成功');
              } else {
                alert('JSON 文件格式不正确');
              }
            } catch (err) {
              alert('解析 JSON 失败');
            }
          };
          reader.readAsText(file);
        };
        input.click();
      };
    });

    main.querySelectorAll('[data-action="resetInitial"]').forEach((btn) => {
      btn.onclick = () => {
        if (!confirm('确定要重置为 Excel 初始预置数据吗？当前新增的未备份修改将被覆盖。')) return;
        state.data = JSON.parse(JSON.stringify(Engine.INITIAL_DATA));
        saveData();
        render();
        showToast('已恢复为 Excel 初始账本数据');
      };
    });
  }

  // 底部导航切换
  document.querySelectorAll('.tab-item').forEach((btn) => {
    btn.onclick = () => {
      state.currentTab = btn.dataset.tab;
      updateTabBarUI();
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  });

  // 夫妻密码锁屏校验逻辑
  function initLockScreen() {
    const overlay = document.getElementById('lockOverlay');
    const pinInput = document.getElementById('unlockPinInput');
    const submitBtn = document.getElementById('unlockSubmitBtn');
    if (!overlay) return;

    if (!state.cloudCfg.unlocked) {
      overlay.classList.remove('hidden');
      setTimeout(() => pinInput && pinInput.focus(), 100);
    } else {
      overlay.classList.add('hidden');
      pullFromServer();
    }

    const doUnlock = () => {
      const val = pinInput ? pinInput.value : '';
      const res = tryUnlockVault(val);
      if (res) {
        state.cloudCfg = res;
        saveCloudConfig();
        overlay.classList.add('hidden');
        showToast('🔓 解锁成功！已连接夫妻云账本');
        pullFromServer(true);
      } else {
        alert('解锁密码不正确，请重新输入！');
        if (pinInput) {
          pinInput.value = '';
          pinInput.focus();
        }
      }
    };

    if (submitBtn) submitBtn.onclick = doUnlock;
    if (pinInput) {
      pinInput.onkeydown = (e) => {
        if (e.key === 'Enter') doUnlock();
      };
    }
  }

  // 初始化启动
  initPeriodSelect();
  updateSyncHeader();
  render();
  initLockScreen();
  setInterval(() => {
    if (state.cloudCfg.unlocked) pullFromServer();
  }, 8000);
})();
