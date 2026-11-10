# Şazeli Konakları · Site Yönetim Paneli

Site sakinlerinin aidat, ek tahakkuk ve giderlerini takip eden tek sayfalık web uygulaması.
Kurulum yok, sunucu yok, ücretsiz — GitHub Pages üzerinde çalışır.

## Ne yapar?

- **Daire borçları:** her hesap için devir bakiyesi + aidat tahakkuku + ek tahakkuk + gecikme faizi − ödemeler.
- **Malik / kiracı ayrımı:** aynı dairede iki ayrı hesap; aylık aidat yalnızca “aidat işle” işaretli hesaba yazılır.
- **Gecikme faizi:** son ödeme gününden (varsayılan ayın 15’i) sonra ödenen veya ödenmeyen her ay için aylık aidatın %5’i. Oran ve gün ayarlardan değiştirilebilir.
- **Ödemeler:** Gmail’e düşen havale/EFT bildirimleri yapıştırılarak otomatik ayıklanır (daire, tutar, tarih, açıklama).
- **Pasta grafikler:** tahsilat durumu, gider dağılımı, son 6 ay tahsilat/gider, en yüksek borçlar.
- **Bütçe:** aylık gider bütçesi, gerçekleşen gider, kalan bütçe, kasa bakiyesi.
- **Hatırlatma:** borçlu hesap için hazır WhatsApp/SMS metni.
- **Yedekleme:** JSON yedeği indir/yükle, CSV (Excel) dışa aktarma, yazdır/PDF.
- **Şifreli giriş:** panel şifre olmadan açılmaz; şifre cihazda saklanır.

## Veri nerede duruyor?

Tarayıcının `localStorage` alanında, yalnızca o cihazda. Sunucuya hiçbir şey gönderilmez.
Bu yüzden:

- Şifre ve veriler **cihaz başına**dır: telefon ve bilgisayar ayrı kasadır.
- Aynı veriyi ikinci cihazda görmek için **JSON yedeği** alıp orada yükleyin.
- Tarayıcı verilerini temizlerseniz kayıtlar silinir — düzenli yedek alın.
- Ortak kullanım (birden fazla kişi, otomatik Gmail) için Google Sheets/Apps Script senkronizasyonu eklenebilir.

## Mevcut bakiyelerin aktarımı

`Aktif Malik ve Kiracılar` listesinden üretilen JSON dosyası (`Sazeli-Sakin-Listesi-2026-11.json`):
Ayarlar → Yedekten yükle ile bir kez yüklenir. İçinde 69 hesap, 04.11.2026 tarihli devir bakiyeleri
ve aidat başlangıcı (Aralık 2026) vardır. Aylık aidat varsayılanı 5.500 ₺ — Ayarlar’dan doğrulayın.

## Dosyalar

| Dosya | Görev |
|---|---|
| `index.html` | Arayüz iskeleti |
| `styles.css` | Tasarım |
| `app.js` | Veri modeli, borç hesabı, grafikler, Gmail ayrıştırıcı |
| `sw.js` | Çevrimdışı destek (service worker) |
| `manifest.webmanifest` | Telefona “uygulama” olarak ekleme |
| `robots.txt` | Arama motorlarına kapatma |

## Yayınlama (GitHub Pages)

```bash
git init
git add .
git commit -m "Şazeli Konakları site yönetim paneli"
git branch -M main
git remote add origin git@github.com:SerdarOzdemir89/sazeli-konaklari.git
git push -u origin main
```

Sonra depo ayarlarından **Settings → Pages → Source: Deploy from a branch → main / (root)** seçin.

Yayın adresi: <https://serdarozdemir89.github.io/sazeli-konaklari/>

## İlk kurulum

1. Site açılınca **Kurulum sihirbazı** çıkar: site adı, blok sayısı, blok başına daire, aylık aidat, başlangıç ayı.
2. **Ayarlar → Daireler** bölümünden daire sakinlerinin adını ve telefonunu girin (isteğe bağlı).
3. Ödemeleri **Gmail’den İçe Aktar** ile yapıştırın veya **Ödemeler → Ödeme ekle** ile elle işleyin.
4. Giderleri **Gider & Bütçe** bölümüne ekleyin.

> Not: Aidat değişirse, geçmiş aylar yeni tutarla yeniden hesaplanır. Dönem bazlı farklı aidat gerekiyorsa
> daireye özel “Aidat” alanı kullanılabilir.

## Gmail otomasyonu (opsiyonel, sonraki adım)

Banka bildirimleri Gmail’e düşüyorsa, Google Apps Script ile:

1. Gmail’de `label:site-odeme` etiketli iletiler okunur,
2. daire/tutar/tarih ayıklanır,
3. Google Sheets’e satır yazılır,
4. Sheets’ten CSV indirilip buraya yüklenir (veya Apps Script doğrudan bu sayfaya `postMessage` ile veri gönderir).

Bu adım ücretsizdir ama Google hesabınızda yetkilendirme gerektirir. İstenirse eklenebilir.
