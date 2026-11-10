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

## 5) Gmail'den ödeme çekme

**Gmail'den İçe Aktar → Gmail'den çek** düğmesi son 45 günün İş Bankası bildirimlerini okur,
tutar/tarih/daire çıkarır ve **kaydetmeden önce** tabloda gösterir. Daire eşleşmeyen satırı
açılır listeden seçip kaydedersin.

Bildirimler farklı bir adresten geliyorsa `Code.gs` içindeki `MAIL_QUERY` satırını değiştir
(ör. `from:(isbank.com.tr)`), kaydet ve **Dağıt → Dağıtımları yönet → Düzenle → Yeni sürüm** ile
yeniden yayınla.

## Notlar

- Tabloyu elle düzenleme; veri tek hücrede JSON olarak durur. Yedek: **Ayarlar → JSON yedeği indir**.
- Erişim anahtarı sayfada görünür; site "gizli" değil, meraklıyı durdurur. Daha sıkı koruma
  istersen Google hesabına bağlı erişim (Cloudflare Access / Apps Script oturum kontrolü) eklenebilir.
- Apps Script kotası: günde 20.000 e-posta okuma / 90 dakika çalışma — bu site için fazlasıyla yeterli.
