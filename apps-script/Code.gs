/**
 * ŞAZELİ KONAKLARI — Gmail → Supabase köprüsü
 *
 * Gmail'e düşen İş Bankası ödeme bildirimlerini okur ve sitedeki ortak
 * veritabanına (Supabase) ödeme olarak yazar. 15 dakikada bir otomatik çalışır.
 *
 * Kurulum: KURULUM-BULUT.md
 */

var SUPABASE_URL = 'https://zwwipahoyemlvvhvcvrj.supabase.co';
var SUPABASE_KEY = 'sb_publishable_AoDnTDiWClfWNurWp_pnAA_QnG1MuOW';
var CLOUD_ROW = 'main';

var MAX_MAILS = 60;
var CHECK_EVERY_MINUTES = 15;          // otomatik kontrol sıklığı
var MAIL_QUERY = 'from:(isbank)';      // gerekirse: 'from:(isbank.com.tr)'
var LOOKBACK_DAYS = 4;                 // her kontrolde geriye bakılan gün

/* ---------------- HTTP ---------------- */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'ping';
  if (action === 'load') return out({ ok: true, db: loadDB() });
  if (action === 'gmail') return out({ ok: true, mails: fetchMails(Number(p.days) || 45) });
  if (action === 'check') return out(checkMail());
  if (action === 'bootstrap') {
    installTrigger();
    return out({
      ok: true,
      bootstrapped: true,
      user: Session.getActiveUser().getEmail(),
      triggers: ScriptApp.getProjectTriggers().length,
      cloud: !!loadDB()
    });
  }
  return out({ ok: true, ping: true, user: Session.getActiveUser().getEmail(), time: new Date().toISOString() });
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- depo (Supabase) ---------------- */

function sbHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
}

