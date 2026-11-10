# Ortak veri + Gmail kurulumu (tek seferlik, ~7 dakika)

Bu adımlar **Sazelikonaklari@gmail.com** hesabıyla yapılır. Sonunda site, verileri
Google E-Tablo'da tutar: telefon, bilgisayar ve diğer kullanıcılar aynı veriyi görür.

## 1) Script projesi aç

1. Bilgisayarda Chrome/Safari'de **Sazelikonaklari@gmail.com** ile giriş yap.
2. <https://script.google.com> → **Yeni proje**.
3. Soldaki `Kod.gs` içeriğini tamamen sil, `apps-script/Code.gs` dosyasının içeriğini yapıştır.
4. Üstteki ada tıkla, projeye **Şazeli Konakları** yaz. **Kaydet** (💾).

> `Code.gs` içindeki `TOKEN` satırını değiştirme — sitedeki "Erişim anahtarı" ile aynı olmalı.

## 2) İzin ver

1. Üstteki fonksiyon menüsünden **setup** seç → **Çalıştır**.
2. "Bu uygulama doğrulanmadı" uyarısı çıkarsa: **Gelişmiş → (Şazeli Konakları) sayfasına git** → **İzin ver**.
3. Gmail'i görüntüleme ve E-Tablo oluşturma izinlerini onayla. Bir tablo otomatik oluşur, gizli `veri` sekmesi açılır.

## 3) Web uygulaması olarak yayınla

1. Sağ üst: **Dağıt → Yeni dağıtım**.
2. Dişli simgesinden **Web uygulaması** seç.
3. **Şu kimlikle çalıştır:** Ben (Sazelikonaklari@gmail.com)
   **Erişimi olan:** Herkes
4. **Dağıt** → çıkan **Web uygulaması URL'sini** kopyala (`.../exec` ile biter).

## 4) Siteye bağla

1. <https://serdarozdemir89.github.io/sazeli-konaklari/> → şifre `Tuzla-456`.
2. **Ayarlar → Ortak veri (bulut)**:
   - Web App adresi: kopyaladığın `.../exec` adresi
   - Erişim anahtarı: `szl-2026-7f3a91` (değiştirmediysen hazır gelir)
3. **Kaydet ve bağlan** → "Bulut bağlantısı tamam" yazarsa hazır.
4. **Buluta gönder** → mevcut 69 daire, ödemeler ve giderler tabloya yazılır.

Artık herkes aynı şifreyle girip aynı veriyi görür. Bir kullanıcı ödeme girdiğinde
1-2 saniye içinde tabloya yazılır; diğer kullanıcılar sayfayı açtığında (veya 60 saniyede bir)
otomatik güncellenir.

## 5) Gmail otomatik kontrol

`setup()` çalıştığında **15 dakikada bir** çalışan bir zamanlayıcı kurulur (`installTrigger`).
Site açık olmasa da script gelen bildirimleri okur:

- Tutar + daire/isim eşleşirse ödeme **otomatik** eklenir (`Kaynak: Gmail (otomatik)`).
- Eşleşmeyen bildirimler **silinmez**, "bekleyen" listesine düşer. Sitede
  **Gmail'den İçe Aktar** sayfasında "N eşleşmeyen Gmail bildirimi var" uyarısı çıkar;
  daireyi seçip tek tıkla aktarılır.
- Aynı e-posta ikinci kez eklenmez (mesaj kimliğiyle tekilleştirme).

Sıklığı değiştirmek için `Code.gs` içindeki `CHECK_EVERY_MINUTES` değerini değiştirip
yeniden dağıtın. Elle denemek için sitede **Ayarlar → Gmail'i kontrol et**.

Bildirimler farklı bir adresten geliyorsa `MAIL_QUERY` satırını değiştir
(ör. `from:(isbank.com.tr)`), kaydet ve **Dağıt → Dağıtımları yönet → Düzenle → Yeni sürüm**
ile yeniden yayınla.

> **ÖNEMLİ — web uygulaması herkese açılamıyor (10 Kas 2026 doğrulandı):**
> Script `https://mail.google.com/` (kısıtlı/Gmail) iznini kullandığı için Google,
> dağıtımın erişimini **"Yalnızca ben"** olarak sabitliyor; "Herkes" seçilse bile kayıt
> "Yalnızca ben" kalıyor ve `/exec` adresi anonim isteklerde 302 ile
> `accounts.google.com` oturum açma sayfasına yönlendiriyor (curl ile doğrulandı).
> Yani `/exec` adresi **site tarafından veri kaynağı olarak kullanılamaz**.
> Bu yüzden paylaşımlı veri için Google E-Tablo (yayınlanmış CSV, herkese açık okuma)
> + yazma için Google Form yolu kullanılacak. Ayrıntı: `PAYLASIM.md`.

Not: `sheet_()` fonksiyonu bağımsız (standalone) scriptte `SpreadsheetApp.getActive()`
**null** döndürdüğü için `SpreadsheetApp.create()` + `PropertiesService` ile tablo
kimliği saklanacak şekilde güncellendi.

## Notlar

- Tabloyu elle düzenleme; veri tek hücrede JSON olarak durur. Yedek: **Ayarlar → JSON yedeği indir**.
- Erişim anahtarı sayfada görünür; site "gizli" değil, meraklıyı durdurur. Daha sıkı koruma
  istersen Google hesabına bağlı erişim (Cloudflare Access / Apps Script oturum kontrolü) eklenebilir.
- Apps Script kotası: günde 20.000 e-posta okuma / 90 dakika çalışma — bu site için fazlasıyla yeterli.
