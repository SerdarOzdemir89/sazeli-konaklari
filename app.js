/* ============================================================
   Şazeli Konakları — Site Yönetim Paneli
   Tek sayfa, sunucusuz. Veriler tarayıcının localStorage'ında.
   ============================================================ */
(function () {
  'use strict';

  var LS_KEY = 'sazeli_konaklari_v1';

  var MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

  var EXPENSE_CATEGORIES = ['Temizlik', 'Elektrik', 'Su', 'Doğalgaz', 'Asansör',
    'Bahçe/Peyzaj', 'Güvenlik', 'Bakım/Onarım', 'Site Yönetim', 'İlaçlama', 'Demirbaş', 'Vergi/Harç', 'Diğer'];

  var PALETTE = ['#0f766e', '#14b8a6', '#3b82f6', '#6366f1', '#f59e0b',
    '#ef4444', '#84cc16', '#a855f7', '#0ea5e9', '#64748b', '#f97316'];

  var DB = null;
  var UI = {
    tab: 'panel',
    asOf: null,
    search: '',
    block: '',
    onlyDebtors: false,
    debtView: 'month',
    drawerUnit: null,
    importRows: null,
    expFileRows: null
  };

  /* ---------------- utils ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function monthKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function todayMonth() { return monthKey(new Date()); }
  function monthLabel(key) {
    if (!key) return '—';
    var p = key.split('-');
    var mi = parseInt(p[1], 10) - 1;
    return (MONTH_NAMES[mi] || p[1]) + ' ' + p[0];
  }
  function addMonths(key, n) {
    var p = key.split('-');
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1 + n, 1);
    return monthKey(d);
  }
  function monthsRange(start, end) {
    if (!start) start = end;
    if (start > end) return [];
    var out = [], cur = start, guard = 0;
    while (cur <= end && guard < 600) { out.push(cur); cur = addMonths(cur, 1); guard++; }
    return out;
  }
  var nf2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fmtNum(n) {
    var v = round2(n);
    if (Math.abs(v % 1) > 0.0001) return nf2.format(v);
    return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(v);
  }
  function fmtMoney(n) { return fmtNum(n) + ' ₺'; }
  function fmtShort(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1).replace('.', ',') + ' Mn';
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace('.', ',') + ' bin';
    return String(Math.round(n));
  }
  var nfMoney2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fmtMoney2(n) { return nfMoney2.format(round2(n)) + ' ₺'; }
  function fmtDate(iso) {
    if (!iso) return '—';
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    return p[2] + '.' + p[1] + '.' + p[0];
  }
  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function pct(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 1000) / 10;
  }
  function toast(msg, ms) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, ms || 2600);
  }

  /* ---------------- data ---------------- */
  function newDB() {
    return {
      v: 2,
      meta: { siteName: 'Şazeli Konakları', createdAt: new Date().toISOString(), updatedAt: null, rev: 0 },
      settings: {
        monthlyFee: 0,
        startMonth: todayMonth(),
        budgetMonthly: 0,
        managerName: '',
        managerPhone: '',
        note: '',
        lateFeeEnabled: true,
        lateFeeRate: 5,
        lateFeeDay: 15,
        cashOpening: 0,
        demirbasTarget: 120000,
        demirbasOpening: 0,
        cloud: { url: '', key: '' }
      },
      units: [],
      payments: [],
      charges: [],
      expenses: []
    };
  }

  function migrate(d) {
    var base = newDB();
    d.meta = Object.assign({}, base.meta, d.meta || {});
    d.settings = Object.assign({}, base.settings, d.settings || {});
    d.units = (d.units || []).map(function (u) {
      return {
        id: u.id || uid('u'),
        block: u.block || '',
        no: String(u.no || ''),
        owner: u.owner || '',
        phone: u.phone || '',
        fee: typeof u.fee === 'number' ? u.fee : null,
        active: u.active !== false,
        type: (u.type === 'kiracı' || u.type === 'kiracı ') ? 'kiracı' : (u.type === 'Malik' ? 'malik' : (u.type || 'malik')),
        opening: round2(Number(u.opening) || 0),
        billable: u.billable !== false,
        demirbasDue: round2(Number(u.demirbasDue) || 0),
        penaltyBooked: round2(Number(u.penaltyBooked) || 0),
        token: u.token || '',
        cariAsOf: u.cariAsOf || ''
      };
    });
    d.payments = (d.payments || []).map(function (p) {
      return {
        id: p.id || uid('p'),
        unitId: p.unitId, date: p.date || todayISO(), period: p.period || (p.date || '').slice(0, 7),
        type: p.type || 'aidat', amount: round2(p.amount), desc: p.desc || '', source: p.source || 'Diğer',
        mailId: p.mailId || '',
        hist: !!p.hist,
        createdAt: p.createdAt || new Date().toISOString()
      };
    }).filter(function (p) { return p.unitId && p.amount > 0; });
    // aynı kayıt iki kez yazılmışsa (eski köprü sürümü) tekilleştir
    var seenPay = {};
    d.payments = d.payments.filter(function (p) {
      if (seenPay[p.id]) return false;
      seenPay[p.id] = 1;
      return true;
    });
    d.charges = (d.charges || []).map(function (c) {
      return { id: c.id || uid('c'), unitId: c.unitId, date: c.date || todayISO(), label: c.label || 'Ek tahakkuk', amount: round2(c.amount) };
    }).filter(function (c) { return c.unitId && c.amount > 0; });
    d.expenses = (d.expenses || []).map(function (e) {
      return {
        id: e.id || uid('e'), date: e.date || todayISO(), category: e.category || 'Diğer',
        amount: round2(e.amount), desc: e.desc || '', payee: e.payee || '',
        hist: !!e.hist, source: e.source || ''
      };
    }).filter(function (e) { return e.amount > 0; });
    d.pending = Array.isArray(d.pending) ? d.pending : [];
    d.announcements = Array.isArray(d.announcements) ? d.announcements : [];
    d.log = Array.isArray(d.log) ? d.log : [];
    d.contracts = Array.isArray(d.contracts) ? d.contracts : [];
    d.inventory = Array.isArray(d.inventory) ? d.inventory : [];
    d.tickets = Array.isArray(d.tickets) ? d.tickets : [];
    d.meetings = Array.isArray(d.meetings) ? d.meetings : [];
    d.users = Array.isArray(d.users) && d.users.length ? d.users : [{ id: 'u-admin', name: 'Yönetici', role: 'admin', pass: '' }];
    d.closedMonths = Array.isArray(d.closedMonths) ? d.closedMonths : [];
    d.reminderLog = Array.isArray(d.reminderLog) ? d.reminderLog : [];
    d.outgoing = Array.isArray(d.outgoing) ? d.outgoing.filter(function (o) { return !o.done; }) : [];
    if (!d.matchMemory || typeof d.matchMemory !== 'object') d.matchMemory = {};
    if (!d.settings.budgetByCategory || typeof d.settings.budgetByCategory !== 'object') d.settings.budgetByCategory = {};
    if (!d.settings.role) d.settings.role = 'admin';
    if (!d.settings.devirDate) d.settings.devirDate = '2026-10-01';
    return d;
  }

  function loadDB() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || !Array.isArray(d.units)) return null;
      return migrate(d);
    } catch (err) {
      console.warn('Veri okunamadı:', err);
      return null;
    }
  }

  function saveDB() {
    try {
      if (DB.settings && DB.settings.role === 'viewer') {
        toast('Salt-okunur mod: değişiklik kaydedilmedi.', 3600);
        return false;
      }
      DB.meta.updatedAt = new Date().toISOString();
      DB.meta.rev = (Number(DB.meta.rev) || 0) + 1;
      localStorage.setItem(LS_KEY, JSON.stringify(DB));
      schedulePush();
      return true;
    } catch (err) {
      console.error(err);
      toast('Kayıt başarısız: tarayıcı depolaması dolu olabilir.', 4200);
      return false;
    }
  }

  /* ---------------- cloud sync (Supabase) ---------------- */
  var applyingRemote = false;
  var pushTimer = null;
  var cloudPoll = null;
  var cloudCheckTimer = null;
  var CLOUD_ROW = 'main';
  /* Tüm ziyaretçiler için ortak veritabanı (Supabase, ücretsiz plan) */
  var DEFAULT_CLOUD = {
    url: 'https://zwwipahoyemlvvhvcvrj.supabase.co',
    key: 'sb_publishable_AoDnTDiWClfWNurWp_pnAA_QnG1MuOW'
  };

  function cloudCfg() {
    if (!DB.settings.cloud) DB.settings.cloud = { url: '', key: '' };
    var c = DB.settings.cloud;
    if (!c.url && DEFAULT_CLOUD.url) c.url = DEFAULT_CLOUD.url;
    if (!c.key && DEFAULT_CLOUD.key) c.key = DEFAULT_CLOUD.key;
    return c;
  }
  function cloudReady() {
    var c = cloudCfg();
    return !!(c.url && c.key);
  }
  function sbFetch(path, opts) {
    var c = cloudCfg();
    var o = opts || {};
    var headers = {
      apikey: c.key,
      Authorization: 'Bearer ' + c.key,
      'Content-Type': 'application/json'
    };
    if (o.headers) {
      Object.keys(o.headers).forEach(function (k) { headers[k] = o.headers[k]; });
    }
    return fetch(c.url + path, {
      method: o.method || 'GET',
      headers: headers,
      body: o.body,
      cache: 'no-store'
    }).then(function (r) {
      var ct = r.headers.get('content-type') || '';
      return (ct.indexOf('json') >= 0 ? r.json() : r.text()).then(function (body) {
        if (!r.ok) {
          var msg = body && body.message ? body.message : ('HTTP ' + r.status);
          throw new Error(msg);
        }
        return body;
      });
    });
  }
  function sbRead() {
    return sbFetch('/rest/v1/sazeli_db?id=eq.' + CLOUD_ROW + '&select=rev,data').then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) return { rev: 0, data: null };
      return { rev: Number(row.rev) || 0, data: row.data };
    });
  }
  function sbWrite(rev, data) {
    return sbFetch('/rest/v1/sazeli_db?id=eq.' + CLOUD_ROW, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ rev: rev, data: data, updated_at: new Date().toISOString() })
    });
  }
  function saveLocalOnly() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch (e) { }
  }
  function schedulePush() {
    if (!cloudReady() || applyingRemote) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      cloudPush(true);
    }, 1800);
  }
  function cloudPush(silent) {
    if (!cloudReady()) {
      if (!silent) toast('Ortak veri bağlantısı kurulmadı.');
      return Promise.resolve(false);
    }
    return sbRead().then(function (remote) {
      var lr = Number(DB.meta.rev) || 0;
      if (remote.rev > lr && remote.data && remote.data.units && remote.data.units.length) {
        throw new Error('ortak veri daha yeni — önce “Ortak veriden çek”');
      }
      var rev = Math.max(lr, remote.rev) + 1;
      DB.meta.rev = rev;
      return sbWrite(rev, DB).then(function () {
        saveLocalOnly();
        if (!silent) toast('Ortak veriye gönderildi.');
        return true;
      });
    }).catch(function (e) {
      if (!silent) toast('Gönderilemedi: ' + e.message, 4600);
      return false;
    });
  }
  function cloudCheck(silent) { return cloudPull(silent); }
  function cloudPull(silent) {
    if (!cloudReady()) {
      if (!silent) toast('Ortak veri bağlantısı kurulmadı.');
      return Promise.resolve(false);
    }
    return sbRead().then(function (remote) {
      var empty = !remote.data || !Array.isArray(remote.data.units) || !remote.data.units.length;
      if (empty) {
        if (DB.units && DB.units.length) return cloudPush(true);
        if (!silent) toast('Ortak veride kayıt yok.');
        return false;
      }
      var lr = Number(DB.meta.rev) || 0;
      if (remote.rev <= lr) {
        if (!silent) toast('Ortak veri güncel.');
        return false;
      }
      applyingRemote = true;
      DB = migrate(remote.data);
      DB.meta.rev = remote.rev;
      saveLocalOnly();
      applyingRemote = false;
      renderAll();
      if (!silent) toast('Ortak veri güncellendi.');
      return true;
    }).catch(function (e) {
      if (!silent) toast('Çekilemedi: ' + e.message, 4600);
      return false;
    });
  }

  /* ---------------- unit helpers ---------------- */
  function unitLabel(u) {
    if (!u) return '—';
    return u.block ? (u.block + '-' + u.no) : String(u.no);
  }
  function unitById(id) {
    for (var i = 0; i < DB.units.length; i++) if (DB.units[i].id === id) return DB.units[i];
    return null;
  }
  function typeLabel(u) {
    if (!u) return '';
    return u.type === 'kiracı' ? 'Kiracı' : (u.type === 'malik' ? 'Malik' : '');
  }
  function hasTwin(u) {
    return DB.units.some(function (x) {
      return x.id !== u.id && x.active !== false && String(x.block || '') === String(u.block || '') &&
        String(x.no) === String(u.no);
    });
  }
  function displayUnit(u) {
    if (!u) return '—';
    return unitLabel(u) + (hasTwin(u) ? (u.type === 'kiracı' ? ' (K)' : ' (M)') : '');
  }
  function chartLabel(r) { return displayUnit(r.u); }
  function selectLabel(u) {
    var t = typeLabel(u);
    return unitLabel(u) + (t ? ' · ' + t : '') + (u.owner ? ' · ' + u.owner : '');
  }
  function unitOption(u) {
    var t = typeLabel(u);
    return unitLabel(u) + (t ? ' · ' + t : '');
  }
  function unitFee(u) {
    return (u && typeof u.fee === 'number' && u.fee > 0) ? u.fee : (Number(DB.settings.monthlyFee) || 0);
  }
  function syncBillable(changed) {
    var group = DB.units.filter(function (x) {
      return String(x.block || '') === String(changed.block || '') && String(x.no) === String(changed.no);
    });
    if (group.length > 1) {
      var tenant = null;
      group.forEach(function (x) { if (x.type === 'kiracı') tenant = x; });
      group.forEach(function (x) { x.billable = tenant ? (x === tenant) : (x === changed); });
    } else {
      changed.billable = true;
    }
  }
  function sortUnits(list) {
    return list.slice().sort(function (a, b) {
      var ab = String(a.block || ''), bb = String(b.block || '');
      if (ab !== bb) return ab.localeCompare(bb, 'tr');
      var an = parseInt(a.no, 10), bn = parseInt(b.no, 10);
      if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
      return String(a.no).localeCompare(String(b.no), 'tr');
    });
  }
  function blocks() {
    var seen = {}, out = [];
    DB.units.forEach(function (u) {
      if (u.block && !seen[u.block]) { seen[u.block] = 1; out.push(u.block); }
    });
    return out.sort(function (a, b) { return a.localeCompare(b, 'tr'); });
  }

  /* ---------------- computation ---------------- */
  function feeForMonth(m) {
    var hist = DB.settings.feeHistory;
    if (Array.isArray(hist) && hist.length) {
      var f = 0;
      hist.forEach(function (h) { if (String(h.from) <= String(m)) f = Number(h.fee) || 0; });
      if (f > 0) return f;
    }
    if (String(m) < '2026-01') return 4000;
    return Number(DB.settings.monthlyFee) || 0;
  }

  function computeAll(asOf) {
    var s = DB.settings;
    var start = s.startMonth || todayMonth();
    var periods = monthsRange(start, asOf);
    var cutoff = asOf + '-31';
    var today = todayISO();
    var lateOn = s.lateFeeEnabled !== false;
    var rate = (Number(s.lateFeeRate) || 0) / 100;
    var lday = Math.min(28, Math.max(1, parseInt(s.lateFeeDay, 10) || 15));

    var rows = DB.units.filter(function (u) { return u.active !== false; }).map(function (u) {
      var billable = u.billable !== false;
      var fee = billable ? unitFee(u) : 0;
      var expected = round2(fee * periods.length);
      var extra = round2(DB.charges.filter(function (c) { return c.unitId === u.id; })
        .reduce(function (a, c) { return a + c.amount; }, 0));
      var pays = DB.payments.filter(function (p) {
        return p.unitId === u.id && !p.hist && String(p.date || '') <= cutoff;
      }).sort(function (a, b) {
        return String(a.date || '').localeCompare(String(b.date || '')) ||
          String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
      var paid = round2(pays.reduce(function (a, p) { return a + p.amount; }, 0));
      var opening = round2(Number(u.opening) || 0);

      /* Tahsilat dağıtımı: önce devir bakiyesi, sonra aylar (en eski → yeni).
         Her ayın hangi tarihte kapandığı, gecikme faizi için kaydedilir. */
      var openingRemaining = Math.max(0, opening);
      var monthPaid = periods.map(function () { return 0; });
      var monthDone = periods.map(function () { return null; });
      var mIdx = 0;

      pays.forEach(function (p) {
        if (p.type === 'ek') return;
        var amt = p.amount;
        if (openingRemaining > 0.005) {
          var use = Math.min(openingRemaining, amt);
          openingRemaining = round2(openingRemaining - use);
          amt = round2(amt - use);
        }
        while (amt > 0.005 && mIdx < periods.length) {
          var need = round2(fee - monthPaid[mIdx]);
          if (need <= 0.005) { mIdx++; continue; }
          var use2 = Math.min(need, amt);
          monthPaid[mIdx] = round2(monthPaid[mIdx] + use2);
          amt = round2(amt - use2);
          if (monthPaid[mIdx] >= fee - 0.005) {
            monthDone[mIdx] = p.date || null;
            mIdx++;
          }
        }
      });

      var penalty = 0;
      var months = periods.map(function (k, i) {
        var status = fee <= 0 ? 'none'
          : (monthPaid[i] >= fee - 0.005 ? 'paid' : (monthPaid[i] > 0.005 ? 'partial' : 'unpaid'));
        var late = false;
        if (lateOn && fee > 0) {
          var deadline = k + '-' + pad2(lday);
          if (monthDone[i] ? String(monthDone[i]) > deadline : today > deadline) late = true;
        }
        if (late) penalty = round2(penalty + fee * rate);
        return { month: k, due: fee, paid: round2(monthPaid[i]), status: status, late: late };
      });

      penalty = round2(Math.max(0, penalty - (Number(u.penaltyBooked) || 0)));
      var accrued = round2(opening + expected + extra);
      var debt = round2(accrued + penalty - paid);
      var paidForExtra = Math.max(0, paid - Math.max(0, opening) - expected);

      return {
        u: u, label: unitLabel(u), fee: fee, billable: billable,
        months: months, periods: periods,
        opening: opening, openingLeft: openingRemaining,
        expected: expected, extra: extra, extraLeft: round2(Math.max(0, extra - paidForExtra)),
        penalty: penalty, accrued: accrued, paid: paid, debt: debt,
        surplus: debt < -0.5 ? Math.abs(debt) : 0,
        lastPayment: pays.length ? pays[pays.length - 1] : null
      };
    });

    var totals = rows.reduce(function (t, r) {
      t.opening += r.opening;
      t.expected += r.expected;
      t.extra += r.extra;
      t.penalty += r.penalty;
      t.paid += r.paid;
      t.net += r.debt;
      if (r.debt > 0.5) { t.debt += r.debt; t.debtors++; }
      if (r.debt < -0.5) { t.credit += Math.abs(r.debt); }
      t.extraLeft += r.extraLeft;
      return t;
    }, { opening: 0, expected: 0, extra: 0, extraLeft: 0, penalty: 0, paid: 0, debt: 0, net: 0, credit: 0, debtors: 0 });

    ['opening', 'expected', 'extra', 'extraLeft', 'penalty', 'paid', 'debt', 'net', 'credit'].forEach(function (k) {
      totals[k] = round2(totals[k]);
    });

    var due = round2(rows.reduce(function (a, r) {
      return a + Math.max(0, r.opening) + r.expected + r.extra + r.penalty;
    }, 0));

    var expenses = round2(DB.expenses.filter(function (e) { return String(e.date || '') <= cutoff; })
      .reduce(function (s2, e) { return s2 + e.amount; }, 0));

    var monthPayments = DB.payments.filter(function (p) {
      return String(p.date || '').slice(0, 7) === asOf;
    }).reduce(function (s2, p) { return s2 + p.amount; }, 0);
    var monthExpenses = DB.expenses.filter(function (e) {
      return String(e.date || '').slice(0, 7) === asOf;
    }).reduce(function (s2, e) { return s2 + e.amount; }, 0);

    var demirbas = 0, demirbasPayers = {};
    DB.payments.forEach(function (p) {
      if (p.type === 'demirbaş' && !p.hist) { demirbas += p.amount; demirbasPayers[p.unitId] = 1; }
    });
    var demirbasExpenses = DB.expenses.filter(function (e) {
      return /demirba/i.test(String(e.category || '') + ' ' + String(e.desc || ''));
    }).reduce(function (s2, e) { return s2 + e.amount; }, 0);
    var demirbasOpening = Number(s.demirbasOpening) || 0;
    var dAsOf = String(s.demirbasAsOf || '');
    var demirbasNew = DB.payments.filter(function (p) {
      return p.type === 'demirbaş' && (!dAsOf || String(p.date || '') > dAsOf);
    }).reduce(function (s2, p) { return s2 + p.amount; }, 0);
    var demirbasExpNew = DB.expenses.filter(function (e) {
      return /demirba/i.test(String(e.category || '') + ' ' + String(e.desc || '')) &&
        (!dAsOf || String(e.date || '') > dAsOf);
    }).reduce(function (s2, e) { return s2 + e.amount; }, 0);

    var cashOpen = Number(s.cashOpening) || 0;
    var cashOpenDate = String(s.cashOpeningDate || '');
    var inRange = function (d, from, to) {
      var x = String(d || '');
      if (cashOpenDate && x <= cashOpenDate) return false;
      if (from && x < from) return false;
      if (to && x > to) return false;
      return true;
    };
    var mStart = asOf + '-01';
    var mEnd = asOf + '-31';

    var cashIn = DB.payments.filter(function (p) { return inRange(p.date, '', ''); })
      .reduce(function (s2, p) { return s2 + p.amount; }, 0);
    var cashOut = DB.expenses.filter(function (e) { return inRange(e.date, '', ''); })
      .reduce(function (s2, e) { return s2 + e.amount; }, 0);

    // dönem sonu ve dönem başı kasa
    var cashAtStart = round2(cashOpen +
      DB.payments.filter(function (p) { return inRange(p.date, '', '') && String(p.date) < mStart; })
        .reduce(function (s2, p) { return s2 + p.amount; }, 0) -
      DB.expenses.filter(function (e) { return inRange(e.date, '', '') && String(e.date) < mStart; })
        .reduce(function (s2, e) { return s2 + e.amount; }, 0));
    var cashAtEnd = round2(cashOpen +
      DB.payments.filter(function (p) { return inRange(p.date, '', mEnd); })
        .reduce(function (s2, p) { return s2 + p.amount; }, 0) -
      DB.expenses.filter(function (e) { return inRange(e.date, '', mEnd); })
        .reduce(function (s2, e) { return s2 + e.amount; }, 0));

    // seçili ayın daire bazlı durumu: o ay kim ödedi / ödemedi
    var feeM = feeForMonth(asOf);
    var monthPayMap = {}, debtMap = {};
    rows.forEach(function (r) { debtMap[r.u.id] = r.debt; });
    DB.payments.forEach(function (p) {
      if (String(p.date || '').slice(0, 7) !== asOf) return;
      if (p.type === 'demirbaş') return;   // demirbaş aidat yerine sayılmaz
      monthPayMap[p.unitId] = (monthPayMap[p.unitId] || 0) + p.amount;
    });
    var monthRows = rows.map(function (r) {
      var f2 = r.billable ? feeM : 0;
      var paidM = round2(monthPayMap[r.u.id] || 0);
      var cariDebt = round2(Math.max(0, debtMap[r.u.id] || 0));
      var st;
      if (f2 <= 0) st = 'none';
      else if (paidM >= f2 - 0.5) st = 'paid';
      else if (cariDebt <= 0.5) st = 'covered';          // bu ay ödeme yok ama borcu da yok (peşin/önce ödemiş)
      else if (paidM > 0.5) st = 'partial';
      else st = 'unpaid';
      var rem = (st === 'unpaid' || st === 'partial') ? round2(Math.min(f2, cariDebt)) : 0;
      return { u: r.u, label: r.label, owner: r.u.owner, phone: r.u.phone, fee: f2,
               paid: paidM, remaining: rem, cariDebt: cariDebt, status: st };
    });
    var monthUnpaid = round2(monthRows.reduce(function (s2, r) { return s2 + r.remaining; }, 0));
    var monthUnpaidCount = monthRows.filter(function (r) { return r.status === 'unpaid' || r.status === 'partial'; }).length;
    var monthPaidCount = monthRows.filter(function (r) { return r.status === 'paid'; }).length;

    return {
      asOf: asOf, periods: periods, rows: rows, totals: totals, due: due,
      expenses: expenses, balance: round2(cashOpen + cashIn - cashOut),
      cashOpening: round2(cashOpen), cashOpeningDate: cashOpenDate,
      cashIn: round2(cashIn), cashOut: round2(cashOut),
      cashAtStart: cashAtStart, cashAtEnd: cashAtEnd,
      monthRows: monthRows, monthFee: feeM, monthUnpaid: monthUnpaid,
      monthUnpaidCount: monthUnpaidCount, monthPaidCount: monthPaidCount,
      histPaid: round2(DB.payments.filter(function (p) { return p.hist; })
        .reduce(function (s2, p) { return s2 + p.amount; }, 0)),
      histPaidCount: DB.payments.filter(function (p) { return p.hist; }).length,
      histExpenses: round2(DB.expenses.filter(function (e) { return e.hist; })
        .reduce(function (s2, e) { return s2 + e.amount; }, 0)),
      histExpensesCount: DB.expenses.filter(function (e) { return e.hist; }).length,
      monthPayments: round2(monthPayments), monthExpenses: round2(monthExpenses),
      demirbas: round2(demirbas), demirbasPayers: Object.keys(demirbasPayers).length,
      demirbasExpenses: round2(demirbasExpenses),
      demirbasOpening: round2(demirbasOpening),
      demirbasAsOf: dAsOf,
      demirbasNew: round2(demirbasNew),
      demirbasExpNew: round2(demirbasExpNew),
      demirbasBalance: round2(demirbasOpening + demirbasNew - demirbasExpNew),
      demirbasTarget: Number(s.demirbasTarget) || 0,
      rate: Math.round(rate * 1000) / 10, lateDay: lday, lateOn: lateOn,
      collectRate: due > 0 ? Math.min(100, pct(totals.paid, due)) : 0
    };
  }

  /* ---------------- charts ---------------- */
  function donutSVG(segments, opts) {
    opts = opts || {};
    var size = opts.size || 178;
    var th = opts.thickness || 24;
    var total = segments.reduce(function (s, x) { return s + Math.max(0, x.value); }, 0);
    var r = (size - th) / 2, c = 2 * Math.PI * r, cx = size / 2, cy = size / 2;
    var off = 0, arcs = '';

    if (total > 0) {
      segments.forEach(function (sg) {
        var v = Math.max(0, sg.value);
        if (v <= 0) return;
        var len = c * v / total;
        arcs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + sg.color +
          '" stroke-width="' + th + '" stroke-dasharray="' + Math.max(len - 2, 0.6) + ' ' + Math.max(c - len + 2, 0.6) +
          '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"></circle>';
        off += len;
      });
    } else {
      arcs = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#e3e8ee" stroke-width="' + th + '"></circle>';
    }

    var center = '';
    if (opts.centerValue != null) {
      center = '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="21" font-weight="700" fill="#0e1a2b" font-family="inherit">' +
        esc(opts.centerValue) + '</text>' +
        '<text x="' + cx + '" y="' + (cy + 17) + '" text-anchor="middle" font-size="10.5" fill="#6b7c93" font-family="inherit" letter-spacing=".06em">' +
        esc(opts.centerLabel || '') + '</text>';
    }

    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="' +
      esc(opts.aria || 'Grafik') + '">' + arcs + center + '</svg>';
  }

  function legendHTML(segments, total) {
    return '<div class="legend">' + segments.map(function (s) {
      return '<div class="legend-row"><i class="dot" style="background:' + s.color + '"></i>' +
        '<span class="name">' + esc(s.label) + '</span>' +
        '<span class="val">' + esc(s.display != null ? s.display : fmtMoney(s.value)) + '</span>' +
        '<span class="pct">' + (total > 0 ? pct(s.value, total).toFixed(1).replace('.', ',') + '%' : '—') + '</span></div>';
    }).join('') + '</div>';
  }

  function barsSVG(labels, series) {
    var W = 640, H = 252, padL = 50, padR = 12, padT = 18, padB = 34;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var max = 1;
    series.forEach(function (s) { s.values.forEach(function (v) { if (v > max) max = v; }); });
    var step = max / 3;
    var nice = Math.ceil(step / 10) * 10;
    var top = Math.max(nice * 3, 300);

    var defs = '<defs>' + series.map(function (sr, si) {
      return '<linearGradient id="bgrad' + si + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + sr.color + '" stop-opacity="0.95"/>' +
        '<stop offset="100%" stop-color="' + sr.color + '" stop-opacity="0.55"/></linearGradient>';
    }).join('') + '</defs>';

    var grid = '', i, y;
    for (i = 0; i <= 3; i++) {
      y = padT + plotH - (plotH * i / 3);
      grid += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y +
        '" stroke="#e9eef4" stroke-width="1" stroke-dasharray="' + (i === 0 ? '0' : '3 4') + '"></line>';
      grid += '<text x="' + (padL - 9) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="10" fill="#93a1b3">' +
        fmtShort(top * i / 3) + '</text>';
    }

    var groupW = plotW / Math.max(labels.length, 1);
    var barW = Math.min(18, Math.max(6, groupW * 0.26));
    var bars = '', xlabels = '';

    labels.forEach(function (lab, idx) {
      var gx = padL + groupW * idx + groupW / 2;
      series.forEach(function (s, si) {
        var v = s.values[idx] || 0;
        var h = top > 0 ? (v / top) * plotH : 0;
        var bx = gx - (series.length * barW + (series.length - 1) * 3) / 2 + si * (barW + 3);
        if (h > 0) {
          bars += '<rect x="' + bx + '" y="' + (padT + plotH - h) + '" width="' + barW + '" height="' + h +
            '" rx="3" fill="url(#bgrad' + si + ')"><title>' + esc(lab + ' · ' + s.name + ': ' + fmtMoney(v)) + '</title></rect>';
        } else {
          bars += '<rect x="' + bx + '" y="' + (padT + plotH - 2) + '" width="' + barW + '" height="2" rx="1" fill="#e9eef4"></rect>';
        }
      });
      var isLast = idx === labels.length - 1;
      xlabels += '<text x="' + gx + '" y="' + (H - 11) + '" text-anchor="middle" font-size="10.5" fill="' +
        (isLast ? '#0f766e' : '#6b7c93') + '" font-weight="' + (isLast ? '700' : '500') + '">' + esc(lab) + '</text>';
    });

    return '<svg class="bars-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Aylık tahsilat ve gider grafiği">' +
      defs + grid + bars + xlabels +
      '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (padT + plotH) + '" y2="' + (padT + plotH) + '" stroke="#dde4ec" stroke-width="1"></line>' +
      '</svg>';
  }

  /* ---------------- render: header ---------------- */
  function renderHeader() {
    $('#siteName').textContent = DB.meta.siteName || 'Site Yönetim Paneli';
    document.title = (DB.meta.siteName || 'Şazeli Konakları') + ' · Site Yönetim Paneli';
    $('#periodChip').textContent = 'Bilanço: ' + monthLabel(UI.asOf);
    var y = new Date().getFullYear();
    var el = $('#modalFootYear');
    if (el) el.textContent = y;
  }

  /* ---------------- render: panel ---------------- */
  function renderPanel(c) {
    var t = c.totals;
    var unitCount = c.rows.length;

    var uniqUnits = {};
    c.rows.forEach(function (r) { uniqUnits[(r.u.block || '') + '|' + r.u.no] = 1; });
    var unitNo = Object.keys(uniqUnits).length;

    var rangeTxt = (DB.settings.startMonth > c.asOf)
      ? 'aidat ' + monthLabel(DB.settings.startMonth) + '’dan itibaren'
      : monthLabel(DB.settings.startMonth) + ' – ' + monthLabel(c.asOf);

    $('#panelSub').textContent = unitCount
      ? unitNo + ' daire · ' + unitCount + ' hesap · ' + rangeTxt +
        ' · aylık aidat ' + fmtMoney(DB.settings.monthlyFee)
      : 'Henüz daire eklenmedi. Ayarlar bölümünden daire listesini oluşturun.';

    var setupCard = $('#setupCard');
    if (setupCard) setupCard.hidden = DB.units.length > 0;

    var prevM = addMonths(c.asOf, -1);
    var prevPay = DB.payments.filter(function (p) { return String(p.date || '').slice(0, 7) === prevM; })
      .reduce(function (a, p) { return a + p.amount; }, 0);
    var prevExp = DB.expenses.filter(function (e) { return String(e.date || '').slice(0, 7) === prevM; })
      .reduce(function (a, e) { return a + e.amount; }, 0);
    function deltaChip(cur, prev) {
      if (c.asOf === todayMonth()) return '';   // ay sürüyorsa kıyas yanıltıcı
      if (!prev || prev < 1) return '';
      var d = Math.round(((cur - prev) / prev) * 1000) / 10;
      if (!isFinite(d) || Math.abs(d) < 0.1) return '';
      return ' <span class="delta ' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '▲' : '▼') +
        ' %' + String(Math.abs(d)).replace('.', ',') + '</span>';
    }

    var monthMode = UI.scope !== 'all';
    var netPeriod = c.monthPayments - c.monthExpenses;
    var countMonth = DB.payments.filter(function (p) { return String(p.date || '').slice(0, 7) === c.asOf; }).length;
    var expenseCountMonth = DB.expenses.filter(function (e) { return String(e.date || '').slice(0, 7) === c.asOf; }).length;
    // devir tarihinden önceki aylar: kasa ve borç hesaplanamaz → arşiv görünümü
    var devirAy = String(DB.settings.cashOpeningDate || '2026-10-31').slice(0, 7);
    var archive = c.asOf < devirAy;

    $('#kpis').innerHTML = archive ? [
      '<div class="kpi ok"><div class="kpi-label">' + monthLabel(c.asOf) + ' Tahsilatı</div>' +
        '<div class="kpi-value">' + fmtMoney(c.monthPayments) + '</div>' +
        '<div class="kpi-sub">' + countMonth + ' ödeme kaydı' + deltaChip(c.monthPayments, prevPay) + '</div></div>',

      '<div class="kpi warn"><div class="kpi-label">' + monthLabel(c.asOf) + ' Gideri</div>' +
        '<div class="kpi-value">' + fmtMoney(c.monthExpenses) + '</div>' +
        '<div class="kpi-sub">' + expenseCountMonth + ' gider kaydı' + deltaChip(c.monthExpenses, prevExp) + '</div></div>',

      '<div class="kpi danger kpi-click" role="button" tabindex="0" data-act="show-month-debtors" title="O ay ödemeyenleri göster">' +
        '<div class="kpi-label">' + monthLabel(c.asOf) + ' Ödemeyen</div>' +
        '<div class="kpi-value">' + fmtMoney(c.monthUnpaid) + '</div>' +
        '<div class="kpi-sub"><strong>' + c.monthUnpaidCount + '</strong> daire · listeye git →</div></div>',

      '<div class="kpi hero ' + (netPeriod < 0 ? 'danger' : '') + '"><div class="kpi-label">Net</div>' +
        '<div class="kpi-value">' + (netPeriod >= 0 ? '+' : '−') + fmtMoney(Math.abs(netPeriod)) + '</div>' +
        '<div class="kpi-sub">tahsilat − gider · arşiv dönemi</div></div>'
    ].join('') : monthMode ? [
      '<div class="kpi ok"><div class="kpi-label">' + monthLabel(c.asOf) + ' Tahsilatı</div>' +
        '<div class="kpi-value">' + fmtMoney(c.monthPayments) + '</div>' +
        '<div class="kpi-sub">' + countMonth + ' ödeme' + deltaChip(c.monthPayments, prevPay) + '</div></div>',

      '<div class="kpi danger kpi-click" role="button" tabindex="0" data-act="show-debtors" title="Cari borç listesini aç">' +
        '<div class="kpi-label">Sakinlerden Alacak</div>' +
        '<div class="kpi-value">' + fmtMoney(t.net) + '</div>' +
        '<div class="kpi-sub"><strong>' + t.debtors + '</strong> hesap borçlu' +
        (t.credit > 0.5 ? ' · ' + fmtMoney(t.credit) + ' alacaklı' : '') + ' · cari ' +
        esc(fmtDate(DB.meta.cariImport && DB.meta.cariImport.at || '2026-11-10')) + ' →</div></div>',

      '<div class="kpi hero ' + (c.cashAtEnd < 0 ? 'danger' : '') + '"><div class="kpi-label">Kasa · ay sonu</div>' +
        '<div class="kpi-value">' + fmtMoney(c.cashAtEnd) + '</div>' +
        '<div class="kpi-sub">ay başı ' + fmtMoney(c.cashAtStart) + ' · net ' +
        (netPeriod >= 0 ? '+' : '−') + fmtMoney(Math.abs(netPeriod)) + '</div></div>',

      '<div class="kpi warn"><div class="kpi-label">Tahsilat Oranı (tutar)</div>' +
        '<div class="kpi-value">%' + String(c.collectRate).replace('.', ',') + '</div>' +
        '<div class="kpi-sub">Tahakkuk ' + fmtMoney(c.due) +
        (t.credit > 0 ? ' · alacak ' + fmtMoney(t.credit) : '') + '</div></div>'
    ].join('') : [
      '<div class="kpi ok"><div class="kpi-label">Toplam Tahsilat</div>' +
        '<div class="kpi-value">' + fmtMoney(t.paid) + '</div>' +
        '<div class="kpi-sub">' + DB.payments.length + ' ödeme · bu ay <strong>' + fmtMoney(c.monthPayments) + '</strong>' +
        (c.histPaid > 0 ? ' · geçmiş ' + fmtShort(c.histPaid) + ' ₺' : '') + '</div></div>',

      '<div class="kpi danger kpi-click" role="button" tabindex="0" data-act="show-debtors" title="Ödemeyenlerin listesini aç">' +
        '<div class="kpi-label">Sakinlerden Alacak</div>' +
        '<div class="kpi-value">' + fmtMoney(t.net) + '</div>' +
        '<div class="kpi-sub"><strong>' + t.debtors + '</strong> hesap ödemedi · listeye git →' +
        (t.penalty > 0 ? ' · faiz ' + fmtMoney(t.penalty) : '') + '</div></div>',

      '<div class="kpi hero ' + (c.balance < 0 ? 'danger' : '') + '"><div class="kpi-label">Kasa Bakiyesi</div>' +
        '<div class="kpi-value">' + fmtMoney(c.balance) + '</div>' +
        '<div class="kpi-sub">devir ' + fmtMoney(c.cashOpening) + ' · net ' +
        (c.cashIn - c.cashOut >= 0 ? '+' : '−') + fmtMoney(Math.abs(c.cashIn - c.cashOut)) + '</div></div>',

      '<div class="kpi warn"><div class="kpi-label">Tahsilat Oranı (tutar)</div>' +
        '<div class="kpi-value">%' + String(c.collectRate).replace('.', ',') + '</div>' +
        '<div class="kpi-sub">Tahakkuk ' + fmtMoney(c.due) +
        (t.credit > 0 ? ' · alacak ' + fmtMoney(t.credit) : '') + '</div></div>'
    ].join('');

    if ($('#donutCard')) $('#donutCard').hidden = archive;
    if ($('#debtorsCard')) $('#debtorsCard').hidden = archive;

    /* tahsilat donut */
    var collectSegs = [
      { label: 'Tahsil edilen', value: Math.max(0, t.paid), color: '#0f766e', display: fmtMoney(t.paid) },
      { label: 'Ödenmemiş aidat', value: Math.max(0, t.net), color: '#f59e0b', display: fmtMoney(t.net) }
    ];
    var collectTotal = collectSegs[0].value + collectSegs[1].value;
    $('#donutTahsilat').innerHTML = '<div class="donut-wrap">' +
      donutSVG(collectSegs, {
        centerValue: '%' + String(c.collectRate).replace('.', ','),
        centerLabel: 'KÜMÜLATİF TAHSİLAT', aria: 'Kümülatif tahsilat durumu'
      }) + legendHTML(collectSegs.filter(function (s) { return s.value > 0; }), collectTotal) + '</div>';
    var paidUnits = (c.monthRows || []).filter(function (r) { return r.status === 'paid'; }).length;
    var billedUnits = (c.monthRows || []).filter(function (r) { return r.fee > 0; }).length;
    $('#collectHint').textContent = monthLabel(c.asOf) + ' · ' + paidUnits + '/' + billedUnits + ' daire ödedi' +
      (t.credit > 0.5 ? ' · alacak ' + fmtMoney(t.credit) : '');

    /* kasa ekstresi */
    var cash = $('#cashCard');
    if (cash) {
      if (archive) {
        cash.innerHTML =
          '<div class="card-h"><h3>Arşiv dönemi · ' + monthLabel(c.asOf) + '</h3><span class="hint">devir öncesi</span></div>' +
          '<p class="small muted" style="margin:0">Bu ay devir tarihinden (' + fmtDate(DB.settings.cashOpeningDate || '2026-10-31') +
          ') önce. Kasa bakiyesi hesaplanmıyor (devir tutarı bu geçmişi zaten içeriyor), ama o ayın tahsilatı, gideri ve ' +
          'ödemeyen daireleri görünür.</p>';
      } else if (monthMode) {
        cash.innerHTML =
          '<div class="card-h"><h3>Kasa · ' + monthLabel(c.asOf) + '</h3>' +
          '<span class="hint">ay başı → ay sonu</span></div>' +
          '<div class="cash-grid">' +
            '<div class="cash-col"><span class="l">Ay başı</span><span class="v">' + fmtMoney(c.cashAtStart) + '</span></div>' +
            '<div class="cash-col plus"><span class="l">Tahsilat</span><span class="v">+' + fmtMoney(c.monthPayments) + '</span></div>' +
            '<div class="cash-col minus"><span class="l">Gider</span><span class="v">' +
              (c.monthExpenses > 0 ? '−' + fmtMoney(c.monthExpenses)
                : '<span class="muted" style="font-size:15px;font-weight:600">kayıt yok</span>') + '</span></div>' +
            '<div class="cash-col total"><span class="l">' + (c.asOf === todayMonth() && Number(DB.settings.cashActual) > 0 ? 'Güncel bakiye' : 'Ay sonu') + '</span>' +
              '<span class="v">' + fmtMoney(c.asOf === todayMonth() && Number(DB.settings.cashActual) > 0 ? Number(DB.settings.cashActual) : c.cashAtEnd) + '</span></div>' +
          '</div>' +
          bankLine(c) +
          '<p class="hint">Sadece seçili ayın hareketleri. Tüm geçmiş için üstteki <strong>Tümü</strong> düğmesine bas.</p>';
      } else {
        var opDate = c.cashOpeningDate ? fmtDate(c.cashOpeningDate) : '';
        cash.innerHTML =
          '<div class="card-h"><h3>Kasa</h3>' +
          '<span class="hint">' + (opDate ? opDate + ' devrinden bugüne' : 'devir tanımlı değil') + '</span></div>' +
          '<div class="cash-grid">' +
            '<div class="cash-col"><span class="l">Devir bakiyesi</span><span class="v">' + fmtMoney(c.cashOpening) + '</span></div>' +
            '<div class="cash-col plus"><span class="l">Tahsilat</span><span class="v">+' + fmtMoney(c.cashIn) + '</span></div>' +
            '<div class="cash-col minus"><span class="l">Gider</span><span class="v">' +
              (c.cashOut > 0 ? '−' + fmtMoney(c.cashOut) : '0 ₺') + '</span></div>' +
            '<div class="cash-col total"><span class="l">Kayıtlı kasa</span><span class="v">' + fmtMoney(c.balance) + '</span></div>' +
          '</div>' +
          bankLine(c) +
          '<p class="hint">Kasa = devir + tahsilat − gider. Devir tutarı Ayarlar’daki “Kasa devir bakiyesi / Devir tarihi” alanlarından gelir.</p>';
      }
    }

    /* bar chart */
    var mkeys = [], cur = c.asOf;
    for (var i = 0; i < 12; i++) { mkeys.unshift(cur); cur = addMonths(cur, -1); }
    var paySeries = mkeys.map(function (k) {
      return DB.payments.filter(function (p) { return String(p.date || '').slice(0, 7) === k; })
        .reduce(function (s, p) { return s + p.amount; }, 0);
    });
    var expSeries = mkeys.map(function (k) {
      return DB.expenses.filter(function (e) { return String(e.date || '').slice(0, 7) === k; })
        .reduce(function (s, e) { return s + e.amount; }, 0);
    });
    $('#barChart').innerHTML = barsSVG(
      mkeys.map(function (k) { return MONTH_NAMES[parseInt(k.split('-')[1], 10) - 1].slice(0, 3); }),
      [{ name: 'Tahsilat', color: '#0f766e', values: paySeries },
       { name: 'Gider', color: '#f59e0b', values: expSeries }]
    );

    /* top debtors */
    var debtors = c.rows.filter(function (r) { return r.debt > 0.5; })
      .sort(function (a, b) { return b.debt - a.debt; }).slice(0, 5);
    var maxD = debtors.length ? debtors[0].debt : 1;
    $('#topDebtors').innerHTML = debtors.length
      ? '<div class="hbar">' + debtors.map(function (r) {
          return '<div class="hbar-row"><span class="u">' + esc(chartLabel(r)) + '</span>' +
            '<span class="hbar-track"><span class="hbar-fill" style="width:' + Math.max(4, (r.debt / maxD) * 100) + '%"></span></span>' +
            '<span class="a debt">' + fmtMoney(r.debt) + '</span></div>';
        }).join('') + '</div>'
      : '<div class="empty">Borçlu daire yok. 🎉</div>';

    /* recent payments */
    var recent = DB.payments.slice().filter(function (p) {
      return !monthMode || String(p.date || '').slice(0, 7) === c.asOf;
    }).sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    }).slice(0, 6);
    $('#recentPayments').innerHTML = recent.length
      ? '<table class="mini-table"><thead><tr><th>Tarih</th><th>Daire</th><th class="num">Tutar</th></tr></thead><tbody>' +
        recent.map(function (p) {
          var u = unitById(p.unitId);
          return '<tr><td>' + fmtDate(p.date) + '</td><td>' + esc(u ? displayUnit(u) : '—') +
            (p.desc ? '<div class="small muted" style="max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.desc) + '</div>' : '') +
            '</td><td class="num">' + fmtMoney(p.amount) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="empty">Henüz ödeme yok.</div>';
  }

  /* ---------------- render: debts ---------------- */
  function renderMonthDebts(c, sel, q) {
    var rows = c.monthRows.filter(function (r) {
      if (UI.onlyDebtors && r.status !== 'unpaid' && r.status !== 'partial') return false;
      if (sel.value && r.u.block !== sel.value) return false;
      if (q) {
        var hay = (r.label + ' ' + (r.owner || '') + ' ' + (r.phone || '') + ' ' + typeLabel(r.u)).toLocaleLowerCase('tr');
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      return b.remaining - a.remaining || String(a.label).localeCompare(String(b.label), 'tr');
    });

    var head = $('#debtHead');
    if (head) head.innerHTML = '<tr><th>Daire</th><th>Sakin</th><th class="num">' + monthLabel(c.asOf) + ' aidatı</th>' +
      '<th class="num">Ödenen</th><th class="num">Kalan</th><th>Durum</th><th class="right">İşlem</th></tr>';

    var tb = $('#debtTable tbody');
    tb.innerHTML = rows.map(function (r) {
      var badge = r.status === 'paid' ? '<span class="badge ok">Ödedi</span>' :
        r.status === 'partial' ? '<span class="badge warn">Kısmi</span>' :
          r.status === 'covered' ? '<span class="badge ok">Borcu yok</span>' :
            r.status === 'none' ? '<span class="badge">—</span>' : '<span class="badge danger">Ödemedi</span>';
      var tip = typeLabel(r.u);
      return '<tr data-unit="' + esc(r.u.id) + '">' +
        '<td><button class="unit-btn" data-act="open-unit" data-id="' + esc(r.u.id) + '">' + esc(r.label) + '</button></td>' +
        '<td class="owner-cell"><button class="owner-btn" type="button" data-act="open-unit" data-id="' + esc(r.u.id) +
          '" title="Ödeme geçmişini gör">' + (esc(r.owner) || '<span class="muted">—</span>') + '</button>' +
          (tip ? '<span class="type-badge' + (r.u.type === 'kiracı' ? ' tenant' : '') + '">' + esc(tip) + '</span>' : '') + '</td>' +
        '<td class="num">' + (r.fee > 0 ? fmtMoney(r.fee) : '<span class="muted">—</span>') + '</td>' +
        '<td class="num">' + (r.paid > 0 ? fmtMoney(r.paid) : '<span class="muted">—</span>') + '</td>' +
        '<td class="num">' + (r.remaining > 0
          ? '<span class="debt-amt">' + fmtMoney(r.remaining) + '</span>'
          : '<span class="muted">—</span>') + '</td>' +
        '<td>' + badge + '</td>' +
        '<td class="right"><span class="row-actions">' +
          '<button class="btn sm ghost" type="button" data-act="quick-pay-unit" data-id="' + esc(r.u.id) + '">Ödeme</button>' +
          (r.remaining > 0
            ? '<button class="btn sm ghost" type="button" data-act="remind-unit" data-id="' + esc(r.u.id) + '">Hatırlat</button>'
            : '') +
        '</span></td>' +
      '</tr>';
    }).join('');

    var unpaid = rows.reduce(function (s, r) { return s + r.remaining; }, 0);
    var cnt = rows.filter(function (r) { return r.status === 'unpaid' || r.status === 'partial'; }).length;
    $('#debtSum').innerHTML = monthLabel(c.asOf) + ' · <strong>' + fmtMoney(unpaid) + '</strong> eksik · ' + cnt + ' daire';
    var lg = $('#debtLegend');
    if (lg) lg.innerHTML = '<span class="hint">' + monthLabel(c.asOf) + ': o ay ödeme görünmeyen <strong>ve cari borcu olan</strong> daireler. Peşin ödeyenler “Borcu yok” görünür.</span>';
    $('#debtEmpty').hidden = rows.length > 0;
    $('#debtTable').style.display = rows.length ? '' : 'none';
  }

  function renderDebts(c) {
    var blocksList = blocks();
    var sel = $('#debtBlock');
    var curVal = sel.value;
    sel.innerHTML = '<option value="">Tüm bloklar</option>' + blocksList.map(function (b) {
      return '<option value="' + esc(b) + '">' + esc(b) + ' Blok</option>';
    }).join('');
    sel.value = curVal && blocksList.indexOf(curVal) >= 0 ? curVal : '';

    var q = ($('#debtSearch').value || '').toLocaleLowerCase('tr');
    var monthView = UI.debtView !== 'total';
    var seg = $('#debtSeg');
    if (seg) Array.prototype.forEach.call(seg.querySelectorAll('[data-view]'), function (b) {
      b.classList.toggle('is-on', (b.dataset.view === 'month') === monthView);
    });
    if (monthView) { renderMonthDebts(c, sel, q); return; }
    var lg2 = $('#debtLegend');
    if (lg2) lg2.innerHTML = '<span class="hint">Cari borç: devir + tahakkuk + faiz − ödemeler.</span>';
    var head = $('#debtHead');
    if (head) head.innerHTML = '<tr><th>Daire</th><th>Sakin</th><th class="num">Aidat</th>' +
      '<th class="num" title="Devir bakiyesi + aidat + ek tahakkuk">Tahakkuk</th>' +
      '<th class="num" title="Aylık aidatın %5\'i, 15\'inden sonra ödenen/ödenmeyen her ay için">Faiz</th>' +
      '<th class="num">Ödenen</th><th class="num">Kalan</th><th>Dönemler</th><th class="right">İşlem</th></tr>';
    var rows = c.rows.filter(function (r) {
      if (UI.onlyDebtors && r.debt <= 0.5) return false;
      if (sel.value && r.u.block !== sel.value) return false;
      if (q) {
        var hay = (r.label + ' ' + (r.u.owner || '') + ' ' + (r.u.phone || '') + ' ' + typeLabel(r.u)).toLocaleLowerCase('tr');
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    var tb = $('#debtTable tbody');
    tb.innerHTML = rows.map(function (r) {
      var lastMonths = r.months.slice(-6);
      var strip = lastMonths.map(function (m) {
        var ay = String(parseInt(m.month.split('-')[1], 10));
        return '<span class="ms ' + m.status + (m.late ? ' late' : '') + '" title="' + monthLabel(m.month) + ' · ' +
          (m.status === 'paid' ? 'Ödendi' : m.status === 'partial' ? 'Kısmi: ' + fmtMoney(m.paid) : 'Ödenmedi') +
          (m.late ? ' · %' + String(c.rate).replace('.', ',') + ' gecikme faizi' : '') + '">' + ay + '</span>';
      }).join('');

      var debtClass = r.debt > 0.5 ? '' : (r.debt < -0.5 ? ' credit' : ' zero');
      var debtTxt = fmtMoney(r.debt);
      var badge = r.debt > 0.5 ? '<span class="badge danger">Borçlu</span>' :
        (r.debt < -0.5 ? '<span class="badge info">Alacaklı</span>' : '<span class="badge ok">Kapalı</span>');
      var tip = typeLabel(r.u);

      return '<tr data-unit="' + esc(r.u.id) + '">' +
        '<td><button class="unit-btn" data-act="open-unit" data-id="' + esc(r.u.id) + '">' + esc(r.label) + '</button>' +
          (r.extra > 0 ? ' <span class="badge info" title="Ek tahakkuk: ' + fmtMoney(r.extra) + '">ek</span>' : '') + '</td>' +
        '<td class="owner-cell"><button class="owner-btn" type="button" data-act="open-unit" data-id="' + esc(r.u.id) + '" title="Ödeme geçmişini gör">' + (esc(r.u.owner) || '<span class="muted">—</span>') + '</button>' +
          (tip ? '<span class="type-badge' + (r.u.type === 'kiracı' ? ' tenant' : '') + '">' + esc(tip) + '</span>' : '') + '</td>' +
        '<td class="num">' + (r.fee > 0 ? fmtMoney(r.fee) : '<span class="muted" title="Aidat bu hesaba işlenmiyor">—</span>') + '</td>' +
        '<td class="num" title="Devir ' + fmtMoney(r.opening) + ' + aidat ' + fmtMoney(r.expected) + ' + ek ' + fmtMoney(r.extra) + '">' +
          fmtMoney(r.accrued) + '</td>' +
        '<td class="num">' + (r.penalty > 0 ? '<span class="faiz">' + fmtMoney(r.penalty) + '</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td class="num">' + fmtMoney(r.paid) + '</td>' +
        '<td class="num"><span class="debt-amt' + debtClass + '">' + debtTxt + '</span><div style="margin-top:3px">' + badge + '</div></td>' +
        '<td><div class="monthstrip">' + strip + '</div></td>' +
        '<td class="right"><span class="row-actions">' +
          '<button class="btn sm ghost" type="button" data-act="quick-pay-unit" data-id="' + esc(r.u.id) + '">Ödeme</button>' +
          (r.debt > 0.5
            ? '<button class="btn sm ghost" type="button" data-act="remind-unit" data-id="' + esc(r.u.id) + '">Hatırlat</button>'
            : '<button class="btn sm ghost" type="button" disabled title="Borç yok" style="opacity:.45;cursor:default">Hatırlat</button>') +
        '</span></td>' +
      '</tr>';
    }).join('');

    $('#debtEmpty').hidden = rows.length > 0;
    $('#debtTable').style.display = rows.length ? '' : 'none';
    $('#debtLegend').style.display = rows.length ? '' : 'none';

    var sum = rows.reduce(function (s, r) { return s + r.debt; }, 0);
    $('#debtSum').innerHTML = rows.length + ' hesap · toplam borç <strong>' + fmtMoney(sum) + '</strong>';
  }

  /* ---------------- render: payments ---------------- */
  function renderPayments() {
    fillUnitSelect($('#payUnit'));
    var q = ($('#paySearch').value || '').toLocaleLowerCase('tr');
    var list = DB.payments.slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    }).filter(function (p) {
      if (UI.scope !== 'all' && String(p.date || '').slice(0, 7) !== UI.asOf) return false;
      if (!q) return true;
      var u = unitById(p.unitId);
      var hay = ((u ? unitLabel(u) : '') + ' ' + (p.desc || '') + ' ' + (p.source || '') + ' ' + (p.type || '')).toLocaleLowerCase('tr');
      return hay.indexOf(q) >= 0;
    });

    var typeName = { aidat: 'Aidat', 'demirbaş': 'Demirbaş', ek: 'Ek tahakkuk', diger: 'Diğer' };
    $('#payTable tbody').innerHTML = list.map(function (p) {
      var u = unitById(p.unitId);
      return '<tr>' +
        '<td>' + fmtDate(p.date) + '</td>' +
        '<td><strong>' + esc(u ? unitLabel(u) : '—') + '</strong></td>' +
        '<td>' + (p.period ? monthLabel(p.period) : '<span class="muted">—</span>') + '</td>' +
        '<td><span class="badge info">' + esc(typeName[p.type] || p.type) + '</span></td>' +
        '<td class="owner-cell" title="' + esc(p.desc) + '">' + (esc(p.desc) || '<span class="muted">—</span>') + '</td>' +
        '<td><span class="badge">' + esc(p.source || '—') + '</span></td>' +
        '<td class="num"><strong>' + fmtMoney(p.amount) + '</strong></td>' +
        '<td class="right"><button class="icon-btn" type="button" data-act="del-payment" data-id="' + esc(p.id) + '" title="Ödemeyi sil" aria-label="Ödemeyi sil">✕</button></td>' +
      '</tr>';
    }).join('');

    $('#payEmpty').hidden = list.length > 0;
    $('#payTable').style.display = list.length ? '' : 'none';
    var sum = list.reduce(function (s, p) { return s + p.amount; }, 0);
    $('#paySum').innerHTML = list.length + ' kayıt · toplam <strong>' + fmtMoney(sum) + '</strong>';
    var psh = $('#payScopeHint');
    if (psh) psh.textContent = UI.scope === 'all' ? 'tüm aylar' : monthLabel(UI.asOf);
  }

  function renderPendingBar() {
    var bar = $('#pendingBar');
    if (!bar) return;
    var n = (DB.pending || []).length;
    if (!n) { bar.innerHTML = ''; return; }
    bar.innerHTML = '<div class="warn-box">' + n + ' eşleşmeyen Gmail bildirimi var. ' +
      '<button class="link" type="button" data-act="show-pending">Daire seçerek aktar</button></div>';
  }

  function showPending() {
    var pend = DB.pending || [];
    if (!pend.length) { toast('Bekleyen bildirim yok.'); return; }
    UI.importRows = pend.map(function (p) {
      return {
        include: true, date: p.date, unitId: '', type: p.type || 'aidat',
        amount: p.amount, desc: (p.text || p.desc || '').slice(0, 140),
        source: 'Gmail', pendingId: p.id
      };
    });
    renderImportPreview();
    $('#importPreviewCard').hidden = false;
    toast(pend.length + ' bildirim yüklendi; daireleri seçin.', 3600);
  }

  function fillUnitSelect(sel) {
    if (!sel) return;
    var prev = sel.value;
    var units = sortUnits(DB.units.filter(function (u) { return u.active !== false; }));
    sel.innerHTML = units.length
      ? units.map(function (u) {
          return '<option value="' + esc(u.id) + '">' + esc(selectLabel(u)) + '</option>';
        }).join('')
      : '<option value="">Önce daire ekleyin</option>';
    if (prev && units.some(function (u) { return u.id === prev; })) sel.value = prev;
  }

  /* ---------------- render: expenses ---------------- */
  function renderExpenses(c) {
    var sel = $('#expCategory');
    if (!sel.options.length) {
      sel.innerHTML = EXPENSE_CATEGORIES.map(function (x) {
        return '<option>' + esc(x) + '</option>';
      }).join('');
    }

    var budget = Number(DB.settings.budgetMonthly) || 0;
    var monthList = [], cur = c.asOf;
    for (var i = 0; i < 6; i++) { monthList.unshift(cur); cur = addMonths(cur, -1); }

    /* gider dağılımı + bütçe mini (Gider & Bütçe sekmesi) */
    var byCat = {};
    DB.expenses.forEach(function (e) {
      if (String(e.date || '') > c.asOf + '-31') return;
      byCat[e.category || 'Diğer'] = (byCat[e.category || 'Diğer'] || 0) + e.amount;
    });
    var catSegs = Object.keys(byCat)
      .map(function (k) { return { label: k, value: byCat[k] }; })
      .sort(function (a, b) { return b.value - a.value; })
      .map(function (s, i) { s.color = PALETTE[i % PALETTE.length]; return s; });
    var catTotal = catSegs.reduce(function (s, x) { return s + x.value; }, 0);
    var dg = $('#donutGider');
    if (dg) {
      dg.innerHTML = catTotal > 0
        ? '<div class="donut-wrap">' +
          donutSVG(catSegs, { centerValue: fmtShort(catTotal) + ' ₺', centerLabel: 'TOPLAM GİDER', aria: 'Gider dağılımı' }) +
          legendHTML(catSegs.slice(0, 6), catTotal) + '</div>'
        : '<div class="empty">Henüz gider kaydı yok.</div>';
    }
    var mini = $('#budgetMini');
    if (mini) {
      mini.innerHTML = '<div class="card-h"><h3>Aylık Bütçe · ' + monthLabel(c.asOf) + '</h3>' +
        '<button class="link" type="button" data-act="edit-budget">Düzenle</button></div>' +
        '<div class="budget-grid">' +
          '<div class="bstat"><div class="l">Bütçe</div><div class="v">' + (budget > 0 ? fmtMoney(budget) : '—') + '</div></div>' +
          '<div class="bstat"><div class="l">Harcanan</div><div class="v">' + fmtMoney(c.monthExpenses) + '</div>' +
            '<div class="progress' + (budget > 0 && c.monthExpenses > budget ? ' over' : '') + '"><i style="width:' +
            (budget > 0 ? Math.min(100, pct(c.monthExpenses, budget)) : 0) + '%"></i></div></div>' +
          '<div class="bstat"><div class="l">Kalan</div><div class="v">' + (budget > 0 ? fmtMoney(budget - c.monthExpenses) : '—') + '</div></div>' +
        '</div>';
    }

    var rowsHTML = monthList.map(function (k) {
      var spent = DB.expenses.filter(function (e) { return String(e.date || '').slice(0, 7) === k; })
        .reduce(function (s, e) { return s + e.amount; }, 0);
      var p = budget > 0 ? Math.min(100, pct(spent, budget)) : 0;
      return '<tr><td>' + monthLabel(k) + '</td>' +
        '<td class="num">' + fmtMoney(spent) + '</td>' +
        '<td class="num">' + (budget > 0 ? fmtMoney(Math.max(0, budget - spent)) : '—') + '</td>' +
        '<td style="width:38%"><div class="progress' + (budget > 0 && spent > budget ? ' over' : '') + '">' +
        '<i style="width:' + p + '%"></i></div></td></tr>';
    }).join('');

    var uniqD = {};
    c.rows.forEach(function (r) { uniqD[(r.u.block || '') + '|' + r.u.no] = 1; });
    var dTarget = c.demirbasTarget;
    var dPct = dTarget > 0 ? Math.min(100, pct(c.demirbas, dTarget)) : 0;
    var dCollected = round2((Number(DB.settings.demirbasCollected) || 0) + c.demirbasNew);
    var dSpent = round2((Number(DB.settings.demirbasSpent) || 0) + c.demirbasExpNew);
    var demirbasEksikList = demirbasMissing(c);
    var demirbasCard = '<div class="card">' +
      '<div class="card-h"><h3>Demirbaş Kasası</h3><button class="link" data-act="edit-demirbas">Bakiye / hedef düzenle</button></div>' +
      '<div class="budget-grid">' +
        '<div class="bstat"><div class="l">Toplanan</div><div class="v">' + fmtMoney(dCollected) + '</div>' +
          '<div class="small muted">' + (dTarget > 0 ? '%' + Math.min(100, Math.round(dCollected / dTarget * 100)) + ' hedef' : '') + '</div></div>' +
        '<div class="bstat"><div class="l">Harcanan</div><div class="v">' + fmtMoney(dSpent) + '</div></div>' +
        '<div class="bstat"><div class="l">Kalan bakiye</div><div class="v" style="color:' +
          (c.demirbasBalance < 0 ? 'var(--danger)' : 'var(--ok)') + '">' + fmtMoney(c.demirbasBalance) + '</div>' +
          '<div class="small muted">' + (c.demirbasAsOf ? fmtDate(c.demirbasAsOf) + ' itibarıyla' : '') + '</div></div>' +
        '<div class="bstat"><div class="l">Hedef</div><div class="v">' + (dTarget > 0 ? fmtMoney(dTarget) : '—') + '</div>' +
          (dTarget > 0 ? '<div class="progress"><i style="width:' + dPct + '%"></i></div>' : '') + '</div>' +
      '</div>' +
      '<p class="hint">Toplanan − Harcanan = Kalan. Yeni demirbaş tahsilatı bakiyeye eklenir, demirbaş gideri düşer.</p>' +
      '<p class="hint">Taahhüt: <strong>' + (Object.keys(uniqD).length - demirbasEksikList.length) + ' / ' + Object.keys(uniqD).length + ' daire</strong> ödedi' +
        (demirbasEksikList.length ? ' · eksik: ' + demirbasEksikList.map(function (x) { return esc(x.label); }).join(', ') : '') + '</p>' +
    '</div>';

    var catBudget = DB.settings.budgetByCategory || {};
    var monthCat = {};
    DB.expenses.filter(function (e) { return String(e.date || '').slice(0, 7) === c.asOf; })
      .forEach(function (e) { monthCat[e.category] = (monthCat[e.category] || 0) + e.amount; });
    var catKeys = {};
    EXPENSE_CATEGORIES.forEach(function (k) { catKeys[k] = 1; });
    Object.keys(monthCat).forEach(function (k) { catKeys[k] = 1; });
    Object.keys(catBudget).forEach(function (k) { catKeys[k] = 1; });

    var catCard = '<div class="card">' +
      '<div class="card-h"><h3>Kategori bütçesi · ' + monthLabel(c.asOf) + '</h3>' +
      '<button class="link" type="button" data-act="save-cat-budget">Limitleri kaydet</button></div>' +
      '<table class="mini-table"><thead><tr><th>Kategori</th><th class="num">Bu ay</th><th class="num">Limit</th><th style="width:30%">Durum</th></tr></thead><tbody>' +
      Object.keys(catKeys).sort().map(function (k) {
        var spent = monthCat[k] || 0;
        var lim = Number(catBudget[k]) || 0;
        var p = lim > 0 ? Math.min(100, pct(spent, lim)) : 0;
        return '<tr><td>' + esc(k) + '</td><td class="num">' + (spent ? fmtMoney(spent) : '—') + '</td>' +
          '<td class="num"><input class="cat-limit" data-cat="' + esc(k) + '" type="number" min="0" step="100" value="' +
          (lim || '') + '" placeholder="—" style="width:96px;text-align:right"></td>' +
          '<td>' + (lim > 0 ? '<div class="progress' + (spent > lim ? ' over' : '') + '"><i style="width:' + p + '%"></i></div>' +
            '<span class="small muted">' + (spent > lim ? 'aşıldı' : '%' + p) + '</span>' : '<span class="small muted">limit yok</span>') +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';

    // son 6 ay fatura / tüketim trendi
    var utilCats = ['Elektrik', 'Su', 'Doğalgaz'];
    var trend = [], mx = 0;
    monthList.forEach(function (k) {
      var per = {};
      DB.expenses.filter(function (e) { return String(e.date || '').slice(0, 7) === k && utilCats.indexOf(e.category) >= 0; })
        .forEach(function (e) { per[e.category] = (per[e.category] || 0) + e.amount; });
      var tot = Object.keys(per).reduce(function (s, x) { return s + per[x]; }, 0);
      mx = Math.max(mx, tot);
      trend.push({ k: k, per: per, tot: tot });
    });
    var trendCard = '<div class="card">' +
      '<div class="card-h"><h3>Fatura trendi (son 6 ay)</h3><span class="hint">Elektrik · Su · Doğalgaz</span></div>' +
      (mx > 0 ? trend.map(function (t) {
        return '<div style="margin-bottom:9px"><div class="small" style="display:flex;justify-content:space-between">' +
          '<span>' + monthLabel(t.k) + '</span><strong>' + fmtMoney(t.tot) + '</strong></div>' +
          '<div class="progress" style="height:9px"><i style="width:' + pct(t.tot, mx) + '%"></i></div>' +
          '<div class="small muted">' + utilCats.map(function (cc) { return t.per[cc] ? cc + ' ' + fmtMoney(t.per[cc]) : ''; })
            .filter(Boolean).join(' · ') + '</div></div>';
      }).join('') : '<p class="small muted">Fatura kaydı yok.</p>') +
      '</div>';

    // personel / taşeron ödeme planı
    var contracts = DB.contracts || [];
    var paidThisMonth = function (name) {
      var key = String(name || '').toLocaleLowerCase('tr');
      return DB.expenses.some(function (e) {
        if (String(e.date || '').slice(0, 7) !== c.asOf) return false;
        var hay = (String(e.desc || '') + ' ' + String(e.payee || '') + ' ' + String(e.category || '')).toLocaleLowerCase('tr');
        return key && hay.indexOf(key) >= 0;
      });
    };
    var contractCard = '<div class="card">' +
      '<div class="card-h"><h3>Personel / taşeron ödemeleri</h3><span class="hint">' + monthLabel(c.asOf) + '</span></div>' +
      (contracts.length ? '<table class="mini-table"><thead><tr><th>Ad</th><th>Kategori</th><th class="num">Aylık</th><th class="num">Gün</th><th></th></tr></thead><tbody>' +
        contracts.map(function (ct) {
          var ok = paidThisMonth(ct.name);
          return '<tr><td>' + esc(ct.name) + '</td><td><span class="badge info">' + esc(ct.category) + '</span></td>' +
            '<td class="num">' + fmtMoney(ct.amount) + '</td><td class="num">' + (ct.day || '—') + '</td>' +
            '<td class="num"><span class="badge ' + (ok ? 'ok' : 'warn') + '">' + (ok ? 'ödendi' : 'bekliyor') + '</span> ' +
            '<button class="icon-btn" type="button" data-act="del-contract" data-id="' + esc(ct.id) + '">✕</button></td></tr>';
        }).join('') + '</tbody></table>' : '<p class="small muted">Kayıtlı sözleşme yok.</p>') +
      '<div class="form-grid small-form" style="margin-top:10px">' +
        '<label>Ad<input id="ctName" placeholder="Lotus Güvenlik"></label>' +
        '<label>Kategori<select id="ctCat">' + EXPENSE_CATEGORIES.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select></label>' +
        '<label>Aylık tutar<input id="ctAmount" type="number" min="0" step="0.01"></label>' +
        '<label>Ödeme günü<input id="ctDay" type="number" min="1" max="31"></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn ghost" type="button" data-act="add-contract">Sözleşme ekle</button></div>' +
      '</div>';

    $('#budgetBox').innerHTML = demirbasCard + '<div class="card">' +
      '<div class="card-h"><h3>Aylık Bütçe Durumu · ' + monthLabel(c.asOf) + '</h3>' +
      '<button class="link" data-act="edit-budget">Bütçeyi düzenle</button></div>' +
      '<div class="budget-grid">' +
        '<div class="bstat"><div class="l">Aylık bütçe</div><div class="v">' + (budget > 0 ? fmtMoney(budget) : '—') + '</div></div>' +
        '<div class="bstat"><div class="l">Bu ay harcanan</div><div class="v">' + fmtMoney(c.monthExpenses) + '</div>' +
          '<div class="progress' + (budget > 0 && c.monthExpenses > budget ? ' over' : '') + '"><i style="width:' +
          (budget > 0 ? Math.min(100, pct(c.monthExpenses, budget)) : 0) + '%"></i></div></div>' +
        '<div class="bstat"><div class="l">Kalan bütçe</div><div class="v">' +
          (budget > 0 ? fmtMoney(budget - c.monthExpenses) : '—') + '</div></div>' +
        '<div class="bstat"><div class="l">Kasa bakiyesi</div><div class="v" style="color:' +
          (c.balance < 0 ? 'var(--danger)' : 'var(--ok)') + '">' + fmtMoney(c.balance) + '</div></div>' +
      '</div>' +
      (budget > 0 ? '' : '<div class="warn-box">Aylık bütçe belirlenmedi. “Bütçeyi düzenle” ile hedef gider tutarını girin; grafikler karşılaştırma yapar.</div>') +
      '<table class="budget-months"><thead><tr><th>Dönem</th><th class="num">Gider</th><th class="num">Kalan</th><th></th></tr></thead>' +
      '<tbody>' + rowsHTML + '</tbody></table></div>' + catCard + trendCard + contractCard;

    var list = DB.expenses.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    $('#expTable tbody').innerHTML = list.map(function (e) {
      return '<tr><td>' + fmtDate(e.date) + '</td>' +
        '<td><span class="badge info">' + esc(e.category) + '</span></td>' +
        '<td class="owner-cell" title="' + esc(e.desc) + '">' + (esc(e.desc) || '<span class="muted">—</span>') + '</td>' +
        '<td class="owner-cell">' + (esc(e.payee) || '<span class="muted">—</span>') + '</td>' +
        '<td class="num"><strong>' + fmtMoney(e.amount) + '</strong></td>' +
        '<td class="right"><button class="icon-btn" type="button" data-act="del-expense" data-id="' + esc(e.id) + '" title="Sil">✕</button></td></tr>';
    }).join('');
    $('#expEmpty').hidden = list.length > 0;
    $('#expTable').style.display = list.length ? '' : 'none';
  }

  /* ---------------- render: settings ---------------- */
  function bankLine(c) {
    var act = Number(DB.settings.cashActual);
    if (!(act > 0)) return '';
    var diff = round2(c.balance - act);
    var pend = (DB.outgoing || []).filter(function (o) { return !o.done && !o.ignored; }).length;
    return '<div class="bank-line' + (Math.abs(diff) > 0.5 ? ' has-diff' : '') + '">' +
      '<div><span class="l">Banka bakiyesi</span><span class="v">' + fmtMoney2(act) + '</span>' +
      '<em>' + fmtDate(DB.settings.cashActualDate || todayISO()) + ' itibarıyla</em></div>' +
      (Math.abs(diff) > 0.5
        ? '<div class="diff"><span>Kayıtla fark</span><strong>' + fmtMoney2(Math.abs(diff)) + '</strong>' +
          '<a href="#" data-act="goto-expenses">' + (pend ? pend + ' ödeme detay bekliyor →' : 'Detay gir →') + '</a></div>'
        : '<div class="diff ok"><span>Kayıtla fark</span><strong>yok</strong></div>') +
      '</div>';
  }

  function parseBankText(t) {
    var txt = String(t || '');
    var amount = 0;
    var m = txt.match(/([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})\s*(?:TL|TRY|₺)?/);
    if (m) amount = Number(m[1].replace(/\./g, '').replace(',', '.'));
    else {
      m = txt.match(/([0-9]+(?:[.,][0-9]{2})?)\s*(?:TL|TRY|₺)/i);
      if (m) amount = Number(m[1].replace(',', '.'));
    }
    var date = '';
    m = txt.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
    if (m) date = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    else {
      m = txt.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (m) date = m[0];
    }
    if (!date) date = todayISO();

    var desc = '', payee = '';
    // İş Bankası: "Gönderen / Açıklama: Güven Karataş*TR..*ŞAZELİ KONAKLARI..*..*FAST"
    var g = txt.match(/G[ÖO]NDEREN\s*\/\s*A[ÇC][İIıi]KLAMA\s*[:\-]?\s*([^\n]{3,240})/i);
    if (g) {
      var seg = g[1].split('*');
      var nm = (seg[0] || '').replace(/\s+/g, ' ').trim();
      if (nm && !/^TR\d/i.test(nm)) payee = nm;
      var note = (seg[2] || '').trim();
      if (payee && /tarafından aktarılan/i.test(note)) desc = payee + ' ödemesi';
    }
    if (!payee) {
      var a = txt.match(/(?:AL[İIıi]C[İIıi]|AL[İIıi]C[İIıi] AD[İIıi])\s*[:\-]?\s*([^\n*]{3,60})/i);
      if (a) payee = a[1].replace(/\s+/g, ' ').trim();
    }
    if (!desc) m = txt.match(/A[ÇC][İIıi]KLAMA\s*[:\-]?\s*([^\n]{3,120})/i);
    if (!desc && m) desc = m[1].trim();
    if (!desc) {
      var lines = txt.split(/\n+/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length > 8; });
      desc = (lines[0] || '').slice(0, 90);
    }
    var up = txt.replace(/G[ÖO]NDEREN[\s\S]{0,300}/i, ' ').toUpperCase(), cat = 'Diğer';
    [['Elektrik', /ELEKTR[İI]K|ENERJ[İI]SA/], ['Su', /\bSU\b|ASK[İI]/], ['Doğalgaz', /DO[ĞG]AZ|GAZDA[ŞS]/],
     ['Asansör', /ASANS[ÖO]R/], ['Temizlik', /TEM[İI]ZL[İI]K/], ['Güvenlik', /G[ÜU]VENL[İI]K/],
     ['Bahçe/Peyzaj', /BAH[ÇC]E|PEYZAJ/], ['Site Yönetim', /Y[ÖO]NET[İI]M|MAA[ŞS]|PERSONEL/],
     ['Bakım/Onarım', /BAKIM|ONARIM|TAM[İI]R/], ['İlaçlama', /[İI]LA[ÇC]LAMA/], ['Vergi/Harç', /VERG[İI]|HAR[ÇC]/]
    ].forEach(function (pair) { if (cat === 'Diğer' && pair[1].test(up)) cat = pair[0]; });

    return { amount: round2(amount), date: date, desc: desc || (payee ? payee + ' ödemesi' : ''), payee: payee, category: cat };
  }

  function renderOutgoing() {
    var card = $('#outCard'), box = $('#outBox');
    if (!card || !box) return;
    var list = (DB.outgoing || []).filter(function (o) { return !o.done && !o.ignored; });
    card.hidden = !list.length;
    if (!list.length) { box.innerHTML = ''; return; }
    $('#outHint').innerHTML = '<strong>' + list.length + '</strong> ödeme · ' +
      fmtMoney(list.reduce(function (a, o) { return a + (Number(o.amount) || 0); }, 0));
    box.innerHTML = list.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).map(function (o) {
      var id = esc(o.id);
      return '<div class="out-row" data-out="' + id + '">' +
        '<div class="out-top"><strong>' + fmtMoney2(o.amount) + '</strong>' +
          '<span>' + fmtDate(o.date) + '</span></div>' +
        '<div class="out-mail">' + esc(String(o.text || o.desc || '').slice(0, 220)) + '</div>' +
        '<div class="out-fields">' +
          '<label>Kategori<select id="oc-' + id + '">' + EXPENSE_CATEGORIES.map(function (x) {
            return '<option' + (x === (o.suggest || 'Diğer') ? ' selected' : '') + '>' + esc(x) + '</option>';
          }).join('') + '</select></label>' +
          '<label>Ödenen kişi / kurum<input id="op-' + id + '" value="' + esc(o.payee || '') + '" placeholder="Örn. Yönetim firması"></label>' +
          '<label>Açıklama<input id="od-' + id + '" value="' + esc(o.desc || '') + '" placeholder="Örn. Kasım elektrik bakım"></label>' +
        '</div>' +
        '<div class="out-acts">' +
          '<button class="btn sm primary" type="button" data-act="save-outgoing" data-id="' + id + '">Gidere işle</button>' +
          '<button class="btn sm ghost" type="button" data-act="ignore-outgoing" data-id="' + id + '">Yok say</button>' +
        '</div></div>';
    }).join('');
  }

  function renderSettingsExtra() {
    var box = $('#settingsExtra');
    if (!box) return;
    var users = DB.users || [];
    var closed = DB.closedMonths || [];
    box.innerHTML =
      '<div class="settings-grid" style="margin-top:14px">' +
        '<div>' +
          '<div class="card">' +
            '<div class="card-h"><h3>Kullanıcılar</h3><span class="hint">Yönetici şifresi ana şifredir</span></div>' +
            '<table class="mini-table"><thead><tr><th>Ad</th><th>Rol</th><th>Şifre</th><th></th></tr></thead><tbody>' +
            users.map(function (u) {
              return '<tr><td>' + esc(u.name) + '</td><td><span class="badge info">' +
                (u.role === 'viewer' ? 'Denetçi (salt-okunur)' : u.role === 'cashier' ? 'Kasiyer' : 'Yönetici') +
                '</span></td><td>' + (u.pass ? '••••' : '—') + '</td>' +
                '<td class="num">' + (u.id === 'u-admin' ? '' :
                  '<button class="icon-btn" type="button" data-act="del-user" data-id="' + esc(u.id) + '">✕</button>') + '</td></tr>';
            }).join('') + '</tbody></table>' +
            '<div class="form-grid small-form" style="margin-top:10px">' +
              '<label>Ad<input id="usName" placeholder="Örn. Ahmet (kasiyer)"></label>' +
              '<label>Rol<select id="usRole"><option value="cashier">Kasiyer</option><option value="viewer">Denetçi (salt-okunur)</option><option value="admin">Yönetici</option></select></label>' +
              '<label>Şifre<input id="usPass" placeholder="en az 4 karakter"></label>' +
            '</div>' +
            '<div class="form-actions"><button class="btn ghost" type="button" data-act="add-user">Kullanıcı ekle</button></div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-h"><h3>Ay kapanışı</h3><span class="hint">Kapanan ayda yeni kayıt engellenir</span></div>' +
            '<p class="small muted">Seçili dönemi kapatınca o aya ödeme/gider eklenemez. Gerekirse yeniden açabilirsiniz.</p>' +
            '<div class="form-actions"><button class="btn ghost" type="button" data-act="close-month">' + monthLabel(UI.asOf) + ' ayını kapat</button></div>' +
            (closed.length
              ? '<table class="mini-table"><thead><tr><th>Kapatılan ay</th><th></th></tr></thead><tbody>' +
                closed.slice().sort().reverse().map(function (m) {
                  return '<tr><td>' + monthLabel(m) + '</td><td class="num"><button class="link" type="button" data-act="open-month" data-id="' + esc(m) + '">yeniden aç</button></td></tr>';
                }).join('') + '</tbody></table>'
              : '<p class="small muted" style="margin-top:8px">Kapatılmış ay yok.</p>') +
          '</div>' +
        '</div>' +

        '<div>' +
          '<div class="card">' +
            '<div class="card-h"><h3>Yedekten geri yükleme</h3></div>' +
            '<p class="small muted">“Yedekle” ile indirdiğiniz JSON dosyasını seçin. Mevcut veri tamamen değiştirilir.</p>' +
            '<div class="form-actions"><label class="btn ghost" style="cursor:pointer">JSON dosyası seç' +
              '<input type="file" id="restoreFile" accept="application/json,.json" hidden></label></div>' +
          '</div>' +
          '<div class="card">' +
            '<div class="card-h"><h3>Sakin portalı</h3></div>' +
            '<p class="small muted">Her daireye özel bağlantı: <code>?daire=&lt;token&gt;</code> — sakin kendi borcunu ve ödeme geçmişini görür, değiştiremez.</p>' +
            '<div class="form-actions"><button class="btn ghost" type="button" data-act="print-portal-links">Bağlantı listesi (PDF)</button></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderSettings() {
    var uniq = {};
    DB.units.forEach(function (u) { uniq[(u.block || '') + '|' + u.no] = 1; });
    var counts = {
      units: Object.keys(uniq).length,
      accounts: DB.units.length,
      payments: DB.payments.length,
      charges: DB.charges.length,
      expenses: DB.expenses.length
    };
    var updated = DB.meta.updatedAt ? new Date(DB.meta.updatedAt) : null;

    $('#settingsBody').innerHTML =
      '<div class="settings-grid">' +
        '<div>' +
          '<div class="card">' +
            '<div class="card-h"><h3>Site Bilgileri</h3></div>' +
            '<div class="form-grid" style="grid-template-columns:1fr 1fr">' +
              '<label class="span-2">Site adı<input id="setSiteName" value="' + esc(DB.meta.siteName) + '"></label>' +
              '<label>Aylık aidat (₺)<input id="setFee" type="number" min="0" step="0.01" value="' + (DB.settings.monthlyFee || '') + '"></label>' +
              '<label>Aidat başlangıç ayı<input id="setStart" type="month" value="' + esc(DB.settings.startMonth) + '"></label>' +
              '<label>Aylık gider bütçesi (₺)<input id="setBudget" type="number" min="0" step="0.01" value="' + (DB.settings.budgetMonthly || '') + '"></label>' +
              '<label>Kasa devir bakiyesi (₺)<input id="setCash" type="number" step="0.01" value="' + (DB.settings.cashOpening || '') + '" placeholder="0"></label>' +
              '<label>Devir tarihi<input id="setCashDate" type="date" value="' + esc(DB.settings.cashOpeningDate || '') + '"></label>' +
              '<label>Bankadaki güncel bakiye (₺)<input id="setCashActual" type="number" step="0.01" value="' + (DB.settings.cashActual || '') + '" placeholder="Örn. 158026.15"></label>' +
              '<label>Bakiye tarihi<input id="setCashActualDate" type="date" value="' + esc(DB.settings.cashActualDate || '') + '"></label>' +
              '<label>Demirbaş hedefi (₺)<input id="setDemirbas" type="number" min="0" step="0.01" value="' + (DB.settings.demirbasTarget || '') + '" placeholder="120000"></label>' +
              '<label>Site başkanı<input id="setManager" value="' + esc(DB.settings.managerName || (DB.settings.board || {}).president || '') + '" placeholder="Ad Soyad"></label>' +
              '<label>Yardımcılar<input id="setDeputies" value="' + esc(((DB.settings.board || {}).deputies || []).join(', ')) + '" placeholder="Ad Soyad, Ad Soyad"></label>' +
              '<label>Denetçi<input id="setAuditor" value="' + esc((DB.settings.board || {}).auditor || '') + '" placeholder="Ad Soyad"></label>' +
              '<label>Gecikme faizi (%)<input id="setLateRate" type="number" min="0" max="100" step="0.1" value="' + (DB.settings.lateFeeRate != null ? DB.settings.lateFeeRate : 5) + '"></label>' +
              '<label>Son ödeme günü<input id="setLateDay" type="number" min="1" max="28" value="' + (DB.settings.lateFeeDay || 15) + '"></label>' +
              '<label class="span-2 check" style="flex-direction:row;align-items:center;gap:8px;margin-top:2px">' +
                '<input type="checkbox" id="setLateOn" ' + (DB.settings.lateFeeEnabled !== false ? 'checked' : '') + ' style="width:15px;height:15px;accent-color:var(--brand)">' +
                '<span style="font-weight:600;color:var(--ink-2);font-size:13px">Son ödeme gününden sonra ödenen/ödenmeyen her ay için gecikme faizi uygula</span></label>' +
              '<label class="span-2">İletişim notu (hatırlatma metninde görünür)<input id="setNote" value="' + esc(DB.settings.note) + '" placeholder="Örn. Ödemeler için IBAN: TR.. .."></label>' +
              '<label class="span-2 check" style="flex-direction:row;align-items:center;gap:8px;margin-top:2px">' +
                '<input type="checkbox" id="setViewer" ' + (DB.settings.role === 'viewer' ? 'checked' : '') + ' style="width:15px;height:15px;accent-color:var(--brand)">' +
                '<span style="font-weight:600;color:var(--ink-2);font-size:13px">Salt-okunur (denetçi) modu — bu cihazda hiçbir değişiklik kaydedilmez</span></label>' +
            '</div>' +
            '<div class="form-actions"><button class="btn primary" type="button" data-act="save-settings">Kaydet</button>' +
            '<span class="hint">Aidat değişikliği geçmiş dönemlere uygulanmaz; geçmiş kayıtlar silinmez.</span></div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-h"><h3>Daireler ve Hesaplar</h3><span class="hint">' + counts.units + ' daire · ' + counts.accounts + ' hesap</span></div>' +
            '<div class="units-scroll"><table class="units-table"><thead><tr>' +
              '<th style="width:54px">Blok</th><th style="width:58px">No</th><th style="width:84px">Tip</th><th>Sakin</th>' +
              '<th style="width:124px">Telefon</th><th style="width:86px">Aidat</th><th style="width:92px">Devir (₺)</th>' +
              '<th style="width:44px" title="Bu hesaba aylık aidat işlensin mi?">Aidat işle</th><th style="width:28px"></th>' +
            '</tr></thead><tbody>' +
            sortUnits(DB.units).map(function (u) {
              return '<tr>' +
                '<td><input data-unit-field="block" data-id="' + esc(u.id) + '" value="' + esc(u.block) + '" placeholder="A"></td>' +
                '<td><input data-unit-field="no" data-id="' + esc(u.id) + '" value="' + esc(u.no) + '"></td>' +
                '<td><select data-unit-field="type" data-id="' + esc(u.id) + '">' +
                  '<option value="malik"' + (u.type !== 'kiracı' ? ' selected' : '') + '>Malik</option>' +
                  '<option value="kiracı"' + (u.type === 'kiracı' ? ' selected' : '') + '>Kiracı</option>' +
                '</select></td>' +
                '<td><input data-unit-field="owner" data-id="' + esc(u.id) + '" value="' + esc(u.owner) + '" placeholder="Ad Soyad"></td>' +
                '<td><input data-unit-field="phone" data-id="' + esc(u.id) + '" value="' + esc(u.phone) + '" placeholder="05.."></td>' +
                '<td><input data-unit-field="fee" data-id="' + esc(u.id) + '" type="number" min="0" step="1" value="' + (u.fee || '') + '" placeholder="' + (DB.settings.monthlyFee || '') + '"></td>' +
                '<td><input data-unit-field="opening" data-id="' + esc(u.id) + '" type="number" step="0.01" value="' + (u.opening || '') + '" placeholder="0"></td>' +
                '<td style="text-align:center"><input type="checkbox" data-unit-field="billable" data-id="' + esc(u.id) + '" ' + (u.billable !== false ? 'checked' : '') + ' title="Aylık aidat bu hesaba işlensin"></td>' +
                '<td><button class="icon-btn" type="button" data-act="del-unit" data-id="' + esc(u.id) + '" title="Hesabı sil">✕</button></td>' +
              '</tr>';
            }).join('') +
            '</tbody></table></div>' +
            '<div class="form-actions" style="gap:8px;flex-wrap:wrap">' +
              '<input id="newBlock" class="input" style="width:64px;flex:none" placeholder="Blok">' +
              '<input id="newNo" class="input" style="width:72px;flex:none" placeholder="No">' +
              '<select id="newType" class="select" style="width:96px;flex:none"><option value="malik">Malik</option><option value="kiracı">Kiracı</option></select>' +
              '<input id="newOwner" class="input" style="flex:1;min-width:130px" placeholder="Ad soyad">' +
              '<button class="btn ghost" type="button" data-act="add-unit">+ Hesap Ekle</button>' +
            '</div>' +
            '<p class="hint" style="margin-top:8px">Aynı dairede malik ve kiracı ayrı hesap olarak durur. “Aidat işle” işaretli hesaba aylık aidat yazılır; diğeri yalnızca devir bakiyesini taşır.</p>' +
          '</div>' +
        '</div>' +

        '<div>' +
          '<div class="card">' +
            '<div class="card-h"><h3>Ortak veri (bulut)</h3><span class="hint">Supabase</span></div>' +
            '<p class="small muted">Kayıtlar ortak veritabanında tutulur; telefon, bilgisayar ve diğer sakinler aynı veriyi görür. Gmail bildirimleri Google tarafında 15 dakikada bir okunup buraya yazılır.</p>' +
            '<div class="form-grid" style="grid-template-columns:1fr">' +
              '<label>Sunucu adresi<input id="setCloudUrl" value="' + esc((DB.settings.cloud || {}).url || '') + '" placeholder="https://xxxx.supabase.co"></label>' +
              '<label>Yayın anahtarı (publishable)<input id="setCloudKey" value="' + esc((DB.settings.cloud || {}).key || '') + '"></label>' +
            '</div>' +
            '<div class="form-actions" style="flex-wrap:wrap">' +
              '<button class="btn primary" type="button" data-act="cloud-save">Kaydet ve bağlan</button>' +
              '<button class="btn ghost" type="button" data-act="cloud-push">Ortak veriye gönder</button>' +
              '<button class="btn ghost" type="button" data-act="cloud-pull">Ortak veriden çek</button>' +
            '</div>' +
            '<div class="kv"><span class="k">Durum</span><span class="v" id="cloudStatus">' + (cloudReady() ? 'bağlı' : 'kurulmadı') + '</span></div>' +
            '<div class="kv"><span class="k">Son Gmail kontrolü</span><span class="v">' +
              (DB.meta.lastMailCheck ? new Date(DB.meta.lastMailCheck).toLocaleString('tr-TR') : '—') + '</span></div>' +
            '<div class="kv"><span class="k">Eşleşmeyen bildirim</span><span class="v">' + ((DB.pending || []).length) + '</span></div>' +
            '<div class="kv"><span class="k">Otomatik kontrol</span><span class="v">15 dakikada bir (Google)</span></div>' +
            '<div class="kv"><span class="k">Son yedek</span><span class="v">' +
              (DB.meta.lastBackup ? new Date(DB.meta.lastBackup).toLocaleString('tr-TR') +
                (DB.meta.lastBackupResult ? ' · ' + esc(DB.meta.lastBackupResult) : '') : 'henüz yok') + '</span></div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-h"><h3>Güvenlik</h3></div>' +
            '<p class="small muted">Giriş şifresi tüm kullanıcılar için ortaktır. Şifre sayfanın içinde tanımlı olduğu için bu kapı meraklıyı durdurur; gerçek gizlilik gerekiyorsa söyleyin, erişimi Google hesabına bağlarız.</p>' +
            '<div class="form-actions" style="flex-wrap:wrap">' +
              '<button class="btn ghost" type="button" data-act="lock">Kilitle</button>' +
            '</div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-h"><h3>Toplu borç güncelle</h3></div>' +
            '<p class="small muted">Her satır bir hesap: <code>A-1 2.013,34</code> · <code>B-3 Kiracı 18.214,45</code> · <code>A BLOK 1 Malik 2.013,34</code>. Tutar, devir bakiyesini <strong>değiştirir</strong> (eklemez).</p>' +
            '<textarea id="bulkText" class="textarea" rows="5" placeholder="A-1 2013,34&#10;B-3 Kiracı 18214,45"></textarea>' +
            '<div class="form-actions">' +
              '<button class="btn ghost" type="button" data-act="bulk-preview">Kontrol et</button>' +
              '<button class="btn primary" type="button" data-act="bulk-apply">Uygula</button>' +
            '</div>' +
            '<div id="bulkPreview"></div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-h"><h3>Kurulum</h3></div>' +
            '<p class="small muted">Daire listesini sıfırdan oluşturur. Mevcut hesaplar ve onlara bağlı ödemeler silinir — önce yedek alın.</p>' +
            '<div class="form-actions"><button class="btn ghost" type="button" data-act="open-setup">Kurulum sihirbazı</button></div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-h"><h3>Yedekleme</h3></div>' +
            '<p class="small muted">Veriler bu cihazın tarayıcısında saklanır. Telefon/başka bilgisayarda görmek için yedeği indirip oradan yükleyin.</p>' +
            '<div class="form-actions" style="flex-wrap:wrap">' +
              '<button class="btn primary" type="button" data-act="export-json">JSON yedeği indir</button>' +
              '<button class="btn ghost" type="button" data-act="pick-json">Yedekten yükle</button>' +
              '<button class="btn ghost" type="button" data-act="print">Yazdır / PDF</button>' +
            '</div>' +
            '<div style="margin-top:14px">' +
              '<div class="kv"><span class="k">Daire / hesap</span><span class="v">' + counts.units + ' / ' + counts.accounts + '</span></div>' +
              '<div class="kv"><span class="k">Ödeme / tahakkuk / gider</span><span class="v">' +
                counts.payments + ' / ' + counts.charges + ' / ' + counts.expenses + '</span></div>' +
              '<div class="kv"><span class="k">Son kayıt</span><span class="v">' +
                (updated ? updated.toLocaleString('tr-TR') : '—') + '</span></div>' +
              '<div class="kv"><span class="k">Sürüm</span><span class="v">2.0</span></div>' +
            '</div>' +
            (counts.payments === 0 && counts.expenses === 0
              ? '<div class="form-actions"><button class="btn ghost" type="button" data-act="demo-data">Örnek veriyle doldur</button></div>'
              : '') +
          '</div>' +

          '<div class="card danger-zone">' +
            '<div class="card-h"><h3>Tehlikeli Bölge</h3></div>' +
            '<p class="small muted">Tüm hesap, ödeme ve gider kayıtları silinir. Önce yedek indirin.</p>' +
            '<div class="form-actions"><button class="btn danger" type="button" data-act="reset-all">Tüm verileri sil</button></div>' +
          '</div>' +

          '<div class="card note-card">' +
            '<h3>Gizlilik</h3>' +
            '<p class="small muted">Bu sayfa tamamen tarayıcıda çalışır; hiçbir kayıt sunucuya gönderilmez. Site adresi herkese açık olsa da veriler yalnızca sizin cihazınızda durur. Ortak kullanım için bulut senkronizasyonu (örn. Google Sheets) eklenebilir.</p>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- render: all ---------------- */
  function renderAll() {
    if (!DB.units.length && cloudReady()) {
      var ab = $('#alertBar');
      if (ab) ab.innerHTML = '<span class="alert-chip">Ortak veriler yükleniyor…</span>' +
        '<button class="alert-chip" type="button" data-act="cloud-retry">Yeniden dene</button>';
      return;
    }
    if (!DB) return;
    if (UI.scope !== 'all') UI.scope = 'month';
    if (!UI.asOf) UI.asOf = todayMonth();
    var sei = $('#scopeSeg');
    if (sei) {
      Array.prototype.forEach.call(sei.querySelectorAll('[data-scope]'), function (b) {
        b.classList.toggle('is-on', b.dataset.scope === UI.scope);
      });
    }
    document.body.classList.toggle('readonly', UI.role === 'viewer' || DB.settings.role === 'viewer');
    var c = computeAll(UI.asOf);
    renderHeader();
    renderPanel(c);
    renderDebts(c);
    renderPayments();
    renderExpenses(c);
    renderSettings();
    renderReports(c);
    renderReportDoc(c);
    renderWork(c);
    renderSettingsExtra();
    renderOutgoing();
    renderCashbook();
    renderBudgetVs();
    renderActionCenter(c);
    renderPendingBar();
    if (UI.drawerUnit) openUnitDrawer(UI.drawerUnit, true);
  }

  /* ---------------- drawer ---------------- */
  function openUnitDrawer(unitId, silent) {
    var u = unitById(unitId);
    if (!u) return;
    UI.drawerUnit = unitId;
    var c = computeAll(UI.asOf);
    var r = null;
    c.rows.forEach(function (x) { if (x.u.id === unitId) r = x; });
    if (!r) return;

    var tip = typeLabel(u);
    $('#drawerTitle').textContent = unitLabel(u) + (tip ? ' · ' + tip : '');
    $('#drawerSub').textContent = (u.owner || 'İsim girilmemiş') + (u.phone ? ' · ' + u.phone : '') +
      (r.billable ? '' : ' · aidat işlenmiyor');

    var pays = DB.payments.filter(function (p) { return p.unitId === unitId; })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var charges = DB.charges.filter(function (x) { return x.unitId === unitId; });

    var monthCells = r.months.slice().reverse().map(function (m) {
      return '<div class="mcell ' + m.status + (m.late ? ' late' : '') + '"><div class="m">' + monthLabel(m.month) + '</div>' +
        '<div class="s">' + (m.status === 'paid' ? 'Ödendi' : m.status === 'partial' ? 'Kısmi ' + fmtMoney(m.paid) : 'Ödenmedi') +
        (m.late ? ' + faiz' : '') + '</div></div>';
    }).join('');

    $('#drawerBody').innerHTML =
      '<div class="drawer-summary">' +
        '<div class="dsum"><div class="l">Devir bakiyesi</div><div class="v">' + fmtMoney(r.opening) + '</div></div>' +
        '<div class="dsum"><div class="l">Aidat tahakkuku</div><div class="v">' + fmtMoney(r.expected) + '</div></div>' +
        '<div class="dsum"><div class="l">Ek tahakkuk</div><div class="v">' + fmtMoney(r.extra) + '</div></div>' +
        '<div class="dsum"><div class="l">Gecikme faizi</div><div class="v" style="color:' + (r.penalty > 0 ? 'var(--warn)' : 'inherit') + '">' + fmtMoney(r.penalty) + '</div></div>' +
        '<div class="dsum"><div class="l">Ödenen</div><div class="v">' + fmtMoney(r.paid) + '</div></div>' +
        '<div class="dsum"><div class="l">Sakinin borcu</div><div class="v" style="color:' +
          (r.debt > 0.5 ? 'var(--danger)' : r.debt < -0.5 ? 'var(--brand)' : 'var(--ok)') + '">' + fmtMoney(r.debt) + '</div></div>' +
      '</div>' +

      (charges.length ? '<h4>Ek tahakkuklar</h4><table class="mini-table"><tbody>' +
        charges.map(function (ch) {
          return '<tr><td>' + esc(ch.label) + '<div class="small muted">' + fmtDate(ch.date) + '</div></td>' +
            '<td class="num">' + fmtMoney(ch.amount) + '</td>' +
            '<td class="num"><button class="icon-btn" type="button" data-act="del-charge" data-id="' + esc(ch.id) + '">✕</button></td></tr>';
        }).join('') + '</tbody></table>' : '') +

      '<h4>Dönemler</h4><div class="month-grid">' + monthCells + '</div>' +

      '<h4>Ödemeler</h4>' +
      (pays.length
        ? '<table class="mini-table"><thead><tr><th>Tarih</th><th>Açıklama</th><th class="num">Tutar</th></tr></thead><tbody>' +
          pays.map(function (p) {
            return '<tr><td>' + fmtDate(p.date) + '</td><td>' + (esc(p.desc) || '<span class="muted">—</span>') +
              '<div class="small muted">' + esc(p.source || '') + '</div></td>' +
              '<td class="num">' + fmtMoney(p.amount) + '</td>' +
              '<td class="num"><button class="icon-btn" type="button" title="Makbuz" data-act="print-receipt" data-unit="' + esc(u.id) +
              '" data-id="' + esc(p.id) + '">🧾</button></td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="small muted">Bu daireye ait ödeme kaydı yok.</p>') +

      '<h4>Sakin bilgileri</h4>' +
      '<div class="form-grid small-form">' +
        '<label>Telefon<input id="uiPhone" value="' + esc(u.phone || '') + '" placeholder="05xx…"></label>' +
        '<label>Araç plakası<input id="uiPlate" value="' + esc((u.extra || {}).plate || '') + '" placeholder="34 ABC 123"></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn ghost" type="button" data-act="save-unit-info" data-id="' + esc(u.id) + '">Bilgileri kaydet</button></div>' +

      '<div class="drawer-actions">' +
        '<button class="btn primary" type="button" data-act="quick-pay-unit" data-id="' + esc(u.id) + '">Ödeme ekle</button>' +
        '<button class="btn ghost" type="button" data-act="add-charge-unit" data-id="' + esc(u.id) + '">Ek tahakkuk</button>' +
        '<button class="btn ghost" type="button" data-act="print-statement" data-id="' + esc(u.id) + '">Ekstre (PDF)</button>' +
        '<button class="btn ghost" type="button" data-act="print-notice" data-id="' + esc(u.id) + '">Borç bildirimi</button>' +
        '<button class="btn ghost" type="button" data-act="remind-unit" data-id="' + esc(u.id) + '">Hatırlatma metni</button>' +
      '</div>';

    $('#drawer').hidden = false;
    $('#drawer').setAttribute('aria-hidden', 'false');
  }

  function closeDrawer() {
    UI.drawerUnit = null;
    $('#drawer').hidden = true;
    $('#drawer').setAttribute('aria-hidden', 'true');
  }

  /* ---------------- modal ---------------- */
  var PAGES = [
    { id: 'panel', name: 'Panel', desc: 'Özet, kasa, grafikler' },
    { id: 'debts', name: 'Daireler / Borçlar', desc: 'Daire listesi, cari borç, ekstre' },
    { id: 'payments', name: 'Ödemeler', desc: 'Tahsilat listesi, Excel/CSV yükle' },
    { id: 'expenses', name: 'Gider & Bütçe', desc: 'Giderler, kategori bütçesi, sözleşmeler' },
    { id: 'work', name: 'İşler', desc: 'Arıza/talep, demirbaş envanteri, toplantı' },
    { id: 'reports', name: 'Raporlar', desc: 'Kasa defteri, yaşlandırma, bütçe-gerçekleşen' },
    { id: 'report', name: 'Ay Sonu Raporu', desc: 'Aylık denetim dökümü' },
    { id: 'import', name: 'Gmail İçe Aktar', desc: 'Bekleyen banka bildirimleri' },
    { id: 'settings', name: 'Ayarlar', desc: 'Aidat, kullanıcılar, yedek, ay kapanışı' }
  ];

  function handleAction(act) {
    var b = document.createElement('button');
    b.dataset.act = act;
    b.style.display = 'none';
    document.body.appendChild(b);
    b.click();
    b.remove();
  }

  function openSearch() {
    openModal('Ara',
      '<input id="cmdInput" class="cmd-input" placeholder="Sayfa, işlem veya daire ara…" autocomplete="off">' +
      '<div id="cmdList" class="cmd-list"></div>' +
      '<p class="small muted" style="margin:8px 2px 0">Kısayol: ⌘K · Daire adı, plaka veya blok yazabilirsin.</p>');
    var inp = $('#cmdInput');
    inp.addEventListener('input', function () { renderCmdResults(inp.value); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = document.querySelector('#cmdList .cmd-item');
        if (first) first.click();
      }
    });
    renderCmdResults('');
    setTimeout(function () { inp.focus(); }, 60);
  }

  function renderCmdResults(q) {
    var box = $('#cmdList');
    if (!box) return;
    var nq = normName(q || '');
    var out = [];
    PAGES.forEach(function (p) {
      if (!nq || normName(p.name).indexOf(nq) >= 0 || normName(p.desc).indexOf(nq) >= 0)
        out.push({ kind: 'Sayfa', label: p.name, sub: p.desc, run: function () { setTab(p.id); } });
    });
    var ACTIONS = [
      ['Yeni ödeme gir', 'Tahsilat kaydı', function () { handleAction('quick-payment'); }],
      ['Yeni gider gir', 'Gider & bütçe', function () { setTab('expenses'); setTimeout(function () { var f = $('#expForm'); if (f && f.amount) f.amount.focus(); }, 250); }],
      ['Kasa defteri (PDF)', 'Raporlar', function () { setTab('reports'); setTimeout(printCashbook, 200); }],
      ['Borç bildirimi (PDF)', 'Tüm borçlular', function () { printNotices(true); }],
      ['Demirbaş envanteri', 'Alınanlar listesi', function () { setTab('work'); }],
      ['Arıza/talep kaydı aç', 'İşler', function () { setTab('work'); setTimeout(function () { var f = $('#tkTitle'); if (f) f.focus(); }, 250); }],
      ['Toplantı ekle', 'Karar defteri', function () { setTab('work'); setTimeout(function () { var f = $('#mtTitle'); if (f) f.focus(); }, 250); }],
      ['Yedek al (JSON)', 'Veriyi indir', function () { handleAction('export-json'); }],
      ['Ayarlar', 'Aidat, kullanıcı, kapanış', function () { setTab('settings'); }],
      ['Kilitle', 'Oturumu kapat', function () { handleAction('lock'); }]
    ];
    ACTIONS.forEach(function (a) {
      if (!nq || normName(a[0]).indexOf(nq) >= 0 || normName(a[1]).indexOf(nq) >= 0)
        out.push({ kind: 'İşlem', label: a[0], sub: a[1], run: a[2] });
    });
    var nqC = nq.replace(/[^a-z0-9]/g, '');
    if (nq.length >= 2) {
      DB.units.filter(function (u) {
        var hay = normName(unitLabel(u) + ' ' + (u.owner || '') + ' ' + (u.plate || '') + ' ' + (u.phone || ''));
        var hayC = hay.replace(/[^a-z0-9]/g, '');
        return hay.indexOf(nq) >= 0 || (nqC && hayC.indexOf(nqC) >= 0);
      }).slice(0, 8).forEach(function (u) {
        out.push({ kind: 'Daire', label: unitLabel(u) + ' · ' + (u.owner || ''), sub: (u.plate ? u.plate + ' · ' : '') + (u.type || 'malik'),
          run: function () { closeModal(); setTab('debts'); setTimeout(function () { openUnitDrawer(u.id); }, 200); } });
      });
    }
    if (!out.length) { box.innerHTML = '<p class="small muted" style="padding:10px 4px">Sonuç yok.</p>'; return; }
    box.innerHTML = out.slice(0, 24).map(function (r, i) {
      return '<button type="button" class="cmd-item" data-i="' + i + '"><span class="cmd-kind">' + r.kind + '</span>' +
        '<span class="cmd-main"><strong>' + esc(r.label) + '</strong><em>' + esc(r.sub || '') + '</em></span></button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.cmd-item'), function (btn) {
      btn.addEventListener('click', function () {
        var r = out[Number(btn.dataset.i)];
        closeModal();
        if (r && r.run) r.run();
      });
    });
  }

  function openModal(title, bodyHTML) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
    $('#modal').hidden = false;
  }
  function closeModal() {
    $('#modal').hidden = true;
  }

  function trTitle(s) {
    return String(s || '').toLocaleLowerCase('tr').replace(/(^|\s)(\S)/g, function (m, a, b) {
      return a + b.toLocaleUpperCase('tr');
    });
  }

  function reminderShort(r) {
    var u = r.u;
    var L = [];
    L.push('Sayın ' + trTitle(u.owner || (r.label + ' sakini')) + ',');
    L.push(DB.meta.siteName + ' ' + r.label + ' hesabınızda ' + fmtMoney2(Math.max(0, r.debt)) + ' borç görünüyor.');
    L.push('Son ödeme günü ' + (DB.settings.lateFeeDay || 15) + '. Sonrası için aylık %' +
      String(DB.settings.lateFeeRate || 0).replace('.', ',') + ' gecikme faizi uygulanır.');
    if (DB.settings.note) L.push(DB.settings.note);
    L.push('— ' + (DB.settings.managerName || DB.meta.siteName));
    return L.join('\n');
  }

  function reminderText(r) {
    var u = r.u;
    var tip = typeLabel(u);
    var lines = [];
    lines.push('Sayın ' + (u.owner || (r.label + ' numaralı daire sakini')) + ',');
    lines.push('');
    lines.push((DB.meta.siteName || 'Site') + ' ' + r.label + (tip ? ' (' + tip + ')' : '') + ' hesabı için ' +
      fmtMoney(Math.max(0, r.debt)) + ' tutarında borç görünmektedir.');
    if (r.penalty > 0) lines.push('(Bunun ' + fmtMoney(r.penalty) + ' kadarı gecikme faizidir.)');
    else if (r.extraLeft > 0) lines.push('(Bunun ' + fmtMoney(r.extraLeft) + ' kadarı ek tahakkuktur.)');
    if (DB.settings.note) lines.push('');
    if (DB.settings.note) lines.push(DB.settings.note);
    lines.push('');
    lines.push('Bilgilendirme için teşekkürler.');
    lines.push('— ' + (DB.settings.managerName || (DB.meta.siteName + ' Site Yönetimi')));
    return lines.join('\n');
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('Hatırlatma metni kopyalandı.');
      }).catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Hatırlatma metni kopyalandı.'); }
    catch (e) { toast('Kopyalanamadı, metni elle seçin.'); }
    document.body.removeChild(ta);
  }

  /* ---------------- onboarding ---------------- */
  function openSetup() {
    var d = new Date();
    var defStart = todayMonth();
    openModal('Kurulum sihirbazı',
      '<div class="warn-box" style="margin-bottom:14px">Elinde hazır sakin listesi (JSON) varsa sihirbazı atla: ' +
        '<button class="link" type="button" data-act="pick-json">dosyadan yükle</button> · ' +
        '<button class="link" type="button" data-act="paste-json">yapıştır</button></div>' +
      '<p class="lead">Siteyi 30 saniyede kurun. Daireler otomatik oluşturulur; sonra tek tek isim ekleyebilirsiniz.</p>' +
      '<div class="form-grid">' +
        '<label class="span-2">Site adı<input id="wName" value="' + esc(DB.meta.siteName || 'Şazeli Konakları') + '"></label>' +
        '<label>Blok sayısı<input id="wBlocks" type="number" min="1" max="8" value="1"></label>' +
        '<label>Her blokta daire<input id="wPerBlock" type="number" min="1" max="120" value="12"></label>' +
        '<label>Aylık aidat (₺)<input id="wFee" type="number" min="0" step="0.01" value="' + (DB.settings.monthlyFee || 750) + '"></label>' +
        '<label>Aidat başlangıç ayı<input id="wStart" type="month" value="' + esc(DB.settings.startMonth || defStart) + '"></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="button" data-act="run-setup">Daireleri oluştur</button>' +
      '<button class="btn ghost" type="button" data-act="close-modal">Vazgeç</button></div>' +
      '<p class="hint" style="margin-top:10px">Tek blok seçilirse daireler 1, 2, 3… olarak numaralanır; birden fazla blokta A-1, B-1 biçiminde görünür.</p>');
  }

  function runSetup() {
    var name = ($('#wName').value || '').trim() || 'Şazeli Konakları';
    var nBlocks = Math.max(1, Math.min(8, parseInt($('#wBlocks').value, 10) || 1));
    var per = Math.max(1, Math.min(120, parseInt($('#wPerBlock').value, 10) || 12));
    var fee = Math.max(0, parseFloat(($('#wFee').value || '0').replace(',', '.')) || 0);
    var start = $('#wStart').value || todayMonth();

    var units = [];
    for (var b = 0; b < nBlocks; b++) {
      var blk = nBlocks > 1 ? String.fromCharCode(65 + b) : '';
      for (var i = 1; i <= per; i++) {
        units.push({
          id: uid('u'), block: blk, no: String(i), owner: '', phone: '',
          fee: null, active: true, type: 'malik', opening: 0, billable: true
        });
      }
    }

    if (DB.units.length) {
      var msg = 'Mevcut ' + DB.units.length + ' daire silinip ' + units.length + ' daire oluşturulacak.';
      if (DB.payments.length || DB.charges.length) {
        msg += '\n\nEski dairelere bağlı ' + DB.payments.length + ' ödeme ve ' +
          DB.charges.length + ' ek tahakkuk kaydı da silinecek.';
      }
      if (!confirm(msg + '\n\nDevam edilsin mi?')) return;
      DB.payments = [];
      DB.charges = [];
    }

    DB.units = units;
    DB.meta.siteName = name;
    DB.settings.monthlyFee = fee;
    DB.settings.startMonth = start;
    saveDB();
    closeModal();
    renderAll();
    toast(units.length + ' daire oluşturuldu.');
  }

  /* ---------------- payment form ---------------- */
  function defaultPayForm() {
    var f = $('#payForm');
    if (!f) return;
    if (!f.date.value) f.date.value = todayISO();
    if (!f.period.value) f.period.value = todayMonth();
  }

  function monthClosed(m) { return (DB.closedMonths || []).indexOf(String(m || '').slice(0, 7)) >= 0; }

  function addPayment(p) {
    if (monthClosed(p.date)) {
      toast(monthLabel(String(p.date).slice(0, 7)) + ' kapatıldı — önce Ayarlar’dan yeniden açın.', 5200);
      return false;
    }
    DB.payments.push({
      id: uid('p'), unitId: p.unitId, date: p.date || todayISO(),
      period: p.period || (p.date || todayISO()).slice(0, 7),
      type: p.type || 'aidat', amount: round2(p.amount), desc: p.desc || '',
      source: p.source || 'Gmail', createdAt: new Date().toISOString()
    });
    var apu = unitById(p.unitId);
    addLog('Ödeme eklendi', (apu ? unitLabel(apu) : '') + ' · ' + fmtMoney(p.amount) + ' · ' + (p.source || 'Gmail'));
    return true;
  }

  /* ---------------- Gmail / text parsing ---------------- */
  function normalizeText(t) {
    return String(t || '').replace(/\r/g, '').replace(/\u00a0/g, ' ')
      .replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  }

  function parseAmountLoose(raw) {
    var t = String(raw || '').replace(/[^\d.,]/g, '');
    if (!t || !/\d/.test(t)) return null;
    var hasDot = t.indexOf('.') >= 0, hasComma = t.indexOf(',') >= 0;
    if (hasDot && hasComma) {
      if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
      else t = t.replace(/,/g, '');
    } else if (hasComma) {
      var cp = t.split(',');
      if (cp.length === 2 && cp[1].length <= 2) t = cp[0] + '.' + cp[1];
      else t = t.replace(/,/g, '');
    } else if (hasDot) {
      var dp = t.split('.');
      if (dp.length > 2) t = dp.join('');
      else if (dp[1].length === 3 && dp[0].length <= 3) t = dp.join('');
    }
    var n = parseFloat(t);
    return isFinite(n) ? round2(n) : null;
  }

  function extractAmount(block) {
    var pats = [
      /(?:tutar|miktar|toplam|ödeme|odeme|gönderilen|gonderilen)\s*[:\-]?\s*([\d][\d.,]*)\s*(?:tl|try|₺)?/i,
      /([\d][\d.,]*)\s*(?:tl|try|₺)/i,
      /(?:tl|try|₺)\s*([\d][\d.,]*)/i,
      /\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/,
      /\b(\d+\.\d{2})\b/
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = block.match(pats[i]);
      if (m) {
        var n = parseAmountLoose(m[1]);
        if (n != null && n > 0) return n;
      }
    }
    return null;
  }

  function extractDate(text) {
    var m = text.match(/\b(\d{2})[.\/-](\d{2})[.\/-](\d{4})\b/);
    if (m) return m[3] + '-' + m[2] + '-' + m[1];
    m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (m) return m[0];
    m = text.match(/\b(\d{1,2})\s+(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\s+(\d{4})\b/i);
    if (m) {
      var idx = MONTH_NAMES.map(function (x) { return x.toLocaleLowerCase('tr'); })
        .indexOf(m[2].toLocaleLowerCase('tr')) + 1;
      if (idx > 0) return m[3] + '-' + pad2(idx) + '-' + pad2(parseInt(m[1], 10));
    }
    return todayISO();
  }

  function extractUnitId(text, units) {
    var norm = ' ' + text.toLocaleLowerCase('tr').replace(/\s+/g, ' ') + ' ';

    function pick(list) {
      if (!list.length) return '';
      var billable = list.filter(function (u) { return u.billable !== false; });
      return (billable[0] || list[0]).id;
    }

    var m = norm.match(/daire\s*(?:no|numara|numaras[ıi]|numaral[ıi])?\s*[:#.\-]?\s*([a-z]{1,2})?\s*[-\/ ]?\s*(\d{1,3})\b/);
    if (m) {
      var blk = (m[1] || '').toUpperCase(), no = m[2];
      var cands = units.filter(function (u) {
        return String(u.block || '').toUpperCase() === blk && String(u.no) === no;
      });
      if (!cands.length) cands = units.filter(function (u) { return String(u.no) === no; });
      if (cands.length) return pick(cands);
    }

    var m2 = norm.match(/\b([a-z])\s*[-\/]\s*(\d{1,3})\b/);
    if (m2) {
      var b2 = m2[1].toUpperCase(), n2 = m2[2];
      var c2 = units.filter(function (u) {
        return String(u.block || '').toUpperCase() === b2 && String(u.no) === n2;
      });
      if (!c2.length) c2 = units.filter(function (u) { return String(u.no) === n2; });
      if (c2.length) return pick(c2);
    }

    var m3 = norm.match(/\b(\d{1,3})\s*(?:nolu|numaral[ıi])\b/);
    if (m3) {
      var c3 = units.filter(function (u) { return String(u.no) === m3[1]; });
      if (c3.length) return pick(c3);
    }
    return '';
  }

  function extractDesc(block) {
    var m = block.match(/(?:a[çc][ıi]klama|desc|mesaj)\s*[:\-]\s*(.+)/i);
    if (m) return m[1].trim().slice(0, 140);
    var first = block.split('\n').map(function (s) { return s.trim(); }).filter(Boolean)[0] || '';
    return first.replace(/\s+/g, ' ').slice(0, 140);
  }

  function splitRecords(text) {
    var t = normalizeText(text).trim();
    if (!t) return [];
    var parts = t.split(/\n\s*\n+/);
    if (parts.length === 1) {
      parts = t.split(/\n(?=(?:konu|say[ıi]n|sn\.|g[öo]nderen|tarih|tutar)\b)/i);
    }
    parts = parts.map(function (p) { return p.trim(); }).filter(function (p) {
      return p.length > 3 && /\d/.test(p);
    });
    return parts;
  }

  function parseImportText(text) {
    var units = DB.units.filter(function (u) { return u.active !== false; });
    var records = splitRecords(text);
    var rows = [];
    records.forEach(function (rec) {
      var amt = extractAmount(rec);
      if (amt == null) return;
      var date = extractDate(rec);
      rows.push({
        include: true,
        date: date,
        unitId: extractUnitId(rec, units),
        type: 'aidat',
        amount: amt,
        desc: extractDesc(rec),
        source: 'Gmail',
        raw: rec
      });
    });
    return rows;
  }

  function renderImportPreview() {
    var rows = UI.importRows || [];
    $('#importPreviewCard').hidden = rows.length === 0;
    if (!rows.length) return;
    $('#importCount').textContent = rows.length + ' kayıt bulundu · daire eşleşmeyenleri seçin';
    var units = sortUnits(DB.units);
    $('#importTable tbody').innerHTML = rows.map(function (r, i) {
      return '<tr>' +
        '<td><input type="checkbox" data-imp="include" data-i="' + i + '"' + (r.include ? ' checked' : '') + '></td>' +
        '<td><input type="date" class="input" style="padding:5px 7px;font-size:12.5px" data-imp="date" data-i="' + i + '" value="' + esc(r.date) + '"></td>' +
        '<td><select class="select" style="padding:5px 7px;font-size:12.5px" data-imp="unitId" data-i="' + i + '">' +
          '<option value="">— seçin —</option>' +
          units.map(function (u) {
            return '<option value="' + esc(u.id) + '"' + (u.id === r.unitId ? ' selected' : '') + '>' + esc(unitOption(u)) + '</option>';
          }).join('') + '</select></td>' +
        '<td><select class="select" style="padding:5px 7px;font-size:12.5px" data-imp="type" data-i="' + i + '">' +
          ['aidat', 'demirbaş', 'ek', 'diger'].map(function (tp) {
            var nm = { aidat: 'Aidat', 'demirbaş': 'Demirbaş', ek: 'Ek tahakkuk', diger: 'Diğer' }[tp];
            return '<option value="' + tp + '"' + (tp === r.type ? ' selected' : '') + '>' + nm + '</option>';
          }).join('') + '</select></td>' +
        '<td class="num"><input type="number" step="0.01" min="0" class="input" style="width:104px;text-align:right;padding:5px 7px;font-size:12.5px" data-imp="amount" data-i="' + i + '" value="' + r.amount + '"></td>' +
        '<td><input class="input" style="width:100%;padding:5px 7px;font-size:12.5px" data-imp="desc" data-i="' + i + '" value="' + esc(r.desc) + '"></td>' +
      '</tr>';
    }).join('');
  }

  /* ---------------- CSV ---------------- */
  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 300);
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v).replace(/"/g, '""');
    return '"' + s + '"';
  }
  function csvNum(n) { return String(round2(n)).replace('.', ','); }

  function exportDebtsCSV() {
    var c = computeAll(UI.asOf);
    var lines = [['Daire', 'Blok', 'No', 'Tip', 'Sakin', 'Telefon', 'Aylık Aidat', 'Devir', 'Tahakkuk', 'Gecikme Faizi', 'Ödenen', 'Sakinin Borcu', 'Durum'].map(csvCell).join(';')];
    c.rows.forEach(function (r) {
      lines.push([r.label, r.u.block || '', r.u.no, typeLabel(r.u), r.u.owner || '', r.u.phone || '',
        csvNum(r.fee), csvNum(r.opening), csvNum(r.accrued), csvNum(r.penalty), csvNum(r.paid), csvNum(r.debt),
        r.debt > 0.5 ? 'Borçlu' : r.debt < -0.5 ? 'Alacaklı' : 'Kapalı'].map(csvCell).join(';'));
    });
    download('sazeli-borclar-' + UI.asOf + '.csv', '\ufeff' + lines.join('\r\n'));
    toast('Borç listesi CSV olarak indirildi.');
  }

  function exportPaymentsCSV() {
    var lines = [['Tarih', 'Daire', 'Tür', 'Dönem', 'Açıklama', 'Kaynak', 'Tutar'].map(csvCell).join(';')];
    DB.payments.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }).forEach(function (p) {
      var u = unitById(p.unitId);
      lines.push([fmtDate(p.date), u ? unitLabel(u) : '', p.type, p.period || '', p.desc || '', p.source || '', csvNum(p.amount)]
        .map(csvCell).join(';'));
    });
    download('sazeli-odemeler-' + todayISO() + '.csv', '\ufeff' + lines.join('\r\n'));
    toast('Ödemeler CSV olarak indirildi.');
  }

  function exportExpensesCSV() {
    var lines = [['Tarih', 'Kategori', 'Açıklama', 'Ödenen', 'Tutar'].map(csvCell).join(';')];
    DB.expenses.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }).forEach(function (e) {
      lines.push([fmtDate(e.date), e.category, e.desc || '', e.payee || '', csvNum(e.amount)].map(csvCell).join(';'));
    });
    download('sazeli-giderler-' + todayISO() + '.csv', '\ufeff' + lines.join('\r\n'));
    toast('Giderler CSV olarak indirildi.');
  }

  /* ---------------- demo data ---------------- */
  function addDemoData() {
    if (!DB.units.length) { toast('Önce daireleri oluşturun.'); return; }
    if (!DB.settings.monthlyFee) { toast('Önce Ayarlar’dan aylık aidat tutarını girin.'); return; }
    if ((DB.payments.length || DB.expenses.length) &&
      !confirm('Mevcut ödeme/gider kayıtlarının üzerine örnek veriler eklenecek. Devam edilsin mi?')) return;

    var today = new Date();
    var cats = EXPENSE_CATEGORIES;
    var units = DB.units;
    var startM = DB.settings.startMonth || todayMonth();
    var months = [];
    for (var k = 3; k >= 0; k--) {
      var mk = addMonths(todayMonth(), -k);
      if (mk >= startM) months.push(mk);
    }
    if (!months.length) months = [todayMonth()];

    months.forEach(function (mk, mi) {
      var isLast = mi === months.length - 1;
      units.forEach(function (u, i) {
        if (u.billable === false) return;
        if (isLast && i % 4 === 1) return;          // son ay bazı daireler ödemesin
        if ((i + mi) % 7 === 3) return;             // ara ara eksik ödeme
        var day = 3 + ((i * 3 + mi) % 20);
        DB.payments.push({
          id: uid('p'), unitId: u.id,
          date: mk + '-' + pad2(day), period: mk, type: 'aidat',
          amount: unitFee(u), desc: monthLabel(mk) + ' aidatı', source: 'Gmail',
          createdAt: new Date().toISOString()
        });
      });
      DB.expenses.push({
        id: uid('e'), date: mk + '-05', category: 'Temizlik',
        amount: 2400, desc: 'Merdiven ve ortak alan temizliği', payee: 'Temizlik firması'
      });
      DB.expenses.push({
        id: uid('e'), date: mk + '-10', category: 'Elektrik',
        amount: 1850 + mi * 90, desc: 'Ortak alan elektrik faturası', payee: 'EnerjiSA'
      });
      if (mi % 2 === 0) DB.expenses.push({
        id: uid('e'), date: mk + '-14', category: cats[(mi + 4) % cats.length],
        amount: 900 + mi * 120, desc: 'Periyodik bakım', payee: 'Servis'
      });
    });
    // bir daireye ek tahakkuk
    DB.charges.push({
      id: uid('c'), unitId: units[0].id, date: todayISO(),
      label: 'Asansör bakım payı', amount: 750
    });
    DB.settings.budgetMonthly = DB.settings.budgetMonthly || 5000;
    saveDB();
    renderAll();
    toast('Örnek veriler eklendi.');
  }

  /* ---------------- wiring ---------------- */
  function setTab(name) {
    UI.tab = name;
    $$('.tab').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === name); });
    $$('.view').forEach(function (v) { v.classList.toggle('is-active', v.id === 'view-' + name); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openPaymentModal(unitId) {
    var units = sortUnits(DB.units);
    if (!units.length) { toast('Önce daire ekleyin.'); setTab('settings'); return; }
    openModal('Ödeme ekle',
      '<div class="form-grid">' +
        '<label>Daire<select id="mUnit">' + units.map(function (u) {
          return '<option value="' + esc(u.id) + '"' + (u.id === unitId ? ' selected' : '') + '>' + esc(selectLabel(u)) + '</option>';
        }).join('') + '</select></label>' +
        '<label>Tarih<input id="mDate" type="date" value="' + todayISO() + '"></label>' +
        '<label>Tutar (₺)<input id="mAmount" type="number" min="0" step="0.01" placeholder="0,00"></label>' +
        '<label>Dönem<input id="mPeriod" type="month" value="' + todayMonth() + '"></label>' +
        '<label>Tür<select id="mType"><option value="aidat">Aidat</option><option value="demirbaş">Demirbaş</option><option value="ek">Ek tahakkuk ödemesi</option><option value="diger">Diğer</option></select></label>' +
        '<label>Kasa<select id="mFund"><option value="butce">Bütçe (aidat)</option><option value="demirbas">Demirbaş kasası</option></select></label>' +
        '<label>Kaynak<select id="mSource"><option>Gmail</option><option>Havale/EFT</option><option>Nakit</option><option>Diğer</option></select></label>' +
        '<label class="span-2">Açıklama<input id="mDesc" placeholder="Örn. Kasım aidatı"></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="button" data-act="save-modal-payment">Kaydet</button>' +
      '<button class="btn ghost" type="button" data-act="close-modal">Vazgeç</button></div>');
    setTimeout(function () { var el = $('#mAmount'); if (el) el.focus(); }, 60);
  }

  function openChargeModal(unitId) {
    var units = sortUnits(DB.units);
    if (!units.length) { toast('Önce daire ekleyin.'); return; }
    openModal('Ek tahakkuk ekle',
      '<p class="lead">Aidat dışında daireye yansıtılan tutar (ör. asansör bakım payı, ortak alan hasar bedeli).</p>' +
      '<div class="form-grid">' +
        '<label>Daire<select id="cUnit">' + units.map(function (u) {
          return '<option value="' + esc(u.id) + '"' + (u.id === unitId ? ' selected' : '') + '>' + esc(selectLabel(u)) + '</option>';
        }).join('') + '</select></label>' +
        '<label>Tarih<input id="cDate" type="date" value="' + todayISO() + '"></label>' +
        '<label class="span-2">Açıklama<input id="cLabel" placeholder="Örn. Asansör bakım payı"></label>' +
        '<label>Tutar (₺)<input id="cAmount" type="number" min="0" step="0.01" placeholder="0,00"></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="button" data-act="save-charge">Kaydet</button>' +
      '<button class="btn ghost" type="button" data-act="close-modal">Vazgeç</button></div>');
  }

  function openBudgetModal() {
    openModal('Aylık bütçe',
      '<p class="lead">Aylık ortalama gider hedefi. Bütçe karşılaştırması ve uyarılar buna göre hesaplanır.</p>' +
      '<div class="form-grid"><label class="span-2">Aylık gider bütçesi (₺)<input id="bAmount" type="number" min="0" step="0.01" value="' +
      (DB.settings.budgetMonthly || '') + '"></label></div>' +
      '<div class="form-actions"><button class="btn primary" type="button" data-act="save-budget">Kaydet</button>' +
      '<button class="btn ghost" type="button" data-act="close-modal">Vazgeç</button></div>');
  }

  /* ---------------- duyurular, işlem geçmişi, raporlar ---------------- */

  function addLog(action, detail) {
    DB.log = DB.log || [];
    DB.log.unshift({
      id: uid('l'), at: new Date().toISOString(),
      who: DB.settings.managerName || 'Yönetim', action: action, detail: detail || ''
    });
    if (DB.log.length > 300) DB.log.length = 300;
  }

  function renderAnnouncements() {
    var box = $('#announceBox');
    if (!box) return;
    var list = (DB.announcements || []).slice()
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 3);
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = list.map(function (a) {
      return '<div class="warn-box" style="border-left:4px solid var(--brand)">' +
        '<strong>' + esc(a.title) + '</strong> <span class="small muted">' + fmtDate(a.date) + '</span>' +
        '<div class="small">' + esc(a.text) + '</div>' +
        (DB.settings.role === 'viewer' ? '' :
          '<button class="link" type="button" data-act="del-announcement" data-id="' + esc(a.id) + '">Kaldır</button>') +
        '</div>';
    }).join('');
  }

  function agingRows(c) {
    var today = new Date();
    var fallback = DB.settings.devirDate || '2026-10-01';
    return c.rows.filter(function (r) { return r.debt > 0.5; }).map(function (r) {
      var oldest = null;
      (r.months || []).forEach(function (m) { if (m.status !== 'paid' && !oldest) oldest = m.month; });
      var base = oldest ? oldest + '-01' : fallback;
      var days = Math.max(0, Math.round((today - new Date(base + 'T00:00:00')) / 86400000));
      return { label: r.label, owner: r.u.owner, debt: r.debt, days: days, id: r.u.id };
    }).sort(function (a, b) { return b.days - a.days || b.debt - a.debt; });
  }

  function bucketOf(days) {
    if (days >= 90) return '90+';
    if (days >= 61) return '61-90';
    if (days >= 31) return '31-60';
    return '0-30';
  }

  /** Demirbaş eksiği: resmi cari rapordaki demirbaş borcu esas alınır.
   *  Raporda borç varsa ondan; yoksa ödeme kayıtlarından (2.000 ₺ eşiği). */
  function demirbasMissing(c) {
    var paidAfter = {};
    DB.payments.forEach(function (p) {
      if (p.type === 'demirbaş' && String(p.date || '') > '2026-10-31') {
        paidAfter[p.unitId] = (paidAfter[p.unitId] || 0) + p.amount;
      }
    });
    // resmi cari verisi bir kez girildiyse ödeme kayıtlarına düşülmez
    var anyDue = !!DB.settings.demirbasComplete ||
      DB.units.some(function (u) { return (Number(u.demirbasDue) || 0) > 0.5; });

    if (anyDue) {
      return c.rows.filter(function (r) {
        var due = Number(r.u.demirbasDue) || 0;
        if (due <= 0.5) return false;
        return Math.max(0, due - (paidAfter[r.u.id] || 0)) >= 100;   // kuruş kırıntısı sayılmaz
      }).map(function (r) {
        var due = Number(r.u.demirbasDue) || 0;
        return {
          label: r.label, owner: r.u.owner, id: r.u.id,
          paid: Math.max(0, 2000 - due),
          missing: round2(Math.max(0, due - (paidAfter[r.u.id] || 0)))
        };
      }).sort(function (a, b) { return b.missing - a.missing; });
    }

    var paid = {};
    DB.payments.forEach(function (p) { if (p.type === 'demirbaş') paid[p.unitId] = (paid[p.unitId] || 0) + p.amount; });
    var map = {};
    c.rows.forEach(function (r) {
      if (r.u.billable === false) return;
      var key = (r.u.block || '') + '|' + r.u.no;
      if (!map[key]) map[key] = { label: r.label, owner: r.u.owner, paid: 0, missing: 0 };
      map[key].paid += (paid[r.u.id] || 0);
    });
    return Object.keys(map).map(function (k) {
      var x = map[k]; x.missing = Math.max(0, 2000 - x.paid); return x;
    }).filter(function (x) { return x.paid < 2000; });
  }

  function renderReports(c) {
    renderAnnouncements();
    var rows = agingRows(c);
    var sums = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    rows.forEach(function (r) { sums[bucketOf(r.days)] += r.debt; });

    var aging = '<div class="card">' +
      '<div class="card-h"><h3>Borç yaşlandırma</h3><span class="hint">' + rows.length + ' borçlu daire</span></div>' +
      '<div class="budget-grid">' +
        ['0-30', '31-60', '61-90', '90+'].map(function (k) {
          return '<div class="bstat"><div class="l">' + k + ' gün</div><div class="v">' + fmtMoney(sums[k]) + '</div></div>';
        }).join('') +
      '</div>' +
      (rows.length
        ? '<table class="mini-table"><thead><tr><th>Daire</th><th>Malik/Kiracı</th><th class="num">Borç</th><th class="num">Gün</th></tr></thead><tbody>' +
          rows.slice(0, 25).map(function (r) {
            return '<tr><td><button class="owner-btn" type="button" data-act="open-unit" data-id="' + esc(r.id) + '">' + esc(r.label) + '</button></td>' +
              '<td>' + (esc(r.owner) || '—') + '</td><td class="num">' + fmtMoney(r.debt) + '</td><td class="num">' + r.days + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="small muted">Borç görünmüyor.</p>') +
      '</div>';

    var miss = demirbasMissing(c);
    var demirbas = '<div class="card">' +
      '<div class="card-h"><h3>Demirbaş taahhüdü (2.000 ₺)</h3><span class="hint">' + miss.length + ' daire eksik</span></div>' +
      (miss.length
        ? '<table class="mini-table"><thead><tr><th>Daire</th><th>Malik/Kiracı</th><th class="num">Yatan</th><th class="num">Eksik</th></tr></thead><tbody>' +
          miss.map(function (x) {
            return '<tr><td>' + esc(x.label) + '</td><td>' + (esc(x.owner) || '—') + '</td><td class="num">' + fmtMoney(x.paid) +
              '</td><td class="num">' + fmtMoney(Math.max(0, 2000 - x.paid)) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="small muted">Tüm daireler demirbaşı yatırmış.</p>') +
      '</div>';

    var rb = $('#reportBox');
    if (rb) rb.innerHTML = aging + demirbas;

    var al = $('#annList');
    if (al) {
      al.innerHTML = (DB.announcements || []).length
        ? '<table class="mini-table"><tbody>' +
          DB.announcements.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).map(function (a) {
            return '<tr><td><strong>' + esc(a.title) + '</strong><div class="small muted">' + fmtDate(a.date) + ' · ' + esc(a.text) + '</div></td>' +
              '<td class="num"><button class="icon-btn" type="button" data-act="del-announcement" data-id="' + esc(a.id) + '">✕</button></td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="small muted">Duyuru yok.</p>';
    }

    var lb = $('#logBox');
    if (lb) {
      lb.innerHTML = (DB.log || []).length
        ? '<table class="mini-table"><thead><tr><th>Zaman</th><th>İşlem</th><th>Detay</th></tr></thead><tbody>' +
          DB.log.slice(0, 60).map(function (l) {
            return '<tr><td class="small">' + new Date(l.at).toLocaleString('tr-TR') + '</td><td>' + esc(l.action) +
              '</td><td class="small muted">' + esc(l.detail) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="small muted">Kayıt yok.</p>';
    }
  }

  /* ---------------- yazdırma / belgeler ---------------- */

  function sigBlock(cols) {
    var b = DB.settings.board || {};
    var dep = (b.deputies || []).join(', ');
    return '<div class="sig">' +
      '<div><span>Site Başkanı</span><br>' + esc(b.president || DB.settings.managerName || '') + '</div>' +
      '<div><span>Yardımcılar</span><br>' + (dep ? esc(dep) : '—') + '</div>' +
      '<div><span>Denetçi</span><br>' + esc(b.auditor || '') + '</div>' +
      '</div>';
  }

  function printDoc(html) {
    var area = $('#printArea');
    if (!area) return;
    area.innerHTML = '<div class="doc">' + html + '</div>';
    document.body.classList.add('printing');
    setTimeout(function () { window.print(); }, 60);
  }
  window.addEventListener('afterprint', function () { document.body.classList.remove('printing'); });

  function docHead(title, sub) {
    return '<div class="doc-head"><div><h1>' + esc(title) + '</h1><p>' +
      esc(DB.meta.siteName || 'Şazeli Konakları') + (sub ? ' · ' + esc(sub) : '') + '</p></div>' +
      '<p class="doc-date">' + new Date().toLocaleDateString('tr-TR') + '</p></div>';
  }

  function buildReceipt(unitId, paymentId) {
    var u = unitById(unitId);
    if (!u) return '';
    var p = null;
    DB.payments.forEach(function (x) { if (x.id === paymentId) p = x; });
    var c = computeAll(UI.asOf);
    var row = null;
    c.rows.forEach(function (r) { if (r.u.id === unitId) row = r; });
    return docHead('Ödeme Makbuzu', p ? fmtDate(p.date) : '') +
      '<table class="doc-table"><tbody>' +
      '<tr><th>Daire</th><td>' + esc(displayUnit(u)) + '</td></tr>' +
      '<tr><th>Malik / Kiracı</th><td>' + (esc(u.owner) || '—') + '</td></tr>' +
      '<tr><th>Tutar</th><td><strong>' + fmtMoney(p ? p.amount : 0) + '</strong></td></tr>' +
      '<tr><th>Tür</th><td>' + esc(p ? ({ aidat: 'Aidat', 'demirbaş': 'Demirbaş', ek: 'Ek tahakkuk', diger: 'Diğer' }[p.type] || p.type) : '') + '</td></tr>' +
      '<tr><th>Dönem</th><td>' + (p && p.period ? esc(monthLabel(p.period)) : '—') + '</td></tr>' +
      '<tr><th>Açıklama</th><td>' + (p && p.desc ? esc(p.desc) : '—') + '</td></tr>' +
      '<tr><th>Kaynak</th><td>' + esc(p ? (p.source || '') : '') + '</td></tr>' +
      '<tr><th>Sakinin kalan borcu</th><td>' + fmtMoney(row ? row.debt : 0) + '</td></tr>' +
      '</tbody></table>' +
      '<p class="doc-note">Bu belge bilgilendirme amaçlıdır; mali makbuz yerine geçmez.</p>';
  }

  function buildStatement(unitId) {
    var u = unitById(unitId);
    if (!u) return '';
    var c = computeAll(UI.asOf);
    var row = null;
    c.rows.forEach(function (r) { if (r.u.id === unitId) row = r; });
    if (!row) return '';
    var pays = DB.payments.filter(function (p) { return p.unitId === unitId; })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var charges = DB.charges.filter(function (x) { return x.unitId === unitId; });

    return docHead('Hesap Ekstresi', displayUnit(u) + (u.owner ? ' · ' + u.owner : '')) +
      '<table class="doc-table"><tbody>' +
      '<tr><th>Devir bakiyesi</th><td>' + fmtMoney(row.opening) + '</td></tr>' +
      '<tr><th>Aidat tahakkuku (' + (c.periods || []).length + ' dönem)</th><td>' + fmtMoney(row.expected) + '</td></tr>' +
      '<tr><th>Ek tahakkuk</th><td>' + fmtMoney(row.extra) + '</td></tr>' +
      '<tr><th>Gecikme faizi</th><td>' + fmtMoney(row.penalty) + '</td></tr>' +
      '<tr><th>Ödenen</th><td>' + fmtMoney(row.paid) + '</td></tr>' +
      '<tr><th>Sakinin borcu</th><td><strong>' + fmtMoney(row.debt) + '</strong></td></tr>' +
      '</tbody></table>' +

      (charges.length ? '<h2>Ek tahakkuklar</h2><table class="doc-table"><thead><tr><th>Tarih</th><th>Açıklama</th><th class="num">Tutar</th></tr></thead><tbody>' +
        charges.map(function (ch) {
          return '<tr><td>' + fmtDate(ch.date) + '</td><td>' + esc(ch.label) + '</td><td class="num">' + fmtMoney(ch.amount) + '</td></tr>';
        }).join('') + '</tbody></table>' : '') +

      '<h2>Ödemeler</h2>' +
      (pays.length ? '<table class="doc-table"><thead><tr><th>Tarih</th><th>Açıklama</th><th>Kaynak</th><th class="num">Tutar</th></tr></thead><tbody>' +
        pays.map(function (p) {
          return '<tr><td>' + fmtDate(p.date) + '</td><td>' + esc(p.desc || '') + '</td><td>' + esc(p.source || '') +
            '</td><td class="num">' + fmtMoney(p.amount) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p>Ödeme kaydı yok.</p>') +
      '<p class="doc-note">' + esc(DB.settings.managerName || '') +
      (DB.settings.managerPhone ? ' · ' + esc(DB.settings.managerPhone) : '') + '</p>';
  }

  function buildMonthlyReport() {
    var c = computeAll(UI.asOf);
    var byCat = {};
    DB.expenses.filter(function (e) { return String(e.date || '').slice(0, 7) === UI.asOf; })
      .forEach(function (e) { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
    var top = agingRows(c).slice(0, 10);

    return docHead('Aylık Yönetim Raporu', monthLabel(UI.asOf)) +
      '<table class="doc-table"><tbody>' +
      '<tr><th>Bu ay tahsilat</th><td>' + fmtMoney(c.monthPayments) + '</td></tr>' +
      '<tr><th>Bu ay gider</th><td>' + fmtMoney(c.monthExpenses) + '</td></tr>' +
      '<tr><th>Aylık bütçe</th><td>' + fmtMoney(Number(DB.settings.budgetMonthly) || 0) + '</td></tr>' +
      '<tr><th>Kasa bakiyesi</th><td>' + fmtMoney(c.balance) + '</td></tr>' +
      '<tr><th>Toplam alacak (aidat)</th><td>' + fmtMoney(c.totals.debt) + '</td></tr>' +
      '<tr><th>Tahsilat oranı</th><td>%' + String(c.collectRate).replace('.', ',') + '</td></tr>' +
      '<tr><th>Demirbaş kasası</th><td>' + fmtMoney(c.demirbasBalance) + '</td></tr>' +
      '</tbody></table>' +

      '<h2>Bu ay gider dağılımı</h2>' +
      (Object.keys(byCat).length
        ? '<table class="doc-table"><thead><tr><th>Kategori</th><th class="num">Tutar</th></tr></thead><tbody>' +
          Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).map(function (k) {
            return '<tr><td>' + esc(k) + '</td><td class="num">' + fmtMoney(byCat[k]) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p>Bu ay gider kaydı yok.</p>') +

      '<h2>En borçlu 10 daire</h2>' +
      (top.length
        ? '<table class="doc-table"><thead><tr><th>Daire</th><th>Malik/Kiracı</th><th class="num">Borç</th><th class="num">Gün</th></tr></thead><tbody>' +
          top.map(function (r) {
            return '<tr><td>' + esc(r.label) + '</td><td>' + (esc(r.owner) || '—') + '</td><td class="num">' + fmtMoney(r.debt) +
              '</td><td class="num">' + r.days + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p>Borçlu daire yok.</p>') +
      '<p class="doc-note">' + esc(DB.settings.managerName || '') +
      (DB.settings.managerPhone ? ' · ' + esc(DB.settings.managerPhone) : '') + '</p>';
  }

  function buildAgingReport() {
    var c = computeAll(UI.asOf);
    var rows = agingRows(c);
    return docHead('Borç Yaşlandırma', monthLabel(UI.asOf)) +
      '<table class="doc-table"><thead><tr><th>Daire</th><th>Malik/Kiracı</th><th class="num">Borç</th><th class="num">Gün</th><th>Kova</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.label) + '</td><td>' + (esc(r.owner) || '—') + '</td><td class="num">' + fmtMoney(r.debt) +
          '</td><td class="num">' + r.days + '</td><td>' + bucketOf(r.days) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="doc-note">Gün, en eski ödenmemiş dönemin başlangıcından bugüne hesaplanır.</p>';
  }

  /* ---------------- yazdırma / belgeler son ---------------- */

  /* ---------------- ay sonu denetim raporu ---------------- */

  var nfDoc = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fmtDoc(n) { return nfDoc.format(round2(n)) + ' ₺'; }

  function renderReportDoc(c) {
    var box = $('#reportDoc');
    if (!box) return;
    var s = DB.settings;
    var feeM = c.monthFee || feeForMonth(c.asOf);
    var billable = c.monthRows.filter(function (r) { return r.fee > 0; });
    var paidCount = billable.filter(function (r) { return r.status === 'paid'; }).length;
    var unpaid = billable.filter(function (r) { return r.status === 'unpaid' || r.status === 'partial'; });
    var plan = round2(feeM * billable.length);
    var rate = plan > 0 ? Math.round((c.monthPayments / plan) * 1000) / 10 : 0;

    var byCat = {};
    DB.expenses.filter(function (e) { return String(e.date || '').slice(0, 7) === c.asOf; })
      .forEach(function (e) { byCat[e.category || 'Diğer'] = (byCat[e.category || 'Diğer'] || 0) + e.amount; });
    var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    var expTotal = c.monthExpenses || 0;

    var debtors = c.rows.filter(function (r) { return r.debt > 0.5; })
      .sort(function (a, b) { return b.debt - a.debt; });
    var debtSum = round2(debtors.reduce(function (a, r) { return a + r.debt; }, 0));
    var creditSum = round2(c.rows.reduce(function (a, r) { return a + (r.debt < -0.5 ? -r.debt : 0); }, 0));

    var archive = c.asOf < String(s.cashOpeningDate || '2026-10-31').slice(0, 7);
    var islem = DB.payments.filter(function (p) { return String(p.date || '').slice(0, 7) === c.asOf; }).length +
      DB.expenses.filter(function (e) { return String(e.date || '').slice(0, 7) === c.asOf; }).length;

    var ozet = monthLabel(c.asOf) + ' döneminde ' + fmtDoc(c.monthPayments) + ' tahsilat yapılmış, ' +
      fmtDoc(c.monthExpenses) + ' gider kaydedilmiştir. Dönem neti ' +
      (c.monthPayments - c.monthExpenses >= 0 ? 'pozitif (' : 'negatif (') + fmtDoc(Math.abs(c.monthPayments - c.monthExpenses)) + '). ' +
      'Aidat tahsilat oranı %' + String(rate).replace('.', ',') + '; ' + paidCount + ' daire ödemesini yapmış, ' +
      unpaid.length + ' dairede eksik ödeme bulunmaktadır. ' +
      'Devir sonrası kalan toplam alacak ' + fmtDoc(debtSum) + ' (' + debtors.length + ' hesap)' +
      (creditSum > 0.5 ? ', alacaklı hesaplarda ' + fmtDoc(creditSum) + ' bulunmaktadır' : '') + '.';

    var kpi = function (l, v) { return '<div><div class="l">' + l + '</div><div class="v">' + v + '</div></div>'; };

    box.innerHTML =
      '<div class="rh">' +
        '<div><h1>' + esc(DB.meta.siteName || 'Şazeli Konakları') + '</h1>' +
        '<p>Site Yönetimi · Aylık Denetim Raporu</p></div>' +
        '<div style="text-align:right"><strong>Dönem: ' + monthLabel(c.asOf) + '</strong><br>' +
        '<span>Rapor tarihi: ' + new Date().toLocaleDateString('tr-TR') + '</span></div>' +
      '</div>' +

      '<div class="kpi-doc">' +
        kpi('Tahsilat', fmtDoc(c.monthPayments)) +
        kpi('Gider', fmtDoc(c.monthExpenses)) +
        kpi('Dönem neti', (c.monthPayments - c.monthExpenses >= 0 ? '+' : '−') + fmtDoc(Math.abs(c.monthPayments - c.monthExpenses))) +
        kpi('Kasa (ay sonu)', archive ? '—' : fmtDoc(c.cashAtEnd)) +
        kpi('Tahsilat oranı', '%' + String(rate).replace('.', ',')) +
        kpi('Borçlu hesap', String(debtors.length)) +
      '</div>' +

      '<h2>1. Yönetici Özeti</h2><p>' + esc(ozet) + '</p>' +

      '<h2>2. Aidat Tahsilatı</h2>' +
      '<table><tbody>' +
        '<tr><th style="width:46%">Planlanan aidat (' + billable.length + ' daire × ' + fmtDoc(feeM) + ')</th><td class="num">' + fmtDoc(plan) + '</td></tr>' +
        '<tr><th>Tahsil edilen</th><td class="num">' + fmtDoc(c.monthPayments) + '</td></tr>' +
        '<tr><th>Tahsilat oranı</th><td class="num">%' + String(rate).replace('.', ',') + '</td></tr>' +
        '<tr><th>Ödemesini yapan daire</th><td class="num">' + paidCount + ' / ' + billable.length + '</td></tr>' +
        '<tr><th>Eksik ödeme bulunan daire</th><td class="num">' + unpaid.length + '</td></tr>' +
        '<tr><th>Dönem işlem sayısı</th><td class="num">' + islem + '</td></tr>' +
      '</tbody></table>' +

      '<h2>3. Ödemeyen Hesaplar</h2>' +
      (debtors.length
        ? '<table><thead><tr><th>Daire</th><th>Sakin</th><th>Tür</th><th class="num">Borç</th></tr></thead><tbody>' +
          debtors.slice(0, 20).map(function (r) {
            return '<tr><td>' + esc(r.label) + '</td><td>' + esc(r.u.owner || '—') + '</td><td>' +
              esc(typeLabel(r.u) || 'Malik') + '</td><td class="num">' + fmtDoc(r.debt) + '</td></tr>';
          }).join('') +
          '<tr><th>Toplam</th><th></th><th></th><td class="num"><strong>' + fmtDoc(debtSum) + '</strong></td></tr>' +
          '</tbody></table>'
        : '<p>Borçlu hesap bulunmamaktadır.</p>') +

      '<h2>4. Gider Dağılımı</h2>' +
      (cats.length
        ? '<table><thead><tr><th>Kategori</th><th class="num">Tutar</th><th class="num">Pay</th></tr></thead><tbody>' +
          cats.map(function (k) {
            return '<tr><td>' + esc(k) + '</td><td class="num">' + fmtDoc(byCat[k]) + '</td><td class="num">%' +
              String(Math.round((byCat[k] / (expTotal || 1)) * 1000) / 10).replace('.', ',') + '</td></tr>';
          }).join('') +
          '<tr><th>Toplam</th><td class="num"><strong>' + fmtDoc(expTotal) + '</strong></td><td class="num">%100</td></tr>' +
          '</tbody></table>'
        : '<p>Bu dönemde gider kaydı bulunmamaktadır.</p>') +

      '<h2>5. Kasa Hareketi</h2>' +
      (archive
        ? '<p>Devir tarihinden (' + fmtDate(s.cashOpeningDate) + ') önceki dönem: kasa bakiyesi raporlanmaz.</p>'
        : '<table><tbody>' +
          '<tr><th style="width:46%">Ay başı kasa</th><td class="num">' + fmtDoc(c.cashAtStart) + '</td></tr>' +
          '<tr><th>(+) Tahsilat</th><td class="num">' + fmtDoc(c.monthPayments) + '</td></tr>' +
          '<tr><th>(−) Gider</th><td class="num">' + fmtDoc(c.monthExpenses) + '</td></tr>' +
          '<tr><th>Ay sonu kasa</th><td class="num"><strong>' + fmtDoc(c.cashAtEnd) + '</strong></td></tr>' +
          '</tbody></table>') +

      '<h2>6. Demirbaş Fonu</h2>' +
      '<table><tbody>' +
        '<tr><th style="width:46%">Kasa bakiyesi</th><td class="num">' + fmtDoc(c.demirbasBalance) + '</td></tr>' +
        '<tr><th>Hedef</th><td class="num">' + (c.demirbasTarget > 0 ? fmtDoc(c.demirbasTarget) : '—') + '</td></tr>' +
        '<tr><th>Taahhüt eden daire</th><td class="num">' + c.demirbasPayers + ' / ' + c.rows.length + '</td></tr>' +
      '</tbody></table>' +

      sigBlock() +
      '<p class="doc-note">Bu rapor ' + DB.meta.siteName + ' yönetim paneli tarafından ' +
      new Date().toLocaleString('tr-TR') + ' tarihinde otomatik oluşturulmuştur.</p>';
  }

  function renderActionCenter(c) {
    var box = $('#alertBar');
    if (!box) return;
    var billable = (c.monthRows || []).filter(function (r) { return r.fee > 0; });
    var lateN = billable.filter(function (r) { return r.status === 'unpaid' || r.status === 'partial'; }).length;
    var duesDay = Number(DB.settings.lateFeeDay) || 15;
    var daysLeft = Math.ceil((new Date(c.asOf + '-' + pad2(duesDay) + 'T23:59:59') - new Date()) / 86400000);
    var demirbasEksik = demirbasMissing(c).length;
    var chips = [];

    if (daysLeft >= 0 && daysLeft <= 7) {
      chips.push({ k: 'warn', t: 'Son ödeme gününe ' + daysLeft + ' gün', a: 'show-month-debtors', b: 'Ödemeyenler' });
    }
    if (lateN > 0) chips.push({ k: 'danger', t: lateN + ' dairede eksik ödeme', a: 'show-month-debtors', b: 'Liste' });
    if (c.totals.debtors > 0) chips.push({ k: '', t: c.totals.debtors + ' hesap cari borçlu · ' + fmtMoney(c.totals.net), a: 'show-debtors', b: 'Cari' });
    if (demirbasEksik > 0) chips.push({ k: '', t: demirbasEksik + ' dairede demirbaş eksiği', a: 'goto-reports', b: 'Gör' });

    if (!chips.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="alertbar">' + chips.map(function (x) {
      return '<button type="button" class="alert-chip ' + x.k + '" data-act="' + x.a + '">' +
        '<span>' + esc(x.t) + '</span><strong>' + esc(x.b) + ' →</strong></button>';
    }).join('') + '</div>';
  }

  /* ---------------- işler: arıza, envanter, toplantı ---------------- */

  var TICKET_LABEL = { open: 'Açık', inprogress: 'Devam ediyor', done: 'Tamamlandı' };

  function renderWork(c) {
    var tk = $('#ticketList');
    if (!tk) return;
    fillUnitSelect($('#tkUnit'));
    var open = DB.tickets.filter(function (t) { return t.status !== 'done'; }).length;
    $('#ticketHint').textContent = DB.tickets.length + ' kayıt · ' + open + ' açık';

    var rows = DB.tickets.slice().sort(function (a, b) {
      var rank = { open: 0, inprogress: 1, done: 2 };
      return (rank[a.status] - rank[b.status]) || String(b.date).localeCompare(String(a.date));
    });
    tk.innerHTML = rows.length
      ? '<table class="mini-table"><thead><tr><th>Tarih</th><th>Daire</th><th>Konu</th><th>Kategori</th><th>Sorumlu</th><th class="num">Maliyet</th><th>Durum</th><th></th></tr></thead><tbody>' +
        rows.map(function (t) {
          var u = unitById(t.unitId);
          var badge = t.status === 'done' ? 'ok' : (t.status === 'inprogress' ? 'warn' : 'danger');
          return '<tr><td>' + fmtDate(t.date) + '</td>' +
            '<td>' + esc(u ? unitLabel(u) : '—') + '</td>' +
            '<td class="owner-cell">' + esc(t.title) + (t.priority === 'Acil' ? ' <span class="badge danger">acil</span>' : '') + '</td>' +
            '<td><span class="badge info">' + esc(t.category) + '</span></td>' +
            '<td>' + (esc(t.assignee) || '—') + '</td>' +
            '<td class="num">' + (t.cost > 0 ? fmtMoney(t.cost) : '—') + '</td>' +
            '<td><span class="badge ' + badge + '">' + (TICKET_LABEL[t.status] || t.status) + '</span></td>' +
            '<td class="right">' +
              (t.status !== 'done' ? '<button class="icon-btn" type="button" title="Tamamlandı" data-act="ticket-status" data-id="' + esc(t.id) + '" data-status="done">✓</button>' : '') +
              (t.status === 'open' ? '<button class="icon-btn" type="button" title="Başladı" data-act="ticket-status" data-id="' + esc(t.id) + '" data-status="inprogress">▶</button>' : '') +
              '<button class="icon-btn" type="button" title="Sil" data-act="del-ticket" data-id="' + esc(t.id) + '">✕</button>' +
            '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="small muted" style="margin-top:10px">Henüz talep kaydı yok.</p>';

    var inv = DB.inventory.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var invTotal = inv.reduce(function (s2, x) { return s2 + (Number(x.amount) || 0); }, 0);
    $('#invHint').innerHTML = inv.length + ' kalem · <strong>' + fmtMoney(invTotal) + '</strong>';
    $('#invList').innerHTML = inv.length
      ? '<table class="mini-table"><thead><tr><th>Tarih</th><th>Kalem</th><th>Kategori</th><th>Firma</th><th>Fatura</th><th>Garanti</th><th class="num">Tutar</th><th></th></tr></thead><tbody>' +
        inv.map(function (x) {
          return '<tr><td>' + fmtDate(x.date) + '</td><td class="owner-cell">' + esc(x.name) + '</td>' +
            '<td><span class="badge info">' + esc(x.category) + '</span></td>' +
            '<td>' + (esc(x.vendor) || '—') + '</td><td>' + (esc(x.invoice) || '—') + '</td>' +
            '<td>' + (x.warranty ? fmtDate(x.warranty) : '—') + '</td>' +
            '<td class="num">' + fmtMoney(x.amount) + '</td>' +
            '<td class="num"><button class="icon-btn" type="button" data-act="del-inventory" data-id="' + esc(x.id) + '">✕</button></td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="small muted" style="margin-top:10px">Envanter kaydı yok.</p>';

    var mt = DB.meetings.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    $('#mtList').innerHTML = mt.length
      ? '<table class="mini-table"><thead><tr><th>Tarih</th><th>Başlık</th><th>Karar</th><th>Katılan</th><th></th></tr></thead><tbody>' +
        mt.map(function (m) {
          return '<tr><td>' + fmtDate(m.date) + '</td><td class="owner-cell">' + esc(m.title) + '</td>' +
            '<td>' + (m.decisions || []).length + ' karar</td><td>' + (esc(m.attendees) || '—') + '</td>' +
            '<td class="num"><button class="icon-btn" type="button" data-act="del-meeting" data-id="' + esc(m.id) + '">✕</button></td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="small muted" style="margin-top:10px">Toplantı kaydı yok.</p>';
  }

  /* ---------------- kasa defteri / bütçe gerçekleşen ---------------- */

  function cashbookRows() {
    var from = String(DB.settings.cashOpeningDate || '2026-10-31');
    if (!(Number(DB.settings.cashOpening) > 0)) from = '0000-01-01';
    var items = [];
    DB.payments.forEach(function (p) {
      if (String(p.date || '') <= from) return;
      items.push({ date: p.date, desc: (p.desc || 'Ödeme') + ' · ' + (unitLabel(unitById(p.unitId) || {}) || ''), in: p.amount, out: 0, src: p.source || '' });
    });
    DB.expenses.forEach(function (e) {
      if (String(e.date || '') <= from) return;
      items.push({ date: e.date, desc: (e.desc || e.category) + ' · ' + (e.payee || ''), in: 0, out: e.amount, src: 'Gider' });
    });
    items.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var bal = Number(DB.settings.cashOpening) || 0;
    items.forEach(function (x) { bal = round2(bal + x.in - x.out); x.bal = bal; });
    return { rows: items, opening: Number(DB.settings.cashOpening) || 0, from: from, closing: bal };
  }

  function renderCashbook() {
    var box = $('#cashbookBox');
    if (!box) return;
    var cb = cashbookRows();
    var last = cb.rows.slice(-25).reverse();
    if (!cb.rows.length) {
      box.innerHTML = '<p class="small muted">Kasa hareketi bulunamadı. Veriler ortak veritabanından yükleniyor olabilir — birkaç saniye sonra tekrar deneyin.</p>';
      return;
    }
    box.innerHTML =
      '<div class="budget-grid" style="margin-bottom:10px">' +
        '<div class="bstat"><div class="l">Devir (' + fmtDate(cb.from) + ')</div><div class="v">' + fmtMoney(cb.opening) + '</div></div>' +
        '<div class="bstat"><div class="l">Hareket</div><div class="v">' + cb.rows.length + '</div></div>' +
        '<div class="bstat"><div class="l">Kapanış</div><div class="v" style="color:var(--ok)">' + fmtMoney(cb.closing) + '</div></div>' +
      '</div>' +
      (last.length
        ? '<table class="mini-table"><thead><tr><th>Tarih</th><th>Açıklama</th><th class="num">Giren</th><th class="num">Çıkan</th><th class="num">Bakiye</th></tr></thead><tbody>' +
          last.map(function (x) {
            return '<tr><td>' + fmtDate(x.date) + '</td><td class="owner-cell small">' + esc(x.desc).slice(0, 70) + '</td>' +
              '<td class="num">' + (x.in ? fmtMoney(x.in) : '—') + '</td>' +
              '<td class="num">' + (x.out ? fmtMoney(x.out) : '—') + '</td>' +
              '<td class="num"><strong>' + fmtMoney(x.bal) + '</strong></td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="small muted">Hareket yok.</p>');
  }

  function printCashbook() {
    var cb = cashbookRows();
    printDoc('<div class="doc-sheet">' + docHead('Kasa Defteri', monthLabel(todayMonth())) +
      '<table class="doc-table"><thead><tr><th>Tarih</th><th>Açıklama</th><th class="num">Giren</th><th class="num">Çıkan</th><th class="num">Bakiye</th></tr></thead><tbody>' +
      '<tr><th colspan="4">Devir (' + fmtDate(cb.from) + ')</th><td class="num">' + fmtMoney2(cb.opening) + '</td></tr>' +
      cb.rows.map(function (x) {
        return '<tr><td>' + fmtDate(x.date) + '</td><td>' + esc(x.desc).slice(0, 80) + '</td>' +
          '<td class="num">' + (x.in ? fmtMoney2(x.in) : '—') + '</td>' +
          '<td class="num">' + (x.out ? fmtMoney2(x.out) : '—') + '</td>' +
          '<td class="num">' + fmtMoney2(x.bal) + '</td></tr>';
      }).join('') +
      '<tr><th colspan="4">Kapanış</th><td class="num"><strong>' + fmtMoney2(cb.closing) + '</strong></td></tr>' +
      '</tbody></table>' + sigBlock() + '</div>');
  }

  function renderBudgetVs() {
    var box = $('#budgetVsBox');
    if (!box) return;
    var months = [], cur = todayMonth();
    for (var i = 0; i < 12; i++) { months.unshift(cur); cur = addMonths(cur, -1); }
    var lim = DB.settings.budgetByCategory || {};
    var cats = Object.keys(lim).filter(function (k) { return Number(lim[k]) > 0; });
    if (!cats.length) {
      box.innerHTML = '<p class="small muted">Kategori limiti girilmedi. Gider &amp; Bütçe → Kategori bütçesi bölümünden limit girin.</p>';
      return;
    }
    var rows = cats.map(function (k) {
      var spent = DB.expenses.filter(function (e) { return e.category === k && months.indexOf(String(e.date || '').slice(0, 7)) >= 0; })
        .reduce(function (a, e) { return a + e.amount; }, 0);
      var plan = Number(lim[k]) * 12;
      var diff = round2(spent - plan);
      return { k: k, spent: spent, plan: plan, diff: diff };
    }).sort(function (a, b) { return b.spent - a.spent; });

    box.innerHTML = '<table class="mini-table"><thead><tr><th>Kategori</th><th class="num">12 ay bütçe</th><th class="num">Gerçekleşen</th><th class="num">Fark</th><th style="width:22%">Durum</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var p = r.plan > 0 ? Math.min(100, Math.round(r.spent / r.plan * 100)) : 0;
        return '<tr><td>' + esc(r.k) + '</td><td class="num">' + fmtMoney(r.plan) + '</td><td class="num">' + fmtMoney(r.spent) + '</td>' +
          '<td class="num" style="color:' + (r.diff > 0 ? 'var(--danger)' : 'var(--ok)') + '">' +
            (r.diff > 0 ? '+' : '') + fmtMoney(r.diff) + '</td>' +
          '<td><div class="progress' + (r.diff > 0 ? ' over' : '') + '"><i style="width:' + p + '%"></i></div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  function portalUnitId() {
    var m = /[?&]daire=([^&]+)/.exec(location.search || '');
    return m ? decodeURIComponent(m[1]) : '';
  }

  function ensureTokens() {
    DB.units.forEach(function (u) { if (!u.token) u.token = 'p' + (u.id || uid('u')).replace(/[^a-z0-9]/gi, ''); });
  }

  function startPortal(key) {
    ensureTokens();
    var u = DB.units.filter(function (x) { return x.token === key || x.id === key; })[0];
    document.body.classList.add('portal-mode');
    var host = document.getElementById('portalView');
    if (!host) {
      host = document.createElement('div');
      host.id = 'portalView';
      document.body.appendChild(host);
    }
    if (!u) {
      host.innerHTML = '<div class="portal-card"><h1>Daire bulunamadı</h1><p>Bağlantı geçersiz olabilir.</p></div>';
      return;
    }
    var c = computeAll(todayMonth());
    var row = c.rows.filter(function (r) { return r.u.id === u.id; })[0];
    var pays = DB.payments.filter(function (p) { return p.unitId === u.id; })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 12);

    host.innerHTML =
      '<div class="portal-card">' +
        '<div class="portal-head"><div><h1>' + esc(DB.meta.siteName || 'Site') + '</h1>' +
        '<p>Sakin portalı</p></div><div class="right"><strong>' + esc(unitLabel(u)) + '</strong><br>' +
        '<span>' + esc(u.owner || '') + '</span></div></div>' +
        '<div class="portal-grid">' +
          '<div><span>Kalan borç</span><strong>' + fmtMoney(row ? row.debt : 0) + '</strong></div>' +
          '<div><span>Devir</span><strong>' + fmtMoney(row ? row.opening : 0) + '</strong></div>' +
          '<div><span>Bu ay ödenen</span><strong>' + fmtMoney(c.monthRows.filter(function (r) { return r.u.id === u.id; })[0].paid) + '</strong></div>' +
        '</div>' +
        '<h2>Ödeme geçmişi</h2>' +
        (pays.length
          ? '<table><thead><tr><th>Tarih</th><th>Açıklama</th><th class="num">Tutar</th></tr></thead><tbody>' +
            pays.map(function (p) {
              return '<tr><td>' + fmtDate(p.date) + '</td><td>' + esc(p.desc || '') + '</td><td class="num">' + fmtMoney2(p.amount) + '</td></tr>';
            }).join('') + '</tbody></table>'
          : '<p>Ödeme kaydı yok.</p>') +
        '<p class="portal-note">Aidat ' + fmtMoney(DB.settings.monthlyFee) + ' · son ödeme günü ' +
        (DB.settings.lateFeeDay || 15) + ' · gecikme faizi %' + String(DB.settings.lateFeeRate || 0).replace('.', ',') + '</p>' +
        '<p class="portal-note">Site Başkanı: ' + esc((DB.settings.board || {}).president || '') +
        ((DB.settings.board || {}).auditor ? ' · Denetçi: ' + esc(DB.settings.board.auditor) : '') + '</p>' +
      '</div>';
  }

  function buildNotice(unitId) {
    var u = unitById(unitId);
    if (!u) return '';
    var c = computeAll(UI.asOf);
    var r = c.rows.filter(function (x) { return x.u.id === unitId; })[0];
    if (!r) return '';
    var lines = ihtarLines(r, u);
    return '<div class="doc-sheet">' +
      docHead('Borç Bildirimi', unitLabel(u) + ' · ' + (u.owner || '')) +
      '<p>Sayın <strong>' + esc(u.owner || '') + '</strong>,</p>' +
      '<p>' + esc(DB.meta.siteName || '') + ' yönetimi kayıtlarına göre ' + fmtDate(UI.asOf + '-01') +
      ' itibarıyla hesabınızda <strong>' + fmtMoney2(r.debt) + '</strong> borç görünmektedir.</p>' +
      '<table class="doc-table"><tbody>' +
        '<tr><th>Devir bakiyesi</th><td class="num">' + fmtMoney2(r.opening) + '</td></tr>' +
        '<tr><th>Aidat tahakkuku</th><td class="num">' + fmtMoney2(r.expected) + '</td></tr>' +
        '<tr><th>Ek tahakkuk</th><td class="num">' + fmtMoney2(r.extra) + '</td></tr>' +
        '<tr><th>Gecikme faizi</th><td class="num">' + fmtMoney2(r.penalty) + '</td></tr>' +
        '<tr><th>Ödenen</th><td class="num">' + fmtMoney2(r.paid) + '</td></tr>' +
        '<tr><th>Kalan borç</th><td class="num"><strong>' + fmtMoney2(r.debt) + '</strong></td></tr>' +
      '</tbody></table>' +
      '<p>Ödemenin <strong>' + (DB.settings.lateFeeDay || 15) + '</strong> gününe kadar yapılması rica olunur. ' +
      'Bu tarihten sonra aylık aidata %' + String(DB.settings.lateFeeRate || 0).replace('.', ',') + ' gecikme faizi uygulanır.</p>' +
      (DB.settings.note ? '<p>' + esc(DB.settings.note) + '</p>' : '') +
      '<p>Bilgilerinize sunarız.</p>' +
      sigBlock() +
      '<p class="doc-note">Bu bildirim ' + new Date().toLocaleString('tr-TR') + ' tarihinde otomatik oluşturulmuştur.</p>' +
      '</div>';
  }

  function ihtarLines(r, u) { return ''; }

  function printNotices(all) {
    var c = computeAll(UI.asOf);
    var rows = c.rows.filter(function (r) { return r.debt > 0.5; }).sort(function (a, b) { return b.debt - a.debt; });
    if (!rows.length) { toast('Borçlu hesap yok.'); return; }
    var docs = rows.map(function (r) {
      var u = r.u;
      return '<div class="doc-sheet" style="page-break-after:always">' +
        docHead('Borç Bildirimi', unitLabel(u) + ' · ' + (u.owner || '')) +
        '<p>Sayın <strong>' + esc(u.owner || '') + '</strong>,</p>' +
        '<p>' + esc(DB.meta.siteName || '') + ' yönetimi kayıtlarına göre ' + fmtDate(UI.asOf + '-01') +
        ' itibarıyla hesabınızda <strong>' + fmtMoney2(r.debt) + '</strong> borç görünmektedir.</p>' +
        '<table class="doc-table"><tbody>' +
          '<tr><th>Devir bakiyesi</th><td class="num">' + fmtMoney2(r.opening) + '</td></tr>' +
          '<tr><th>Aidat tahakkuku</th><td class="num">' + fmtMoney2(r.expected) + '</td></tr>' +
          '<tr><th>Ek tahakkuk</th><td class="num">' + fmtMoney2(r.extra) + '</td></tr>' +
          '<tr><th>Gecikme faizi</th><td class="num">' + fmtMoney2(r.penalty) + '</td></tr>' +
          '<tr><th>Ödenen</th><td class="num">' + fmtMoney2(r.paid) + '</td></tr>' +
          '<tr><th>Kalan borç</th><td class="num"><strong>' + fmtMoney2(r.debt) + '</strong></td></tr>' +
        '</tbody></table>' +
        '<p>Ödemenin <strong>' + (DB.settings.lateFeeDay || 15) + '</strong> gününe kadar yapılması rica olunur.</p>' +
        sigBlock() +
        '</div>';
    }).join('');
    printDoc(docs);
  }

  function printInventory() {
    var inv = DB.inventory.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var total = inv.reduce(function (s2, x) { return s2 + (Number(x.amount) || 0); }, 0);
    printDoc('<div class="doc-sheet">' +
      docHead('Demirbaş Envanteri', DB.meta.siteName) +
      (inv.length
        ? '<table class="doc-table"><thead><tr><th>Tarih</th><th>Kalem</th><th>Kategori</th><th>Firma</th><th>Fatura</th><th>Garanti</th><th class="num">Tutar</th></tr></thead><tbody>' +
          inv.map(function (x) {
            return '<tr><td>' + fmtDate(x.date) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.category) + '</td>' +
              '<td>' + (esc(x.vendor) || '—') + '</td><td>' + (esc(x.invoice) || '—') + '</td>' +
              '<td>' + (x.warranty ? fmtDate(x.warranty) : '—') + '</td><td class="num">' + fmtMoney2(x.amount) + '</td></tr>';
          }).join('') +
          '<tr><th colspan="6">Toplam</th><td class="num"><strong>' + fmtMoney2(total) + '</strong></td></tr></tbody></table>'
        : '<p>Envanter kaydı yok.</p>') +
      '</div>');
  }

  function printMinutes() {
    var mt = DB.meetings.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    printDoc('<div class="doc-sheet">' +
      docHead('Toplantı Tutanakları', DB.meta.siteName) +
      (mt.length ? mt.map(function (m) {
        return '<h2>' + fmtDate(m.date) + ' · ' + esc(m.title) + '</h2>' +
          (m.attendees ? '<p><strong>Katılan:</strong> ' + esc(m.attendees) + '</p>' : '') +
          ((m.decisions || []).length
            ? '<ol>' + m.decisions.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ol>'
            : '<p>Karar kaydı yok.</p>');
      }).join('') : '<p>Toplantı kaydı yok.</p>') +
      sigBlock() +
      '</div>');
  }

  function renderStatusStrip(c) {
    var box = $('#statusStrip');
    if (!box) return;
    var billable = (c.monthRows || []).filter(function (r) { return r.fee > 0; });
    var paidN = billable.filter(function (r) { return r.status === 'paid'; }).length;
    var pctPaid = billable.length ? Math.round((paidN / billable.length) * 100) : 0;
    var duesDay = Number(DB.settings.lateFeeDay) || 15;
    var today = new Date();
    var daysLeft = Math.ceil((new Date(c.asOf + '-' + pad2(duesDay) + 'T23:59:59') - today) / 86400000);
    var demirbasEksik = demirbasMissing(c).length;

    box.innerHTML =
      '<div class="card-h"><h3>Yönetim Durumu · ' + monthLabel(c.asOf) + '</h3>' +
      '<span class="hint">son ödeme günü ' + duesDay + '.' + monthLabel(c.asOf).split(' ')[0] + '</span></div>' +
      '<div class="strip" style="grid-template-columns:repeat(4,1fr)">' +
        '<div class="strip-item"><span class="l">Ödeyen daire</span><span class="v ok">' + paidN + '/' + billable.length + '</span>' +
          '<div class="progress"><i style="width:' + pctPaid + '%"></i></div>' +
          '<span class="small muted">' + pctPaid + '% tahsil</span></div>' +
        '<div class="strip-item"><span class="l">Son ödeme günü</span><span class="v">' +
          (daysLeft >= 0 ? daysLeft + ' gün' : 'geçti') + '</span>' +
          '<span class="small muted">' + duesDay + '. gün · %' + String(c.rate).replace('.', ',') + ' faiz</span></div>' +
        '<div class="strip-item"><span class="l">Cari alacak</span><span class="v">' + fmtMoney(c.totals.net) + '</span>' +
          '<span class="small muted">' + c.totals.debtors + ' hesap borçlu</span></div>' +
        '<div class="strip-item"><span class="l">Demirbaş eksiği</span><span class="v">' + demirbasEksik + '</span>' +
          '<a class="link" href="#reports" data-act="goto-reports">Daire listesi →</a></div>' +
      '</div>';
  }

  /* ---------------- ay sonu denetim raporu son ---------------- */

  function wire() {
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var k = e.target.closest('[data-act][role="button"]');
      if (!k) return;
      e.preventDefault();
      k.click();
    });
    document.addEventListener('click', function (e) {
      var tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
      var el = e.target.closest('[data-act]');
      if (!el) return;
      var act = el.dataset.act;
      var id = el.dataset.id;

      switch (act) {
        case 'close-drawer': closeDrawer(); break;
        case 'close-modal': closeModal(); break;
        case 'open-unit': openUnitDrawer(id); break;
        case 'quick-payment': openPaymentModal(); break;
        case 'quick-pay-unit': closeDrawer(); setTab('payments'); openPaymentModal(id); break;
        case 'add-charge': openChargeModal(); break;
        case 'add-charge-unit': closeDrawer(); openChargeModal(id); break;
        case 'remind-unit': {
          var c = computeAll(UI.asOf);
          var r = null;
          c.rows.forEach(function (x) { if (x.u.id === id) r = x; });
          if (!r) break;
          if (r.debt <= 0.5) { toast('Bu dairede borç görünmüyor.'); break; }
          var phone = String(r.u.phone || '').replace(/[^\d]/g, '');
          if (phone && phone.length === 10) phone = '90' + phone;
          if (phone && /^0/.test(phone)) phone = '90' + phone.slice(1);
          var waBase = phone ? 'https://wa.me/' + phone : 'https://wa.me/';
          var shortTxt = reminderShort(r);
          openModal('WhatsApp mesajı · ' + r.label,
            '<p class="lead">Kısa mesaj hazır. WhatsApp’ta açıp kişiyi/grubu seç, ya da kopyalayıp yapıştır.</p>' +
            '<textarea class="textarea" rows="6" id="remindText">' + esc(shortTxt) + '</textarea>' +
            '<div class="form-actions">' +
              '<a class="btn primary" target="_blank" rel="noopener" href="' + waBase + '?text=' + encodeURIComponent(shortTxt) + '">WhatsApp’ta aç</a>' +
              '<button class="btn ghost" type="button" data-act="copy-remind">Kopyala</button>' +
              '<button class="btn ghost" type="button" data-act="remind-long" data-id="' + esc(r.u.id) + '">Ayrıntılı metin</button>' +
              '<button class="btn ghost" type="button" data-act="close-modal">Kapat</button>' +
            '</div>' +
            '<p class="small muted" style="margin-top:8px">Telefon kayıtlıysa sohbet doğrudan açılır; kayıtlı değilse WhatsApp kişi seçimini gösterir.</p>');
          break;
        }
        case 'parse-mail-paste': {
          var raw = ($('#mailPaste') || {}).value || '';
          if (!raw.trim()) { toast('Önce e-posta metnini yapıştır.'); break; }
          var pp = parseBankText(raw);
          if (!(pp.amount > 0)) { toast('Tutarı bulamadım — metni kontrol et.', 4500); break; }
          $('#mailParseBox').innerHTML =
            '<div class="parsed-box">' +
              '<div class="pb-row"><span>Tutar</span><strong>' + fmtMoney2(pp.amount) + '</strong></div>' +
              '<div class="pb-row"><span>Tarih</span><strong>' + fmtDate(pp.date) + '</strong></div>' +
              '<div class="pb-fields">' +
                '<label>Kategori<select id="pmCat">' + EXPENSE_CATEGORIES.map(function (x) {
                  return '<option' + (x === pp.category ? ' selected' : '') + '>' + esc(x) + '</option>';
                }).join('') + '</select></label>' +
                '<label>Ödenen kişi / kurum<input id="pmPayee" value="' + esc(pp.payee || '') + '" placeholder="Örn. Yönetim firması"></label>' +
                '<label>Açıklama<input id="pmDesc" value="' + esc(pp.desc) + '"></label>' +
              '</div>' +
              '<p class="hint">Doğruysa “Gidere işle”ye bas.</p>' +
            '</div>';
          break;
        }
        case 'save-mail-paste': {
          var box = $('#mailParseBox');
          if (!box || !$('#pmCat')) { toast('Önce “Çözümle”ye bas.'); break; }
          var pp2 = parseBankText(($('#mailPaste') || {}).value || '');
          if (!(pp2.amount > 0)) { toast('Tutar bulunamadı.'); break; }
          DB.expenses.push({
            id: uid('ex'), date: pp2.date, category: $('#pmCat').value,
            amount: pp2.amount, payee: ($('#pmPayee') || {}).value || '',
            desc: ($('#pmDesc') || {}).value || pp2.desc, source: 'Banka (yapıştırma)'
          });
          addLog('Banka ödemesi gidere işlendi', $('#pmCat').value + ' · ' + fmtMoney(pp2.amount));
          $('#mailPaste').value = ''; box.innerHTML = '';
          saveDB(); renderAll();
          toast('Gidere işlendi: ' + fmtMoney(pp2.amount));
          break;
        }
        case 'save-outgoing': {
          var o = (DB.outgoing || []).filter(function (x) { return x.id === id; })[0];
          if (!o) break;
          var cat = ($('#oc-' + id) || {}).value || 'Diğer';
          var payee = ($('#op-' + id) || {}).value || '';
          var desc = ($('#od-' + id) || {}).value || o.desc || 'Banka ödemesi';
          DB.expenses.push({
            id: uid('ex'), date: o.date || todayISO(), category: cat,
            amount: round2(Number(o.amount) || 0), payee: payee, desc: desc, source: 'Banka'
          });
          o.done = true;
          addLog('Banka ödemesi gidere işlendi', cat + ' · ' + fmtMoney(o.amount));
          saveDB(); renderAll();
          toast('Gidere işlendi: ' + fmtMoney(o.amount));
          break;
        }
        case 'ignore-outgoing': {
          var o2 = (DB.outgoing || []).filter(function (x) { return x.id === id; })[0];
          if (o2) { o2.ignored = true; saveDB(); renderAll(); }
          break;
        }
        case 'goto-expenses': setTab('expenses'); break;
        case 'wa-list': {
          var cw = computeAll(UI.asOf);
          var rws = cw.rows.filter(function (r) { return r.debt > 0.5; }).sort(function (a, b) { return b.debt - a.debt; });
          if (!rws.length) { toast('Borçlu hesap yok.'); break; }
          openModal('WhatsApp hatırlatma listesi',
            '<p class="lead">' + rws.length + ' borçlu. Mesajı kopyala ya da WhatsApp’ta aç.</p>' +
            '<div class="wa-list">' + rws.map(function (r) {
              var t = reminderShort(r);
              var ph = String(r.u.phone || '').replace(/[^\d]/g, '');
              if (ph && ph.length === 10) ph = '90' + ph;
              if (ph && /^0/.test(ph)) ph = '90' + ph.slice(1);
              return '<div class="wa-row">' +
                '<div class="wa-top"><strong>' + esc(unitLabel(r.u)) + ' · ' + esc(r.u.owner || '') + '</strong>' +
                '<span class="wa-amt">' + fmtMoney(r.debt) + '</span></div>' +
                '<div class="wa-text">' + esc(t).replace(/\n/g, '<br>') + '</div>' +
                '<div class="wa-acts">' +
                  '<a class="btn sm primary" target="_blank" rel="noopener" href="' + (ph ? 'https://wa.me/' + ph : 'https://wa.me/') +
                    '?text=' + encodeURIComponent(t) + '">WhatsApp</a>' +
                  '<button class="btn sm ghost" type="button" data-act="copy-text" data-text="' + esc(t) + '">Kopyala</button>' +
                '</div></div>';
            }).join('') + '</div>');
          break;
        }
        case 'copy-text': {
          copyText(el.dataset.text || '');
          break;
        }
        case 'remind-long': {
          var c2 = computeAll(UI.asOf), r2 = null;
          c2.rows.forEach(function (x) { if (x.u.id === id) r2 = x; });
          if (!r2) break;
          var ph = String(r2.u.phone || '').replace(/[^\d]/g, '');
          if (ph && ph.length === 10) ph = '90' + ph;
          if (ph && /^0/.test(ph)) ph = '90' + ph.slice(1);
          openModal('Ayrıntılı metin · ' + r2.label,
            '<textarea class="textarea" rows="10" id="remindText">' + esc(reminderText(r2)) + '</textarea>' +
            '<div class="form-actions"><a class="btn primary" target="_blank" rel="noopener" href="' + (ph ? 'https://wa.me/' + ph : 'https://wa.me/') +
            '?text=' + encodeURIComponent(reminderText(r2)) + '">WhatsApp’ta aç</a>' +
            '<button class="btn ghost" type="button" data-act="copy-remind">Kopyala</button>' +
            '<button class="btn ghost" type="button" data-act="close-modal">Kapat</button></div>');
          break;
        }
        case 'copy-remind': {
          var ta = $('#remindText');
          if (ta) copyText(ta.value);
          break;
        }
        case 'goto-debts': setTab('debts'); break;
        case 'goto-work': setTab('work'); break;
        case 'add-ticket': {
          var tTitle = ($('#tkTitle') || {}).value || '';
          if (!tTitle.trim()) { toast('Konu gerekli.'); break; }
          DB.tickets.unshift({
            id: uid('tk'), date: ($('#tkDate') || {}).value || todayISO(),
            unitId: ($('#tkUnit') || {}).value || '', title: tTitle.trim(),
            category: ($('#tkCat') || {}).value || 'Diğer',
            priority: ($('#tkPri') || {}).value || 'Normal',
            assignee: ($('#tkWho') || {}).value || '',
            cost: Number(($('#tkCost') || {}).value) || 0,
            status: 'open', createdAt: new Date().toISOString()
          });
          addLog('Talep açıldı', tTitle.trim());
          saveDB(); renderAll();
          if ($('#tkTitle')) $('#tkTitle').value = '';
          if ($('#tkWho')) $('#tkWho').value = '';
          if ($('#tkCost')) $('#tkCost').value = '';
          toast('Talep kaydedildi.');
          break;
        }
        case 'ticket-status': {
          var t0 = DB.tickets.filter(function (x) { return x.id === id; })[0];
          if (!t0) break;
          t0.status = el.dataset.status || 'done';
          if (t0.status === 'done') t0.closedAt = todayISO();
          addLog('Talep durumu', t0.title + ' → ' + (TICKET_LABEL[t0.status] || t0.status));
          saveDB(); renderAll();
          break;
        }
        case 'del-ticket': {
          DB.tickets = DB.tickets.filter(function (x) { return x.id !== id; });
          addLog('Talep silindi', id);
          saveDB(); renderAll();
          break;
        }
        case 'add-inventory': {
          var ivName = ($('#ivName') || {}).value || '';
          var ivAmt = Number(($('#ivAmount') || {}).value) || 0;
          if (!ivName.trim() || ivAmt <= 0) { toast('Kalem adı ve tutar gerekli.'); break; }
          DB.inventory.unshift({
            id: uid('iv'), date: ($('#ivDate') || {}).value || todayISO(),
            name: ivName.trim(), category: ($('#ivCat') || {}).value || 'Diğer',
            amount: round2(ivAmt), vendor: ($('#ivVendor') || {}).value || '',
            invoice: ($('#ivInvoice') || {}).value || '',
            warranty: ($('#ivWarranty') || {}).value || ''
          });
          addLog('Envantere eklendi', ivName.trim() + ' · ' + fmtMoney(ivAmt));
          saveDB(); renderAll();
          $('#ivName').value = ''; $('#ivAmount').value = ''; $('#ivVendor').value = '';
          $('#ivInvoice').value = ''; $('#ivWarranty').value = '';
          toast('Envantere eklendi.');
          break;
        }
        case 'del-inventory': {
          DB.inventory = DB.inventory.filter(function (x) { return x.id !== id; });
          addLog('Envanter silindi', id);
          saveDB(); renderAll();
          break;
        }
        case 'print-inventory': printInventory(); break;
        case 'print-cashbook': printCashbook(); break;
        case 'open-search': openSearch(); break;
        case 'cloud-retry': cloudPull(false); break;
        case 'goto-import': setTab('import'); break;
        case 'goto-report': setTab('report'); break;
        case 'print-notices': printNotices(true); break;
        case 'print-notice': printDoc(buildNotice(id)); break;
        case 'book-penalties': {
          var cc0 = computeAll(UI.asOf);
          var booked = 0, sum = 0;
          cc0.rows.forEach(function (r) {
            if (r.penalty > 0.5) {
              DB.charges.push({ id: uid('c'), unitId: r.u.id, date: todayISO(),
                label: 'Gecikme faizi · ' + monthLabel(UI.asOf), amount: r.penalty });
              r.u.penaltyBooked = round2((Number(r.u.penaltyBooked) || 0) + r.penalty);
              booked++; sum += r.penalty;
            }
          });
          if (!booked) { toast('Tahakkuk edecek faiz yok.'); break; }
          addLog('Gecikme faizi borca yazıldı', booked + ' hesap · ' + fmtMoney(sum));
          saveDB(); renderAll();
          toast(booked + ' hesaba ' + fmtMoney(sum) + ' faiz işlendi.');
          break;
        }
        case 'add-user': {
          if (UI.role !== 'admin') { toast('Bu işlem için yönetici gerekli.'); break; }
          var un = ($('#usName') || {}).value || '';
          var up = ($('#usPass') || {}).value || '';
          if (!un.trim() || up.length < 4) { toast('Ad ve en az 4 karakter şifre gerekli.'); break; }
          DB.users.push({ id: uid('us'), name: un.trim(), role: ($('#usRole') || {}).value || 'cashier', pass: up });
          addLog('Kullanıcı eklendi', un.trim());
          saveDB(); renderAll(); toast('Kullanıcı eklendi.');
          break;
        }
        case 'del-user': {
          DB.users = (DB.users || []).filter(function (x) { return x.id !== id; });
          addLog('Kullanıcı silindi', id);
          saveDB(); renderAll(); break;
        }
        case 'close-month': {
          if (UI.role !== 'admin') { toast('Yönetici yetkisi gerekli.'); break; }
          DB.closedMonths = DB.closedMonths || [];
          if (DB.closedMonths.indexOf(UI.asOf) < 0) DB.closedMonths.push(UI.asOf);
          addLog('Ay kapatıldı', UI.asOf);
          saveDB(); renderAll(); toast(monthLabel(UI.asOf) + ' kapatıldı.');
          break;
        }
        case 'open-month': {
          DB.closedMonths = (DB.closedMonths || []).filter(function (m) { return m !== id; });
          addLog('Ay yeniden açıldı', id);
          saveDB(); renderAll(); toast('Ay yeniden açıldı.'); break;
        }
        case 'print-portal-links': {
          ensureTokens();
          saveDB();
          var us = sortUnits(DB.units.filter(function (u) { return u.type !== 'kiracı'; }));
          printDoc('<div class="doc-sheet">' + docHead('Sakin Portalı Bağlantıları', DB.meta.siteName) +
            '<table class="doc-table"><thead><tr><th>Daire</th><th>Sakin</th><th>Bağlantı</th></tr></thead><tbody>' +
            us.map(function (u) {
              return '<tr><td>' + esc(unitLabel(u)) + '</td><td>' + esc(u.owner || '—') + '</td><td style="font-size:10px">' +
                esc(location.origin + location.pathname + '?daire=' + (u.token || u.id)) + '</td></tr>';
            }).join('') + '</tbody></table></div>');
          break;
        }
        case 'add-meeting': {
          var mtTitle = ($('#mtTitle') || {}).value || '';
          if (!mtTitle.trim()) { toast('Başlık gerekli.'); break; }
          var mtDec = String(($('#mtDecisions') || {}).value || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
          DB.meetings.unshift({
            id: uid('mt'), date: ($('#mtDate') || {}).value || todayISO(),
            title: mtTitle.trim(), decisions: mtDec,
            attendees: ($('#mtAttend') || {}).value || ''
          });
          addLog('Toplantı eklendi', mtTitle.trim());
          saveDB(); renderAll();
          $('#mtTitle').value = ''; $('#mtDecisions').value = ''; $('#mtAttend').value = '';
          toast('Toplantı kaydedildi.');
          break;
        }
        case 'del-meeting': {
          DB.meetings = DB.meetings.filter(function (x) { return x.id !== id; });
          addLog('Toplantı silindi', id);
          saveDB(); renderAll();
          break;
        }
        case 'print-minutes': printMinutes(); break;
        case 'goto-report': setTab('report'); break;
        case 'goto-reports': setTab('reports'); break;
        case 'print-report-doc': {
          var rd = $('#reportDoc');
          if (rd) printDoc('<div class="doc-sheet">' + rd.innerHTML + '</div>');
          break;
        }
        case 'goto-payments': setTab('payments'); break;
        case 'set-scope': UI.scope = el.dataset.scope === 'all' ? 'all' : 'month'; renderAll(); break;
        case 'debt-view': UI.debtView = el.dataset.view === 'total' ? 'total' : 'month'; renderAll(); break;
        case 'show-month-debtors': {
          UI.debtView = 'month';
          UI.onlyDebtors = true;
          var od2 = $('#onlyDebtors'); if (od2) od2.checked = true;
          setTab('debts'); renderAll(); break;
        }
        case 'show-debtors': {
          UI.debtView = 'total';
          UI.onlyDebtors = true;
          var od = $('#onlyDebtors'); if (od) od.checked = true;
          var ds = $('#debtSearch'); if (ds) ds.value = '';
          var db2 = $('#debtBlock'); if (db2) db2.value = '';
          setTab('debts');
          renderAll();
          break;
        }
        case 'pay-file-demo': {
          UI.payFileRows = [
            { date: todayISO(), unitId: (unitById('a-8-m') || {}).id || '', name: 'ALİPAŞA KOÇAK', amount: 5500, desc: 'Kasım aidatı', type: 'aidat' },
            { date: todayISO(), unitId: '', name: 'BİLİNMEYEN KİŞİ', amount: 2000, desc: 'Demirbaş', type: 'demirbaş' }
          ];
          renderPayFilePreview('örnek veri');
          break;
        }
        case 'apply-payment-file': {
          var pf = UI.payFileRows || [];
          var added = 0, skipped = 0;
          Array.prototype.forEach.call(document.querySelectorAll('.payfile-unit'), function (sel) {
            var i = Number(sel.dataset.i);
            var r = pf[i];
            if (!r) return;
            if (!sel.value) { skipped++; return; }
            addPayment({ unitId: sel.value, date: r.date, type: r.type, amount: r.amount, desc: r.desc, source: 'Excel' });
            added++;
          });
          if (!added) { toast('Daire seçilmedi — kaydedilecek satır yok.'); break; }
          addLog('Excel’den ödeme yüklendi', added + ' kayıt');
          saveDB(); renderAll();
          UI.payFileRows = null;
          if ($('#payFilePreview')) $('#payFilePreview').innerHTML = '';
          if ($('#payFileInfo')) $('#payFileInfo').textContent = '';
          toast(added + ' ödeme kaydedildi' + (skipped ? ' · ' + skipped + ' satır atlandı' : '') + '.');
          break;
        }
        case 'cancel-payment-file': {
          UI.payFileRows = null;
          if ($('#payFilePreview')) $('#payFilePreview').innerHTML = '';
          if ($('#payFileInfo')) $('#payFileInfo').textContent = '';
          break;
        }
        case 'save-cat-budget': {
          var map = {};
          document.querySelectorAll('.cat-limit').forEach(function (inp) {
            var v = Number(inp.value);
            if (v > 0) map[inp.dataset.cat] = v;
          });
          DB.settings.budgetByCategory = map;
          addLog('Kategori bütçesi güncellendi', Object.keys(map).length + ' kategori');
          saveDB(); renderAll(); toast('Kategori limitleri kaydedildi.');
          break;
        }
        case 'add-contract': {
          var name = ($('#ctName') || {}).value || '';
          if (!name.trim()) { toast('Ad gerekli.'); break; }
          DB.contracts = DB.contracts || [];
          DB.contracts.push({
            id: uid('ct'), name: name.trim(),
            category: ($('#ctCat') || {}).value || 'Diğer',
            amount: Number(($('#ctAmount') || {}).value) || 0,
            day: Number(($('#ctDay') || {}).value) || null
          });
          addLog('Sözleşme eklendi', name.trim());
          saveDB(); renderAll(); toast('Sözleşme eklendi.');
          break;
        }
        case 'del-contract': {
          DB.contracts = (DB.contracts || []).filter(function (x) { return x.id !== id; });
          addLog('Sözleşme silindi', id);
          saveDB(); renderAll(); toast('Sözleşme silindi.');
          break;
        }
        case 'save-unit-info': {
          var uu = unitById(id);
          if (!uu) break;
          uu.phone = ($('#uiPhone') || {}).value || '';
          uu.extra = { plate: ($('#uiPlate') || {}).value || '' };
          addLog('Sakin bilgisi güncellendi', unitLabel(uu));
          saveDB(); renderAll(); toast('Bilgiler kaydedildi.');
          break;
        }
        case 'print-monthly': printDoc(buildMonthlyReport()); break;
        case 'print-aging': printDoc(buildAgingReport()); break;
        case 'print-receipt': printDoc(buildReceipt(el.dataset.unit, id)); break;
        case 'print-statement': printDoc(buildStatement(id)); break;
        case 'del-announcement': {
          DB.announcements = (DB.announcements || []).filter(function (x) { return x.id !== id; });
          addLog('Duyuru kaldırıldı', id);
          saveDB(); renderAll(); toast('Duyuru kaldırıldı.');
          break;
        }
        case 'add-announcement': {
          var at = ($('#annTitle') || {}).value || '';
          var ax = ($('#annText') || {}).value || '';
          if (!at.trim() || !ax.trim()) { toast('Başlık ve metin gerekli.'); break; }
          DB.announcements = DB.announcements || [];
          DB.announcements.push({ id: uid('ann'), date: todayISO(), title: at.trim(), text: ax.trim() });
          addLog('Duyuru eklendi', at.trim());
          saveDB();
          if ($('#annTitle')) $('#annTitle').value = '';
          if ($('#annText')) $('#annText').value = '';
          renderAll(); toast('Duyuru yayınlandı.');
          break;
        }
        case 'del-payment': {
          var p = DB.payments.find(function (x) { return x.id === id; });
          if (!p) break;
          var pu = unitById(p.unitId);
          if (!confirm('Silinsin mi?\n' + (pu ? unitLabel(pu) : '') + ' · ' + fmtMoney(p.amount) + ' · ' + fmtDate(p.date))) break;
          DB.payments = DB.payments.filter(function (x) { return x.id !== id; });
          addLog('Ödeme silindi', (pu ? unitLabel(pu) : '') + ' · ' + fmtMoney(p.amount) + ' · ' + fmtDate(p.date));
          saveDB(); renderAll(); toast('Ödeme silindi.');
          break;
        }
        case 'del-expense': {
          var ex = DB.expenses.find(function (x) { return x.id === id; });
          if (!ex) break;
          if (!confirm('Gider silinsin mi?\n' + fmtMoney(ex.amount) + ' · ' + (ex.desc || ex.category))) break;
          DB.expenses = DB.expenses.filter(function (x) { return x.id !== id; });
          saveDB(); renderAll(); toast('Gider silindi.');
          break;
        }
        case 'del-charge': {
          if (!confirm('Ek tahakkuk silinsin mi?')) break;
          DB.charges = DB.charges.filter(function (x) { return x.id !== id; });
          saveDB(); renderAll(); toast('Ek tahakkuk silindi.');
          break;
        }
        case 'del-unit': {
          var u = unitById(id);
          if (!u) break;
          var relP = DB.payments.filter(function (x) { return x.unitId === id; }).length;
          var relC = DB.charges.filter(function (x) { return x.unitId === id; }).length;
          if (!confirm(unitLabel(u) + ' dairesi silinsin mi?\n' + relP + ' ödeme ve ' + relC + ' tahakkuk kaydı da silinecek.')) break;
          DB.units = DB.units.filter(function (x) { return x.id !== id; });
          DB.payments = DB.payments.filter(function (x) { return x.unitId !== id; });
          DB.charges = DB.charges.filter(function (x) { return x.unitId !== id; });
          saveDB(); renderAll(); toast('Daire silindi.');
          break;
        }
        case 'add-unit': {
          var no = ($('#newNo').value || '').trim();
          if (!no) { toast('Daire numarası girin.'); $('#newNo').focus(); break; }
          var blk = ($('#newBlock').value || '').trim().toUpperCase();
          var ntype = $('#newType') ? $('#newType').value : 'malik';
          if (DB.units.some(function (x) {
            return String(x.no) === no && String(x.block || '').toUpperCase() === blk && (x.type || 'malik') === ntype;
          })) {
            toast('Bu hesap zaten var.'); break;
          }
          var newU = {
            id: uid('u'), block: blk, no: no,
            owner: ($('#newOwner').value || '').trim(), phone: '',
            fee: null, active: true, type: ntype === 'kiracı' ? 'kiracı' : 'malik', opening: 0, billable: true
          };
          DB.units.push(newU);
          syncBillable(newU);
          saveDB(); renderAll(); toast('Hesap eklendi.');
          break;
        }
        case 'save-settings': {
          DB.meta.siteName = ($('#setSiteName').value || '').trim() || 'Site Yönetim Paneli';
          DB.settings.monthlyFee = Math.max(0, parseFloat(($('#setFee').value || '0').replace(',', '.')) || 0);
          DB.settings.startMonth = $('#setStart').value || todayMonth();
          DB.settings.budgetMonthly = Math.max(0, parseFloat(($('#setBudget').value || '0').replace(',', '.')) || 0);
          if ($('#setCashActual')) DB.settings.cashActual = round2(Number($('#setCashActual').value) || 0);
          if ($('#setCashActualDate')) DB.settings.cashActualDate = $('#setCashActualDate').value || todayISO();
          DB.settings.managerName = ($('#setManager').value || '').trim();
          DB.settings.board = {
            president: DB.settings.managerName,
            deputies: String(($('#setDeputies') || {}).value || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
            auditor: String(($('#setAuditor') || {}).value || '').trim()
          };
          DB.settings.note = ($('#setNote').value || '').trim();
          DB.settings.cashOpening = parseFloat(($('#setCash').value || '0').replace(',', '.')) || 0;
          DB.settings.cashOpeningDate = ($('#setCashDate') || {}).value || '';
          DB.settings.demirbasTarget = Math.max(0, parseFloat(($('#setDemirbas').value || '0').replace(',', '.')) || 0);
          DB.settings.lateFeeEnabled = $('#setLateOn').checked;
          DB.settings.lateFeeRate = Math.max(0, Math.min(100, parseFloat(($('#setLateRate').value || '0').replace(',', '.')) || 0));
          DB.settings.lateFeeDay = Math.max(1, Math.min(28, parseInt($('#setLateDay').value, 10) || 15));
          DB.settings.role = ($('#setViewer') && $('#setViewer').checked) ? 'viewer' : 'admin';
          addLog('Ayarlar güncellendi', DB.meta.siteName);
          saveDB(); renderAll(); toast('Ayarlar kaydedildi.');
          break;
        }
        case 'edit-budget': openBudgetModal(); break;
        case 'cloud-save': {
          var cu = ($('#setCloudUrl').value || '').trim().replace(/\/+$/, '');
          var ck = ($('#setCloudKey').value || '').trim();
          if (cu && !/^https:\/\//i.test(cu)) { toast('Adres https:// ile başlamalı.'); break; }
          DB.settings.cloud = { url: cu, key: ck };
          saveDB();
          var st = $('#cloudStatus');
          if (!cu || !ck) { if (st) st.textContent = 'kurulmadı'; toast('Adres ve anahtar gerekli.'); break; }
          if (st) st.textContent = 'bağlanıyor…';
          sbRead().then(function (remote) {
            if (st) st.textContent = 'bağlı';
            toast('Ortak veri bağlantısı tamam.');
            if (remote.data && remote.data.units && remote.data.units.length) {
              return cloudPull(false);
            }
            return cloudPush(false);
          }).catch(function (e) {
            if (st) st.textContent = 'hata: ' + e.message;
            toast('Bağlanamadı: ' + e.message, 4500);
          });
          break;
        }
        case 'cloud-push': {
          var st2 = $('#cloudStatus');
          if (st2) st2.textContent = 'gönderiliyor…';
          cloudPush(false).then(function (ok) { if (st2) st2.textContent = ok ? 'gönderildi' : 'hata'; });
          break;
        }
        case 'cloud-pull': {
          var st3 = $('#cloudStatus');
          if (st3) st3.textContent = 'çekiliyor…';
          cloudPull(false).then(function (ok) { if (st3) st3.textContent = ok ? 'güncellendi' : 'değişiklik yok'; });
          break;
        }
        case 'gmail-fetch': gmailFetch(); break;
        case 'show-pending': showPending(); break;
        case 'cloud-check': {
          var st4 = $('#cloudStatus');
          if (st4) st4.textContent = 'kontrol ediliyor…';
          cloudCheck(false).then(function (r) {
            if (!r) { if (st4) st4.textContent = 'hata'; return; }
            if (st4) st4.textContent = r.added + ' yeni · ' + r.pending + ' bekleyen';
            if (r.added) cloudPull(false).then(function () { renderAll(); });
            else renderAll();
          });
          break;
        }
        case 'edit-demirbas': {
          openModal('Demirbaş kasası',
            '<p class="lead">Kasa bakiyesi = başlangıç bakiyesi + demirbaş tahsilatları − demirbaş giderleri.</p>' +
            '<div class="form-grid">' +
            '<label>Başlangıç bakiyesi (₺)<input id="dmOpening" type="number" min="0" step="0.01" value="' +
            (DB.settings.demirbasOpening || '') + '" placeholder="13200"></label>' +
            '<label>Başlangıç tarihi<input id="dmAsOf" type="date" value="' +
            (DB.settings.demirbasAsOf || todayISO()) + '"></label>' +
            '<label>Hedef toplam (₺)<input id="dmAmount" type="number" min="0" step="0.01" value="' +
            (DB.settings.demirbasTarget || '') + '"></label></div>' +
            '<div class="form-actions"><button class="btn primary" type="button" data-act="save-demirbas">Kaydet</button>' +
            '<button class="btn ghost" type="button" data-act="close-modal">Vazgeç</button></div>');
          break;
        }
        case 'save-demirbas': {
          DB.settings.demirbasTarget = Math.max(0, parseFloat((($('#dmAmount') || {}).value || '0').replace(',', '.')) || 0);
          DB.settings.demirbasOpening = Math.max(0, parseFloat((($('#dmOpening') || {}).value || '0').replace(',', '.')) || 0);
          DB.settings.demirbasAsOf = (($('#dmAsOf') || {}).value || todayISO());
          saveDB(); closeModal(); renderAll(); toast('Demirbaş kasası güncellendi.');
          break;
        }
        case 'save-budget': {
          DB.settings.budgetMonthly = Math.max(0, parseFloat(($('#bAmount').value || '0').replace(',', '.')) || 0);
          saveDB(); closeModal(); renderAll(); toast('Bütçe güncellendi.');
          break;
        }
        case 'save-modal-payment': {
          var unitId = $('#mUnit').value;
          var amount = parseFloat(($('#mAmount').value || '').replace(',', '.'));
          if (!unitId) { toast('Daire seçin.'); break; }
          if (!amount || amount <= 0) { toast('Geçerli bir tutar girin.'); $('#mAmount').focus(); break; }
          var fundSel = $('#mFund');
          var ptype = $('#mType').value;
          if (fundSel && fundSel.value === 'demirbas') ptype = 'demirbaş';
          addPayment({
            unitId: unitId, date: $('#mDate').value || todayISO(), period: $('#mPeriod').value || todayMonth(),
            type: ptype, amount: amount, desc: ($('#mDesc').value || '').trim(), source: $('#mSource').value
          });
          saveDB(); closeModal(); closeDrawer(); renderAll(); toast('Ödeme kaydedildi.');
          break;
        }
        case 'save-charge': {
          var cu = $('#cUnit').value;
          var ca = parseFloat(($('#cAmount').value || '').replace(',', '.'));
          if (!cu) { toast('Daire seçin.'); break; }
          if (!ca || ca <= 0) { toast('Geçerli bir tutar girin.'); break; }
          DB.charges.push({
            id: uid('c'), unitId: cu, date: $('#cDate').value || todayISO(),
            label: ($('#cLabel').value || '').trim() || 'Ek tahakkuk', amount: round2(ca)
          });
          saveDB(); closeModal(); renderAll(); toast('Ek tahakkuk eklendi.');
          break;
        }
        case 'lock': {
          try { sessionStorage.removeItem('sazeli_unlocked'); } catch (e) { }
          location.reload();
          break;
        }
        case 'change-pass': openChangePass(); break;
        case 'save-pass': {
          var au = authData();
          if (!au) { toast('Şifre bulunamadı.'); break; }
          var oldP = $('#cpOld').value || '';
          var newP = $('#cpNew').value || '';
          if (newP.length < 6) { toast('Yeni şifre en az 6 karakter olmalı.'); break; }
          if (newP !== $('#cpNew2').value) { toast('Yeni şifreler eşleşmiyor.'); break; }
          hashPass(oldP, au.salt).then(function (h) {
            if (h !== au.hash) { toast('Mevcut şifre yanlış.'); return; }
            var salt = randSalt();
            hashPass(newP, salt).then(function (nh) {
              localStorage.setItem(AUTH_KEY, JSON.stringify({ v: 1, salt: salt, hash: nh, createdAt: au.createdAt }));
              closeModal();
              toast('Şifre güncellendi.');
            });
          });
          break;
        }
        case 'export-json': {
          var payload = JSON.stringify(DB, null, 2);
          download('sazeli-konaklari-yedek-' + todayISO() + '.json', payload, 'application/json');
          toast('Yedek indirildi.');
          break;
        }
        case 'pick-json': {
          var fi = $('#jsonFile');
          if (fi) fi.click();
          break;
        }
        case 'paste-json': openPasteJson(); break;
        case 'seed-load': openSeedModal(); break;
        case 'seed-apply': {
          var sp = $('#seedPass') ? $('#seedPass').value : '';
          if (!sp) { toast('Şifre girin.'); break; }
          trySeedWith(sp).then(function (ok) {
            if (!ok) toast('Liste açılamadı: şifre yanlış olabilir.', 4200);
          });
          break;
        }
        case 'paste-json-apply': {
          var pj = $('#pasteJsonText');
          applyJsonText(pj ? pj.value : '');
          break;
        }
        case 'bulk-preview': {
          var lines = ($('#bulkText').value || '').split(/\n/);
          var rows = [];
          lines.forEach(function (ln) {
            var r = parseBulkLine(ln);
            if (r) rows.push(r);
          });
          UI.bulkRows = rows;
          if (!rows.length) { toast('Satır bulunamadı.'); break; }
          renderBulkPreview(rows);
          var okc = rows.filter(function (r) { return !r.error; }).length;
          toast(okc + ' hesap hazır, ' + (rows.length - okc) + ' satır eşleşmedi.');
          break;
        }
        case 'bulk-apply': {
          if (!UI.bulkRows || !UI.bulkRows.length) { toast('Önce “Kontrol et”e basın.'); break; }
          var good = UI.bulkRows.filter(function (r) { return !r.error; });
          if (!good.length) { toast('Uygulanacak satır yok.'); break; }
          if (!confirm(good.length + ' hesabın devir bakiyesi güncellenecek. Devam edilsin mi?')) break;
          good.forEach(function (r) { r.unit.opening = round2(r.amount); });
          saveDB();
          UI.bulkRows = null;
          renderAll();
          toast(good.length + ' hesap güncellendi.');
          break;
        }
        case 'export-debts-csv': exportDebtsCSV(); break;
        case 'export-payments-csv': exportPaymentsCSV(); break;
        case 'export-expenses-csv': exportExpensesCSV(); break;
        case 'pick-expense-file': {
          var f = $('#expFile');
          if (f) f.click();
          break;
        }
        case 'apply-expense-file': {
          var rows = UI.expFileRows || [];
          if (!rows.length) { toast('Önce dosya seçin.'); break; }
          rows.forEach(function (x) {
            DB.expenses.push({
              id: uid('e'), date: x.date, category: x.category || 'Diğer',
              amount: round2(x.amount), desc: x.desc || '', payee: x.payee || ''
            });
          });
          UI.expFileRows = null;
          saveDB();
          renderAll();
          var prev = $('#expFilePreview');
          if (prev) prev.innerHTML = '<div class="warn-box">' + rows.length + ' gider listeye eklendi.</div>';
          var info = $('#expFileInfo');
          if (info) info.textContent = '';
          toast(rows.length + ' gider eklendi.', 3600);
          break;
        }
        case 'cancel-expense-file': {
          UI.expFileRows = null;
          var p2 = $('#expFilePreview');
          if (p2) p2.innerHTML = '';
          var i2 = $('#expFileInfo');
          if (i2) i2.textContent = '';
          break;
        }
        case 'demo-data': addDemoData(); break;
        case 'print': window.print(); break;
        case 'open-setup': openSetup(); break;
        case 'run-setup': runSetup(); break;
        case 'reset-all': {
          if (!confirm('TÜM veriler silinecek. Emin misiniz?')) break;
          if (!confirm('Son kez: daireler, ödemeler ve giderler kalıcı olarak silinsin mi?')) break;
          var fresh = newDB();
          fresh.units = [];
          DB = fresh;
          saveDB(); renderAll(); toast('Tüm veriler silindi.');
          break;
        }
        case 'parse-import': {
          var text = $('#importText').value || '';
          var parsed = parseImportText(text);
          if (!parsed.length) { toast('Metinden ödeme ayıklanamadı. Tutarın “1.500,00 TL” gibi olduğundan emin olun.', 4200); break; }
          UI.importRows = parsed;
          renderImportPreview();
          toast(parsed.length + ' kayıt ayıklandı. Kontrol edip kaydedin.');
          break;
        }
        case 'save-import': {
          var rows = UI.importRows || [];
          var saved = 0;
          var usedPending = [];
          rows.forEach(function (r) {
            if (!r.include) return;
            if (!r.unitId || !(r.amount > 0)) return;
            addPayment({
              unitId: r.unitId, date: r.date, period: (r.date || todayISO()).slice(0, 7),
              type: r.type, amount: r.amount, desc: r.desc, source: 'Gmail'
            });
            saved++;
            if (r.pendingId) {
              usedPending.push(r.pendingId);
              // öğrenen eşleştirme: bu isim bundan sonra bu daireye otomatik bağlanır
              var pe = (DB.pending || []).filter(function (x) { return x.id === r.pendingId; })[0];
              var nm = pe && (pe.name || pe.sender);
              if (nm && nm.length > 4) {
                DB.matchMemory = DB.matchMemory || {};
                DB.matchMemory[nm.toLocaleUpperCase('tr')] = r.unitId;
              }
            }
          });
          if (!saved) { toast('Kaydedilecek satır yok. Daire seçin veya tutar girin.'); break; }
          if (usedPending.length) {
            DB.pending = (DB.pending || []).filter(function (p) { return usedPending.indexOf(p.id) < 0; });
          }
          saveDB();
          UI.importRows = null;
          $('#importPreviewCard').hidden = true;
          $('#importText').value = '';
          renderAll();
          toast(saved + ' ödeme kaydedildi.');
          setTab('payments');
          break;
        }
        case 'clear-import': {
          UI.importRows = null;
          $('#importPreviewCard').hidden = true;
          $('#importText').value = '';
          break;
        }
        case 'demo-import': {
          $('#importText').value =
            'Sayın A-3 dairesi sakini,\n' +
            '12.11.2026 tarihinde hesabınıza 1.500,00 TL tutarında ödeme yapılmıştır.\n' +
            'Açıklama: Kasım ayı aidatı\n\n' +
            'Sn. B/7 dairesi,\n' +
            '13.11.2026 - 2.250,00 TL tutarında havale alınmıştır.\n' +
            'Açıklama: Ekim-Kasım aidatı\n\n' +
            'Daire No: 12\n' +
            'Tutar: 750 TL\n' +
            'Tarih: 14.11.2026\n' +
            'Açıklama: Kasım aidatı';
          break;
        }
      }
    });

    /* forms */
    $('#payForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var amount = parseFloat((f.amount.value || '').replace(',', '.'));
      if (!f.unitId.value) { toast('Daire seçin.'); return; }
      if (!amount || amount <= 0) { toast('Geçerli bir tutar girin.'); f.amount.focus(); return; }
      addPayment({
        unitId: f.unitId.value, date: f.date.value || todayISO(), period: f.period.value || todayMonth(),
        type: f.type.value, amount: amount, desc: (f.desc.value || '').trim(), source: f.source.value
      });
      saveDB(); renderAll();
      f.desc.value = ''; f.amount.value = '';
      f.amount.focus();
      toast('Ödeme kaydedildi.');
    });

    $('#expForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var amount = parseFloat((f.amount.value || '').replace(',', '.'));
      if (!amount || amount <= 0) { toast('Geçerli bir tutar girin.'); f.amount.focus(); return; }
      if (monthClosed(f.date.value)) { toast(monthLabel(String(f.date.value).slice(0, 7)) + ' kapatıldı — kayıt eklenemez.', 5200); return; }
      DB.expenses.push({
        id: uid('e'), date: f.date.value || todayISO(), category: f.category.value,
        amount: round2(amount), desc: (f.desc.value || '').trim(), payee: (f.payee.value || '').trim()
      });
      addLog('Gider eklendi', f.category.value + ' · ' + fmtMoney(amount) + ' · ' + ((f.desc.value || '').trim()));
      saveDB(); renderAll();
      f.desc.value = ''; f.amount.value = ''; f.payee.value = '';
      toast('Gider kaydedildi.');
    });

    var expFileInput = $('#expFile');
    if (expFileInput) {
      expFileInput.addEventListener('change', function () {
        handleExpenseFile(expFileInput.files && expFileInput.files[0]);
        expFileInput.value = '';
      });
    }

    var restoreInput = $('#restoreFile');
    if (restoreInput) {
      restoreInput.addEventListener('change', function () {
        var f = restoreInput.files && restoreInput.files[0];
        restoreInput.value = '';
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          var parsed;
          try { parsed = JSON.parse(String(rd.result || '')); } catch (e) { toast('Dosya okunamadı: geçerli JSON değil.', 5000); return; }
          if (!parsed || !Array.isArray(parsed.units) || !parsed.units.length) { toast('Bu dosya panel yedeği değil.', 5000); return; }
          if (!confirm('Mevcut veri bu yedekle değiştirilecek.\n' + parsed.units.length + ' hesap · ' +
            ((parsed.payments || []).length) + ' ödeme · ' + ((parsed.expenses || []).length) + ' gider.\n\nDevam edilsin mi?')) return;
          DB = migrate(parsed);
          DB.meta.rev = (Number(DB.meta.rev) || 0) + 1;
          addLog('Yedekten geri yüklendi', f.name);
          saveDB(); renderAll();
          toast('Yedek geri yüklendi.');
        };
        rd.readAsText(f, 'utf-8');
      });
    }

    var payFileInput = $('#payFile');
    if (payFileInput) {
      payFileInput.addEventListener('change', function () {
        handlePaymentFile(payFileInput.files && payFileInput.files[0]);
        payFileInput.value = '';
      });
    }

    /* filters */
    $('#asOfInput').addEventListener('change', function (e) {
      UI.asOf = e.target.value || todayMonth();
      renderAll();
    });
    $('#debtSearch').addEventListener('input', function (e) {
      UI.search = e.target.value;
      renderDebts(computeAll(UI.asOf));
    });
    $('#debtBlock').addEventListener('change', function () { renderDebts(computeAll(UI.asOf)); });
    $('#onlyDebtors').addEventListener('change', function (e) {
      UI.onlyDebtors = e.target.checked;
      renderDebts(computeAll(UI.asOf));
    });
    $('#paySearch').addEventListener('input', function () { renderPayments(); });

    /* import preview edits */
    $('#importTable').addEventListener('change', function (e) {
      var el = e.target;
      var key = el.dataset.imp;
      if (!key) return;
      var i = parseInt(el.dataset.i, 10);
      if (!UI.importRows || !UI.importRows[i]) return;
      var row = UI.importRows[i];
      if (key === 'include') row.include = el.checked;
      else if (key === 'amount') row.amount = round2(parseFloat(el.value) || 0);
      else row[key] = el.value;
      $('#importCount').textContent = row.include ? 'Seçili' : 'Seçili değil';
      // sayımı koru
      var inc = UI.importRows.filter(function (r) { return r.include; }).length;
      $('#importCount').textContent = UI.importRows.length + ' kayıt · ' + inc + ' seçili';
    });

    /* unit inline edits */
    document.addEventListener('change', function (e) {
      var el = e.target;
      if (!el.dataset || !el.dataset.unitField) return;
      var u = unitById(el.dataset.id);
      if (!u) return;
      var f = el.dataset.unitField;
      if (f === 'fee') {
        var v = parseFloat((el.value || '').replace(',', '.'));
        u.fee = isFinite(v) && v > 0 ? round2(v) : null;
      } else if (f === 'opening') {
        var ov = parseFloat((el.value || '').replace(',', '.'));
        u.opening = isFinite(ov) ? round2(ov) : 0;
      } else if (f === 'billable') {
        u.billable = !!el.checked;
      } else if (f === 'type') {
        u.type = el.value === 'kiracı' ? 'kiracı' : 'malik';
        syncBillable(u);
      } else if (f === 'block') {
        u.block = (el.value || '').trim().toUpperCase();
      } else {
        u[f] = (el.value || '').trim();
      }
      saveDB();
      var c = computeAll(UI.asOf);
      renderDebts(c);
      fillUnitSelect($('#payUnit'));
      renderPanel(c);
      renderHeader();
    });

    /* JSON restore */
    document.addEventListener('change', function (e) {
      if (e.target.id !== 'jsonFile') return;
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { applyJsonText(reader.result); };
      reader.readAsText(file);
      e.target.value = '';
    });

    /* drag & drop JSON */
    ['dragenter', 'dragover'].forEach(function (ev) {
      window.addEventListener(ev, function (e) {
        if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
        e.preventDefault();
        $('#dropHint').classList.add('show');
      });
    });
    window.addEventListener('dragleave', function (e) {
      if (e.relatedTarget) return;
      $('#dropHint').classList.remove('show');
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      $('#dropHint').classList.remove('show');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { applyJsonText(r.result); };
      r.readAsText(f);
    });

    /* esc closes */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#modal').hidden) closeModal();
      else if (!$('#drawer').hidden) closeDrawer();
    });
  }

  /* ---------------- auth / lock screen ---------------- */
  var AUTH_KEY = 'sazeli_auth_v1';
  var SHARED_PASS = 'Tuzla-456';
  var authBusy = false;
  var started = false;

  function authData() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; }
  }
  function randSalt() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function hashPass(pass, salt) {
    var text = salt + '|' + pass;
    try {
      if (window.crypto && crypto.subtle && window.TextEncoder) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
          return Array.prototype.map.call(new Uint8Array(buf), function (x) {
            return ('0' + x.toString(16)).slice(-2);
          }).join('');
        });
      }
    } catch (e) { /* fallback */ }
    return Promise.resolve('fb:' + btoa(unescape(encodeURIComponent(text))));
  }

  function showLock() {
    $('#lockTitle').textContent = DB.meta.siteName || 'Şazeli Konakları';
    $('#lockSub').textContent = 'Yönetim girişi';
    $('#lockPass2Wrap').hidden = true;
    $('#lockBtn').textContent = 'Giriş';
    $('#lockReset').hidden = true;
    $('#lockPass').value = '';
    $('#lockPass2').value = '';
    $('#lockErr').textContent = '';
    $('#lockScreen').hidden = false;
    document.body.classList.add('locked');
    setTimeout(function () { $('#lockPass').focus(); }, 80);
  }

  function bindLock() {
    $('#lockForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (authBusy) return;
      var pass = $('#lockPass').value || '';
      var err = $('#lockErr');
      err.textContent = '';
      if (!pass) { err.textContent = 'Şifre girin.'; return; }
      var usr = null;
      if (pass === SHARED_PASS) usr = { role: 'admin', name: DB.settings.managerName || 'Yönetici' };
      else {
        usr = (DB.users || []).filter(function (u) { return u.pass && u.pass === pass; })[0] || null;
      }
      if (!usr) {
        err.textContent = 'Şifre yanlış.';
        $('#lockPass').select();
        return;
      }
      UI.role = usr.role === 'viewer' ? 'viewer' : (usr.role === 'cashier' ? 'cashier' : 'admin');
      UI.userName = usr.name || '';
      unlockApp(pass);
    });
  }

  function openPasteJson() {
    openModal('JSON yapıştır',
      '<p class="lead">Yedek dosyasının içeriğini buraya yapıştırın (tüm metni seçip kopyalayın).</p>' +
      '<textarea id="pasteJsonText" class="textarea" rows="10" placeholder="{ &quot;units&quot;: [...] }"></textarea>' +
      '<div class="form-actions"><button class="btn primary" type="button" data-act="paste-json-apply">Yükle</button>' +
      '<button class="btn ghost" type="button" data-act="close-modal">Vazgeç</button></div>');
  }

  /* ---------------- encrypted seed ---------------- */
  function b64ToBuf(b64) {
    var bin = atob(String(b64 || ''));
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf;
  }

  function decryptSeed(seed, pass) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey'])
      .then(function (km) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: b64ToBuf(seed.salt), iterations: seed.iter || 210000, hash: 'SHA-256' },
          km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      })
      .then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(seed.iv) }, key, b64ToBuf(seed.ct));
      })
      .then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
  }

  function importSeedData(data) {
    if (!data || !Array.isArray(data.units) || !data.units.length) return false;
    var had = DB.units.length;
    var curV = DB.meta.seedVersion || '';
    var newV = (data.meta && data.meta.seedVersion) || '';
    var newer = !!newV && (!curV || newV > curV);
    var ids = {}, matches = 0;
    DB.units.forEach(function (u) { ids[u.id] = 1; });
    data.units.forEach(function (su) { if (ids[su.id]) matches++; });

    if (had && !matches) {
      if (!confirm('Bu cihazda ' + had + ' daire/hesap var ve liste bununla eşleşmiyor.\n\nHazır liste yüklensin mi? (Mevcut kayıtlar silinir.)')) return false;
      DB.units = [];
      DB.payments = [];
      DB.charges = [];
    }

    var byId = {};
    DB.units.forEach(function (u) { byId[u.id] = u; });
    var added = 0, updated = 0;

    data.units.forEach(function (su) {
      var u = byId[su.id];
      if (u) {
        u.block = su.block || '';
        u.no = String(su.no || u.no);
        u.owner = su.owner || '';
        u.type = su.type === 'kiracı' ? 'kiracı' : 'malik';
        u.opening = round2(Number(su.opening) || 0);
        u.billable = su.billable !== false;
        u.active = true;
        updated++;
      } else {
        var nu = {
          id: su.id || uid('u'), block: su.block || '', no: String(su.no || ''),
          owner: su.owner || '', phone: su.phone || '',
          fee: typeof su.fee === 'number' ? su.fee : null,
          active: true, type: su.type === 'kiracı' ? 'kiracı' : 'malik',
          opening: round2(Number(su.opening) || 0), billable: su.billable !== false
        };
        DB.units.push(nu);
        byId[nu.id] = nu;
        added++;
      }
    });

    if ((!had || newer) && data.settings) {
      var s = data.settings;
      if (s.monthlyFee) DB.settings.monthlyFee = s.monthlyFee;
      if (s.startMonth) DB.settings.startMonth = s.startMonth;
      if (s.lateFeeRate != null) DB.settings.lateFeeRate = s.lateFeeRate;
      if (s.lateFeeDay) DB.settings.lateFeeDay = s.lateFeeDay;
      DB.settings.lateFeeEnabled = s.lateFeeEnabled !== false;
      if (s.cashOpening != null) DB.settings.cashOpening = s.cashOpening;
      if (s.budgetMonthly) DB.settings.budgetMonthly = s.budgetMonthly;
      if (!DB.settings.managerName && s.managerName) DB.settings.managerName = s.managerName;
    }

    /* ödemeler ve giderler: id ile eşleştir; yeni sürümde olanları güncelle */
    var payById = {};
    DB.payments.forEach(function (p) { payById[p.id] = p; });
    var unitIds = {};
    DB.units.forEach(function (u) { unitIds[u.id] = 1; });
    var newPay = 0, updPay = 0;
    (data.payments || []).forEach(function (p) {
      if (!p || !unitIds[p.unitId]) return;
      var ex = payById[p.id];
      if (ex) {
        if (!newer) return;
        ex.type = p.type || ex.type;
        ex.desc = p.desc || ex.desc;
        ex.amount = round2(p.amount);
        ex.date = p.date || ex.date;
        ex.period = p.period || ex.period;
        ex.source = p.source || ex.source;
        updPay++;
        return;
      }
      DB.payments.push({
        id: p.id || uid('p'), unitId: p.unitId, date: p.date || todayISO(),
        period: p.period || String(p.date || '').slice(0, 7), type: p.type || 'aidat',
        amount: round2(p.amount), desc: p.desc || '', source: p.source || 'İşletme defteri',
        createdAt: p.createdAt || new Date().toISOString()
      });
      payById[p.id] = 1;
      newPay++;
    });

    var expById = {};
    DB.expenses.forEach(function (e) { expById[e.id] = e; });
    var newExp = 0, updExp = 0;
    (data.expenses || []).forEach(function (e) {
      if (!e) return;
      var ex = expById[e.id];
      if (ex) {
        if (!newer) return;
        ex.category = e.category || ex.category;
        ex.desc = e.desc || ex.desc;
        ex.amount = round2(e.amount);
        ex.date = e.date || ex.date;
        updExp++;
        return;
      }
      DB.expenses.push({
        id: e.id || uid('e'), date: e.date || todayISO(), category: e.category || 'Diğer',
        amount: round2(e.amount), desc: e.desc || '', payee: e.payee || ''
      });
      expById[e.id] = 1;
      newExp++;
    });

    if (data.meta && data.meta.siteName) DB.meta.siteName = data.meta.siteName;
    if (newV) DB.meta.seedVersion = newV;

    saveDB();
    closeModal();
    renderAll();
    toast(added + ' hesap, ' + newPay + ' yeni ödeme, ' + updPay + ' güncellenen ödeme, ' + newExp + ' gider yüklendi · ' + updated + ' hesap güncellendi.', 4600);
    return true;
  }

  function trySeedWith(pass) {
    if (!pass) return Promise.resolve(false);
    return fetch('seed.enc.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('seed yok');
        return r.json();
      })
      .then(function (seed) { return decryptSeed(seed, pass); })
      .then(function (data) {
        var v = data && data.meta && data.meta.seedVersion;
        var cur = DB.meta.seedVersion || '';
        if (DB.units.length && !(v && v > cur)) return false;
        return importSeedData(data);
      })
      .catch(function (err) { console.warn('seed:', err); return false; });
  }

  /* ---------------- Excel / CSV gider içe aktarma ---------------- */

  function normHead(s) {
    return String(s || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
  }

  function isoDate(raw) {
    var t = String(raw || '').trim();
    if (!t) return '';
    var m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = t.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    if (/^\d{5}$/.test(t)) {   // Excel seri tarihi
      var d = new Date(Date.UTC(1899, 11, 30) + parseInt(t, 10) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    return '';
  }

  function parseSheetRows(text) {
    var t = String(text || '');
    // HTML tablo (banka .xls dökümü)
    if (/<table[\s>]/i.test(t)) {
      var doc = new DOMParser().parseFromString(t, 'text/html');
      var rows = [];
      Array.prototype.forEach.call(doc.querySelectorAll('tr'), function (tr) {
        var cells = Array.prototype.map.call(tr.querySelectorAll('th,td'), function (td) {
          return (td.textContent || '').replace(/\s+/g, ' ').trim();
        });
        if (cells.length) rows.push(cells);
      });
      return rows;
    }
    // ayırıcı tahmini
    var lines = t.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); });
    var sample = lines.slice(0, 5).join('\n');
    var counts = { ';': (sample.match(/;/g) || []).length, '\t': (sample.match(/\t/g) || []).length, ',': (sample.match(/,/g) || []).length };
    var delim = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0] || ';';
    return lines.map(function (line) {
      var out = [], cur = '', q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (ch === '"') {
          if (q && line[i + 1] === '"') { cur += '"'; i++; }
          else q = !q;
        } else if (ch === delim && !q) { out.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      out.push(cur.trim());
      return out;
    });
  }

  function rowsToExpenses(rows) {
    var headIdx = -1, map = {};
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var cells = rows[i].map(normHead);
      var hasDate = cells.some(function (c) { return /tarih|date/.test(c); });
      var hasMoney = cells.some(function (c) { return /tutar|miktar|borç|borc|alacak|amount/.test(c); });
      if (hasDate && hasMoney) {
        headIdx = i;
        cells.forEach(function (c, j) {
          if (map.date === undefined && /tarih|date/.test(c)) map.date = j;
          else if (map.desc === undefined && /açıklama|aciklama|description|detay/.test(c)) map.desc = j;
          else if (map.category === undefined && /kategori|category|tür|tur/.test(c)) map.category = j;
          else if (map.payee === undefined && /ödenen|odenen|alıcı|alici|firma|payee/.test(c)) map.payee = j;
          else if (map.debit === undefined && /borç|borc|çıkan|cikan|gider/.test(c)) map.debit = j;
          else if (map.credit === undefined && /alacak|gelen/.test(c)) map.credit = j;
          else if (map.amount === undefined && /tutar|miktar|amount|toplam/.test(c)) map.amount = j;
        });
        break;
      }
    }
    if (headIdx < 0) return { items: [], skipped: rows.length, noHeader: true };

    var items = [], skipped = 0;
    for (var r = headIdx + 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !row.length) { skipped++; continue; }
      var amt = map.amount !== undefined ? parseAmountLoose(row[map.amount]) : null;
      if (amt === null && map.debit !== undefined) amt = parseAmountLoose(row[map.debit]);
      if (!amt || amt <= 0) { skipped++; continue; }
      var desc = map.desc !== undefined ? String(row[map.desc] || '').trim() : '';
      var cat = map.category !== undefined && row[map.category] ? String(row[map.category]).trim() : '';
      var payee = map.payee !== undefined ? String(row[map.payee] || '').trim() : '';
      if (!cat) {
        if (/demirba/i.test(desc)) cat = 'Demirbaş';
        else if (/temizlik/i.test(desc)) cat = 'Temizlik';
        else if (/elektrik|su |doğalgaz|dogalgaz/i.test(desc)) cat = 'Faturalar';
        else if (/asansör|asansor|bakım|bakim/i.test(desc)) cat = 'Bakım';
        else if (/güvenlik|guvenlik/i.test(desc)) cat = 'Güvenlik';
        else cat = 'Diğer';
      }
      items.push({
        date: isoDate(map.date !== undefined ? row[map.date] : '') || todayISO(),
        desc: desc || cat,
        category: cat,
        payee: payee,
        amount: round2(amt)
      });
    }
    return { items: items, skipped: skipped };
  }

  /* ---------------- ödeme dosyası (Excel / CSV) ---------------- */

  function normName(s) {
    return String(s || '')
      .replace(/İ/g, 'I').replace(/ı/g, 'i')
      .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
      .replace(/Ü/g, 'U').replace(/ü/g, 'u')
      .replace(/Ş/g, 'S').replace(/ş/g, 's')
      .replace(/Ç/g, 'C').replace(/ç/g, 'c')
      .replace(/Ö/g, 'O').replace(/ö/g, 'o')
      .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function findUnitByText(text) {
    var up = normName(text);
    if (!up) return null;
    // "A-8" / "A 8" / "A8" gibi kısa daire etiketleri (normName tireyi boşluğa çevirir)
    var short = up.length <= 6;
    var bm = up.match(/\b([A-C])\s*[-/]?\s*BLOK\s*(?:DA[İI]RE\s*)?(?:NO\s*[:\-]?\s*)?(\d{1,3})\b/);
    if (!bm && short) bm = up.match(/^([A-C])\s*(\d{1,3})$/);
    if (!bm) bm = up.match(/\b([A-C])\s*[-/]\s*(\d{1,3})\b/);
    if (bm) {
      var hits = DB.units.filter(function (u) {
        return String(u.no) === String(bm[2]) && String(u.block || '').toUpperCase() === bm[1];
      });
      if (hits.length) return hits[0];
    }
    var dm = up.match(/\bDA[İI]RE\s*(?:NO)?\s*[:\-]?\s*(\d{1,3})\b/);
    if (dm) {
      var d2 = DB.units.filter(function (u) { return String(u.no) === String(dm[1]); });
      if (d2.length === 1) return d2[0];
    }
    var byName = DB.units.filter(function (u) {
      var n = normName(u.owner);
      return n.length > 5 && up.indexOf(n) >= 0;
    });
    if (byName.length === 1) return byName[0];
    return null;
  }

  function rowsToPayments(rows) {
    var headIdx = -1, map = {};
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var cells = rows[i].map(normHead);
      var hasDate = cells.some(function (c) { return /tarih|date/.test(c); });
      var hasMoney = cells.some(function (c) { return /tutar|miktar|amount|bedel|toplam/.test(c); });
      if (hasDate && hasMoney) {
        headIdx = i;
        cells.forEach(function (c, j) {
          if (map.date === undefined && /tarih|date/.test(c)) map.date = j;
          else if (map.unit === undefined && /daire|blok|unit|konut|bağımsız/.test(c)) map.unit = j;
          else if (map.name === undefined && /ad soyad|adı|adi|isim|malik|sakin|gönderen|ad /.test(c)) map.name = j;
          else if (map.amount === undefined && /tutar|miktar|amount|bedel|toplam/.test(c)) map.amount = j;
          else if (map.desc === undefined && /açıklama|aciklama|description|detay/.test(c)) map.desc = j;
          else if (map.type === undefined && /tür|tur|type/.test(c)) map.type = j;
        });
        break;
      }
    }
    if (headIdx < 0) return { items: [], skipped: rows.length, noHeader: true };

    var items = [], skipped = 0;
    for (var r = headIdx + 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !row.length) { skipped++; continue; }
      var amt = map.amount !== undefined ? parseAmountLoose(row[map.amount]) : null;
      if (!amt || amt <= 0) { skipped++; continue; }
      var date = map.date !== undefined ? extractDate(String(row[map.date] || '')) : null;
      var unitTxt = map.unit !== undefined ? String(row[map.unit] || '').trim() : '';
      var nameTxt = map.name !== undefined ? String(row[map.name] || '').trim() : '';
      var desc = map.desc !== undefined ? String(row[map.desc] || '').trim() : '';
      var typeRaw = map.type !== undefined ? String(row[map.type] || '').trim() : '';

      var u = findUnitByText(unitTxt) || findUnitByText(nameTxt) || findUnitByText(desc) || null;
      var hay = (typeRaw + ' ' + desc).toLocaleLowerCase('tr');
      var type = /demirba/.test(hay) ? 'demirbaş' : (/ek tahakkuk|ceza|gecikme|faiz/.test(hay) ? 'ek' : 'aidat');

      items.push({
        date: date || todayISO(),
        unitId: u ? u.id : '',
        name: nameTxt || unitTxt,
        matched: !!u,
        amount: amt,
        desc: desc || (u ? (monthLabel((date || todayISO()).slice(0, 7)) + ' ödemesi') : ''),
        type: type
      });
    }
    return { items: items, skipped: skipped, noHeader: false };
  }

  function renderPayFilePreview(label) {
    var rows = UI.payFileRows || [];
    var box = $('#payFilePreview');
    if (!box) return;
    if (!rows.length) { box.innerHTML = ''; return; }
    var total = rows.reduce(function (s, r) { return s + r.amount; }, 0);
    var matched = rows.filter(function (r) { return r.unitId; }).length;
    var opts = sortUnits(DB.units).map(function (u) {
      return { id: u.id, label: selectLabel(u) };
    });

    box.innerHTML =
      '<div class="warn-box" style="margin-top:10px">' + rows.length + ' satır okundu · <strong>' + fmtMoney(total) +
      '</strong> · ' + matched + ' eşleşti, ' + (rows.length - matched) + ' elle seçilecek' +
      (label ? ' <span class="small muted">(' + esc(label) + ')</span>' : '') + '</div>' +
      '<table class="mini-table"><thead><tr><th>Tarih</th><th>Daire</th><th>Dosyadaki ad</th><th class="num">Tutar</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        var badge = r.unitId ? '<span class="badge ok">eşleşti</span>' : '<span class="badge warn">seç</span>';
        return '<tr><td>' + fmtDate(r.date) + '</td>' +
          '<td><select class="payfile-unit" data-i="' + i + '" style="max-width:190px">' +
            '<option value="">— daire seç —</option>' +
            opts.map(function (o) {
              return '<option value="' + esc(o.id) + '"' + (o.id === r.unitId ? ' selected' : '') + '>' + esc(o.label) + '</option>';
            }).join('') +
          '</select> ' + badge + '</td>' +
          '<td class="small">' + (esc(r.name) || '<span class="muted">—</span>') + '</td>' +
          '<td class="num"><strong>' + fmtMoney(r.amount) + '</strong></td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="form-actions"><button class="btn primary" type="button" data-act="apply-payment-file">Ödemeleri kaydet</button>' +
      '<button class="btn ghost" type="button" data-act="cancel-payment-file">Vazgeç</button></div>';
  }

  function handlePaymentFile(file) {
    if (!file) return;
    if (/\.xlsx$/i.test(file.name)) {
      toast('.xlsx desteklenmiyor — Excel’de “Farklı kaydet → CSV” yapıp yükleyin.', 5200);
      return;
    }
    var rd = new FileReader();
    rd.onload = function () {
      var res;
      try { res = rowsToPayments(parseSheetRows(String(rd.result || ''))); }
      catch (e) { toast('Dosya okunamadı: ' + e.message, 4600); return; }
      var info = $('#payFileInfo');
      if (info) info.textContent = file.name + ' · ' + res.items.length + ' satır';
      if (!res.items.length) {
        toast(res.noHeader ? 'Başlık satırı bulunamadı (Tarih + Tutar sütunları gerekli).' : 'Ödeme satırı bulunamadı.', 5200);
        return;
      }
      UI.payFileRows = res.items;
      renderPayFilePreview(file.name + (res.skipped ? ' · ' + res.skipped + ' satır atlandı' : ''));
    };
    rd.readAsText(file, 'utf-8');
  }

  function handleExpenseFile(file) {
    if (!file) return;
    if (/\.xlsx$/i.test(file.name)) {
      toast('.xlsx desteklenmiyor — Excel’de “Farklı kaydet → CSV” yapıp yükleyin.', 5200);
      return;
    }
    var rd = new FileReader();
    rd.onload = function () {
      var res;
      try { res = rowsToExpenses(parseSheetRows(String(rd.result || ''))); }
      catch (e) { toast('Dosya okunamadı: ' + e.message, 4600); return; }
      var info = $('#expFileInfo');
      if (info) info.textContent = file.name + ' · ' + res.items.length + ' gider bulundu';
      if (!res.items.length) {
        toast(res.noHeader ? 'Başlık satırı bulunamadı (tarih + tutar sütunu gerekli).' : 'Gider satırı bulunamadı.', 5000);
        return;
      }
      UI.expFileRows = res.items;
      var r = $('#expFilePreview');
      if (r) {
        r.innerHTML = '<div class="warn-box">' + res.items.length + ' gider bulundu' +
          (res.skipped ? ' · ' + res.skipped + ' satır atlandı' : '') +
          '. Toplam <strong>' + fmtMoney(res.items.reduce(function (s, x) { return s + x.amount; }, 0)) + '</strong></div>' +
          '<table class="mini-table"><thead><tr><th>Tarih</th><th>Kategori</th><th>Açıklama</th><th class="num">Tutar</th></tr></thead><tbody>' +
          res.items.slice(0, 8).map(function (x) {
            return '<tr><td>' + fmtDate(x.date) + '</td><td>' + esc(x.category) + '</td><td>' + esc(x.desc).slice(0, 60) +
              '</td><td class="num">' + fmtMoney(x.amount) + '</td></tr>';
          }).join('') +
          (res.items.length > 8 ? '<tr><td colspan="4" class="muted">… +' + (res.items.length - 8) + ' satır</td></tr>' : '') +
          '</tbody></table>' +
          '<div class="form-actions"><button class="btn primary" type="button" data-act="apply-expense-file">Listeye ekle</button>' +
          '<button class="btn ghost" type="button" data-act="cancel-expense-file">Vazgeç</button></div>';
      }
    };
    rd.readAsText(file, 'utf-8');
  }

  function gmailFetch() {
    if (!cloudReady()) {
      toast('Önce ortak veri bağlantısını kurun.');
      setTab('settings');
      return;
    }
    toast('Gmail köprüsü kontrol ediliyor…', 2400);
    cloudPull(false).then(function (ok) {
      if (!ok) toast('Yeni bildirim yok. Köprü 15 dakikada bir kendisi de yazıyor.', 4600);
    });
  }

  function openSeedModal() {
    openModal('Hazır listeyi yükle',
      '<p class="lead">Yönetim listesini açan şifreyi girin (panele giriş şifrenizle aynı olabilir).</p>' +
      '<div class="form-grid" style="grid-template-columns:1fr">' +
        '<label>Liste şifresi<input type="password" id="seedPass" autocomplete="off"></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="button" data-act="seed-apply">Yükle</button>' +
      '<button class="btn ghost" type="button" data-act="close-modal">Vazgeç</button></div>' +
      '<p class="hint" style="margin-top:10px">Liste cihazda saklanır; her cihazda bir kez yüklemeniz yeterli.</p>');
    setTimeout(function () { var e = $('#seedPass'); if (e) e.focus(); }, 80);
  }

  function maybeImportFromHash() {
    var m = (location.hash || '').match(/^#veri=([^&]+)/);
    if (!m) return false;
    var pass = decodeURIComponent(m[1]);
    fetch('seed.enc.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('seed yok');
        return r.json();
      })
      .then(function (seed) { return decryptSeed(seed, pass); })
      .then(function (data) {
        if (importSeedData(data)) {
          try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { }
        }
      })
      .catch(function (err) {
        console.warn(err);
        toast('Şifreli liste açılamadı. Bağlantı eksik kopyalanmış olabilir.', 4500);
      });
    return true;
  }

  function applyJsonText(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { toast('Geçersiz JSON. Dosyanın tamamını kopyaladığınızdan emin olun.', 4200); return; }
    if (!data || !Array.isArray(data.units)) { toast('Bu bir yedek dosyası değil.', 4000); return; }
    if (DB.units.length && !confirm('Mevcut ' + DB.units.length + ' hesap ve kayıtlar bu yedekle değiştirilecek. Devam edilsin mi?')) return;
    DB = migrate(data);
    saveDB();
    closeModal();
    renderAll();
    toast(DB.units.length + ' hesap yüklendi.');
  }

  function parseBulkLine(line) {
    var s = String(line).replace(/\s+/g, ' ').trim();
    if (!s) return null;
    var mAmt = s.match(/(-?\d[\d.]*(?:,\d{1,2})?)\s*(?:tl|try|₺)?\s*$/i);
    if (!mAmt) return { line: s, error: 'Tutar okunamadı' };
    var amount = parseAmountLoose(mAmt[1]);
    if (amount == null) return { line: s, error: 'Tutar okunamadı' };
    var head = s.slice(0, mAmt.index).trim();
    var block = '', no = '';
    var m1 = head.match(/\b([A-Za-z])\s*BLOK\s+(\d{1,3})\b/i);
    if (m1) { block = m1[1].toUpperCase(); no = m1[2]; }
    if (!no) {
      var m2 = head.match(/^([A-Za-z])\s*[-\/]\s*(\d{1,3})\b/);
      if (m2) { block = m2[1].toUpperCase(); no = m2[2]; }
    }
    if (!no) {
      var m3 = head.match(/^(\d{1,3})\b/);
      if (m3) no = m3[1];
    }
    if (!no) return { line: s, error: 'Daire no bulunamadı' };
    var type = /kirac/i.test(head) ? 'kiracı' : (/malik/i.test(head) ? 'malik' : '');
    var cands = DB.units.filter(function (u) {
      return String(u.no) === no && (!block || String(u.block || '').toUpperCase() === block);
    });
    if (type) cands = cands.filter(function (u) { return u.type === type; });
    if (!cands.length) return { line: s, error: 'Eşleşen hesap yok', amount: amount };
    var billable = cands.filter(function (u) { return u.billable !== false; });
    return { line: s, unit: billable[0] || cands[0], amount: amount, error: '' };
  }

  function renderBulkPreview(rows) {
    var ok = rows.filter(function (r) { return !r.error; });
    var bad = rows.filter(function (r) { return r.error; });
    var html = ok.length
      ? '<table class="mini-table"><thead><tr><th>Daire</th><th>Tip</th><th>Sakin</th><th class="num">Eski</th><th class="num">Yeni</th></tr></thead><tbody>' +
        ok.map(function (r) {
          return '<tr><td>' + esc(unitLabel(r.unit)) + '</td><td>' + esc(typeLabel(r.unit)) + '</td>' +
            '<td>' + esc(r.unit.owner || '—') + '</td><td class="num muted">' + fmtMoney(r.unit.opening || 0) + '</td>' +
            '<td class="num"><strong>' + fmtMoney(r.amount) + '</strong></td></tr>';
        }).join('') + '</tbody></table>'
      : '';
    if (bad.length) {
      html += '<div class="warn-box">' + bad.length + ' satır eşleşmedi: ' +
        bad.slice(0, 4).map(function (r) { return esc(r.line) + ' (' + esc(r.error) + ')'; }).join(' · ') + '</div>';
    }
    $('#bulkPreview').innerHTML = html;
  }

  function openChangePass() {
    var a = authData();
    if (!a) { toast('Önce şifre oluşturun.'); return; }
    openModal('Şifre değiştir',
      '<div class="form-grid" style="grid-template-columns:1fr">' +
        '<label>Mevcut şifre<input type="password" id="cpOld" autocomplete="current-password"></label>' +
        '<label>Yeni şifre<input type="password" id="cpNew" autocomplete="new-password"></label>' +
        '<label>Yeni şifre (tekrar)<input type="password" id="cpNew2" autocomplete="new-password"></label>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="button" data-act="save-pass">Kaydet</button>' +
      '<button class="btn ghost" type="button" data-act="close-modal">Vazgeç</button></div>');
  }

  /* ---------------- init ---------------- */
  function startApp(opts) {
    if (started) return;
    started = true;

    $('#asOfInput').value = UI.asOf;
    document.querySelectorAll('input[type=date]').forEach(function (el) {
      if (!el.value) el.value = todayISO();
    });
    $$('#payForm, #expForm').forEach(function (f) {
      if (f.period) f.period.value = todayMonth();
      if (f.date) f.date.value = todayISO();
    });

    wire();
    renderAll();

    var seeding = (opts && opts.seeding) || maybeImportFromHash();
    if (!DB.units.length && !seeding) openSetup();

    if (cloudReady()) {
      cloudPull(true).then(function (ok) {
        if (ok) renderAll();
      });
      if (cloudPoll) clearInterval(cloudPoll);
      cloudPoll = setInterval(function () {
        if (document.visibilityState !== 'visible' || pushTimer) return;
        cloudPull(true);
      }, 45000);
    }

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sessizce geç */ });
    }
  }

  function unlockApp(pass) {
    try { sessionStorage.setItem('sazeli_unlocked', '1'); } catch (e) { }
    $('#lockScreen').hidden = true;
    document.body.classList.remove('locked');
    if (!UI.asOf) UI.asOf = todayMonth();
    var seeding = !DB.units.length && !!pass;
    startApp({ seeding: seeding });
    if (pass) trySeedWith(pass);
  }

  function init() {
    DB = loadDB();
    if (!DB) { DB = newDB(); saveDB(); }
    UI.asOf = todayMonth();

    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault();
        if (!document.body.classList.contains('locked')) openSearch();
      }
    });

    bindLock();
    var pk = portalUnitId();
    if (pk) { $('#lockScreen').hidden = true; document.body.classList.remove('locked'); startPortal(pk); return; }
    var unlocked = false;
    try { unlocked = sessionStorage.getItem('sazeli_unlocked') === '1'; } catch (e) { }
    if (unlocked) {
      $('#lockScreen').hidden = true;
      startApp();
    } else {
      showLock();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
