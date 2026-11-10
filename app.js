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
    'Bahçe/Peyzaj', 'Güvenlik', 'Bakım/Onarım', 'Personel/Maaş', 'Vergi/Harç', 'Diğer'];

  var PALETTE = ['#0f766e', '#14b8a6', '#3b82f6', '#6366f1', '#f59e0b',
    '#ef4444', '#84cc16', '#a855f7', '#0ea5e9', '#64748b', '#f97316'];

  var DB = null;
  var UI = {
    tab: 'panel',
    asOf: null,
    search: '',
    block: '',
    onlyDebtors: false,
    drawerUnit: null,
    importRows: null
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
    if (start > end) return [end];
    var out = [], cur = start, guard = 0;
    while (cur <= end && guard < 600) { out.push(cur); cur = addMonths(cur, 1); guard++; }
    return out;
  }
  var nf = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  function fmtNum(n) { return nf.format(round2(n)); }
  function fmtMoney(n) { return fmtNum(n) + ' ₺'; }
  function fmtShort(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1).replace('.', ',') + 'M';
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace('.', ',') + 'b';
    return String(Math.round(n));
  }
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
      v: 1,
      meta: { siteName: 'Şazeli Konakları', createdAt: new Date().toISOString(), updatedAt: null },
      settings: {
        monthlyFee: 0,
        startMonth: todayMonth(),
        budgetMonthly: 0,
        managerName: '',
        managerPhone: '',
        note: ''
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
        active: u.active !== false
      };
    });
    d.payments = (d.payments || []).map(function (p) {
      return {
        id: p.id || uid('p'),
        unitId: p.unitId, date: p.date || todayISO(), period: p.period || (p.date || '').slice(0, 7),
        type: p.type || 'aidat', amount: round2(p.amount), desc: p.desc || '', source: p.source || 'Diğer',
        createdAt: p.createdAt || new Date().toISOString()
      };
    }).filter(function (p) { return p.unitId && p.amount > 0; });
    d.charges = (d.charges || []).map(function (c) {
      return { id: c.id || uid('c'), unitId: c.unitId, date: c.date || todayISO(), label: c.label || 'Ek tahakkuk', amount: round2(c.amount) };
    }).filter(function (c) { return c.unitId && c.amount > 0; });
    d.expenses = (d.expenses || []).map(function (e) {
      return {
        id: e.id || uid('e'), date: e.date || todayISO(), category: e.category || 'Diğer',
        amount: round2(e.amount), desc: e.desc || '', payee: e.payee || ''
      };
    }).filter(function (e) { return e.amount > 0; });
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
      DB.meta.updatedAt = new Date().toISOString();
      localStorage.setItem(LS_KEY, JSON.stringify(DB));
      return true;
    } catch (err) {
      console.error(err);
      toast('Kayıt başarısız: tarayıcı depolaması dolu olabilir.', 4200);
      return false;
    }
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
  function unitFee(u) {
    return (u && typeof u.fee === 'number' && u.fee > 0) ? u.fee : (Number(DB.settings.monthlyFee) || 0);
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
  function computeAll(asOf) {
    var start = DB.settings.startMonth || todayMonth();
    var periods = monthsRange(start, asOf);
    var cutoff = asOf + '-31';

    var rows = DB.units.filter(function (u) { return u.active !== false; }).map(function (u) {
      var fee = unitFee(u);
      var expected = round2(fee * periods.length);
      var extra = round2(DB.charges.filter(function (c) { return c.unitId === u.id; })
        .reduce(function (s, c) { return s + c.amount; }, 0));
      var pays = DB.payments.filter(function (p) {
        return p.unitId === u.id && String(p.date || '') <= cutoff;
      });
      var paid = round2(pays.reduce(function (s, p) { return s + p.amount; }, 0));
      var paidAidat = round2(pays.filter(function (p) { return p.type !== 'ek'; })
        .reduce(function (s, p) { return s + p.amount; }, 0));
      var paidEk = round2(paid - paidAidat);

      var pool = paidAidat;
      var months = periods.map(function (k) {
        var got = Math.min(fee, Math.max(0, pool));
        pool -= got;
        var status = fee <= 0 ? 'paid' : (got >= fee - 0.01 ? 'paid' : (got > 0.01 ? 'partial' : 'unpaid'));
        return { month: k, due: fee, paid: round2(got), status: status };
      });

      var extraPool = paidEk + Math.max(0, pool);
      var extraLeft = Math.max(0, round2(extra - extraPool));
      var debt = round2(expected + extra - paid);

      return {
        u: u, label: unitLabel(u), fee: fee, months: months, periods: periods,
        expected: expected, extra: extra, extraLeft: extraLeft,
        paid: paid, debt: debt, surplus: debt < -0.5 ? Math.abs(debt) : 0,
        lastPayment: pays.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })[0] || null
      };
    });

    var totals = rows.reduce(function (t, r) {
      t.expected += r.expected;
      t.extra += r.extra;
      t.paid += r.paid;
      if (r.debt > 0.5) { t.debt += r.debt; t.debtors++; }
      if (r.debt < -0.5) { t.credit += Math.abs(r.debt); }
      t.extraLeft += r.extraLeft;
      return t;
    }, { expected: 0, extra: 0, extraLeft: 0, paid: 0, debt: 0, credit: 0, debtors: 0 });

    totals.expected = round2(totals.expected);
    totals.extra = round2(totals.extra);
    totals.paid = round2(totals.paid);
    totals.debt = round2(totals.debt);
    totals.credit = round2(totals.credit);

    var expenses = round2(DB.expenses.filter(function (e) { return String(e.date || '') <= cutoff; })
      .reduce(function (s, e) { return s + e.amount; }, 0));

    var monthPayments = DB.payments.filter(function (p) {
      return String(p.date || '').slice(0, 7) === asOf;
    }).reduce(function (s, p) { return s + p.amount; }, 0);
    var monthExpenses = DB.expenses.filter(function (e) {
      return String(e.date || '').slice(0, 7) === asOf;
    }).reduce(function (s, e) { return s + e.amount; }, 0);

    return {
      asOf: asOf, periods: periods, rows: rows, totals: totals,
      expenses: expenses, balance: round2(totals.paid - expenses),
      monthPayments: round2(monthPayments), monthExpenses: round2(monthExpenses),
      collectRate: totals.expected + totals.extra > 0
        ? Math.min(100, pct(totals.paid, totals.expected + totals.extra)) : 0
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
    var W = 600, H = 232, padL = 46, padR = 10, padT = 16, padB = 32;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var max = 1;
    series.forEach(function (s) { s.values.forEach(function (v) { if (v > max) max = v; }); });
    var step = max / 3;
    var nice = Math.ceil(step / 10) * 10;
    var top = Math.max(nice * 3, 300);

    var grid = '', i, y;
    for (i = 0; i <= 3; i++) {
      y = padT + plotH - (plotH * i / 3);
      grid += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y +
        '" stroke="#eef2f6" stroke-width="1"></line>';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="10" fill="#8b9aad">' +
        fmtShort(top * i / 3) + '</text>';
    }

    var groupW = plotW / Math.max(labels.length, 1);
    var barW = Math.min(26, groupW * 0.28);
    var bars = '', xlabels = '';

    labels.forEach(function (lab, idx) {
      var gx = padL + groupW * idx + groupW / 2;
      series.forEach(function (s, si) {
        var v = s.values[idx] || 0;
        var h = top > 0 ? (v / top) * plotH : 0;
        var bx = gx - (series.length * barW + (series.length - 1) * 4) / 2 + si * (barW + 4);
        if (h > 0) {
          bars += '<rect x="' + bx + '" y="' + (padT + plotH - h) + '" width="' + barW + '" height="' + h +
            '" rx="4" fill="' + s.color + '"><title>' + esc(lab + ' · ' + s.name + ': ' + fmtMoney(v)) + '</title></rect>';
        } else {
          bars += '<rect x="' + bx + '" y="' + (padT + plotH - 2) + '" width="' + barW + '" height="2" rx="1" fill="#e9eef4"></rect>';
        }
      });
      xlabels += '<text x="' + gx + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10.5" fill="#6b7c93">' +
        esc(lab) + '</text>';
    });

    return '<svg class="bars-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Aylık tahsilat ve gider grafiği">' +
      grid + bars + xlabels +
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

    $('#panelSub').textContent = unitCount
      ? unitCount + ' daire · ' + monthLabel(DB.settings.startMonth) + ' – ' + monthLabel(c.asOf) +
        ' · aylık aidat ' + fmtMoney(DB.settings.monthlyFee)
      : 'Henüz daire eklenmedi. Ayarlar bölümünden daire listesini oluşturun.';

    $('#kpis').innerHTML = [
      '<div class="kpi ok"><div class="kpi-label">Toplam Tahsilat</div>' +
        '<div class="kpi-value">' + fmtMoney(t.paid) + '</div>' +
        '<div class="kpi-sub">' + DB.payments.length + ' ödeme kaydı · bu ay <strong>' + fmtMoney(c.monthPayments) + '</strong></div></div>',

      '<div class="kpi danger"><div class="kpi-label">Kalan Borç</div>' +
        '<div class="kpi-value">' + fmtMoney(t.debt) + '</div>' +
        '<div class="kpi-sub"><strong>' + t.debtors + '</strong> daire borçlu' +
        (t.extraLeft > 0 ? ' · ek tahakkuk ' + fmtMoney(t.extraLeft) : '') + '</div></div>',

      '<div class="kpi ' + (c.balance < 0 ? 'danger' : '') + '"><div class="kpi-label">Kasa Bakiyesi</div>' +
        '<div class="kpi-value">' + fmtMoney(c.balance) + '</div>' +
        '<div class="kpi-sub">Toplam gider ' + fmtMoney(c.expenses) + ' · bu ay ' + fmtMoney(c.monthExpenses) + '</div></div>',

      '<div class="kpi warn"><div class="kpi-label">Tahsilat Oranı</div>' +
        '<div class="kpi-value">%' + String(c.collectRate).replace('.', ',') + '</div>' +
        '<div class="kpi-sub">Tahakkuk ' + fmtMoney(t.expected + t.extra) +
        (t.credit > 0 ? ' · alacak ' + fmtMoney(t.credit) : '') + '</div></div>'
    ].join('');

    /* tahsilat donut */
    var collectSegs = [
      { label: 'Tahsil edilen', value: Math.max(0, t.paid), color: '#0f766e', display: fmtMoney(t.paid) },
      { label: 'Kalan borç', value: Math.max(0, t.debt), color: '#f59e0b', display: fmtMoney(t.debt) }
    ];
    var collectTotal = collectSegs[0].value + collectSegs[1].value;
    $('#donutTahsilat').innerHTML = '<div class="donut-wrap">' +
      donutSVG(collectSegs, {
        centerValue: '%' + String(c.collectRate).replace('.', ','),
        centerLabel: 'TAHSİLAT', aria: 'Tahsilat durumu'
      }) + legendHTML(collectSegs.filter(function (s) { return s.value > 0; }), collectTotal) + '</div>';
    $('#collectHint').textContent = t.credit > 0 ? 'Alacak: ' + fmtMoney(t.credit) : monthLabel(c.asOf);

    /* gider donut */
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

    $('#donutGider').innerHTML = catTotal > 0
      ? '<div class="donut-wrap">' +
        donutSVG(catSegs, {
          centerValue: fmtShort(catTotal) + ' ₺', centerLabel: 'TOPLAM GİDER', aria: 'Gider dağılımı'
        }) + legendHTML(catSegs.slice(0, 6), catTotal) + '</div>'
      : '<div class="empty">Henüz gider kaydı yok.<br><span class="small">Gider &amp; Bütçe bölümünden ekleyebilirsiniz.</span></div>';

    /* bar chart */
    var mkeys = [], cur = c.asOf;
    for (var i = 0; i < 6; i++) { mkeys.unshift(cur); cur = addMonths(cur, -1); }
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
          return '<div class="hbar-row"><span class="u">' + esc(r.label) + '</span>' +
            '<span class="hbar-track"><span class="hbar-fill" style="width:' + Math.max(4, (r.debt / maxD) * 100) + '%"></span></span>' +
            '<span class="a debt">' + fmtMoney(r.debt) + '</span></div>';
        }).join('') + '</div>'
      : '<div class="empty">Borçlu daire yok. 🎉</div>';

    /* recent payments */
    var recent = DB.payments.slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    }).slice(0, 6);
    $('#recentPayments').innerHTML = recent.length
      ? '<table class="mini-table"><thead><tr><th>Tarih</th><th>Daire</th><th class="num">Tutar</th></tr></thead><tbody>' +
        recent.map(function (p) {
          var u = unitById(p.unitId);
          return '<tr><td>' + fmtDate(p.date) + '</td><td>' + esc(u ? unitLabel(u) : '—') +
            (p.desc ? '<div class="small muted" style="max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.desc) + '</div>' : '') +
            '</td><td class="num">' + fmtMoney(p.amount) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="empty">Henüz ödeme yok.</div>';
  }

  /* ---------------- render: debts ---------------- */
  function renderDebts(c) {
    var blocksList = blocks();
    var sel = $('#debtBlock');
    var curVal = sel.value;
    sel.innerHTML = '<option value="">Tüm bloklar</option>' + blocksList.map(function (b) {
      return '<option value="' + esc(b) + '">' + esc(b) + ' Blok</option>';
    }).join('');
    sel.value = curVal && blocksList.indexOf(curVal) >= 0 ? curVal : '';

    var q = ($('#debtSearch').value || '').toLocaleLowerCase('tr');
    var rows = c.rows.filter(function (r) {
      if (UI.onlyDebtors && r.debt <= 0.5) return false;
      if (sel.value && r.u.block !== sel.value) return false;
      if (q) {
        var hay = (r.label + ' ' + (r.u.owner || '') + ' ' + (r.u.phone || '')).toLocaleLowerCase('tr');
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    var tb = $('#debtTable tbody');
    tb.innerHTML = rows.map(function (r) {
      var lastMonths = r.months.slice(-6);
      var strip = lastMonths.map(function (m) {
        var txt = { paid: '✓', partial: '~', unpaid: '!' }[m.status];
        return '<span class="ms ' + m.status + '" title="' + monthLabel(m.month) + ' · ' +
          (m.status === 'paid' ? 'Ödendi' : m.status === 'partial' ? 'Kısmi: ' + fmtMoney(m.paid) : 'Ödenmedi') + '">' + txt + '</span>';
      }).join('');

      var debtClass = r.debt > 0.5 ? '' : (r.debt < -0.5 ? ' credit' : ' zero');
      var debtTxt = fmtMoney(r.debt);
      var badge = r.debt > 0.5 ? '<span class="badge danger">Borçlu</span>' :
        (r.debt < -0.5 ? '<span class="badge info">Alacaklı</span>' : '<span class="badge ok">Kapalı</span>');

      return '<tr data-unit="' + esc(r.u.id) + '">' +
        '<td><button class="unit-btn" data-act="open-unit" data-id="' + esc(r.u.id) + '">' + esc(r.label) + '</button>' +
          (r.extra > 0 ? ' <span class="badge info" title="Ek tahakkuk: ' + fmtMoney(r.extra) + '">ek</span>' : '') + '</td>' +
        '<td class="owner-cell">' + (esc(r.u.owner) || '<span class="muted">—</span>') + '</td>' +
        '<td class="num">' + fmtMoney(r.fee) + '</td>' +
        '<td class="num">' + fmtMoney(r.expected + r.extra) + '</td>' +
        '<td class="num">' + fmtMoney(r.paid) + '</td>' +
        '<td class="num"><span class="debt-amt' + debtClass + '">' + debtTxt + '</span><div style="margin-top:3px">' + badge + '</div></td>' +
        '<td><div class="monthstrip">' + strip + '</div></td>' +
        '<td class="right"><span class="row-actions">' +
          '<button class="btn sm ghost" type="button" data-act="quick-pay-unit" data-id="' + esc(r.u.id) + '">Ödeme</button>' +
          '<button class="btn sm ghost" type="button" data-act="remind-unit" data-id="' + esc(r.u.id) + '">Hatırlat</button>' +
        '</span></td>' +
      '</tr>';
    }).join('');

    $('#debtEmpty').hidden = rows.length > 0;
    $('#debtTable').style.display = rows.length ? '' : 'none';
    $('#debtLegend').style.display = rows.length ? '' : 'none';

    var sum = rows.reduce(function (s, r) { return s + Math.max(0, r.debt); }, 0);
    $('#debtSum').innerHTML = rows.length + ' daire · toplam borç <strong>' + fmtMoney(sum) + '</strong>';
  }

  /* ---------------- render: payments ---------------- */
  function renderPayments() {
    fillUnitSelect($('#payUnit'));
    var q = ($('#paySearch').value || '').toLocaleLowerCase('tr');
    var list = DB.payments.slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    }).filter(function (p) {
      if (!q) return true;
      var u = unitById(p.unitId);
      var hay = ((u ? unitLabel(u) : '') + ' ' + (p.desc || '') + ' ' + (p.source || '') + ' ' + (p.type || '')).toLocaleLowerCase('tr');
      return hay.indexOf(q) >= 0;
    });

    var typeName = { aidat: 'Aidat', ek: 'Ek tahakkuk', diger: 'Diğer' };
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
  }

  function fillUnitSelect(sel) {
    if (!sel) return;
    var prev = sel.value;
    var units = sortUnits(DB.units.filter(function (u) { return u.active !== false; }));
    sel.innerHTML = units.length
      ? units.map(function (u) {
          return '<option value="' + esc(u.id) + '">' + esc(unitLabel(u)) +
            (u.owner ? ' · ' + esc(u.owner) : '') + '</option>';
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

    $('#budgetBox').innerHTML = '<div class="card">' +
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
      '<tbody>' + rowsHTML + '</tbody></table></div>';

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
  function renderSettings() {
    var counts = {
      units: DB.units.length,
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
              '<label>Yönetici<input id="setManager" value="' + esc(DB.settings.managerName) + '" placeholder="Ad Soyad"></label>' +
              '<label class="span-2">İletişim notu (hatırlatma metninde görünür)<input id="setNote" value="' + esc(DB.settings.note) + '" placeholder="Örn. Ödemeler için IBAN: TR.. .."></label>' +
            '</div>' +
            '<div class="form-actions"><button class="btn primary" type="button" data-act="save-settings">Kaydet</button>' +
            '<span class="hint">Aidat değişikliği geçmiş dönemlere uygulanmaz; geçmiş kayıtlar silinmez.</span></div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-h"><h3>Daireler</h3><span class="hint">' + counts.units + ' daire</span></div>' +
            '<div class="units-scroll"><table class="units-table"><thead><tr>' +
              '<th style="width:64px">Blok</th><th style="width:74px">No</th><th>Sakin</th><th style="width:150px">Telefon</th><th style="width:96px">Aidat (₺)</th><th style="width:34px"></th>' +
            '</tr></thead><tbody>' +
            sortUnits(DB.units).map(function (u) {
              return '<tr>' +
                '<td><input data-unit-field="block" data-id="' + esc(u.id) + '" value="' + esc(u.block) + '" placeholder="A"></td>' +
                '<td><input data-unit-field="no" data-id="' + esc(u.id) + '" value="' + esc(u.no) + '"></td>' +
                '<td><input data-unit-field="owner" data-id="' + esc(u.id) + '" value="' + esc(u.owner) + '" placeholder="Ad Soyad"></td>' +
                '<td><input data-unit-field="phone" data-id="' + esc(u.id) + '" value="' + esc(u.phone) + '" placeholder="05.."></td>' +
                '<td><input data-unit-field="fee" data-id="' + esc(u.id) + '" type="number" min="0" step="1" value="' + (u.fee || '') + '" placeholder="' + (DB.settings.monthlyFee || '') + '"></td>' +
                '<td><button class="icon-btn" type="button" data-act="del-unit" data-id="' + esc(u.id) + '" title="Daireyi sil">✕</button></td>' +
              '</tr>';
            }).join('') +
            '</tbody></table></div>' +
            '<div class="form-actions" style="gap:8px;flex-wrap:wrap">' +
              '<input id="newBlock" class="input" style="width:74px;flex:none" placeholder="Blok">' +
              '<input id="newNo" class="input" style="width:84px;flex:none" placeholder="No">' +
              '<input id="newOwner" class="input" style="flex:1;min-width:140px" placeholder="Sakin adı (isteğe bağlı)">' +
              '<button class="btn ghost" type="button" data-act="add-unit">+ Daire Ekle</button>' +
            '</div>' +
            '<p class="hint" style="margin-top:8px">Tek bloklu sitede “Blok” alanını boş bırakın; daireler 1, 2, 3… olarak görünür.</p>' +
          '</div>' +
        '</div>' +

        '<div>' +
          '<div class="card">' +
            '<div class="card-h"><h3>Kurulum</h3></div>' +
            '<p class="small muted">Daire listesini sıfırdan oluşturmak için sihirbazı çalıştırın. Mevcut daireler silinir (ödemeler korunur ancak eşleşmeyebilir).</p>' +
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
            '<input type="file" id="jsonFile" accept="application/json,.json" hidden>' +
            '<div style="margin-top:14px">' +
              '<div class="kv"><span class="k">Daire / ödeme / tahakkuk / gider</span><span class="v">' +
                counts.units + ' / ' + counts.payments + ' / ' + counts.charges + ' / ' + counts.expenses + '</span></div>' +
              '<div class="kv"><span class="k">Son kayıt</span><span class="v">' +
                (updated ? updated.toLocaleString('tr-TR') : '—') + '</span></div>' +
              '<div class="kv"><span class="k">Sürüm</span><span class="v">1.0</span></div>' +
            '</div>' +
            (counts.payments === 0 && counts.expenses === 0
              ? '<div class="form-actions"><button class="btn ghost" type="button" data-act="demo-data">Örnek veriyle doldur</button></div>'
              : '') +
          '</div>' +

          '<div class="card danger-zone">' +
            '<div class="card-h"><h3>Tehlikeli Bölge</h3></div>' +
            '<p class="small muted">Tüm daire, ödeme ve gider kayıtları silinir. Önce yedek indirin.</p>' +
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
    if (!DB) return;
    if (!UI.asOf) UI.asOf = todayMonth();
    var c = computeAll(UI.asOf);
    renderHeader();
    renderPanel(c);
    renderDebts(c);
    renderPayments();
    renderExpenses(c);
    renderSettings();
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

    $('#drawerTitle').textContent = unitLabel(u) + ' numaralı daire';
    $('#drawerSub').textContent = (u.owner || 'Sakin adı girilmemiş') + (u.phone ? ' · ' + u.phone : '');

    var pays = DB.payments.filter(function (p) { return p.unitId === unitId; })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var charges = DB.charges.filter(function (x) { return x.unitId === unitId; });

    var monthCells = r.months.slice().reverse().map(function (m) {
      return '<div class="mcell ' + m.status + '"><div class="m">' + monthLabel(m.month) + '</div>' +
        '<div class="s">' + (m.status === 'paid' ? 'Ödendi' : m.status === 'partial' ? 'Kısmi ' + fmtMoney(m.paid) : 'Ödenmedi') + '</div></div>';
    }).join('');

    $('#drawerBody').innerHTML =
      '<div class="drawer-summary">' +
        '<div class="dsum"><div class="l">Tahakkuk</div><div class="v">' + fmtMoney(r.expected + r.extra) + '</div></div>' +
        '<div class="dsum"><div class="l">Ödenen</div><div class="v">' + fmtMoney(r.paid) + '</div></div>' +
        '<div class="dsum"><div class="l">Kalan borç</div><div class="v" style="color:' +
          (r.debt > 0.5 ? 'var(--danger)' : r.debt < -0.5 ? 'var(--brand)' : 'var(--ok)') + '">' + fmtMoney(r.debt) + '</div></div>' +
        '<div class="dsum"><div class="l">Aylık aidat</div><div class="v">' + fmtMoney(r.fee) + '</div></div>' +
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
              '<td class="num">' + fmtMoney(p.amount) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="small muted">Bu daireye ait ödeme kaydı yok.</p>') +

      '<div class="drawer-actions">' +
        '<button class="btn primary" type="button" data-act="quick-pay-unit" data-id="' + esc(u.id) + '">Ödeme ekle</button>' +
        '<button class="btn ghost" type="button" data-act="add-charge-unit" data-id="' + esc(u.id) + '">Ek tahakkuk</button>' +
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
  function openModal(title, bodyHTML) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
    $('#modal').hidden = false;
  }
  function closeModal() {
    $('#modal').hidden = true;
  }

  function reminderText(r) {
    var u = r.u;
    var lines = [];
    lines.push('Sayın ' + (u.owner || (r.label + ' numaralı daire sakini')) + ',');
    lines.push('');
    lines.push((DB.meta.siteName || 'Site') + ' ' + r.label + ' numaralı daire için ' +
      fmtMoney(Math.max(0, r.debt)) + ' tutarında aidat borcu görünmektedir.');
    if (r.extraLeft > 0) lines.push('(Bunun ' + fmtMoney(r.extraLeft) + ' kadarı ek tahakkuktur.)');
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
        units.push({ id: uid('u'), block: blk, no: String(i), owner: '', phone: '', fee: null, active: true });
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

  function addPayment(p) {
    DB.payments.push({
      id: uid('p'), unitId: p.unitId, date: p.date || todayISO(),
      period: p.period || (p.date || todayISO()).slice(0, 7),
      type: p.type || 'aidat', amount: round2(p.amount), desc: p.desc || '',
      source: p.source || 'Gmail', createdAt: new Date().toISOString()
    });
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

    var m = norm.match(/daire\s*(?:no|numara|numaras[ıi]|numaral[ıi])?\s*[:#.\-]?\s*([a-z]{1,2})?\s*[-\/ ]?\s*(\d{1,3})\b/);
    if (m) {
      var blk = (m[1] || '').toUpperCase(), no = m[2];
      var hit = null;
      if (blk) hit = units.find(function (u) {
        return String(u.block || '').toUpperCase() === blk && String(u.no) === no;
      });
      if (!hit) hit = units.find(function (u) { return String(u.no) === no; });
      if (hit) return hit.id;
    }

    var m2 = norm.match(/\b([a-z])\s*[-\/]\s*(\d{1,3})\b/);
    if (m2) {
      var b2 = m2[1].toUpperCase(), n2 = m2[2];
      var hit2 = units.find(function (u) {
        return String(u.block || '').toUpperCase() === b2 && String(u.no) === n2;
      });
      if (hit2) return hit2.id;
      hit2 = units.find(function (u) { return String(u.no) === n2; });
      if (hit2) return hit2.id;
    }

    var m3 = norm.match(/\b(\d{1,3})\s*(?:nolu|numaral[ıi])\b/);
    if (m3) {
      var hit3 = units.find(function (u) { return String(u.no) === m3[1]; });
      if (hit3) return hit3.id;
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
            return '<option value="' + esc(u.id) + '"' + (u.id === r.unitId ? ' selected' : '') + '>' + esc(unitLabel(u)) + '</option>';
          }).join('') + '</select></td>' +
        '<td><select class="select" style="padding:5px 7px;font-size:12.5px" data-imp="type" data-i="' + i + '">' +
          ['aidat', 'ek', 'diger'].map(function (tp) {
            var nm = { aidat: 'Aidat', ek: 'Ek tahakkuk', diger: 'Diğer' }[tp];
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
    var lines = [['Daire', 'Blok', 'No', 'Sakin', 'Telefon', 'Aylık Aidat', 'Tahakkuk', 'Ödenen', 'Kalan Borç', 'Durum'].map(csvCell).join(';')];
    c.rows.forEach(function (r) {
      lines.push([r.label, r.u.block || '', r.u.no, r.u.owner || '', r.u.phone || '',
        csvNum(r.fee), csvNum(r.expected + r.extra), csvNum(r.paid), csvNum(r.debt),
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
          return '<option value="' + esc(u.id) + '"' + (u.id === unitId ? ' selected' : '') + '>' + esc(unitLabel(u)) + '</option>';
        }).join('') + '</select></label>' +
        '<label>Tarih<input id="mDate" type="date" value="' + todayISO() + '"></label>' +
        '<label>Tutar (₺)<input id="mAmount" type="number" min="0" step="0.01" placeholder="0,00"></label>' +
        '<label>Dönem<input id="mPeriod" type="month" value="' + todayMonth() + '"></label>' +
        '<label>Tür<select id="mType"><option value="aidat">Aidat</option><option value="ek">Ek tahakkuk ödemesi</option><option value="diger">Diğer</option></select></label>' +
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
          return '<option value="' + esc(u.id) + '"' + (u.id === unitId ? ' selected' : '') + '>' + esc(unitLabel(u)) + '</option>';
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

  function wire() {
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
          openModal('Hatırlatma metni · ' + r.label,
            '<p class="lead">Metni kopyalayıp WhatsApp veya SMS ile gönderebilirsiniz.</p>' +
            '<textarea class="textarea" rows="8" id="remindText">' + esc(reminderText(r)) + '</textarea>' +
            '<div class="form-actions"><button class="btn primary" type="button" data-act="copy-remind">Kopyala</button>' +
            (r.u.phone ? '<a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/' +
              esc(String(r.u.phone).replace(/[^\d]/g, '').replace(/^0/, '90')) + '?text=' +
              encodeURIComponent(reminderText(r)) + '">WhatsApp’ta aç</a>' : '') +
            '<button class="btn ghost" type="button" data-act="close-modal">Kapat</button></div>');
          break;
        }
        case 'copy-remind': {
          var ta = $('#remindText');
          if (ta) copyText(ta.value);
          break;
        }
        case 'goto-debts': setTab('debts'); break;
        case 'goto-payments': setTab('payments'); break;
        case 'del-payment': {
          var p = DB.payments.find(function (x) { return x.id === id; });
          if (!p) break;
          var pu = unitById(p.unitId);
          if (!confirm('Silinsin mi?\n' + (pu ? unitLabel(pu) : '') + ' · ' + fmtMoney(p.amount) + ' · ' + fmtDate(p.date))) break;
          DB.payments = DB.payments.filter(function (x) { return x.id !== id; });
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
          if (DB.units.some(function (x) { return String(x.no) === no && String(x.block || '').toUpperCase() === blk; })) {
            toast('Bu daire zaten var.'); break;
          }
          DB.units.push({
            id: uid('u'), block: blk, no: no,
            owner: ($('#newOwner').value || '').trim(), phone: '', fee: null, active: true
          });
          saveDB(); renderAll(); toast('Daire eklendi.');
          break;
        }
        case 'save-settings': {
          DB.meta.siteName = ($('#setSiteName').value || '').trim() || 'Site Yönetim Paneli';
          DB.settings.monthlyFee = Math.max(0, parseFloat(($('#setFee').value || '0').replace(',', '.')) || 0);
          DB.settings.startMonth = $('#setStart').value || todayMonth();
          DB.settings.budgetMonthly = Math.max(0, parseFloat(($('#setBudget').value || '0').replace(',', '.')) || 0);
          DB.settings.managerName = ($('#setManager').value || '').trim();
          DB.settings.note = ($('#setNote').value || '').trim();
          saveDB(); renderAll(); toast('Ayarlar kaydedildi.');
          break;
        }
        case 'edit-budget': openBudgetModal(); break;
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
          addPayment({
            unitId: unitId, date: $('#mDate').value || todayISO(), period: $('#mPeriod').value || todayMonth(),
            type: $('#mType').value, amount: amount, desc: ($('#mDesc').value || '').trim(), source: $('#mSource').value
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
        case 'export-debts-csv': exportDebtsCSV(); break;
        case 'export-payments-csv': exportPaymentsCSV(); break;
        case 'export-expenses-csv': exportExpensesCSV(); break;
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
          rows.forEach(function (r) {
            if (!r.include) return;
            if (!r.unitId || !(r.amount > 0)) return;
            addPayment({
              unitId: r.unitId, date: r.date, period: (r.date || todayISO()).slice(0, 7),
              type: r.type, amount: r.amount, desc: r.desc, source: 'Gmail'
            });
            saved++;
          });
          if (!saved) { toast('Kaydedilecek satır yok. Daire seçin veya tutar girin.'); break; }
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
      DB.expenses.push({
        id: uid('e'), date: f.date.value || todayISO(), category: f.category.value,
        amount: round2(amount), desc: (f.desc.value || '').trim(), payee: (f.payee.value || '').trim()
      });
      saveDB(); renderAll();
      f.desc.value = ''; f.amount.value = ''; f.payee.value = '';
      toast('Gider kaydedildi.');
    });

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
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          if (!data || !Array.isArray(data.units)) throw new Error('Geçersiz yedek dosyası');
          if (!confirm('Yedek yüklenecek ve mevcut veriler değiştirilecek. Devam edilsin mi?')) return;
          DB = migrate(data);
          saveDB(); renderAll();
          toast('Yedek geri yüklendi.');
        } catch (err) {
          toast('Dosya okunamadı: geçerli bir JSON yedeği değil.', 4000);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    /* esc closes */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#modal').hidden) closeModal();
      else if (!$('#drawer').hidden) closeDrawer();
    });
  }

  /* ---------------- init ---------------- */
  function init() {
    DB = loadDB();
    if (!DB) { DB = newDB(); saveDB(); }
    UI.asOf = todayMonth();

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

    if (!DB.units.length) {
      openSetup();
    }

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sessizce geç */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
