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

  function getAutoPeriodKey() {
    return Engine.getPeriodFromDate(getTodayStr()).periodKey;
  }

  function addMonthsToDateStr(baseStr, addMonths) {
    const src = baseStr && /^\d{4}-\d{2}-\d{2}$/.test(baseStr) ? baseStr : getTodayStr();
    const [y0, m0, d0] = src.split('-').map((n) => parseInt(n, 10));
    const totalM = y0 * 12 + (m0 - 1) + addMonths;
    const ny = Math.floor(totalM / 12);
    const nm = (totalM % 12) + 1;
    const maxDay = new Date(ny, nm, 0).getDate();
    const nd = Math.min(d0, maxDay);
    return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
  }

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function createEmptyCardForm() {
    const today = getTodayStr();
    return {
      open: false,
      editingId: null,
      name: '',
      cardType: 'stored', // stored | times | period
      owner: 'family', // family | c | q | dengbao
      price: '',
      totalValue: '',
      remainingValue: '',
      openDate: today,
      expiryDate: addMonthsToDateStr(today, 12),
      note: '',
      recordedInLedger: false,
      syncToLedger: false,
      ledgerRole: savedPrefRole === 'q' ? 'q' : 'c',
      ledgerPurpose: '日常'
    };
  }

  const initialAutoPeriod = getAutoPeriodKey();

  // 应用状态
  const state = {
    data: loadLocalData(),
    cloudCfg: loadCloudConfig(),
    currentTab: 'dashboard', // dashboard | add | ledger | dengbao | cards | budget
    activePeriod: initialAutoPeriod,
    lastAutoPeriod: initialAutoPeriod,
    // 记一笔状态（自动记住本机默认角色 + 默认今天日期）
    addForm: {
      role: savedPrefRole, // c | q | dengbao
      date: getTodayStr(),
      amount: '',
      type: '支出',
      purpose: '日常',
      budgetItemId: '',
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
    // 会员储值卡状态
    cardForm: createEmptyCardForm(),
    cardFilter: {
      type: 'active', // active | stored | times | period | alert | inactive
      keyword: ''
    },
    expandedCardIds: {},
    // 预算/同步页子Tab
    budgetSubTab: 'necessary', // necessary | wish | yearend | sync
    budgetRole: 'c',
    syncOnline: false,
    syncModeLabel: '本地'
  };

  function normalizeLoadedData(d) {
    if (!d) return d;
    d.memberCards = Array.isArray(d.memberCards) ? d.memberCards : [];
    d.deletedCardIds = Array.isArray(d.deletedCardIds) ? d.deletedCardIds : [];
    d.settings = d.settings || {};
    const autoInfo = Engine.getCurrentPeriodInfo();
    if (!d.settings.currentPeriod || d.settings.currentPeriod < autoInfo.periodKey) {
      d.settings.currentPeriod = autoInfo.periodKey;
      d.settings.dengbaoPeriod = autoInfo.periodKey;
    }
    if (!d.settings.budgetYear || d.settings.budgetYear < autoInfo.budgetYear) {
      d.settings.budgetYear = autoInfo.budgetYear;
      d.settings.statYear = autoInfo.budgetYear;
    }
    return d;
  }

  function loadLocalData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.transactions && parsed.necessaryBudgets) {
          return normalizeLoadedData(parsed);
        }
      }
    } catch (e) {
      console.warn('读取本地缓存失败，使用初始 Excel 预置数据', e);
    }
    return normalizeLoadedData(JSON.parse(JSON.stringify(Engine.INITIAL_DATA)));
  }

  function saveData(triggerSync = true, syncOpts = {}) {
    state.data.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    if (triggerSync) {
      pushToServer(syncOpts);
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

  // ==================== 统一移动端底部抽屉面板 (Bottom Sheet) ====================
  let activeSheetConfig = null;
  let activeSheetValues = {};

  function closeBottomSheet() {
    const overlay = document.getElementById('bottomSheetOverlay');
    if (overlay) overlay.classList.add('hidden');
    activeSheetConfig = null;
    activeSheetValues = {};
  }

  function syncSheetInputsFromDOM() {
    const panel = document.getElementById('bottomSheetPanel');
    if (!panel || !activeSheetConfig) return;
    (activeSheetConfig.fields || []).forEach((f) => {
      const el = panel.querySelector(`[data-sheet-input="${f.key}"]`);
      if (!el) return;
      if (f.type === 'checkbox') {
        activeSheetValues[f.key] = !!el.checked;
      } else {
        activeSheetValues[f.key] = el.value;
      }
    });
  }

  function renderSheetContent(focusKey) {
    const panel = document.getElementById('bottomSheetPanel');
    if (!panel || !activeSheetConfig) return;
    const cfg = activeSheetConfig;
    const vals = activeSheetValues;

    const bannerHtml = cfg.banner
      ? `<div class="alert-banner ${cfg.banner.level || 'info'}" style="margin-bottom:12px;">${cfg.banner.html}</div>`
      : '';

    const fieldsHtml = (cfg.fields || [])
      .map((f) => {
        if (typeof f.showWhen === 'function' && !f.showWhen(vals)) return '';
        const val = vals[f.key] ?? '';
        const gridCls = f.half ? '' : 'sheet-field-full';

        if (f.type === 'checkbox') {
          return `
            <div class="form-group ${gridCls}" style="background:#f8fafc;padding:10px 12px;border-radius:10px;border:1px solid #e2e8f0;margin-bottom:10px;">
              <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;cursor:pointer;">
                <input type="checkbox" data-sheet-input="${f.key}" ${val ? 'checked' : ''} />
                <span>${f.label}</span>
              </label>
              ${f.hint ? `<div style="font-size:11px;color:#64748b;margin-top:4px;">${f.hint}</div>` : ''}
            </div>
          `;
        }

        if (f.type === 'chips') {
          return `
            <div class="form-group ${gridCls}" style="margin-bottom:10px;">
              <label class="form-label">${f.label}</label>
              <div class="chip-grid">
                ${(f.options || [])
                  .map(
                    (opt) =>
                      `<button type="button" class="chip ${String(val) === String(opt.value) ? 'active' : ''}" data-sheet-chip="${f.key}" data-sheet-val="${escHtml(opt.value)}">${opt.label}</button>`
                  )
                  .join('')}
              </div>
            </div>
          `;
        }

        const isMath = f.type === 'math';
        const calcVal = isMath ? evalMathAmount(val) : NaN;
        const mathHint =
          isMath && /[+\-]/.test(String(val)) && !isNaN(calcVal) ? `= ${fm(calcVal, false)}` : '';
        const inputType = f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text';
        const inputMode = isMath || f.type === 'number' ? 'inputmode="decimal"' : '';
        const readonlyAttr = f.type === 'readonly' ? 'readonly' : '';

        return `
          <div class="form-group ${gridCls}" style="margin-bottom:10px;">
            <label class="form-label" style="display:flex;justify-content:space-between;align-items:center;">
              <span>${f.label}</span>
              <span data-sheet-math-hint="${f.key}" style="color:#0f766e;font-weight:700;">${mathHint}</span>
            </label>
            <input
              type="${inputType}"
              ${inputMode}
              ${readonlyAttr}
              class="form-input"
              data-sheet-input="${f.key}"
              placeholder="${escHtml(f.placeholder || '')}"
              value="${escHtml(val)}"
            />
            ${
              f.quickChips && f.quickChips.length > 0
                ? `<div class="chip-grid" style="margin-top:6px;">
                    ${f.quickChips
                      .map(
                        (qc) =>
                          `<button type="button" class="chip ${String(val) === String(qc.value) ? 'active' : ''}" data-sheet-qfill="${f.key}" data-sheet-val="${escHtml(qc.value)}" style="padding:4px 9px;font-size:11px;">${qc.label}</button>`
                      )
                      .join('')}
                  </div>`
                : ''
            }
            ${f.hint ? `<div style="font-size:11px;color:#64748b;margin-top:4px;">${f.hint}</div>` : ''}
          </div>
        `;
      })
      .join('');

    panel.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <div class="sheet-title">${cfg.title || ''}</div>
          ${cfg.subtitle ? `<div class="sheet-sub">${cfg.subtitle}</div>` : ''}
        </div>
        <button type="button" class="sheet-close" id="sheetCloseBtn" aria-label="关闭">✕</button>
      </div>
      ${bannerHtml}
      <div class="sheet-error" id="sheetErrorBox"></div>
      <div class="sheet-grid">
        ${fieldsHtml}
      </div>
      <div class="sheet-actions" style="${cfg.hideCancel ? 'grid-template-columns:1fr;' : ''}">
        ${cfg.hideCancel ? '' : `<button type="button" class="btn-secondary" id="sheetCancelBtn" style="padding:12px;font-size:14px;">取消</button>`}
        <button type="button" class="btn-primary" id="sheetSubmitBtn" style="padding:12px;font-size:14px;">${cfg.submitText || '✅ 确认保存'}</button>
      </div>
    `;

    const showError = (msg) => {
      const errEl = document.getElementById('sheetErrorBox');
      if (errEl) {
        errEl.textContent = '⚠️ ' + msg;
        errEl.classList.add('show');
      }
    };

    const doSubmit = () => {
      syncSheetInputsFromDOM();
      if (typeof cfg.onSubmit === 'function') {
        const res = cfg.onSubmit({ ...activeSheetValues }, showError);
        if (res === false) return;
      }
      closeBottomSheet();
    };

    const closeBtn = document.getElementById('sheetCloseBtn');
    const cancelBtn = document.getElementById('sheetCancelBtn');
    const submitBtn = document.getElementById('sheetSubmitBtn');
    if (closeBtn) closeBtn.onclick = closeBottomSheet;
    if (cancelBtn) cancelBtn.onclick = closeBottomSheet;
    if (submitBtn) submitBtn.onclick = doSubmit;

    panel.querySelectorAll('[data-sheet-input]').forEach((el) => {
      const key = el.dataset.sheetInput;
      const fDef = (cfg.fields || []).find((x) => x.key === key);
      if (el.type === 'checkbox') {
        el.onchange = () => {
          syncSheetInputsFromDOM();
          renderSheetContent();
        };
      } else {
        el.oninput = () => {
          activeSheetValues[key] = el.value;
          if (fDef && fDef.type === 'math') {
            const hintEl = panel.querySelector(`[data-sheet-math-hint="${key}"]`);
            if (hintEl) {
              const cVal = evalMathAmount(el.value);
              hintEl.textContent = /[+\-]/.test(String(el.value)) && !isNaN(cVal) ? `= ${fm(cVal, false)}` : '';
            }
          }
        };
        el.onkeydown = (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            doSubmit();
          }
        };
      }
    });

    panel.querySelectorAll('[data-sheet-chip]').forEach((btn) => {
      btn.onclick = () => {
        syncSheetInputsFromDOM();
        activeSheetValues[btn.dataset.sheetChip] = btn.dataset.sheetVal;
        if (typeof cfg.onFieldChange === 'function') {
          cfg.onFieldChange(btn.dataset.sheetChip, btn.dataset.sheetVal, activeSheetValues);
        }
        renderSheetContent();
      };
    });

    panel.querySelectorAll('[data-sheet-qfill]').forEach((btn) => {
      btn.onclick = () => {
        syncSheetInputsFromDOM();
        activeSheetValues[btn.dataset.sheetQfill] = btn.dataset.sheetVal;
        renderSheetContent();
      };
    });

    if (focusKey) {
      const targetInp = panel.querySelector(`[data-sheet-input="${focusKey}"]`);
      if (targetInp && targetInp.type !== 'date' && targetInp.type !== 'checkbox') {
        setTimeout(() => {
          targetInp.focus();
          if (targetInp.readOnly) {
            targetInp.select();
          }
        }, 40);
      }
    }
  }

  function openBottomSheet(config) {
    const overlay = document.getElementById('bottomSheetOverlay');
    const backdrop = document.getElementById('bottomSheetBackdrop');
    if (!overlay) return;
    activeSheetConfig = config;
    activeSheetValues = {};
    let firstFocusKey = null;
    (config.fields || []).forEach((f) => {
      activeSheetValues[f.key] = f.value !== undefined && f.value !== null ? f.value : '';
      if (!firstFocusKey && (f.type === 'text' || f.type === 'math' || f.type === 'number' || f.type === 'readonly')) {
        firstFocusKey = f.key;
      }
    });
    if (backdrop) backdrop.onclick = closeBottomSheet;
    overlay.classList.remove('hidden');
    renderSheetContent(firstFocusKey);
  }

  function saveCloudConfig() {
    localStorage.setItem(CLOUD_CFG_KEY, JSON.stringify(state.cloudCfg));
  }

  // 从 Gist 文件字典中安全定位主账本文件（排除 z_snapshot_ 月度快照备份文件）
  function pickMainGistFile(files, fileName) {
    if (!files) return null;
    if (files[fileName]) return files[fileName];
    const fallbackKey = Object.keys(files).find(
      (k) => k.startsWith('family_ledger_') && !k.startsWith('z_snapshot_')
    );
    return fallbackKey ? files[fallbackKey] : null;
  }

  // 智能合并两份账本数据（按单笔流水 updatedAt 保留最新修改，防止两人同时记账/改账互相覆盖）
  function mergeLedgerData(local, remote) {
    if (!remote || !remote.transactions) return local;
    if (!local || !local.transactions) return remote;

    const remoteNewer = (remote.updatedAt || '') > (local.updatedAt || '');
    const merged = JSON.parse(JSON.stringify(remoteNewer ? remote : local));

    // 合并 c、q、dengbao 三张表的流水（按 id 去重，优先比较单笔 tx.updatedAt）
    const deletedIds = new Set([
      ...(local.deletedTxIds || []),
      ...(remote.deletedTxIds || [])
    ]);
    merged.deletedTxIds = Array.from(deletedIds);

    ['c', 'q', 'dengbao'].forEach((role) => {
      const map = new Map();
      const olderList = (remoteNewer ? local : remote).transactions[role] || [];
      const newerList = (remoteNewer ? remote : local).transactions[role] || [];
      olderList.forEach((tx) => {
        if (tx && tx.id) map.set(tx.id, tx);
      });
      newerList.forEach((tx) => {
        if (!tx || !tx.id) return;
        const prev = map.get(tx.id);
        if (!prev) {
          map.set(tx.id, tx);
        } else if (tx.updatedAt && prev.updatedAt) {
          if (tx.updatedAt >= prev.updatedAt) map.set(tx.id, tx);
        } else if (tx.updatedAt && !prev.updatedAt) {
          map.set(tx.id, tx);
        } else if (!tx.updatedAt && prev.updatedAt) {
          // 保留带有明确单笔编辑时间戳的版本
        } else {
          map.set(tx.id, tx);
        }
      });
      merged.transactions[role] = Array.from(map.values()).filter((tx) => !deletedIds.has(tx.id));
    });

    // 合并会员储值卡明细（按 id 去重，按卡片 updatedAt 保留最新修改，并过滤已删除卡片）
    const deletedCardIds = new Set([
      ...(local.deletedCardIds || []),
      ...(remote.deletedCardIds || [])
    ]);
    merged.deletedCardIds = Array.from(deletedCardIds);
    const cardMap = new Map();
    const olderCards = (remoteNewer ? local : remote).memberCards || [];
    const newerCards = (remoteNewer ? remote : local).memberCards || [];
    olderCards.forEach((c) => {
      if (c && c.id) cardMap.set(c.id, c);
    });
    newerCards.forEach((c) => {
      if (c && c.id) {
        const prev = cardMap.get(c.id);
        if (!prev || (c.updatedAt || '') >= (prev.updatedAt || '')) {
          cardMap.set(c.id, c);
        }
      }
    });
    merged.memberCards = Array.from(cardMap.values()).filter((c) => !deletedCardIds.has(c.id));

    // 合并分类标签
    merged.categories = Array.from(new Set([...(local.categories || []), ...(remote.categories || [])]));
    merged.dengbaoCategories = Array.from(new Set([...(local.dengbaoCategories || []), ...(remote.dengbaoCategories || [])]));

    return normalizeLoadedData(merged);
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
          const fileObj = pickMainGistFile(gist.files, fileName);
          if (fileObj && fileObj.content) {
            const remoteData = JSON.parse(fileObj.content);
            state.syncOnline = true;
            state.syncModeLabel = cfg.provider === 'github' ? 'GitHub云' : 'Gitee云';
            updateSyncHeader();

            const localStr = JSON.stringify({ tx: state.data.transactions, cards: state.data.memberCards || [] });
            const merged = mergeLedgerData(state.data, remoteData);
            const mergedStr = JSON.stringify({ tx: merged.transactions, cards: merged.memberCards || [] });

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
        const localStr = JSON.stringify({ tx: state.data.transactions, cards: state.data.memberCards || [] });
        const merged = mergeLedgerData(state.data, payload.data);
        const mergedStr = JSON.stringify({ tx: merged.transactions, cards: merged.memberCards || [] });
        if (localStr !== mergedStr || payload.data.updatedAt > (state.data.updatedAt || '')) {
          state.data = merged;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
          render();
        }
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

  async function pushToServer(syncOpts = {}) {
    const cfg = state.cloudCfg;
    const code = state.data.familyCode || 'cq2026';
    const fileName = `family_ledger_${code}.json`;

    // 推送前先拉取一次远端进行智能合并（重置操作除外），防止两人同时记账互相覆盖
    if (!syncOpts.forceOverwrite && (cfg.provider === 'github' || cfg.provider === 'gitee') && cfg.token && cfg.gistId) {
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
          const fileObj = pickMainGistFile(gist.files, fileName);
          if (fileObj && fileObj.content) {
            const remoteData = JSON.parse(fileObj.content);
            state.data = mergeLedgerData(state.data, remoteData);
            state.data.updatedAt = new Date().toISOString();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
          }
        }
      } catch (e) {}
    }

    // 1. GitHub / Gitee 云端同步推送（附带按账期月度自动快照，历史月份永久保留在 Gist）
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

        const gistFiles = {
          [fileName]: { content: JSON.stringify(state.data, null, 2) }
        };
        if (syncOpts.preResetData) {
          gistFiles[`z_snapshot_${code}_before_reset.json`] = {
            content: JSON.stringify(syncOpts.preResetData)
          };
        } else if (!syncOpts.skipMonthlySnapshot) {
          const snapPeriod = getAutoPeriodKey();
          gistFiles[`z_snapshot_${code}_${snapPeriod}.json`] = {
            content: JSON.stringify(state.data)
          };
        }

        const bodyObj = {
          description: `2026-2027 家庭共同记账 (${code})`,
          public: false,
          files: gistFiles
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

  function syncPeriodBarUI() {
    const autoKey = getAutoPeriodKey();
    const sel = document.getElementById('periodSelect');
    if (sel) sel.value = state.activePeriod;
    const jumpBtn = document.getElementById('jumpCurrentPeriodBtn');
    if (jumpBtn) {
      jumpBtn.classList.toggle('hidden', state.activePeriod === autoKey);
    }
  }

  // 每月过了9号（进入10号新账期）自动切换到下一账期，无需手动调整
  function checkAndAutoAdvancePeriod() {
    const nowPeriod = getAutoPeriodKey();
    if (nowPeriod !== state.lastAutoPeriod) {
      state.lastAutoPeriod = nowPeriod;
      state.activePeriod = nowPeriod;
      state.data.settings.currentPeriod = nowPeriod;
      state.data.settings.dengbaoPeriod = nowPeriod;
      const autoYear = Engine.getPeriodRange(nowPeriod).year;
      state.data.settings.budgetYear = autoYear;
      state.data.settings.statYear = autoYear;
      if (state.addForm && !state.addForm.editingId) {
        state.addForm.date = getTodayStr();
      }
      initPeriodSelect();
      saveData(false);
      render();
      showToast(`📅 已自动更新至新账期：${Engine.getPeriodRange(nowPeriod).label}`);
    }
  }

  // 生成账期下拉选项（动态覆盖 2026 至当前/未来账期，当期自动标记）
  function initPeriodSelect() {
    const sel = document.getElementById('periodSelect');
    if (!sel) return;
    const autoInfo = Engine.getCurrentPeriodInfo();
    const activeYear = parseInt(String(state.activePeriod).split('-')[0], 10) || autoInfo.budgetYear;
    const maxYear = Math.max(2027, autoInfo.budgetYear + 1, activeYear);
    const periods = [];
    for (let y = 2026; y <= maxYear; y++) {
      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        periods.push(Engine.getPeriodRange(key));
      }
    }
    sel.innerHTML = periods
      .map((p) => {
        const curTag = p.periodKey === autoInfo.periodKey ? ' · 当期' : '';
        return `<option value="${p.periodKey}" ${p.periodKey === state.activePeriod ? 'selected' : ''}>${p.label}${curTag}</option>`;
      })
      .join('');

    sel.onchange = (e) => {
      state.activePeriod = e.target.value;
      syncPeriodBarUI();
      render();
    };

    document.getElementById('prevPeriodBtn').onclick = () => stepPeriod(-1);
    document.getElementById('nextPeriodBtn').onclick = () => stepPeriod(1);
    const jumpBtn = document.getElementById('jumpCurrentPeriodBtn');
    if (jumpBtn) {
      jumpBtn.onclick = () => {
        state.activePeriod = getAutoPeriodKey();
        initPeriodSelect();
        syncPeriodBarUI();
        render();
        showToast('⚡ 已回到当前最新账期');
      };
    }
    document.getElementById('syncStatusBtn').onclick = () => {
      showToast('🔄 正在同步最新云端账本...');
      pullFromServer(true);
    };
    syncPeriodBarUI();
  }

  function stepPeriod(delta) {
    const autoInfo = Engine.getCurrentPeriodInfo();
    const maxYear = Math.max(2027, autoInfo.budgetYear + 1);
    const [yStr, mStr] = state.activePeriod.split('-');
    let y = parseInt(yStr, 10);
    let m = parseInt(mStr, 10) + delta;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    if (y < 2026) { y = 2026; m = 1; }
    if (y > maxYear) { y = maxYear; m = 12; }
    state.activePeriod = `${y}-${String(m).padStart(2, '0')}`;
    syncPeriodBarUI();
    render();
  }

  function updateTabBarUI(report) {
    const alertCount = report && report.memberCardsReport ? report.memberCardsReport.alertCount : 0;
    document.querySelectorAll('.tab-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === state.currentTab);
      if (btn.dataset.tab === 'cards') {
        const oldDot = btn.querySelector('.tab-alert-dot');
        if (alertCount > 0 && !oldDot) {
          const dot = document.createElement('span');
          dot.className = 'tab-alert-dot';
          btn.appendChild(dot);
        } else if (alertCount === 0 && oldDot) {
          oldDot.remove();
        }
      }
    });
  }

  // ==================== 1. 家庭看板 (Dashboard) ====================
  function renderDashboard(report) {
    const alloc = report.currentAllocation;
    const track = report.annualTracking;
    const annSum = report.annualSummary;
    const cardRep = report.memberCardsReport;
    const tr = report.treasurySummary;
    const remDays = calcPeriodRemainingDays(report.periodRange.endDate);
    const cPerDay = alloc.c.remainingPocket !== null ? Math.max(0, alloc.c.remainingPocket / remDays) : null;
    const qPerDay = alloc.q.remainingPocket !== null ? Math.max(0, alloc.q.remainingPocket / remDays) : null;
    const hasFloorTopup = (alloc.c.goldenEggShortfall || 0) > 0 || (alloc.q.goldenEggShortfall || 0) > 0;

    const statusBadge = (level, text) => {
      const map = { ok: 'badge-ok', warn: 'badge-warn', danger: 'badge-danger', info: 'badge-info' };
      return `<span class="badge ${map[level] || 'badge-info'}">${text}</span>`;
    };

    const wishSubLine = tr.wishPool.hasExplicitDeposit
      ? `累计转入 ¥${fm(tr.wishPool.totalDeposit, false)} − 已兑现 ¥${fm(tr.wishPool.totalSpent, false)}`
      : `发薪预留 ¥${fm(tr.wishPool.totalAccrued, false)} − 已兑现 ¥${fm(tr.wishPool.totalSpent, false)}`;

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

      ${cardRep && cardRep.alertCount > 0 ? `
        <div class="alert-banner warn" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;" data-action="jumpCardsAlert">
          <span>💳 <strong>会员储值卡保质期提醒：</strong>有 <strong>${cardRep.alertCount}</strong> 张卡即将到期或已过期，别忘了使用！</span>
          <span style="font-weight:700;white-space:nowrap;">去查看 ›</span>
        </div>
      ` : ''}

      ${(!alloc.family.bothHaveSalary) ? `
        <div class="alert-banner warn">
          💡 <strong>本期分配提醒：</strong>${alloc.c.statusTip !== '正常' ? 'c ' + alloc.c.statusTip + '；' : ''}${alloc.q.statusTip !== '正常' ? 'q ' + alloc.q.statusTip : ''}
          （点击下方“记一笔”选择“收入+工资”即可自动激活当期分配）
        </div>
      ` : ''}

      <!-- 🏆 家庭金蛋与心愿金库（累计攒钱成就卡） -->
      <section class="treasury-card">
        <div class="treasury-head">
          <div class="treasury-title">
            <span>🏆 家庭金蛋与心愿金库</span>
          </div>
          <button type="button" class="btn-secondary" style="padding:4px 9px;font-size:11px;background:rgba(255,255,255,0.85);border-color:#fcd34d;color:#92400e;" data-action="quickDepositWish">
            ✨ 许愿池打卡
          </button>
        </div>
        <div class="treasury-grid">
          <div class="treasury-box">
            <div class="treasury-label">
              <span>🥚 累计已存金蛋</span>
              ${tr.goldenEgg.pendingCheckin > 0 ? `<span class="badge badge-warn" style="font-size:10px;padding:1px 6px;">待打卡¥${fm(tr.goldenEgg.pendingCheckin, false)}</span>` : `<span class="badge badge-ok" style="font-size:10px;padding:1px 6px;">已达标</span>`}
            </div>
            <div class="treasury-val">¥ ${fm(tr.goldenEgg.totalDeposit, false)}</div>
            <div class="treasury-meta">
              👦 c 累计: <strong>¥${fm(tr.goldenEgg.cDeposit, false)}</strong> · 👧 q 累计: <strong>¥${fm(tr.goldenEgg.qDeposit, false)}</strong><br/>
              已发薪期应存合计: ¥${fm(tr.goldenEgg.totalAccruedTarget, false)}
            </div>
          </div>
          <div class="treasury-box wish">
            <div class="treasury-label">
              <span>✨ 许愿池当前池余</span>
              <span class="badge ${tr.wishPool.availableBalance < 0 ? 'badge-warn' : 'badge-ok'}" style="font-size:10px;padding:1px 6px;">${tr.wishPool.hasExplicitDeposit ? '实存池' : '预留池'}</span>
            </div>
            <div class="treasury-val" style="${tr.wishPool.availableBalance < 0 ? 'color:#d97706;' : ''}">¥ ${fm(tr.wishPool.availableBalance, false)}</div>
            <div class="treasury-meta">
              👦 c池: <strong>¥${fm(tr.wishPool.cAvailable, false)}</strong> · 👧 q池: <strong>¥${fm(tr.wishPool.qAvailable, false)}</strong><br/>
              ${wishSubLine}
            </div>
          </div>
        </div>
        <div class="treasury-foot">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <span>🎯 <strong>${tr.budgetYear}年度攒金蛋进度</strong>（保底目标 ¥${fm(tr.goldenEgg.annualBaseTarget, false)}/年）</span>
            <span style="font-weight:800;">¥${fm(tr.goldenEgg.yearDeposit, false)} (${Math.round(tr.goldenEgg.yearProgressPct)}%)</span>
          </div>
          <div class="progress-track" style="height:7px;background:rgba(217,119,6,0.14);">
            <div class="progress-fill ok" style="width:${tr.goldenEgg.yearProgressPct}%;background:linear-gradient(90deg,#f59e0b,#10b981);"></div>
          </div>
          ${tr.otherSavings.totalDeposit !== 0 ? `<div style="margin-top:6px;font-size:11px;color:#065f46;">🏦 其他储蓄累计净存入: <strong>¥${fm(tr.otherSavings.totalDeposit, false)}</strong>（c: ¥${fm(tr.otherSavings.cDeposit, false)} | q: ¥${fm(tr.otherSavings.qDeposit, false)}）</div>` : ''}
        </div>
      </section>

      <!-- 本期工资与月度分配表 -->
      <section class="card">
        <div class="card-header">
          <div>
            <div class="card-title">💰 本期工资分配明细</div>
            <div class="card-subtitle">金蛋保底¥2,000（高于则按50%计） · 不足保底自动从零花钱补足</div>
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
              <td>金蛋固定部分 <span style="font-size:10px;color:#94a3b8;">(保底)</span></td>
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
        ${hasFloorTopup ? `
          <div class="alert-banner info" style="margin-top:10px;margin-bottom:0;font-size:11.5px;">
            🥚 <strong>金蛋最低保底已生效：</strong>
            ${(alloc.c.goldenEggShortfall || 0) > 0 ? `c 本期已从零花钱补入 <strong>¥${fm(alloc.c.goldenEggShortfall, false)}</strong> 凑足保底金蛋；` : ''}
            ${(alloc.q.goldenEggShortfall || 0) > 0 ? `q 本期已从零花钱补入 <strong>¥${fm(alloc.q.goldenEggShortfall, false)}</strong> 凑足保底金蛋。` : ''}
          </div>
        ` : ''}
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

  function suggestCategoryForBudgetItem(itemName, purpose) {
    if (!itemName) return null;
    if (itemName.includes('服装')) return '服饰鞋包';
    if (itemName === '水费' || itemName === '电费' || itemName === '燃气') return '水电燃气';
    if (itemName === '物业费' || itemName.includes('车位')) return '物业停车';
    if (itemName.includes('汽车')) return itemName.includes('保险') ? '保险' : '汽车费用';
    if (itemName.includes('医疗') || itemName.includes('保健') || itemName.includes('健身')) return '医疗健康';
    if (itemName.includes('话费')) return '话费网络';
    if (itemName.includes('房贷')) return '房贷';
    if (itemName.includes('游') || itemName.includes('旅')) return '旅游出游';
    if (itemName.includes('会员') || itemName === '网飞' || itemName === '梯子' || itemName === 'AI') return '订阅会员';
    if (itemName.includes('手机') || itemName.toLowerCase().includes('ultra')) return '数码家电';
    if (purpose === '必要开支' && (itemName.includes('杂物') || itemName.includes('个护'))) return '日用品';
    return null;
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

    // 必要开支 / 许愿池 子项候选列表
    const needBudgetItem =
      !isDengbao && (f.type === '支出' || f.type === '退款') && (f.purpose === '必要开支' || f.purpose === '许愿池');
    const budgetSubItems = needBudgetItem
      ? f.purpose === '必要开支'
        ? (report.budgets[f.role].necessaryItems || []).filter((it) => it.name && it.name !== '噔宝' && !it.isOffset)
        : (report.budgets[f.role].wishItems || []).filter((it) => it.name)
      : [];
    if (needBudgetItem && f.budgetItemId && !budgetSubItems.some((it) => it.id === f.budgetItemId)) {
      f.budgetItemId = '';
    }
    const selectedSubItem = needBudgetItem ? budgetSubItems.find((it) => it.id === f.budgetItemId) : null;

    // 实时预览本笔后剩余年度额度（及具体子项剩余额度）
    let quotaPreviewHtml = '';
    const numAmt = evalMathAmount(f.amount) || 0;
    if (needBudgetItem) {
      const memberTrack = report.annualTracking[f.role];
      const curRem = f.purpose === '必要开支' ? memberTrack.necRemaining : memberTrack.wishRemaining;
      const delta = f.type === '支出' ? -numAmt : numAmt;
      const afterRem = curRem + delta;
      const subItemLine =
        selectedSubItem && selectedSubItem.remaining !== null
          ? `<div style="margin-top:4px;">🎯 <strong>「${escHtml(selectedSubItem.name)}」子项额度：</strong>当前剩余 ¥${fm(selectedSubItem.remaining, false)} → 本笔后剩余 <strong>¥${fm(selectedSubItem.remaining + delta, false)}</strong></div>`
          : '';
      quotaPreviewHtml = `
        <div class="alert-banner ${afterRem < 0 || (selectedSubItem && selectedSubItem.remaining !== null && selectedSubItem.remaining + delta < 0) ? 'warn' : 'info'}">
          <div>📊 <strong>年度${f.purpose}总额预览：</strong>当前剩余 ¥${fm(curRem, false)} → 本笔后剩余 <strong>¥${fm(afterRem, false)}</strong></div>
          ${subItemLine}
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

        ${
          needBudgetItem && budgetSubItems.length > 0
            ? `
          <div class="form-group" style="background:#f8fafc;padding:10px 12px;border-radius:12px;border:1px solid #e2e8f0;">
            <label class="form-label" style="color:#0f766e;margin-bottom:7px;">🎯 对应${f.purpose}子项（精准核减该项目年度预算）</label>
            <div class="chip-grid">
              <button type="button" class="chip ${!f.budgetItemId ? 'active' : ''}" data-bitem="">暂不指定</button>
              ${budgetSubItems
                .map((it) => {
                  const remTxt = it.remaining !== null ? ` · 余¥${fm(it.remaining, false)}` : '';
                  return `<button type="button" class="chip ${f.budgetItemId === it.id ? 'active' : ''}" data-bitem="${it.id}">${escHtml(it.name)}${remTxt}</button>`;
                })
                .join('')}
            </div>
          </div>
        `
            : ''
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
            <input type="text" inputmode="decimal" placeholder="0" class="form-input amount-input" id="txAmountInput" value="${f.amount}" />
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
          const hay = `${tx.category || ''} ${tx.purpose || ''} ${tx.resolvedBudgetItemName || ''} ${tx.note || ''} ${tx.amount || ''} ${tx.date || ''}`.toLowerCase();
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
                          <div class="tx-info-title" style="flex-wrap:wrap;">
                            <span>${tx.category || tx.purpose || '未分类'}</span>
                            <span class="badge ${isDb ? 'badge-db' : tx.member === 'c' ? 'badge-c' : 'badge-q'}">${roleLabel}</span>
                            <span class="badge badge-info">${tx.type}${tx.purpose ? '·' + tx.purpose : ''}</span>
                            ${tx.resolvedBudgetItemName ? `<span class="badge badge-ok">🎯 ${escHtml(tx.resolvedBudgetItemName)}</span>` : ''}
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
              <div class="card-title">${role.toUpperCase()} · ${report.budgets.budgetYear}年度必要开支对账清单</div>
              <div class="card-subtitle">年度消费总额度: ¥${fm(bRole.necessaryAnnualQuota, false)} · 每笔必要开支可精确核销对应子项</div>
            </div>
            <button class="btn-secondary" data-action="addNecessaryItem">+ 新增项目</button>
          </div>
          ${
            bRole.necUnassignedSpent > 0
              ? `<div class="alert-banner info" style="font-size:11.5px;">
                  📌 另有 <strong>¥${fm(bRole.necUnassignedSpent, false)}</strong> 必要开支尚未指定具体子项（已计入年度总额度；可在「流水明细」点编辑补充归类）。
                </div>`
              : ''
          }
          <div class="bitem-list">
            ${bRole.necessaryItems
              .map((it) => {
                const isDbItem = it.name === '噔宝';
                let progressSection = '';
                if (it.isOffset) {
                  progressSection = `
                    <div class="bitem-sub">
                      <span style="color:#0f766e;font-weight:600;">💰 收租抵减项（自动抵减月均预留 ¥${fm(Math.abs(it.monthly || 0))}/月）</span>
                      <span>年度抵减: <strong>¥${fm(it.annualBudget, false)}</strong></span>
                    </div>
                  `;
                } else if (it.annualBudget === null) {
                  progressSection = `
                    <div class="bitem-sub">
                      <span>本年已花: <strong>¥${fm(it.spent, false)}</strong></span>
                      <span style="color:#f59e0b;">未设年度预算（点右侧改额可设）</span>
                    </div>
                  `;
                } else {
                  const pct = Math.min(100, Math.max(0, it.ratio * 100));
                  progressSection = `
                    <div class="progress-track" style="height:6px;margin:4px 0;">
                      <div class="progress-fill ${it.level}" style="width:${pct.toFixed(1)}%"></div>
                    </div>
                    <div class="bitem-sub">
                      <span>已花 <strong>¥${fm(it.spent, false)}</strong> / 预算 ¥${fm(it.annualBudget, false)} (月均¥${fm(it.monthly)})</span>
                      <span style="color:${it.remaining < 0 ? '#ef4444' : '#0f766e'};font-weight:700;">
                        ${it.remaining < 0 ? `超支 ¥${fm(Math.abs(it.remaining), false)}` : `剩余 ¥${fm(it.remaining, false)}`}
                      </span>
                    </div>
                  `;
                }

                return `
                  <div class="bitem-row">
                    <div class="bitem-top">
                      <div class="bitem-name-wrap">
                        <span class="bitem-name">${escHtml(it.name)}</span>
                        ${isDbItem ? `<span class="badge badge-db">👶 自动汇总噔宝专表</span>` : ''}
                        ${it.isOffset ? `<span class="badge badge-ok">月均抵减</span>` : ''}
                        ${it.tip ? `<span class="badge badge-warn">${escHtml(it.tip)}</span>` : ''}
                      </div>
                      <div class="bitem-actions">
                        <button class="btn-secondary" style="padding:3px 8px;font-size:11px;" data-edit-nec="${it.id}">改额</button>
                        <button class="btn-danger-sm" data-del-nec="${it.id}">删</button>
                      </div>
                    </div>
                    ${progressSection}
                  </div>
                `;
              })
              .join('')}
          </div>
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
              <div class="card-title">${role.toUpperCase()} · ${report.budgets.budgetYear}年度许愿池心愿单</div>
              <div class="card-subtitle">年度总额度: ¥${fm(bRole.wishAnnualQuota, false)} · 分摊月数决定每月工资预留</div>
            </div>
            <button class="btn-secondary" data-action="addWishItem">+ 新增愿望</button>
          </div>
          ${
            bRole.wishUnassignedSpent > 0
              ? `<div class="alert-banner info" style="font-size:11.5px;">
                  📌 另有 <strong>¥${fm(bRole.wishUnassignedSpent, false)}</strong> 许愿池消费尚未指定具体愿望（可在「流水明细」点编辑补充归类）。
                </div>`
              : ''
          }
          <div class="bitem-list">
            ${bRole.wishItems
              .map((it) => {
                let progressSection = '';
                if (it.annualQuota === null) {
                  progressSection = `
                    <div class="bitem-sub">
                      <span>已消费: <strong>¥${fm(it.spent, false)}</strong>（分摊 ${it.months}个月）</span>
                      <span style="color:#f59e0b;">未设心愿额度（点改额设置）</span>
                    </div>
                  `;
                } else {
                  const pct = Math.min(100, Math.max(0, it.ratio * 100));
                  progressSection = `
                    <div class="progress-track" style="height:6px;margin:4px 0;">
                      <div class="progress-fill ${it.level}" style="width:${pct.toFixed(1)}%"></div>
                    </div>
                    <div class="bitem-sub">
                      <span>已花 <strong>¥${fm(it.spent, false)}</strong> / 额度 ¥${fm(it.annualQuota, false)} (${it.months}月·月均¥${fm(it.monthly)})</span>
                      <span style="color:${it.remaining < 0 ? '#ef4444' : '#0f766e'};font-weight:700;">
                        ${it.remaining < 0 ? `超支 ¥${fm(Math.abs(it.remaining), false)}` : `剩余 ¥${fm(it.remaining, false)}`}
                      </span>
                    </div>
                  `;
                }

                return `
                  <div class="bitem-row">
                    <div class="bitem-top">
                      <div class="bitem-name-wrap">
                        <span class="bitem-name">✨ ${escHtml(it.name)}</span>
                        ${it.tip ? `<span class="badge badge-warn">${escHtml(it.tip)}</span>` : ''}
                      </div>
                      <div class="bitem-actions">
                        <button class="btn-secondary" style="padding:3px 8px;font-size:11px;" data-edit-wish="${it.id}">改额</button>
                        <button class="btn-danger-sm" data-del-wish="${it.id}">删</button>
                      </div>
                    </div>
                    ${progressSection}
                  </div>
                `;
              })
              .join('')}
          </div>
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
                <td>${fm(track.c.maxRetainable, false)}</td>
                <td>${fm(track.q.maxRetainable, false)}</td>
                <td>${track.c.maxRetainable !== null && track.q.maxRetainable !== null ? fm(Math.max(0, track.family.combinedSurplus), false) : '--'}</td>
              </tr>
              <tr>
                <td>年末实有资金</td>
                <td>${fm(track.c.actualFunds, false)}</td>
                <td>${fm(track.q.actualFunds, false)}</td>
                <td>${track.c.actualFunds !== null && track.q.actualFunds !== null ? fm(track.c.actualFunds + track.q.actualFunds, false) : '--'}</td>
              </tr>
              <tr class="row-highlight">
                <td>🏦 预计可转存下年额度</td>
                <td>${fm(track.c.transferable, false)}</td>
                <td>${fm(track.q.transferable, false)}</td>
                <td>${track.c.transferable !== null && track.q.transferable !== null ? fm(track.c.transferable + track.q.transferable, false) : '--'}</td>
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
                ? '✅ 已接通实时同步，你和老婆在各自手机上的记账会按单笔修改时间智能双向合并，且每月自动生成云端账期快照。'
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
            <div style="margin-bottom:10px;">
              <button type="button" class="btn-secondary" style="width:100%;border-color:#99f6e4;background:#f0fdfa;color:#0f766e;" data-action="restoreCloudSnapshot">
                🕰️ 从云端月度自动备份快照恢复（防误删历史保护）
              </button>
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

  // ==================== 6. 会员储值卡明细 (Membership & Stored-Value Cards) ====================
  function renderCards(report) {
    const cr = report.memberCardsReport;
    const cf = state.cardForm;
    const flt = state.cardFilter;

    const ownerBadge = (owner) => {
      if (owner === 'c') return `<span class="badge badge-c">👦 c</span>`;
      if (owner === 'q') return `<span class="badge badge-q">👧 q</span>`;
      if (owner === 'dengbao') return `<span class="badge badge-db">👶 噔宝</span>`;
      return `<span class="badge badge-info">👨‍👩‍👦 家庭共用</span>`;
    };

    const typeLabel = (t) => (t === 'times' ? '计次卡' : t === 'period' ? '期限会员' : '储值卡');
    const expiryBadgeClass = (lvl) =>
      lvl === 'danger' ? 'badge-danger' : lvl === 'warn' ? 'badge-warn' : 'badge-ok';

    const filteredCards = cr.cards.filter((c) => {
      if (flt.type === 'active' && c.isInactive) return false;
      if (flt.type === 'inactive' && !c.isInactive) return false;
      if (flt.type === 'stored' && (c.cardType !== 'stored' || c.isInactive)) return false;
      if (flt.type === 'times' && (c.cardType !== 'times' || c.isInactive)) return false;
      if (flt.type === 'period' && (c.cardType !== 'period' || c.isInactive)) return false;
      if (flt.type === 'alert' && !((c.isExpiringSoon || c.isExpired) && !c.isInactive)) return false;

      if (flt.keyword && flt.keyword.trim()) {
        const kw = flt.keyword.trim().toLowerCase();
        const hay = `${c.name || ''} ${c.note || ''} ${c.price || ''} ${c.expiryDate || ''} ${c.openDate || ''}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    const fmtCardAmt = (n) => fm(n, false);

    return `
      <!-- 储值卡总览卡片 -->
      <section class="pocket-hero" style="background:linear-gradient(135deg, #0f766e 0%, #1e3a8a 100%);">
        <div class="pocket-hero-top">
          <div>
            <div class="pocket-total-label" style="color:#ccfbf1;">💳 储值卡可用总余额（在用 ${cr.activeCount} 张）</div>
            <div class="pocket-total-val" style="color:#fff;">¥ ${fmtCardAmt(cr.totalStoredRemaining)}</div>
          </div>
          <button type="button" class="btn-secondary" style="background:rgba(255,255,255,0.2);color:#fff;border:none;" data-action="toggleCardForm">
            ${cf.open ? '收起表单' : '+ 新增会员卡'}
          </button>
        </div>
        <div class="pocket-person-grid">
          <div class="pocket-person-box">
            <div class="pocket-person-header" style="color:#ccfbf1;">
              <span>累计充值实付</span>
              <span class="badge badge-info">共 ${cr.totalCount} 张</span>
            </div>
            <div class="pocket-person-val">¥ ${fmtCardAmt(cr.totalPaidPrice)}</div>
            <div class="pocket-person-meta" style="color:#cbd5e1;">
              记录价格、余额与保质期，充卡不再忘
            </div>
          </div>
          <div class="pocket-person-box">
            <div class="pocket-person-header" style="color:#ccfbf1;">
              <span>保质期状态</span>
              <span class="badge ${cr.alertCount > 0 ? 'badge-warn' : 'badge-ok'}">${cr.alertCount > 0 ? cr.alertCount + '张需关注' : '全部正常'}</span>
            </div>
            <div class="pocket-person-val">${cr.expiringSoonCards.length} <span style="font-size:13px;font-weight:500;">张临期</span></div>
            <div class="pocket-person-meta" style="color:#cbd5e1;">
              30天内到期: ${cr.expiringSoonCards.length} 张 | 已过期: ${cr.expiredActiveCards.length} 张
            </div>
          </div>
        </div>
      </section>

      ${
        cf.open
          ? `
        <!-- 新增 / 编辑会员储值卡表单 -->
        <section class="card" style="border:2px solid #0d9488;">
          <div class="card-header">
            <div class="card-title">${cf.editingId ? '✏️ 编辑会员储值卡' : '💳 新增会员储值卡'}</div>
            <button type="button" class="btn-secondary" data-action="cancelCardForm">取消</button>
          </div>

          <div class="form-group">
            <label class="form-label">卡片类型</label>
            <div class="segmented">
              <button type="button" class="seg-btn ${cf.cardType === 'stored' ? 'active' : ''}" data-cftype="stored">💰 储值余额卡</button>
              <button type="button" class="seg-btn ${cf.cardType === 'times' ? 'active' : ''}" data-cftype="times">🔢 计次/课时卡</button>
              <button type="button" class="seg-btn ${cf.cardType === 'period' ? 'active' : ''}" data-cftype="period">📅 期限会员卡</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">卡名称 / 商家店名（必填）</label>
            <input type="text" class="form-input" id="cfNameInput" placeholder="例如：山姆会员卡、楼下理发店充值卡、洗车10次卡" value="${escHtml(cf.name)}" />
          </div>

          <div class="form-group">
            <label class="form-label">归属成员</label>
            <div class="chip-grid">
              <button type="button" class="chip ${cf.owner === 'family' ? 'active' : ''}" data-cfowner="family">👨‍👩‍👦 家庭共用</button>
              <button type="button" class="chip ${cf.owner === 'c' ? 'active' : ''}" data-cfowner="c">👦 c（你）</button>
              <button type="button" class="chip ${cf.owner === 'q' ? 'active' : ''}" data-cfowner="q">👧 q（她）</button>
              <button type="button" class="chip ${cf.owner === 'dengbao' ? 'active' : ''}" data-cfowner="dengbao">👶 噔宝</button>
            </div>
          </div>

          ${
            cf.cardType === 'stored'
              ? `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div class="form-group">
                <label class="form-label">充值实付价格（元）</label>
                <input type="number" step="0.01" class="form-input" id="cfPriceInput" placeholder="实付多少钱，如 500" value="${escHtml(cf.price)}" />
              </div>
              <div class="form-group">
                <label class="form-label">卡内到账面额（元）</label>
                <input type="number" step="0.01" class="form-input" id="cfTotalInput" placeholder="留空同实付；充500送100填600" value="${escHtml(cf.totalValue)}" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">当前卡内剩余金额（元，新卡留空则默认等于到账面额）</label>
              <input type="number" step="0.01" class="form-input" id="cfRemInput" placeholder="若录入旧卡可填当前剩余余额" value="${escHtml(cf.remainingValue)}" />
            </div>
          `
              : cf.cardType === 'times'
              ? `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div class="form-group">
                <label class="form-label">办卡实付价格（元）</label>
                <input type="number" step="0.01" class="form-input" id="cfPriceInput" placeholder="实付总价，如 380" value="${escHtml(cf.price)}" />
              </div>
              <div class="form-group">
                <label class="form-label">总次数（次）</label>
                <input type="number" step="1" class="form-input" id="cfTotalInput" placeholder="如 10" value="${escHtml(cf.totalValue)}" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">当前剩余次数（次，新卡留空默认等于总次数）</label>
              <input type="number" step="1" class="form-input" id="cfRemInput" placeholder="若录入旧卡可填当前剩余次数" value="${escHtml(cf.remainingValue)}" />
            </div>
          `
              : `
            <div class="form-group">
              <label class="form-label">办卡/开通实付价格（元）</label>
              <input type="number" step="0.01" class="form-input" id="cfPriceInput" placeholder="例如：260" value="${escHtml(cf.price)}" />
            </div>
          `
          }

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="form-group">
              <label class="form-label">充值/开卡日期</label>
              <input type="date" class="form-input" id="cfOpenDateInput" value="${escHtml(cf.openDate)}" />
            </div>
            <div class="form-group">
              <label class="form-label">保质期 / 有效期至</label>
              <input type="date" class="form-input" id="cfExpiryDateInput" value="${escHtml(cf.expiryDate)}" />
            </div>
          </div>

          <div class="form-group" style="margin-top:-6px;">
            <label class="form-label">快捷设置保质期（基于开卡日自动推算）</label>
            <div class="chip-grid">
              <button type="button" class="chip ${cf.expiryDate === '' ? 'active' : ''}" data-cfexp="none">♾️ 长期有效</button>
              <button type="button" class="chip" data-cfexp="1">+1个月</button>
              <button type="button" class="chip" data-cfexp="3">+3个月</button>
              <button type="button" class="chip" data-cfexp="6">+半年</button>
              <button type="button" class="chip" data-cfexp="12">+1年</button>
              <button type="button" class="chip" data-cfexp="24">+2年</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">绑定手机号 / 门店 / 折扣说明（选填）</label>
            <input type="text" class="form-input" id="cfNoteInput" placeholder="例如：报q手机号138xxxx、剪发8折、节假日通用..." value="${escHtml(cf.note)}" />
          </div>

          ${
            !cf.editingId
              ? `
            <div class="form-group" style="background:#f8fafc;padding:10px 12px;border-radius:10px;border:1px solid #e2e8f0;">
              <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;cursor:pointer;">
                <input type="checkbox" id="cfSyncLedgerChk" ${cf.syncToLedger ? 'checked' : ''} />
                <span>同时把本次办卡实付金额记入账单流水（补录以前的旧卡请勿勾选）</span>
              </label>
              ${
                cf.syncToLedger
                  ? `
                <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
                  <span style="font-size:11.5px;color:#64748b;">记入：</span>
                  <button type="button" class="chip ${cf.ledgerRole === 'c' ? 'active' : ''}" data-cf-lrole="c">👦 c记账</button>
                  <button type="button" class="chip ${cf.ledgerRole === 'q' ? 'active' : ''}" data-cf-lrole="q">👧 q记账</button>
                  <button type="button" class="chip ${cf.ledgerRole === 'dengbao' ? 'active' : ''}" data-cf-lrole="dengbao">👶 噔宝支出</button>
                  ${
                    cf.ledgerRole !== 'dengbao'
                      ? `
                    <span style="font-size:11.5px;color:#64748b;margin-left:4px;">用途：</span>
                    <button type="button" class="chip ${cf.ledgerPurpose === '日常' ? 'active' : ''}" data-cf-lpurp="日常">日常</button>
                    <button type="button" class="chip ${cf.ledgerPurpose === '必要开支' ? 'active' : ''}" data-cf-lpurp="必要开支">必要开支</button>
                    <button type="button" class="chip ${cf.ledgerPurpose === '许愿池' ? 'active' : ''}" data-cf-lpurp="许愿池">许愿池</button>
                  `
                      : ''
                  }
                </div>
                <div style="font-size:11px;color:#0f766e;margin-top:6px;">🧾 勾选后卡片将自动打上「已入账单」标记，日后扣卡消费时会自动提醒无需重复记账。</div>
              `
                  : `
                <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #cbd5e1;">
                  <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#334155;cursor:pointer;">
                    <input type="checkbox" id="cfRecordedChk" ${cf.recordedInLedger ? 'checked' : ''} />
                    <span>🧾 这张旧卡以前已经在账单里记过支出了（防扣消费重复记账）</span>
                  </label>
                </div>
              `
              }
            </div>
          `
              : `
            <div class="form-group" style="background:#f8fafc;padding:10px 12px;border-radius:10px;border:1px solid #e2e8f0;">
              <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;cursor:pointer;">
                <input type="checkbox" id="cfRecordedChk" ${cf.recordedInLedger ? 'checked' : ''} />
                <span>🧾 办卡/充值费用已记入家庭账单流水</span>
              </label>
              <div style="font-size:11px;color:#64748b;margin-top:4px;">开启后，每次扣减该卡消费时会自动提示「无需重复记入账单」，避免一笔钱扣两次预算。</div>
            </div>
          `
          }

          <button type="button" class="btn-primary" id="saveCardBtn">
            ${cf.editingId ? '💾 保存卡片修改' : '✅ 确认存入会员卡包'}
          </button>
        </section>
      `
          : ''
      }

      <!-- 会员储值卡列表 -->
      <section class="card">
        <div class="card-header">
          <div>
            <div class="card-title">🗂️ 会员储值卡明细 (${filteredCards.length}张)</div>
            <div class="card-subtitle">支持扣减余额/划次、续充延期、到期自动预警与云同步</div>
          </div>
          ${!cf.open ? `<button type="button" class="btn-secondary" data-action="toggleCardForm">+ 记新卡</button>` : ''}
        </div>

        <div class="search-bar-wrap">
          <span class="search-icon">🔍</span>
          <input type="text" class="search-input" id="cardSearchInput" placeholder="搜索店名、卡名、手机号备注..." value="${escHtml(flt.keyword)}" />
        </div>

        <div class="chip-grid" style="margin-bottom:14px;">
          ${[
            ['active', `全部在用 (${cr.activeCount})`],
            ['stored', '💰 储值卡'],
            ['times', '🔢 计次卡'],
            ['period', '📅 期限会员'],
            ['alert', `⚠️ 临期/过期 (${cr.alertCount})`],
            ['inactive', `已用完/归档 (${cr.inactiveCount})`]
          ]
            .map(
              ([k, label]) =>
                `<button type="button" class="chip ${flt.type === k ? 'active' : ''}" data-cflt="${k}">${label}</button>`
            )
            .join('')}
        </div>

        ${
          filteredCards.length === 0
            ? `
          <div style="text-align:center;padding:32px 12px;color:#94a3b8;font-size:13px;">
            <div style="font-size:32px;margin-bottom:8px;">💳</div>
            <div>当前分类下还没有会员储值卡记录</div>
            <div style="margin-top:10px;">
              <button type="button" class="btn-secondary" data-action="toggleCardForm">+ 添加第一张储值卡/会员卡</button>
            </div>
          </div>
        `
            : filteredCards
                .map((c) => {
                  const isExp = !!state.expandedCardIds[c.id];
                  const cardCls = c.isInactive
                    ? 'inactive'
                    : c.isExpired
                    ? 'expired'
                    : c.isExpiringSoon
                    ? 'urgent'
                    : '';

                  let mainValHtml = '';
                  let rightMetaHtml = '';
                  if (c.cardType === 'stored') {
                    mainValHtml = `<div class="mcard-rem-big">余额 ¥${fmtCardAmt(c.remainingValue)}</div>`;
                    rightMetaHtml = `
                      <div>实付价格 <strong>¥${fmtCardAmt(c.price)}</strong>${c.totalValue !== c.price ? ` · 面额 ¥${fmtCardAmt(c.totalValue)}` : ''}</div>
                      ${c.valueHint ? `<div style="color:#0f766e;font-weight:600;">${escHtml(c.valueHint)}</div>` : ''}
                    `;
                  } else if (c.cardType === 'times') {
                    mainValHtml = `<div class="mcard-rem-big">剩余 ${fmtCardAmt(c.remainingValue)} 次</div>`;
                    rightMetaHtml = `
                      <div>实付价格 <strong>¥${fmtCardAmt(c.price)}</strong> · 共 ${fmtCardAmt(c.totalValue)} 次</div>
                      ${c.valueHint ? `<div style="color:#0f766e;font-weight:600;">${escHtml(c.valueHint)}</div>` : ''}
                    `;
                  } else {
                    mainValHtml = `<div class="mcard-rem-big" style="font-size:17px;">${c.isExpired ? '已到期' : '会员有效中'}</div>`;
                    rightMetaHtml = `
                      <div>开通价格 <strong>¥${fmtCardAmt(c.price)}</strong></div>
                      ${c.valueHint ? `<div style="color:#0f766e;font-weight:600;">${escHtml(c.valueHint)}</div>` : ''}
                    `;
                  }

                  const progLevel = c.isExpired ? 'danger' : c.isExpiringSoon ? 'warn' : 'ok';

                  return `
                  <div class="mcard-item ${cardCls}">
                    <div class="mcard-head">
                      <div class="mcard-title-row">
                        <span class="mcard-name">${escHtml(c.name)}</span>
                        ${ownerBadge(c.owner)}
                        <span class="badge badge-info">${typeLabel(c.cardType)}</span>
                        ${
                          c.recordedInLedger
                            ? `<span class="badge badge-ok" title="充卡实付已计入家庭账单，扣消费无需重复记账">🧾 已入账单</span>`
                            : `<span class="badge" style="background:#f1f5f9;color:#64748b;" title="充卡时未记入账单，可在扣消费时按次同步记入账单">未记账单</span>`
                        }
                        ${c.isDepleted ? `<span class="badge badge-danger">已用完</span>` : ''}
                        ${c.archived ? `<span class="badge badge-info">已归档</span>` : ''}
                      </div>
                      <span class="badge ${expiryBadgeClass(c.expiryLevel)}" style="flex-shrink:0;">${c.expiryBadgeText}</span>
                    </div>

                    <div class="mcard-main-nums">
                      ${mainValHtml}
                      <div class="mcard-price-meta">${rightMetaHtml}</div>
                    </div>

                    <div class="progress-track" style="height:7px;">
                      <div class="progress-fill ${progLevel}" style="width:${c.remainPct}%"></div>
                    </div>

                    <div class="mcard-meta-lines">
                      <div>📅 充卡日: ${c.openDate || '--'} &nbsp;|&nbsp; ⏳ 保质期: <strong>${c.expiryDate ? c.expiryDate : '长期有效'}</strong></div>
                      ${c.note ? `<div>📌 备注: ${escHtml(c.note)}</div>` : ''}
                    </div>

                    <div class="mcard-actions">
                      ${
                        c.cardType === 'stored' && !c.archived
                          ? `<button type="button" class="mcard-btn-use" data-card-use="${c.id}">💸 扣消费</button>`
                          : ''
                      }
                      ${
                        c.cardType === 'times' && !c.archived
                          ? `<button type="button" class="mcard-btn-use" data-card-use="${c.id}">✂️ 划次消费</button>`
                          : ''
                      }
                      <button type="button" class="mcard-btn-topup" data-card-topup="${c.id}">
                        ${c.cardType === 'period' ? '🔄 续费延期' : '➕ 续充/延期'}
                      </button>
                      <button type="button" class="btn-secondary" style="padding:4px 8px;font-size:11px;" data-card-logs="${c.id}">
                        📋 记录(${c.logs.length})
                      </button>
                      <button type="button" class="btn-secondary" style="padding:4px 8px;font-size:11px;" data-card-edit="${c.id}">编辑</button>
                      <button type="button" class="btn-secondary" style="padding:4px 8px;font-size:11px;" data-card-archive="${c.id}">
                        ${c.archived ? '恢复' : '归档'}
                      </button>
                      <button type="button" class="btn-danger-sm" data-card-del="${c.id}">删除</button>
                    </div>

                    ${
                      isExp
                        ? `
                      <div class="mcard-logs-box">
                        <div style="font-weight:700;margin-bottom:4px;color:#334155;">📋 充值与使用记录</div>
                        ${
                          c.logs.length === 0
                            ? `<div>暂无变动记录</div>`
                            : c.logs
                                .slice()
                                .reverse()
                                .map((lg) => {
                                  const unit = c.cardType === 'times' ? '次' : '元';
                                  const sign = lg.delta > 0 ? '+' : '';
                                  return `
                                  <div class="mcard-log-row">
                                    <span>${lg.date || ''} · ${escHtml(lg.note || lg.action || '')}</span>
                                    <span style="font-weight:700;color:${lg.delta < 0 ? '#ef4444' : '#0f766e'};">
                                      ${lg.delta !== null && lg.delta !== undefined ? `${sign}${fmtCardAmt(lg.delta)}${unit}` : ''}
                                      ${lg.afterRemaining !== undefined && lg.afterRemaining !== null && c.cardType !== 'period' ? ` (余${fmtCardAmt(lg.afterRemaining)}${unit})` : ''}
                                    </span>
                                  </div>
                                `;
                                })
                                .join('')
                        }
                      </div>
                    `
                        : ''
                    }
                  </div>
                `;
                })
                .join('')
        }

        ${
          cr.totalCount > 0
            ? `
          <div style="margin-top:12px;">
            <button type="button" class="btn-secondary" style="width:100%;" data-action="exportCardsCsv">
              📊 导出会员储值卡明细表 (.csv)
            </button>
          </div>
        `
            : ''
        }
      </section>
    `;
  }

  // ==================== 主渲染与事件绑定 ====================
  function render() {
    const report = Engine.computeFullReport(state.data, state.activePeriod);
    const main = document.getElementById('mainView');
    if (!main) return;

    updateTabBarUI(report);
    syncPeriodBarUI();

    if (state.currentTab === 'dashboard') main.innerHTML = renderDashboard(report);
    else if (state.currentTab === 'add') main.innerHTML = renderAdd(report);
    else if (state.currentTab === 'ledger') main.innerHTML = renderLedger(report);
    else if (state.currentTab === 'dengbao') main.innerHTML = renderDengbao(report);
    else if (state.currentTab === 'cards') main.innerHTML = renderCards(report);
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
        state.addForm.budgetItemId = '';
        state.addForm.explicitNoBudgetItem = false;
        updateTabBarUI();
        render();
      };
    });

    // 发薪后一键金蛋打卡存入（移动端抽屉面板）
    main.querySelectorAll('[data-action="quickDepositGolden"]').forEach((btn) => {
      btn.onclick = () => {
        const m = btn.dataset.member;
        const mAlloc = report.currentAllocation[m];
        const stillNeed = mAlloc && mAlloc.goldenEggStillNeed ? Math.round(mAlloc.goldenEggStillNeed) : 0;
        const defaultAmt = stillNeed > 0 ? stillNeed : 2000;
        const todayStr = getTodayStr();
        const defDate =
          todayStr >= report.periodRange.startDate && todayStr <= report.periodRange.endDate
            ? todayStr
            : report.periodRange.startDate;

        openBottomSheet({
          title: `🥚 ${m.toUpperCase()} 本期金蛋存入打卡`,
          subtitle: `${state.activePeriod} 账期 · 固定金蛋 + 上期结余补足`,
          banner: {
            level: 'info',
            html: `本期应存合计 <strong>¥${fm(mAlloc?.goldenEggTotal || 2000, false)}</strong> &nbsp;|&nbsp; 当前还需存入 <strong>¥${fm(stillNeed, false)}</strong>`
          },
          submitText: '🥚 确认打卡存入',
          fields: [
            {
              key: 'amount',
              label: '本次实际存入金额（元，支持加减算式）',
              type: 'math',
              value: String(defaultAmt),
              quickChips: [
                ...(stillNeed > 0 && stillNeed !== 2000 ? [{ label: `还需 ¥${stillNeed}`, value: String(stillNeed) }] : []),
                { label: '保底 ¥2000', value: '2000' }
              ]
            },
            {
              key: 'date',
              label: '存入日期',
              type: 'date',
              value: defDate
            },
            {
              key: 'note',
              label: '备注说明',
              type: 'text',
              value: `${state.activePeriod}账期金蛋存入打卡`
            }
          ],
          onSubmit: (vals, showError) => {
            const num = evalMathAmount(vals.amount);
            if (isNaN(num) || num <= 0) {
              showError('请输入大于 0 的有效存入金额');
              return false;
            }
            state.data.transactions[m].push({
              id: 'tx_' + Date.now(),
              date: vals.date || report.periodRange.startDate,
              amount: Engine.round2(num),
              type: '存入',
              purpose: '金蛋',
              category: '预算结余转存',
              note: (vals.note || '').trim() || `${state.activePeriod}账期金蛋存入打卡`,
              updatedAt: new Date().toISOString()
            });
            saveData();
            render();
            showToast(`🥚 已记入 ${m.toUpperCase()} 金蛋存入 ¥${fm(num, false)}`);
          }
        });
      };
    });

    // 许愿池储蓄打卡存入（移动端抽屉面板）
    main.querySelectorAll('[data-action="quickDepositWish"]').forEach((btn) => {
      btn.onclick = () => {
        const prefRole = localStorage.getItem(PREF_ROLE_KEY) === 'q' ? 'q' : 'c';
        const cMonth = Math.round(report.budgets.c.wishMonthly || 0);
        const qMonth = Math.round(report.budgets.q.wishMonthly || 0);
        const todayStr = getTodayStr();
        const defDate =
          todayStr >= report.periodRange.startDate && todayStr <= report.periodRange.endDate
            ? todayStr
            : report.periodRange.startDate;

        openBottomSheet({
          title: '✨ 许愿池专户储蓄打卡',
          subtitle: '将当月预留的许愿池资金存入专户，实时追踪心愿池余额',
          banner: {
            level: 'info',
            html: `月度许愿池预留参考：<strong>c ¥${fm(cMonth, false)}/月</strong> · <strong>q ¥${fm(qMonth, false)}/月</strong>`
          },
          submitText: '✨ 确认存入许愿池',
          fields: [
            {
              key: 'member',
              label: '存入成员',
              type: 'chips',
              value: prefRole,
              options: [
                { label: `👦 c（月预留 ¥${fm(cMonth, false)}）`, value: 'c' },
                { label: `👧 q（月预留 ¥${fm(qMonth, false)}）`, value: 'q' }
              ]
            },
            {
              key: 'amount',
              label: '本次存入许愿池金额（元）',
              type: 'math',
              value: String((prefRole === 'q' ? qMonth : cMonth) || 500)
            },
            {
              key: 'date',
              label: '存入日期',
              type: 'date',
              value: defDate
            },
            {
              key: 'note',
              label: '备注说明',
              type: 'text',
              value: `${state.activePeriod}账期许愿池存入打卡`
            }
          ],
          onFieldChange: (key, val, allVals) => {
            if (key === 'member') {
              const targetDef = val === 'q' ? qMonth : cMonth;
              if (targetDef > 0) allVals.amount = String(targetDef);
            }
          },
          onSubmit: (vals, showError) => {
            const m = vals.member === 'q' ? 'q' : 'c';
            const num = evalMathAmount(vals.amount);
            if (isNaN(num) || num <= 0) {
              showError('请输入大于 0 的有效存入金额');
              return false;
            }
            state.data.transactions[m].push({
              id: 'tx_' + Date.now(),
              date: vals.date || defDate,
              amount: Engine.round2(num),
              type: '存入',
              purpose: '许愿池',
              category: '预算结余转存',
              note: (vals.note || '').trim() || `${state.activePeriod}账期许愿池存入打卡`,
              updatedAt: new Date().toISOString()
            });
            saveData();
            render();
            showToast(`✨ 已记入 ${m.toUpperCase()} 许愿池存入 ¥${fm(num, false)}`);
          }
        });
      };
    });

    main.querySelectorAll('[data-action="quickAddDengbao"]').forEach((btn) => {
      btn.onclick = () => {
        state.currentTab = 'add';
        state.addForm.role = 'dengbao';
        state.addForm.type = '支出';
        state.addForm.category = '孩子用品';
        state.addForm.budgetItemId = '';
        state.addForm.explicitNoBudgetItem = false;
        updateTabBarUI();
        render();
      };
    });

    // 期初校正与固定金蛋抽屉设置（一次打开修改全部4项，告别连弹4次弹窗）
    main.querySelectorAll('[data-action="openPeriodOverride"]').forEach((btn) => {
      btn.onclick = () => {
        const pKey = state.activePeriod;
        const ov = (state.data.settings.periodOverrides[pKey] = state.data.settings.periodOverrides[pKey] || {
          c: { initAdjust: null, fixedGoldenEgg: 2000 },
          q: { initAdjust: null, fixedGoldenEgg: 2000 }
        });

        openBottomSheet({
          title: `⚙️ ${pKey} 账期分配参数设置`,
          subtitle: '设置当期固定金蛋保底与期初零花钱手工校正（留空则自动滚存上期结余）',
          submitText: '💾 保存当期参数',
          fields: [
            {
              key: 'cFg',
              label: '👦 c 固定金蛋（元）',
              type: 'math',
              half: true,
              value: String(ov.c?.fixedGoldenEgg ?? 2000)
            },
            {
              key: 'qFg',
              label: '👧 q 固定金蛋（元）',
              type: 'math',
              half: true,
              value: String(ov.q?.fixedGoldenEgg ?? 2000)
            },
            {
              key: 'cAdj',
              label: '👦 c 期初零花钱校正',
              type: 'text',
              half: true,
              placeholder: '留空自动滚存上期',
              value: ov.c?.initAdjust !== null && ov.c?.initAdjust !== undefined ? String(ov.c.initAdjust) : ''
            },
            {
              key: 'qAdj',
              label: '👧 q 期初零花钱校正',
              type: 'text',
              half: true,
              placeholder: '留空自动滚存上期',
              value: ov.q?.initAdjust !== null && ov.q?.initAdjust !== undefined ? String(ov.q.initAdjust) : ''
            }
          ],
          onSubmit: (vals, showError) => {
            const cFgNum = vals.cFg === '' ? 0 : evalMathAmount(vals.cFg);
            const qFgNum = vals.qFg === '' ? 0 : evalMathAmount(vals.qFg);
            if (isNaN(cFgNum) || cFgNum < 0 || isNaN(qFgNum) || qFgNum < 0) {
              showError('固定金蛋金额请填写非负有效数字');
              return false;
            }
            const cAdjClean = String(vals.cAdj ?? '').trim();
            const qAdjClean = String(vals.qAdj ?? '').trim();
            const cAdjNum = cAdjClean === '' ? null : evalMathAmount(cAdjClean);
            const qAdjNum = qAdjClean === '' ? null : evalMathAmount(qAdjClean);
            if ((cAdjClean !== '' && isNaN(cAdjNum)) || (qAdjClean !== '' && isNaN(qAdjNum))) {
              showError('期初校正请填写有效数字（或留空使用自动滚存）');
              return false;
            }

            ov.c = { fixedGoldenEgg: cFgNum, initAdjust: cAdjNum };
            ov.q = { fixedGoldenEgg: qFgNum, initAdjust: qAdjNum };
            saveData();
            render();
            showToast('✅ 已更新当期分配参数');
          }
        });
      };
    });

    // 记一笔表单事件
    main.querySelectorAll('[data-role]').forEach((btn) => {
      btn.onclick = () => {
        state.addForm.role = btn.dataset.role;
        state.addForm.budgetItemId = '';
        state.addForm.explicitNoBudgetItem = false;
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
          state.addForm.budgetItemId = '';
          state.addForm.explicitNoBudgetItem = false;
        }
        render();
      };
    });

    main.querySelectorAll('[data-purpose]').forEach((btn) => {
      btn.onclick = () => {
        state.addForm.purpose = btn.dataset.purpose;
        state.addForm.budgetItemId = '';
        state.addForm.explicitNoBudgetItem = false;
        render();
      };
    });

    main.querySelectorAll('[data-bitem]').forEach((btn) => {
      btn.onclick = () => {
        const bId = btn.dataset.bitem || '';
        state.addForm.budgetItemId = bId;
        state.addForm.explicitNoBudgetItem = bId === '';
        if (bId && (state.addForm.role === 'c' || state.addForm.role === 'q')) {
          const srcList =
            state.addForm.purpose === '必要开支'
              ? state.data.necessaryBudgets[state.addForm.role] || []
              : state.data.wishBudgets[state.addForm.role] || [];
          const found = srcList.find((x) => x.id === bId);
          if (found && (!state.addForm.category || state.addForm.category === '餐饮外卖')) {
            const suggested = suggestCategoryForBudgetItem(found.name, state.addForm.purpose);
            if (suggested && (state.data.categories || []).includes(suggested)) {
              state.addForm.category = suggested;
            }
          }
        }
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
            state.addForm.budgetItemId = '';
            state.addForm.explicitNoBudgetItem = false;
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
        const isDb = state.addForm.role === 'dengbao';
        openBottomSheet({
          title: `🏷️ 新增${isDb ? '噔宝' : '账本'}分类标签`,
          subtitle: '新增后将自动加入分类快捷列表并同步云端',
          submitText: '➕ 确认添加',
          fields: [
            {
              key: 'name',
              label: '分类名称',
              type: 'text',
              placeholder: isDb ? '例如：早教绘本、疫苗体检' : '例如：物业水电、宠物开销',
              value: ''
            }
          ],
          onSubmit: (vals, showError) => {
            const clean = (vals.name || '').trim();
            if (!clean) {
              showError('请输入分类名称');
              return false;
            }
            const targetArr = isDb ? state.data.dengbaoCategories : state.data.categories;
            if (!targetArr.includes(clean)) {
              targetArr.push(clean);
            }
            state.addForm.category = clean;
            saveData();
            render();
            showToast(`🏷️ 已添加分类「${clean}」`);
          }
        });
      };
    });

    main.querySelectorAll('[data-action="cancelEdit"]').forEach((btn) => {
      btn.onclick = () => {
        state.addForm.editingId = null;
        state.addForm.editingRole = null;
        state.addForm.amount = '';
        state.addForm.note = '';
        state.addForm.budgetItemId = '';
        state.addForm.explicitNoBudgetItem = false;
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
            alert(err);
            return;
          }
          state.data.transactions.dengbao.push(item);
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
          if ((f.type === '支出' || f.type === '退款') && (f.purpose === '必要开支' || f.purpose === '许愿池')) {
            if (f.budgetItemId) {
              const srcList =
                f.purpose === '必要开支'
                  ? state.data.necessaryBudgets[f.role] || []
                  : state.data.wishBudgets[f.role] || [];
              const subObj = srcList.find((x) => x.id === f.budgetItemId);
              item.budgetItemId = f.budgetItemId;
              if (subObj) item.budgetItemName = subObj.name;
            } else if (f.explicitNoBudgetItem) {
              item.budgetItemId = '';
            }
          }
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
        state.addForm.budgetItemId = '';
        state.addForm.explicitNoBudgetItem = false;
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
        const enriched =
          role === 'c' || role === 'q' ? (report.transactions[role] || []).find((t) => t.id === id) : null;
        const initBudgetItemId =
          target.budgetItemId !== undefined && target.budgetItemId !== null
            ? target.budgetItemId
            : enriched?.resolvedBudgetItemId || '';
        state.addForm = {
          role,
          date: target.date,
          amount: target.amount,
          type: target.type,
          purpose: target.purpose || '日常',
          budgetItemId: initBudgetItemId,
          explicitNoBudgetItem: target.budgetItemId === '',
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

    // 噔宝额外额度调整（抽屉面板）
    main.querySelectorAll('[data-action="setDengbaoExtra"]').forEach((btn) => {
      btn.onclick = () => {
        const pKey = state.activePeriod;
        const ov = (state.data.settings.periodOverrides[pKey] = state.data.settings.periodOverrides[pKey] || {});
        openBottomSheet({
          title: `👶 ${pKey} 账期噔宝追加额度`,
          subtitle: '除每月基础预留额度外，可为当月设置额外追加预算（如首期 3200 元）',
          submitText: '💾 保存额度',
          fields: [
            {
              key: 'extra',
              label: '当期额外追加额度（元）',
              type: 'math',
              value: String(ov.dengbaoExtraQuota || 0),
              quickChips: [
                { label: '无追加 (¥0)', value: '0' },
                { label: '¥1000', value: '1000' },
                { label: '首期 ¥3200', value: '3200' }
              ]
            }
          ],
          onSubmit: (vals, showError) => {
            const num = vals.extra === '' ? 0 : evalMathAmount(vals.extra);
            if (isNaN(num)) {
              showError('请输入有效的金额数字');
              return false;
            }
            ov.dengbaoExtraQuota = num;
            saveData();
            render();
            showToast('✅ 已更新噔宝当期额度');
          }
        });
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
        const bRole = state.budgetRole;
        openBottomSheet({
          title: `➕ 新增 ${bRole.toUpperCase()} 必要开支预算项`,
          subtitle: '新增后可在「记一笔 → 必要开支」中直接点选该子项进行精准对账',
          submitText: '✅ 确认新增',
          fields: [
            {
              key: 'name',
              label: '项目名称（必填）',
              type: 'text',
              placeholder: '例如：物业费、电费、商业保险',
              value: ''
            },
            {
              key: 'amt',
              label: '年度预算金额（元，抵减项可填负数）',
              type: 'math',
              placeholder: '例如：1200（留空表示暂不计入总额）',
              value: '1200'
            }
          ],
          onSubmit: (vals, showError) => {
            const cleanName = (vals.name || '').trim();
            if (!cleanName) {
              showError('请填写必要开支项目名称');
              return false;
            }
            const rawAmt = String(vals.amt ?? '').trim();
            const parsedAmt = rawAmt === '' ? null : evalMathAmount(rawAmt);
            if (rawAmt !== '' && isNaN(parsedAmt)) {
              showError('请填写有效的年度预算金额（或留空）');
              return false;
            }
            state.data.necessaryBudgets[bRole].push({
              id: 'nec_' + Date.now(),
              name: cleanName,
              annualBudget: parsedAmt,
              oldSpent: null
            });
            saveData();
            render();
            showToast('✅ 已新增必要开支预算项');
          }
        });
      };
    });

    main.querySelectorAll('[data-edit-nec]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.editNec;
        const item = state.data.necessaryBudgets[state.budgetRole].find((x) => x.id === id);
        if (!item) return;
        const isDengbaoItem = item.name === '噔宝';
        openBottomSheet({
          title: `✏️ 编辑必要开支项「${escHtml(item.name)}」`,
          subtitle: isDengbaoItem
            ? '「噔宝」子项会自动汇总噔宝专表中由该成员付款的净支出'
            : '修改项目名称或年度预算额度（留空表示暂不计入总额）',
          submitText: '💾 保存修改',
          fields: [
            {
              key: 'name',
              label: '项目名称',
              type: isDengbaoItem ? 'readonly' : 'text',
              value: item.name || ''
            },
            {
              key: 'amt',
              label: '年度预算金额（元，抵减项可填负数）',
              type: 'math',
              placeholder: '留空表示暂不计入',
              value: item.annualBudget !== null && item.annualBudget !== undefined ? String(item.annualBudget) : ''
            }
          ],
          onSubmit: (vals, showError) => {
            const cleanName = isDengbaoItem ? '噔宝' : (vals.name || '').trim();
            if (!cleanName) {
              showError('项目名称不能为空');
              return false;
            }
            const rawAmt = String(vals.amt ?? '').trim();
            const parsedAmt = rawAmt === '' ? null : evalMathAmount(rawAmt);
            if (rawAmt !== '' && isNaN(parsedAmt)) {
              showError('请输入有效的数字金额（或留空）');
              return false;
            }
            item.name = cleanName;
            item.annualBudget = parsedAmt;
            saveData();
            render();
            showToast('✅ 已更新必要开支预算');
          }
        });
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
        const bRole = state.budgetRole;
        openBottomSheet({
          title: `✨ 新增 ${bRole.toUpperCase()} 许愿池愿望`,
          subtitle: '设置心愿目标与分摊月数，系统自动计算每月应预留心愿金',
          submitText: '✨ 确认许愿',
          fields: [
            {
              key: 'name',
              label: '愿望名称（必填）',
              type: 'text',
              placeholder: '例如：日本旅行、新相机、演唱会门票',
              value: ''
            },
            {
              key: 'amt',
              label: '年度目标金额（元）',
              type: 'math',
              half: true,
              value: '3000'
            },
            {
              key: 'months',
              label: '分摊月数',
              type: 'number',
              half: true,
              value: '12',
              quickChips: [
                { label: '6个月', value: '6' },
                { label: '12个月', value: '12' }
              ]
            },
            {
              key: 'note',
              label: '心愿备注（选填）',
              type: 'text',
              placeholder: '例如：预计明年五一出行',
              value: ''
            }
          ],
          onSubmit: (vals, showError) => {
            const cleanName = (vals.name || '').trim();
            if (!cleanName) {
              showError('请填写愿望名称');
              return false;
            }
            const rawAmt = String(vals.amt ?? '').trim();
            const parsedAmt = rawAmt === '' ? null : evalMathAmount(rawAmt);
            if (rawAmt !== '' && (isNaN(parsedAmt) || parsedAmt < 0)) {
              showError('请填写有效的非负目标金额');
              return false;
            }
            const mNum = Math.max(1, Math.round(Number(vals.months) || 12));
            state.data.wishBudgets[bRole].push({
              id: 'wish_' + Date.now(),
              name: cleanName,
              annualQuota: parsedAmt,
              months: mNum,
              note: (vals.note || '').trim()
            });
            saveData();
            render();
            showToast('✨ 已新增许愿池愿望');
          }
        });
      };
    });

    main.querySelectorAll('[data-edit-wish]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.editWish;
        const item = state.data.wishBudgets[state.budgetRole].find((x) => x.id === id);
        if (!item) return;
        openBottomSheet({
          title: `✏️ 编辑愿望「${escHtml(item.name)}」`,
          subtitle: '调整心愿年度额度与分摊月数',
          submitText: '💾 保存愿望',
          fields: [
            {
              key: 'name',
              label: '愿望名称',
              type: 'text',
              value: item.name || ''
            },
            {
              key: 'amt',
              label: '年度目标金额（元）',
              type: 'math',
              half: true,
              placeholder: '留空暂不计入',
              value: item.annualQuota !== null && item.annualQuota !== undefined ? String(item.annualQuota) : ''
            },
            {
              key: 'months',
              label: '分摊月数',
              type: 'number',
              half: true,
              value: String(item.months || 12),
              quickChips: [
                { label: '6个月', value: '6' },
                { label: '12个月', value: '12' }
              ]
            },
            {
              key: 'note',
              label: '心愿备注（选填）',
              type: 'text',
              value: item.note || ''
            }
          ],
          onSubmit: (vals, showError) => {
            const cleanName = (vals.name || '').trim();
            if (!cleanName) {
              showError('愿望名称不能为空');
              return false;
            }
            const rawAmt = String(vals.amt ?? '').trim();
            const parsedAmt = rawAmt === '' ? null : evalMathAmount(rawAmt);
            if (rawAmt !== '' && (isNaN(parsedAmt) || parsedAmt < 0)) {
              showError('请填写有效的非负金额（或留空）');
              return false;
            }
            item.name = cleanName;
            item.annualQuota = parsedAmt;
            item.months = Math.max(1, Math.round(Number(vals.months) || 12));
            item.note = (vals.note || '').trim();
            saveData();
            render();
            showToast('✅ 已更新愿望配置');
          }
        });
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
        const fmtOpt = (v) => (v !== null && v !== undefined && v !== '' ? String(v) : '');
        openBottomSheet({
          title: '🏦 前期未录消费与年末实有资金设置',
          subtitle: '若全年流水均在本账本完整记录，前期未录消费请填 0；年末盘点时填入实有资金自动算出可转存额度',
          submitText: '💾 保存核算参数',
          fields: [
            {
              key: 'cNec',
              label: '👦 c 必要前期未录消费',
              type: 'math',
              half: true,
              placeholder: '已录全填 0',
              value: fmtOpt(ye.c?.priorNecessary ?? 0)
            },
            {
              key: 'qNec',
              label: '👧 q 必要前期未录消费',
              type: 'math',
              half: true,
              placeholder: '已录全填 0',
              value: fmtOpt(ye.q?.priorNecessary ?? 0)
            },
            {
              key: 'cWish',
              label: '👦 c 许愿池前期消费',
              type: 'math',
              half: true,
              placeholder: '已录全填 0',
              value: fmtOpt(ye.c?.priorWish ?? 0)
            },
            {
              key: 'qWish',
              label: '👧 q 许愿池前期消费',
              type: 'math',
              half: true,
              placeholder: '已录全填 0',
              value: fmtOpt(ye.q?.priorWish ?? 0)
            },
            {
              key: 'cActual',
              label: '👦 c 年末专户实有资金',
              type: 'math',
              half: true,
              placeholder: '年末盘点时填写',
              value: fmtOpt(ye.c?.actualYearEndFunds)
            },
            {
              key: 'qActual',
              label: '👧 q 年末专户实有资金',
              type: 'math',
              half: true,
              placeholder: '年末盘点时填写',
              value: fmtOpt(ye.q?.actualYearEndFunds)
            }
          ],
          onSubmit: (vals, showError) => {
            const parseOpt = (raw) => {
              const s = String(raw ?? '').trim();
              if (s === '') return null;
              return evalMathAmount(s);
            };
            const cNec = parseOpt(vals.cNec);
            const qNec = parseOpt(vals.qNec);
            const cWish = parseOpt(vals.cWish);
            const qWish = parseOpt(vals.qWish);
            const cAct = parseOpt(vals.cActual);
            const qAct = parseOpt(vals.qActual);
            if ([cNec, qNec, cWish, qWish, cAct, qAct].some((x) => x !== null && isNaN(x))) {
              showError('请填写有效的数字金额（未盘点项可留空）');
              return false;
            }
            ye.c = ye.c || {};
            ye.q = ye.q || {};
            ye.c.priorNecessary = cNec;
            ye.c.priorWish = cWish;
            ye.c.actualYearEndFunds = cAct;
            ye.q.priorNecessary = qNec;
            ye.q.priorWish = qWish;
            ye.q.actualYearEndFunds = qAct;
            saveData();
            render();
            showToast('✅ 已更新前期消费与年末核算参数');
          }
        });
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
          openBottomSheet({
            title: '🔗 老婆手机一键绑定链接',
            subtitle: '长按复制下方完整链接发给老婆，她在微信/浏览器点开即自动绑定云账本',
            submitText: '我知道了',
            hideCancel: true,
            fields: [
              {
                key: 'url',
                label: '专属绑定链接',
                type: 'readonly',
                value: shareUrl
              }
            ]
          });
        }
      };
    });

    main.querySelectorAll('[data-action="restoreCloudSnapshot"]').forEach((btn) => {
      btn.onclick = async () => {
        const cfg = state.cloudCfg;
        if (!(cfg.provider === 'github' || cfg.provider === 'gitee') || !cfg.token || !cfg.gistId) {
          alert('请先完成 GitHub / Gitee 云端同步配置！');
          return;
        }
        showToast('⏳ 正在读取云端历史快照列表...');
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
          if (!res.ok) throw new Error('拉取失败');
          const gist = await res.json();
          const files = gist.files || {};
          const snapKeys = Object.keys(files)
            .filter((k) => k.startsWith('z_snapshot_') && k.endsWith('.json'))
            .sort()
            .reverse();

          if (snapKeys.length === 0) {
            alert('当前云端暂未生成历史快照文件。每次正常同步保存时，系统会自动按月归档快照。');
            return;
          }

          const options = snapKeys.map((k) => {
            let label = k.replace(/^z_snapshot_/, '').replace(/\.json$/, '');
            try {
              const parsed = files[k].content ? JSON.parse(files[k].content) : null;
              const txCount = parsed?.transactions
                ? (parsed.transactions.c?.length || 0) +
                  (parsed.transactions.q?.length || 0) +
                  (parsed.transactions.dengbao?.length || 0)
                : 0;
              if (k.includes('_before_reset')) {
                label = `🛡️ 重置前自动保护备份 (${txCount}笔流水)`;
              } else {
                const mMatch = k.match(/(\d{4}-\d{2})\.json$/);
                label = `📅 ${mMatch ? mMatch[1] + ' 账期快照' : label} (${txCount}笔流水)`;
              }
            } catch (e) {}
            return { label, value: k };
          });

          openBottomSheet({
            title: '🕰️ 从云端历史快照恢复',
            subtitle: '恢复前系统仍会先保护当前状态，防止误操作丢失数据',
            submitText: '🔄 确认恢复所选快照',
            fields: [
              {
                key: 'snapKey',
                label: '选择要恢复的云端备份版本',
                type: 'chips',
                value: options[0].value,
                options
              }
            ],
            onSubmit: (vals, showError) => {
              const chosen = files[vals.snapKey];
              if (!chosen || !chosen.content) {
                showError('所选快照内容为空或需重新拉取');
                return false;
              }
              try {
                const snapObj = JSON.parse(chosen.content);
                if (!snapObj || !snapObj.transactions) {
                  showError('快照数据格式异常');
                  return false;
                }
                const preRestoreCopy = JSON.parse(JSON.stringify(state.data));
                state.data = normalizeLoadedData(snapObj);
                saveData(true, { forceOverwrite: true, preResetData: preRestoreCopy });
                render();
                showToast('✅ 已成功从云端快照恢复账本！');
              } catch (err) {
                showError('解析云端快照失败');
                return false;
              }
            }
          });
        } catch (e) {
          alert('读取云端快照失败，请检查网络连接与 Token 配置。');
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
        const rows = [['账本', '日期', '所属账期', '金额(元)', '收支类型', '用途/付款人', '对应预算子项', '分类标签', '备注说明']];
        const allTx = [
          ...report.transactions.c.map((t) => ['c记账', t.date, t.periodKey, t.amount, t.type, t.purpose, t.resolvedBudgetItemName || '', t.category || '', t.note || '']),
          ...report.transactions.q.map((t) => ['q记账', t.date, t.periodKey, t.amount, t.type, t.purpose, t.resolvedBudgetItemName || '', t.category || '', t.note || '']),
          ...report.transactions.dengbao.map((t) => ['噔宝支出', t.date, t.periodKey, t.amount, t.type, `${t.payer}付款`, '噔宝', t.category || '', t.note || ''])
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
                state.data = normalizeLoadedData(obj);
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

    // ==================== 会员储值卡明细交互事件 ====================
    function syncCardFormFromDOM() {
      const cf = state.cardForm;
      const nameEl = document.getElementById('cfNameInput');
      const priceEl = document.getElementById('cfPriceInput');
      const totalEl = document.getElementById('cfTotalInput');
      const remEl = document.getElementById('cfRemInput');
      const openEl = document.getElementById('cfOpenDateInput');
      const expEl = document.getElementById('cfExpiryDateInput');
      const noteEl = document.getElementById('cfNoteInput');
      const recEl = document.getElementById('cfRecordedChk');
      if (nameEl) cf.name = nameEl.value;
      if (priceEl) cf.price = priceEl.value;
      if (totalEl) cf.totalValue = totalEl.value;
      if (remEl) cf.remainingValue = remEl.value;
      if (openEl) cf.openDate = openEl.value;
      if (expEl) cf.expiryDate = expEl.value;
      if (noteEl) cf.note = noteEl.value;
      if (recEl) cf.recordedInLedger = !!recEl.checked;
    }

    main.querySelectorAll('[data-action="jumpCardsAlert"]').forEach((el) => {
      el.onclick = () => {
        state.currentTab = 'cards';
        state.cardFilter.type = 'alert';
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
    });

    main.querySelectorAll('[data-action="toggleCardForm"]').forEach((btn) => {
      btn.onclick = () => {
        if (state.cardForm.open) {
          state.cardForm = createEmptyCardForm();
        } else {
          state.cardForm = { ...createEmptyCardForm(), open: true };
        }
        render();
      };
    });

    main.querySelectorAll('[data-action="cancelCardForm"]').forEach((btn) => {
      btn.onclick = () => {
        state.cardForm = createEmptyCardForm();
        render();
      };
    });

    ['cfNameInput', 'cfPriceInput', 'cfTotalInput', 'cfRemInput', 'cfOpenDateInput', 'cfExpiryDateInput', 'cfNoteInput'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.oninput = syncCardFormFromDOM;
        el.onchange = syncCardFormFromDOM;
      }
    });

    main.querySelectorAll('[data-cftype]').forEach((btn) => {
      btn.onclick = () => {
        syncCardFormFromDOM();
        state.cardForm.cardType = btn.dataset.cftype;
        render();
      };
    });

    main.querySelectorAll('[data-cfowner]').forEach((btn) => {
      btn.onclick = () => {
        syncCardFormFromDOM();
        state.cardForm.owner = btn.dataset.cfowner;
        if (state.cardForm.owner === 'c' || state.cardForm.owner === 'q' || state.cardForm.owner === 'dengbao') {
          state.cardForm.ledgerRole = state.cardForm.owner;
        }
        render();
      };
    });

    main.querySelectorAll('[data-cfexp]').forEach((btn) => {
      btn.onclick = () => {
        syncCardFormFromDOM();
        const val = btn.dataset.cfexp;
        if (val === 'none') {
          state.cardForm.expiryDate = '';
        } else {
          const months = parseInt(val, 10) || 12;
          state.cardForm.expiryDate = addMonthsToDateStr(state.cardForm.openDate || getTodayStr(), months);
        }
        render();
      };
    });

    const syncChk = document.getElementById('cfSyncLedgerChk');
    if (syncChk) {
      syncChk.onchange = (e) => {
        syncCardFormFromDOM();
        state.cardForm.syncToLedger = e.target.checked;
        if (e.target.checked) state.cardForm.recordedInLedger = true;
        render();
      };
    }

    const recChk = document.getElementById('cfRecordedChk');
    if (recChk) {
      recChk.onchange = (e) => {
        syncCardFormFromDOM();
        state.cardForm.recordedInLedger = !!e.target.checked;
      };
    }

    main.querySelectorAll('[data-cf-lrole]').forEach((btn) => {
      btn.onclick = () => {
        syncCardFormFromDOM();
        state.cardForm.ledgerRole = btn.dataset.cfLrole;
        render();
      };
    });

    main.querySelectorAll('[data-cf-lpurp]').forEach((btn) => {
      btn.onclick = () => {
        syncCardFormFromDOM();
        state.cardForm.ledgerPurpose = btn.dataset.cfLpurp;
        render();
      };
    });

    const saveCardBtn = document.getElementById('saveCardBtn');
    if (saveCardBtn) {
      saveCardBtn.onclick = () => {
        syncCardFormFromDOM();
        const cf = state.cardForm;
        const cleanName = (cf.name || '').trim();
        if (!cleanName) {
          alert('请填写会员储值卡名称或商家店名！');
          return;
        }
        const priceNum = Number(cf.price || 0);
        if (isNaN(priceNum) || priceNum < 0) {
          alert('请填写有效的实付价格！');
          return;
        }

        let totalVal = priceNum;
        let remVal = priceNum;
        if (cf.cardType === 'stored') {
          totalVal = cf.totalValue !== '' && cf.totalValue !== null ? Number(cf.totalValue) : priceNum;
          if (isNaN(totalVal) || totalVal < 0) {
            alert('请填写有效的卡内到账面额！');
            return;
          }
          remVal = cf.remainingValue !== '' && cf.remainingValue !== null ? Number(cf.remainingValue) : totalVal;
          if (isNaN(remVal) || remVal < 0) {
            alert('请填写有效的剩余金额！');
            return;
          }
        } else if (cf.cardType === 'times') {
          totalVal = Number(cf.totalValue);
          if (!cf.totalValue || isNaN(totalVal) || totalVal <= 0) {
            alert('计次卡请填写有效的总次数！');
            return;
          }
          remVal = cf.remainingValue !== '' && cf.remainingValue !== null ? Number(cf.remainingValue) : totalVal;
          if (isNaN(remVal) || remVal < 0) {
            alert('请填写有效的剩余次数！');
            return;
          }
        } else {
          totalVal = priceNum;
          remVal = priceNum;
        }

        state.data.memberCards = Array.isArray(state.data.memberCards) ? state.data.memberCards : [];
        const nowIso = new Date().toISOString();

        if (cf.editingId) {
          const target = state.data.memberCards.find((x) => x.id === cf.editingId);
          if (target) {
            target.name = cleanName;
            target.cardType = cf.cardType;
            target.owner = cf.owner;
            target.price = Engine.round2(priceNum);
            target.totalValue = Engine.round2(totalVal);
            target.remainingValue = Engine.round2(remVal);
            target.openDate = cf.openDate || getTodayStr();
            target.expiryDate = cf.expiryDate || '';
            target.note = (cf.note || '').trim();
            target.recordedInLedger = !!cf.recordedInLedger;
            target.updatedAt = nowIso;
          }
          showToast('✅ 已保存会员储值卡修改');
        } else {
          const syncedToLedgerNow = !!(cf.syncToLedger && priceNum > 0);
          const newCard = {
            id: 'card_' + Date.now(),
            name: cleanName,
            cardType: cf.cardType,
            owner: cf.owner,
            price: Engine.round2(priceNum),
            totalValue: Engine.round2(totalVal),
            remainingValue: Engine.round2(remVal),
            openDate: cf.openDate || getTodayStr(),
            expiryDate: cf.expiryDate || '',
            note: (cf.note || '').trim(),
            recordedInLedger: !!(syncedToLedgerNow || cf.recordedInLedger),
            archived: false,
            updatedAt: nowIso,
            logs: [
              {
                id: 'clog_' + Date.now(),
                date: cf.openDate || getTodayStr(),
                action: '开卡充值',
                delta: cf.cardType === 'period' ? null : Engine.round2(remVal),
                paidPrice: Engine.round2(priceNum),
                afterRemaining: cf.cardType === 'period' ? null : Engine.round2(remVal),
                note: `首次办卡（实付 ¥${fm(priceNum, false)}${syncedToLedgerNow ? ' · 已同步记入账单' : ''}）`
              }
            ]
          };
          state.data.memberCards.push(newCard);

          // 可选：同步记入一笔家庭账单支出流水
          if (syncedToLedgerNow) {
            const txDate = cf.openDate || getTodayStr();
            const expText = cf.expiryDate ? `有效期至${cf.expiryDate}` : '长期有效';
            const curPref = localStorage.getItem(PREF_ROLE_KEY) === 'q' ? 'q' : 'c';
            if (cf.ledgerRole === 'dengbao') {
              state.data.transactions.dengbao.push({
                id: 'tx_' + Date.now(),
                date: txDate,
                amount: Engine.round2(priceNum),
                payer: curPref,
                type: '支出',
                category: '孩子用品',
                note: `[办卡] ${cleanName} (${expText})`,
                updatedAt: nowIso
              });
            } else {
              const role = cf.ledgerRole === 'q' ? 'q' : 'c';
              state.data.transactions[role].push({
                id: 'tx_' + Date.now(),
                date: txDate,
                amount: Engine.round2(priceNum),
                type: '支出',
                purpose: cf.ledgerPurpose || '日常',
                category: '订阅会员',
                note: `[办卡] ${cleanName} (${expText})`,
                updatedAt: nowIso
              });
            }
          }
          showToast('💳 已存入会员储值卡明细！');
        }

        state.cardForm = createEmptyCardForm();
        saveData();
        render();
      };
    }

    const cardSearchEl = document.getElementById('cardSearchInput');
    if (cardSearchEl) {
      cardSearchEl.oninput = (e) => {
        state.cardFilter.keyword = e.target.value;
        render();
        const nextEl = document.getElementById('cardSearchInput');
        if (nextEl) {
          nextEl.focus();
          nextEl.setSelectionRange(nextEl.value.length, nextEl.value.length);
        }
      };
    }

    main.querySelectorAll('[data-cflt]').forEach((btn) => {
      btn.onclick = () => {
        state.cardFilter.type = btn.dataset.cflt;
        render();
      };
    });

    // 扣减储值余额 / 划次消费（底部抽屉面板 + 已入账防重记保护）
    main.querySelectorAll('[data-card-use]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.cardUse;
        const card = (state.data.memberCards || []).find((x) => x.id === id);
        if (!card) return;
        const isTimes = card.cardType === 'times';
        const unit = isTimes ? '次' : '元';
        const curRem = Number(card.remainingValue) || 0;
        const isRecorded = !!(
          card.recordedInLedger ||
          (Array.isArray(card.logs) && card.logs.some((lg) => lg && String(lg.note || '').includes('已同步记入账单')))
        );
        const defRole =
          card.owner === 'c' || card.owner === 'q' || card.owner === 'dengbao'
            ? card.owner
            : localStorage.getItem(PREF_ROLE_KEY) === 'q'
            ? 'q'
            : 'c';
        const estUnitCost =
          isTimes && Number(card.totalValue) > 0 && Number(card.price) > 0
            ? Math.round(Number(card.price) / Number(card.totalValue))
            : '';

        openBottomSheet({
          title: `${isTimes ? '✂️ 划次消费' : '💸 储值卡扣款'} — ${escHtml(card.name)}`,
          subtitle: `当前卡内剩余：${fm(curRem, false)} ${unit}`,
          banner: isRecorded
            ? {
                level: 'ok',
                html: '🧾 <strong>防重复记账提醒：</strong>该卡充卡实付费用已在家庭账单入账，本次仅扣减卡内额度，<strong>无需再去账单重复记一笔支出！</strong>'
              }
            : {
                level: 'info',
                html: 'ℹ️ 该卡充卡时未记入账单流水。若你想按每次实际使用记入当月消费，可勾选下方同步开关。'
              },
          submitText: isTimes ? '✂️ 确认划次' : '💸 确认扣款',
          fields: [
            {
              key: 'deduct',
              label: `本次扣除${isTimes ? '次数（次）' : '卡内金额（元，支持加减算式）'}`,
              type: 'math',
              value: isTimes ? '1' : '',
              placeholder: isTimes ? '例如：1' : '请输入本次刷卡扣减金额',
              quickChips: isTimes
                ? [
                    { label: '划 1 次', value: '1' },
                    { label: '划 2 次', value: '2' }
                  ]
                : undefined
            },
            {
              key: 'date',
              label: '使用日期',
              type: 'date',
              value: getTodayStr()
            },
            {
              key: 'memo',
              label: '使用备注（选填）',
              type: 'text',
              placeholder: isTimes ? '例如：周末带娃游泳 / 剪发' : '例如：门店消费结账',
              value: ''
            },
            ...(isRecorded
              ? []
              : [
                  {
                    key: 'syncUseToLedger',
                    label: '同时把本次消费同步记入当期家庭账单流水',
                    type: 'checkbox',
                    value: false,
                    hint: '仅对充卡时未入账的旧卡按次记账时勾选'
                  },
                  ...(isTimes
                    ? [
                        {
                          key: 'ledgerAmt',
                          label: '折算记入账单金额（元）',
                          type: 'math',
                          value: estUnitCost ? String(estUnitCost) : '',
                          placeholder: '请输入本次划次对应的折算金额',
                          showWhen: (v) => !!v.syncUseToLedger
                        }
                      ]
                    : []),
                  {
                    key: 'ledgerRole',
                    label: '记入谁的账本',
                    type: 'chips',
                    value: defRole,
                    options: [
                      { label: '👦 c 记账', value: 'c' },
                      { label: '👧 q 记账', value: 'q' },
                      { label: '👶 噔宝支出', value: 'dengbao' }
                    ],
                    showWhen: (v) => !!v.syncUseToLedger
                  },
                  {
                    key: 'ledgerPurpose',
                    label: '账单资金用途',
                    type: 'chips',
                    value: '日常',
                    options: [
                      { label: '日常', value: '日常' },
                      { label: '必要开支', value: '必要开支' },
                      { label: '许愿池', value: '许愿池' }
                    ],
                    showWhen: (v) => !!v.syncUseToLedger && v.ledgerRole !== 'dengbao'
                  }
                ])
          ],
          onSubmit: (vals, showError) => {
            const deduct = evalMathAmount(vals.deduct);
            if (isNaN(deduct) || deduct <= 0) {
              showError(`请输入大于 0 的扣除${unit}数`);
              return false;
            }
            const useDate = vals.date || getTodayStr();
            const nowIso = new Date().toISOString();
            let txAmt = deduct;
            if (!isRecorded && vals.syncUseToLedger) {
              if (isTimes) {
                txAmt = evalMathAmount(vals.ledgerAmt);
                if (isNaN(txAmt) || txAmt <= 0) {
                  showError('请填写大于 0 的折算记账金额');
                  return false;
                }
              } else if (Number(card.totalValue) > 0 && Number(card.price) > 0 && card.totalValue !== card.price) {
                // 若充500送100，按实付折扣比例折算真实支出，更贴近实际花销
                txAmt = Engine.round2(deduct * (Number(card.price) / Number(card.totalValue)));
              }
            }

            card.remainingValue = Engine.round2(Math.max(0, curRem - deduct));
            card.updatedAt = nowIso;
            card.logs = Array.isArray(card.logs) ? card.logs : [];
            const cleanMemo = (vals.memo || '').trim();
            card.logs.push({
              id: 'clog_' + Date.now(),
              date: useDate,
              action: isTimes ? '划次消费' : '扣款消费',
              delta: -Engine.round2(deduct),
              afterRemaining: card.remainingValue,
              note:
                (cleanMemo || (isTimes ? '划次消费' : '卡内扣款')) +
                (!isRecorded && vals.syncUseToLedger ? `（已按 ¥${fm(txAmt, false)} 记账）` : '')
            });

            if (!isRecorded && vals.syncUseToLedger && txAmt > 0) {
              const curPref = localStorage.getItem(PREF_ROLE_KEY) === 'q' ? 'q' : 'c';
              const txNote = `[卡消] ${card.name}${cleanMemo ? ' · ' + cleanMemo : ''}`;
              if (vals.ledgerRole === 'dengbao') {
                state.data.transactions.dengbao.push({
                  id: 'tx_' + Date.now(),
                  date: useDate,
                  amount: Engine.round2(txAmt),
                  payer: curPref,
                  type: '支出',
                  category: '孩子用品',
                  note: txNote,
                  updatedAt: nowIso
                });
              } else {
                const role = vals.ledgerRole === 'q' ? 'q' : 'c';
                state.data.transactions[role].push({
                  id: 'tx_' + Date.now(),
                  date: useDate,
                  amount: Engine.round2(txAmt),
                  type: '支出',
                  purpose: vals.ledgerPurpose || '日常',
                  category: '其他',
                  note: txNote,
                  updatedAt: nowIso
                });
              }
            }

            saveData();
            render();
            showToast(`✅ 已扣 ${fm(deduct, false)}${unit}，剩余 ${fm(card.remainingValue, false)}${unit}`);
          }
        });
      };
    });

    // 续充 / 续期延期（底部抽屉面板 + 可选同步账单）
    main.querySelectorAll('[data-card-topup]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.cardTopup;
        const card = (state.data.memberCards || []).find((x) => x.id === id);
        if (!card) return;
        const baseExpDate =
          card.expiryDate && card.expiryDate > getTodayStr() ? card.expiryDate : getTodayStr();
        const suggestedExp = card.expiryDate ? addMonthsToDateStr(baseExpDate, 12) : '';
        const defRole =
          card.owner === 'c' || card.owner === 'q' || card.owner === 'dengbao'
            ? card.owner
            : localStorage.getItem(PREF_ROLE_KEY) === 'q'
            ? 'q'
            : 'c';

        openBottomSheet({
          title: `${card.cardType === 'period' ? '🔄 会员续费延期' : '➕ 储值卡续充 / 延期'} — ${escHtml(card.name)}`,
          subtitle: '支持单独免费延期（实付填 0）或续充值并同步记入家庭账单',
          submitText: '💳 确认保存续充',
          fields: [
            {
              key: 'paid',
              label: '本次续充实付价格（元，免费延期填 0）',
              type: 'math',
              half: card.cardType !== 'period',
              value: '0'
            },
            ...(card.cardType === 'stored'
              ? [
                  {
                    key: 'addVal',
                    label: '卡内新增到账面额（元）',
                    type: 'math',
                    half: true,
                    placeholder: '留空则默认等于实付金额',
                    value: ''
                  }
                ]
              : card.cardType === 'times'
              ? [
                  {
                    key: 'addVal',
                    label: '本次新增次数（次）',
                    type: 'number',
                    half: true,
                    value: '10'
                  }
                ]
              : []),
            {
              key: 'expiryDate',
              label: '更新后的保质期 / 有效期至（留空为长期有效）',
              type: 'date',
              value: suggestedExp,
              quickChips: [
                { label: '♾️ 长期有效', value: '' },
                { label: '+半年', value: addMonthsToDateStr(baseExpDate, 6) },
                { label: '+1年', value: addMonthsToDateStr(baseExpDate, 12) },
                { label: '+2年', value: addMonthsToDateStr(baseExpDate, 24) }
              ]
            },
            {
              key: 'syncTopupToLedger',
              label: '同时把本次续充实付金额记入当期家庭账单流水',
              type: 'checkbox',
              value: !!card.recordedInLedger,
              hint: '若实付金额大于 0，勾选后自动同步生成账单支出并标记「🧾 已入账单」'
            },
            {
              key: 'ledgerRole',
              label: '记入谁的账本',
              type: 'chips',
              value: defRole,
              options: [
                { label: '👦 c 记账', value: 'c' },
                { label: '👧 q 记账', value: 'q' },
                { label: '👶 噔宝支出', value: 'dengbao' }
              ],
              showWhen: (v) => !!v.syncTopupToLedger
            },
            {
              key: 'ledgerPurpose',
              label: '账单资金用途',
              type: 'chips',
              value: '日常',
              options: [
                { label: '日常', value: '日常' },
                { label: '必要开支', value: '必要开支' },
                { label: '许愿池', value: '许愿池' }
              ],
              showWhen: (v) => !!v.syncTopupToLedger && v.ledgerRole !== 'dengbao'
            }
          ],
          onSubmit: (vals, showError) => {
            const paid = String(vals.paid ?? '').trim() === '' ? 0 : evalMathAmount(vals.paid);
            if (isNaN(paid) || paid < 0) {
              showError('实付价格请填写非负数字');
              return false;
            }
            let addVal = 0;
            if (card.cardType === 'stored') {
              const rawAdd = String(vals.addVal ?? '').trim();
              addVal = rawAdd === '' ? paid : evalMathAmount(rawAdd);
              if (isNaN(addVal) || addVal < 0) {
                showError('新增到账面额请填写非负数字');
                return false;
              }
            } else if (card.cardType === 'times') {
              const rawAdd = String(vals.addVal ?? '').trim();
              addVal = rawAdd === '' ? 0 : evalMathAmount(rawAdd);
              if (isNaN(addVal) || addVal < 0) {
                showError('新增次数请填写非负数字');
                return false;
              }
            }

            const nowIso = new Date().toISOString();
            const todayStr = getTodayStr();
            card.expiryDate = String(vals.expiryDate ?? '').trim();
            card.price = Engine.round2((Number(card.price) || 0) + paid);
            if (card.cardType !== 'period' && addVal > 0) {
              card.totalValue = Engine.round2((Number(card.totalValue) || 0) + addVal);
              card.remainingValue = Engine.round2((Number(card.remainingValue) || 0) + addVal);
            }
            const syncedNow = !!(vals.syncTopupToLedger && paid > 0);
            if (syncedNow) {
              card.recordedInLedger = true;
            }
            card.archived = false;
            card.updatedAt = nowIso;
            card.logs = Array.isArray(card.logs) ? card.logs : [];
            card.logs.push({
              id: 'clog_' + Date.now(),
              date: todayStr,
              action: '续充延期',
              delta: card.cardType === 'period' ? null : Engine.round2(addVal),
              paidPrice: Engine.round2(paid),
              afterRemaining: card.cardType === 'period' ? null : card.remainingValue,
              note: `续充实付 ¥${fm(paid, false)}${card.expiryDate ? ' · 有效期至 ' + card.expiryDate : ' · 长期有效'}${syncedNow ? ' · 已同步记入账单' : ''}`
            });

            if (syncedNow) {
              const curPref = localStorage.getItem(PREF_ROLE_KEY) === 'q' ? 'q' : 'c';
              const expText = card.expiryDate ? `有效期至${card.expiryDate}` : '长期有效';
              if (vals.ledgerRole === 'dengbao') {
                state.data.transactions.dengbao.push({
                  id: 'tx_' + Date.now(),
                  date: todayStr,
                  amount: Engine.round2(paid),
                  payer: curPref,
                  type: '支出',
                  category: '孩子用品',
                  note: `[续卡] ${card.name} (${expText})`,
                  updatedAt: nowIso
                });
              } else {
                const role = vals.ledgerRole === 'q' ? 'q' : 'c';
                state.data.transactions[role].push({
                  id: 'tx_' + Date.now(),
                  date: todayStr,
                  amount: Engine.round2(paid),
                  type: '支出',
                  purpose: vals.ledgerPurpose || '日常',
                  category: '订阅会员',
                  note: `[续卡] ${card.name} (${expText})`,
                  updatedAt: nowIso
                });
              }
            }

            saveData();
            render();
            showToast('💳 已完成续充与保质期更新！');
          }
        });
      };
    });

    main.querySelectorAll('[data-card-logs]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.cardLogs;
        state.expandedCardIds[id] = !state.expandedCardIds[id];
        render();
      };
    });

    main.querySelectorAll('[data-card-edit]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.cardEdit;
        const card = (state.data.memberCards || []).find((x) => x.id === id);
        if (!card) return;
        const autoDetected =
          Array.isArray(card.logs) && card.logs.some((lg) => lg && String(lg.note || '').includes('已同步记入账单'));
        state.cardForm = {
          open: true,
          editingId: card.id,
          name: card.name || '',
          cardType: card.cardType || 'stored',
          owner: card.owner || 'family',
          price: card.price ?? '',
          totalValue: card.totalValue ?? '',
          remainingValue: card.remainingValue ?? '',
          openDate: card.openDate || getTodayStr(),
          expiryDate: card.expiryDate || '',
          note: card.note || '',
          recordedInLedger: !!(card.recordedInLedger || autoDetected),
          syncToLedger: false,
          ledgerRole: 'c',
          ledgerPurpose: '日常'
        };
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
    });

    main.querySelectorAll('[data-card-archive]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.cardArchive;
        const card = (state.data.memberCards || []).find((x) => x.id === id);
        if (!card) return;
        card.archived = !card.archived;
        card.updatedAt = new Date().toISOString();
        saveData();
        render();
        showToast(card.archived ? '已归档该卡片' : '已恢复该卡片至在用列表');
      };
    });

    main.querySelectorAll('[data-card-del]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.cardDel;
        if (!confirm('确定要删除这张会员储值卡记录吗？')) return;
        state.data.deletedCardIds = state.data.deletedCardIds || [];
        if (!state.data.deletedCardIds.includes(id)) {
          state.data.deletedCardIds.push(id);
        }
        state.data.memberCards = (state.data.memberCards || []).filter((x) => x.id !== id);
        saveData();
        render();
        showToast('已删除会员储值卡');
      };
    });

    main.querySelectorAll('[data-action="exportCardsCsv"]').forEach((btn) => {
      btn.onclick = () => {
        const cr = report.memberCardsReport;
        const rows = [
          ['卡片名称', '卡类型', '归属人', '实付价格(元)', '总额度/总次数', '当前剩余', '充卡日期', '保质期/有效期至', '账单联动', '状态', '备注说明']
        ];
        const ownerMap = { family: '家庭共用', c: 'c', q: 'q', dengbao: '噔宝' };
        const typeMap = { stored: '储值余额卡', times: '计次卡', period: '期限会员卡' };
        cr.cards.forEach((c) => {
          rows.push([
            c.name,
            typeMap[c.cardType] || '储值卡',
            ownerMap[c.owner] || '家庭共用',
            c.price,
            c.cardType === 'period' ? '--' : c.totalValue,
            c.cardType === 'period' ? '--' : c.remainingValue,
            c.openDate || '',
            c.expiryDate || '长期有效',
            c.ledgerBadgeText || '未记账单',
            c.isDepleted ? '已用完' : c.expiryBadgeText,
            c.note || ''
          ]);
        });
        const csvContent =
          '\uFEFF' +
          rows
            .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
            .join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `家庭会员储值卡明细_${getTodayStr()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('📊 已导出会员储值卡明细 (.csv)');
      };
    });
  }

  // 底部导航切换
  document.querySelectorAll('.tab-item').forEach((btn) => {
    btn.onclick = () => {
      state.currentTab = btn.dataset.tab;
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

  // 当手机唤醒或切回页面时，自动检测是否跨月进入新账期并刷新同步
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkAndAutoAdvancePeriod();
      if (state.cloudCfg.unlocked) pullFromServer();
    }
  });

  // 初始化启动
  initPeriodSelect();
  updateSyncHeader();
  render();
  initLockScreen();
  setInterval(() => {
    checkAndAutoAdvancePeriod();
    if (state.cloudCfg.unlocked) pullFromServer();
  }, 8000);
})();
