const Engine = require('./utils/engine.js');
const STORAGE_KEY = 'FAMILY_ACCOUNTING_DATA_2026_MP_V1';

App({
  globalData: {
    ledgerData: null,
    cloudEnabled: false,
    cloudEnvId: '', // 若开通微信云开发，填入云环境 ID 即可自动开启双人云数据库实时同步
    apiServerUrl: 'http://127.0.0.1:8080' // 也可通过局域网/自建服务端同步
  },

  onLaunch() {
    // 1. 加载本地缓存或 Excel 初始数据
    try {
      const saved = wx.getStorageSync(STORAGE_KEY);
      if (saved && saved.transactions && saved.necessaryBudgets) {
        this.globalData.ledgerData = saved;
      } else {
        this.globalData.ledgerData = JSON.parse(JSON.stringify(Engine.INITIAL_DATA));
        wx.setStorageSync(STORAGE_KEY, this.globalData.ledgerData);
      }
    } catch (e) {
      this.globalData.ledgerData = JSON.parse(JSON.stringify(Engine.INITIAL_DATA));
    }

    // 2. 初始化微信云开发（若支持）
    if (wx.cloud && this.globalData.cloudEnvId) {
      try {
        wx.cloud.init({
          env: this.globalData.cloudEnvId,
          traceUser: true
        });
        this.globalData.cloudEnabled = true;
      } catch (err) {
        console.warn('微信云开发未配置，使用本地+REST同步模式', err);
      }
    }
  },

  saveLedgerData(newData, cb) {
    newData.updatedAt = new Date().toISOString();
    this.globalData.ledgerData = newData;
    wx.setStorageSync(STORAGE_KEY, newData);
    this.syncToRemote(newData, cb);
  },

  // 双人云同步（优先微信云数据库，其次 REST 同步服务）
  syncToRemote(data, cb) {
    const code = data.familyCode || 'cq2026';
    if (this.globalData.cloudEnabled && wx.cloud) {
      const db = wx.cloud.database();
      db.collection('family_ledgers')
        .doc(code)
        .set({
          data: {
            familyCode: code,
            updatedAt: data.updatedAt,
            payload: data
          }
        })
        .then(() => cb && cb(true))
        .catch(() => cb && cb(false));
      return;
    }

    if (this.globalData.apiServerUrl) {
      wx.request({
        url: `${this.globalData.apiServerUrl}/api/ledger?code=${encodeURIComponent(code)}`,
        method: 'POST',
        data: { data },
        success: () => cb && cb(true),
        fail: () => cb && cb(false)
      });
    } else if (cb) {
      cb(false);
    }
  },

  pullFromRemote(cb) {
    const cur = this.globalData.ledgerData;
    const code = (cur && cur.familyCode) || 'cq2026';

    if (this.globalData.cloudEnabled && wx.cloud) {
      const db = wx.cloud.database();
      db.collection('family_ledgers')
        .doc(code)
        .get()
        .then((res) => {
          if (res.data && res.data.payload) {
            const remote = res.data.payload;
            if (!cur.updatedAt || remote.updatedAt > cur.updatedAt) {
              this.globalData.ledgerData = remote;
              wx.setStorageSync(STORAGE_KEY, remote);
            }
            cb && cb(true, this.globalData.ledgerData);
          } else {
            cb && cb(false);
          }
        })
        .catch(() => cb && cb(false));
      return;
    }

    if (this.globalData.apiServerUrl) {
      wx.request({
        url: `${this.globalData.apiServerUrl}/api/ledger?code=${encodeURIComponent(code)}`,
        method: 'GET',
        success: (res) => {
          if (res.data && res.data.data && res.data.data.updatedAt) {
            const remote = res.data.data;
            if (!cur.updatedAt || remote.updatedAt > cur.updatedAt) {
              this.globalData.ledgerData = remote;
              wx.setStorageSync(STORAGE_KEY, remote);
            }
            cb && cb(true, this.globalData.ledgerData);
          } else {
            cb && cb(true, cur);
          }
        },
        fail: () => cb && cb(false)
      });
    }
  }
});