function loadDB() {
  var url = SUPABASE_URL + '/rest/v1/sazeli_db?id=eq.' + CLOUD_ROW + '&select=rev,data';
  var res = UrlFetchApp.fetch(url, { method: 'get', headers: sbHeaders(), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error('Supabase okuma: ' + res.getContentText().slice(0, 200));
  var rows = JSON.parse(res.getContentText() || '[]');
  var row = rows && rows[0];
  if (!row || !row.data || !row.data.units) return null;
  var db = row.data;
  db.meta = db.meta || {};
  db.meta.rev = Number(row.rev) || 0;
  return db;
}

function saveDB(db) {
  var rev = (Number(db.meta && db.meta.rev) || 0) + 1;
  db.meta = db.meta || {};
  db.meta.rev = rev;
  db.meta.updatedAt = new Date().toISOString();
  var url = SUPABASE_URL + '/rest/v1/sazeli_db?id=eq.' + CLOUD_ROW;
  var res = UrlFetchApp.fetch(url, {
    method: 'patch',
    headers: sbHeaders(),
    payload: JSON.stringify({ rev: rev, data: db, updated_at: new Date().toISOString() }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('Supabase yazma: ' + res.getContentText().slice(0, 200));
  return rev;
}

/* ---------------- Gmail ---------------- */

function fetchMails(days) {
  var query = MAIL_QUERY + ' newer_than:' + (days || 45) + 'd';
  var threads = GmailApp.search(query, 0, MAX_MAILS);
  var list = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      list.push({
        id: m.getId(),
        date: m.getDate().toISOString(),
        subject: m.getSubject() || '',
        body: (m.getPlainBody() || '').replace(/\s+/g, ' ').slice(0, 6000)
      });
    });
  });
  return list;
}

/** Zamanlanmış görev: gelen bildirimleri okur, eşleşenleri ödeme olarak yazar. */
function checkMail() {
  var db = loadDB();
  if (!db || !db.units || !db.units.length) return { ok: false, error: 'veri yok' };

  var mails = fetchMails(LOOKBACK_DAYS);
  var seen = {};
  (db.payments || []).forEach(function (p) {
    if (p.mailId) seen[p.mailId] = 1;
    if (String(p.source || '').indexOf('Gmail') === 0) seen['k|' + p.date + '|' + p.unitId + '|' + p.amount] = 1;
  });
  (db.pending || []).forEach(function (p) { if (p.mailId) seen[p.mailId] = 1; });

  var added = 0, pending = 0, skipped = 0;
  mails.forEach(function (m) {
    if (seen[m.id]) { skipped++; return; }
    var parsed = parseMail(m, db.units);
    if (!parsed) { skipped++; return; }

    if (parsed.unitId) {
      var key = 'k|' + parsed.date + '|' + parsed.unitId + '|' + parsed.amount;
      if (seen[key]) { skipped++; return; }
      seen[key] = 1;
      db.payments = db.payments || [];
      db.payments.push({
        id: 'mail-' + m.id,
        unitId: parsed.unitId,
        date: parsed.date,
        period: parsed.date.slice(0, 7),
        type: parsed.type,
        amount: parsed.amount,
        desc: parsed.desc,
        source: 'Gmail (otomatik)',
        mailId: m.id,
        createdAt: new Date().toISOString()
      });
      added++;
    } else {
      db.pending = db.pending || [];
      if (db.pending.length < 300) {
        db.pending.push({
          id: 'pend-' + m.id,
          mailId: m.id,
          date: parsed.date,
          amount: parsed.amount,
          desc: parsed.desc,
          text: parsed.text,
          sender: parsed.sender
        });
      }
      pending++;
    }
  });

  // giden işlemlerin bekleyen kayıtlarını temizle
  db.pending = (db.pending || []).filter(function (p) {
    return !/HESABINIZDAN|FATURA ÖDEME|TAL[İI]MATLI|OTOMAT[İI]K ÖDEME/.test(String(p.text || '').toUpperCase());
  });

  if (added || pending) {
    db.meta = db.meta || {};
    db.meta.lastMailCheck = new Date().toISOString();
    db.meta.lastMailResult = added + ' eklendi, ' + pending + ' eşleşmedi';
    saveDB(db);
  }
  return { ok: true, added: added, pending: pending, skipped: skipped, checked: mails.length };
}

/** E-posta metninden tutar / tarih / daire çıkarır. */
function parseMail(m, units) {
  var text = (m.subject || '') + ' ' + (m.body || '');
  var up = text.toUpperCase();

  // Giden işlemler (fatura/otomatik ödeme, hesabınızdan çıkış) gelir sayılmaz
  if (/HESABINIZDAN|HESABINIZDAN\s+YAPILAN|FATURA ÖDEME|TAL[İI]MATLI|OTOMAT[İI]K ÖDEME|KRED[İI] KARTI ÖDEME/.test(up)) return null;

  var amount = extractAmount(text);
  if (!amount) return null;

  var date = m.date ? m.date.slice(0, 10) : new Date().toISOString().slice(0, 10);

  var type = /DEM[İI]RBA[ŞS]/.test(up) ? 'demirbaş' : 'aidat';
  if (/GEC[İI]KME|FA[İI]Z/.test(up)) type = 'diger';

  var unit = matchUnit(text, units);

  return {
    amount: amount,
    date: date,
    unitId: unit ? unit.id : '',
    type: type,
    desc: type === 'demirbaş' ? 'Demirbaş ödemesi' : (type === 'diger' ? 'Gecikme/faiz ödemesi' : 'Aidat ödemesi'),
    text: text.slice(0, 180),
    sender: extractSender(text)
  };
}

function extractAmount(text) {
  var patterns = [
    /(?:TUTAR|MİKTAR|MIKTAR|TOPLAM|GÖNDERİLEN|GONDERILEN)\s*[:\-]?\s*([\d][\d.,]*)\s*(?:TL|TRY|₺)?/i,
    /([\d][\d.,]*)\s*(?:TL|TRY|₺)/i,
    /(?:TL|TRY|₺)\s*([\d][\d.,]*)/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = text.match(patterns[i]);
    if (m) {
      var n = parseAmount(m[1]);
      if (n && n > 0) return n;
    }
  }
  return null;
}

function parseAmount(s) {
  if (!s) return null;
  var t = String(s).replace(/[^\d.,]/g, '');
  if (!/\d/.test(t)) return null;
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
  if (!isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function norm(s) {
  return String(s || '')
    .replace(/İ/g, 'I').replace(/ı/g, 'i')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSender(text) {
  var m = text.match(/(?:Sayın|SAYIN|Sn\.)\s+([A-ZÇĞİÖŞÜa-zçğıöşü ]{3,50})/);
  if (m) return m[1].trim();
  m = text.match(/GÖNDEREN(?:\s+ADI)?\s*[:\-]?\s*([A-ZÇĞİÖŞÜ ]{3,50})/);
  if (m) return m[1].trim();
  m = text.match(/([A-ZÇĞİÖŞÜ]{2,}(?:\s+[A-ZÇĞİÖŞÜ]{2,}){1,3})\s+TARAFINDAN/);
  if (m) return m[1].trim();
  return '';
}

/** Daire etiketi (A-3 / B BLOK 7 / daire 12) veya isim eşleşmesi. Tek aday yoksa eşleşmez. */
function matchUnit(text, units) {
  var up = norm(text);

  var patterns = [
    /\(([A-C]) BLOK\s*\/\s*(\d{1,3})\)/,
    /\b([A-C]) BLOK\s+(\d{1,3})\b/,
    /\b([A-C])\s*[-\/]\s*(\d{1,3})\b/,
    /\bDAİRE\s*(?:NO)?\s*[:\-]?\s*(\d{1,3})\b/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = up.match(patterns[i]);
    if (!m) continue;
    var blk = m[2] ? m[1] : '';
    var no = m[2] || m[1];
    var cands = units.filter(function (u) {
      return String(u.no) === String(no) && (!blk || String(u.block || '').toUpperCase() === blk);
    });
    if (cands.length === 1) return cands[0];
    if (cands.length > 1) {
      var bill = cands.filter(function (u) { return u.billable !== false; });
      return bill.length === 1 ? bill[0] : null;
    }
  }

  // İsim eşleşmesi — aynı isim birden fazla dairedeyse otomatik eşleşmez
  var hits = [];
  units.forEach(function (u) {
    var n = norm(u.owner);
    if (n && n.length > 5 && up.indexOf(n) >= 0) hits.push(u);
  });
  if (hits.length === 1) return hits[0];
  return null;
}

/* ---------------- kurulum ---------------- */

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkMail') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkMail').timeBased().everyMinutes(CHECK_EVERY_MINUTES).create();
}

function setup() {
  installTrigger();          // 15 dakikada bir otomatik kontrol
  return checkMail();        // bir kez hemen çalıştır
}
