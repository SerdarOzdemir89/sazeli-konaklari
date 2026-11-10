/**
 * ŞAZELİ KONAKLARI — ortak veri + otomatik Gmail köprüsü
 * Kurulum: KURULUM-BULUT.md
 *
 * setup() bir kez çalıştırılır: izin verir, sekmeyi kurar ve
 * 15 dakikada bir çalışan Gmail kontrolünü başlatır.
 */

var TOKEN = 'szl-2026-7f3a91';        // sitedeki "Erişim anahtarı" ile aynı
var SHEET_NAME = 'veri';
var MAX_MAILS = 60;
var CHECK_EVERY_MINUTES = 15;          // otomatik kontrol sıklığı
var MAIL_QUERY = 'from:(isbank)';      // gerekirse: 'from:(isbank.com.tr)'
var LOOKBACK_DAYS = 3;                 // her kontrolde geriye bakılan gün

/* ---------------- HTTP ---------------- */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.token !== TOKEN) return out({ ok: false, error: 'token' });
  if (p.action === 'load') return out({ ok: true, db: loadDB() });
  if (p.action === 'gmail') return out({ ok: true, mails: fetchMails(Number(p.days) || 45) });
  if (p.action === 'check') return out(checkMail());
  return out({ ok: true, ping: true, time: new Date().toISOString() });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { }
  if (body.token !== TOKEN) return out({ ok: false, error: 'token' });
  if (body.action === 'save') {
    saveDB(body.db);
    return out({ ok: true, saved: true, time: new Date().toISOString() });
  }
  if (body.action === 'check') return out(checkMail());
  return out({ ok: false, error: 'action' });
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- depo ---------------- */

function sheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    try { sh.hideSheet(); } catch (err) { }
  }
  return sh;
}

function saveDB(db) {
  if (!db) throw new Error('db yok');
  var s = JSON.stringify(db);
  var chunks = s.match(/[\s\S]{1,40000}/g) || [];
  var sh = sheet_();
  sh.clear();
  sh.getRange(1, 1, chunks.length, 1).setValues(chunks.map(function (c) { return [c]; }));
  SpreadsheetApp.flush();
}

function loadDB() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (!last) return null;
  var vals = sh.getRange(1, 1, last, 1).getValues();
  var s = vals.map(function (r) { return r[0]; }).join('');
  try { return JSON.parse(s); } catch (e) { return null; }
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
        body: (m.getPlainBody() || '').replace(/\s+/g, ' ').slice(0, 2000)
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
  (db.payments || []).forEach(function (p) { if (p.mailId) seen[p.mailId] = 1; });
  (db.pending || []).forEach(function (p) { if (p.mailId) seen[p.mailId] = 1; });

  var added = 0, pending = 0, skipped = 0;
  mails.forEach(function (m) {
    if (seen[m.id]) { skipped++; return; }
    var parsed = parseMail(m, db.units);
    if (!parsed) { skipped++; return; }

    if (parsed.unitId) {
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

  db.meta = db.meta || {};
  db.meta.lastMailCheck = new Date().toISOString();
  db.meta.lastMailResult = added + ' eklendi, ' + pending + ' eşleşmedi';
  db.meta.rev = (Number(db.meta.rev) || 0) + 1;
  saveDB(db);
  return { ok: true, added: added, pending: pending, skipped: skipped, checked: mails.length };
}

/** E-posta metninden tutar / tarih / daire çıkarır. */
function parseMail(m, units) {
  var text = (m.subject || '') + ' ' + (m.body || '');
  var up = text.toUpperCase();

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
  m = text.match(/GÖNDEREN\s*[:\-]?\s*([A-ZÇĞİÖŞÜ ]{3,50})/);
  return m ? m[1].trim() : '';
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
  sheet_();
  fetchMails(1);          // Gmail iznini tetikler
  installTrigger();       // 15 dakikada bir otomatik kontrol
  try {
    SpreadsheetApp.getUi().alert('Kurulum tamam.\n\nOtomatik Gmail kontrolü her ' + CHECK_EVERY_MINUTES +
      ' dakikada çalışacak.\n\nŞimdi: Dağıt → Yeni dağıtım → Web uygulaması (Erişim: Herkes).');
  } catch (err) { }
}
