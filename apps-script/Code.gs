/**
 * ŞAZELİ KONAKLARI — ortak veri + Gmail köprüsü
 * Kurulum adımları: KURULUM-BULUT.md
 *
 * Bu dosyayı script.google.com'da yeni bir projeye yapıştırın,
 * setup() fonksiyonunu bir kez çalıştırıp izin verin,
 * Web uygulaması olarak dağıtın ve çıkan /exec adresini siteye girin.
 */

var TOKEN = 'szl-2026-7f3a91';       // sitedeki "Erişim anahtarı" ile aynı olmalı
var SHEET_NAME = 'veri';             // verinin tutulduğu gizli sekme
var MAX_MAILS = 60;                  // tek seferde okunacak e-posta sayısı

/* İş Bankası bildirimleri bu sorguyla bulunur.
   Gelen kutusunda bir ödeme bildirimi açıp "Kimden" adresini kontrol edin;
   farklıysa from:(...) kısmını ona göre değiştirin. */
var MAIL_QUERY = 'from:(isbank)';    // örn: 'from:(isbank.com.tr) subject:(hesabınıza)'

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.token !== TOKEN) return out({ ok: false, error: 'token' });
  if (p.action === 'load') return out({ ok: true, db: loadDB() });
  if (p.action === 'gmail') return out({ ok: true, mails: fetchMails(Number(p.days) || 45) });
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
  return out({ ok: false, error: 'action' });
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

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
  var vals = chunks.map(function (c) { return [c]; });
  sh.getRange(1, 1, vals.length, 1).setValues(vals);
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

function fetchMails(days) {
  var query = MAIL_QUERY + ' newer_than:' + (days || 45) + 'd';
  var threads = GmailApp.search(query, 0, MAX_MAILS);
  var list = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      list.push({
        date: m.getDate().toISOString(),
        subject: m.getSubject() || '',
        body: (m.getPlainBody() || '').replace(/\s+/g, ' ').slice(0, 1500)
      });
    });
  });
  return list;
}

/** İlk kurulumda bir kez çalıştırın: izinleri verir ve sekmeyi oluşturur. */
function setup() {
  sheet_();
  fetchMails(1);
  try {
    SpreadsheetApp.getUi().alert('Kurulum tamam. Şimdi: Dağıt → Yeni dağıtım → Web uygulaması.');
  } catch (err) { }
}
