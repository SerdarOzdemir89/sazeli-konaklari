# Sistem mimarisi ve kurulum

Şazeli Konakları paneli üç parçadan oluşur:

| Parça | Nerede | Ne yapar |
|---|---|---|
| **Site** | GitHub Pages — <https://serdarozdemir89.github.io/sazeli-konaklari/> | Arayüz, borç/ödeme/gider takibi, grafikler. Şifre: `Tuzla-456` |
| **Ortak veri** | Supabase (ücretsiz plan, Frankfurt) | 69 daire + ödemeler + giderler tek JSON satırında (`sazeli_db` / `main`). Herkes aynı veriyi görür |
| **Gmail köprüsü** | Google Apps Script (Sazelikonaklari@gmail.com) | 15 dakikada bir Gmail'i okur, eşleşen ödemeleri Supabase'e yazar |

## 1) Ortak veri (Supabase)

- Proje: `zwwipahoyemlvvhvcvrj` · Bölge: `eu-central-1` (Frankfurt) · Plan: Free
- Tablo: `public.sazeli_db` → `id text pk`, `data jsonb`, `rev bigint`, `updated_at timestamptz`
- RLS açık; `anon` rolü için select/insert/update politikaları var (site anahtarı yayınlanabilir anahtar).
- Site `DEFAULT_CLOUD` sabitiyle otomatik bağlanır (`app.js`). Telefon/bilgisayar ayrımı yok.
- Senkron: `rev` sayacı. Her cihaz 45 saniyede bir çeker; kayıt yapınca 2 saniye içinde gönderir.
  Çakışmada "ortak veri daha yeni — önce çek" uyarısı çıkar (veri ezilmez).

**Anahtarlar** (yayınlanabilir, gizli değil): `sb_publishable_AoDnTDiWClfWNurWp_pnAA_QnG1MuOW`

## 2) Gmail köprüsü (Apps Script)

Proje: <https://script.google.com/u/2/home/projects/14RtEk7zGvGEC4rL0BYufeE0J7qobSqA3PwOPoR95T4jNi34z-bPEgXWq/edit>
(sazelikonaklari@gmail.com hesabında, adı **Şazeli Konakları - Gmail Köprüsü**)

- Kaynak: `apps-script/Code.gs` (değiştirirsen editöre yapıştır + kaydet).
- `installTrigger()` → **15 dakikada bir** `checkMail` çalışır (Tetikleyiciler sayfasında görünür).
- `checkMail()`: son 4 günün İş Bankası bildirimlerini okur; tutar + daire/isim eşleşirse
  ödemeyi Supabase'e yazar (`Kaynak: Gmail (otomatik)`), eşleşmeyenleri "bekleyen" listesine atar.
  Aynı e-posta ikinci kez eklenmez (mesaj kimliğiyle tekilleştirme).
- Ayarlar: `CHECK_EVERY_MINUTES=15`, `LOOKBACK_DAYS=4`, `MAIL_QUERY='from:(isbank)'`.

> **Neden web uygulaması değil?** Script `https://mail.google.com/` (kısıtlı) iznini kullandığı için
> Google, dağıtımın erişimini "Yalnızca ben"e sabitliyor; "Herkes" seçilse bile kayıt değişmiyor ve
> `/exec` anonim isteklerde 302 ile oturum açma sayfasına düşüyor (curl ile doğrulandı).
> Bu yüzden veri yolu **Supabase** üzerinden kuruldu; Apps Script yalnızca dışa doğru HTTP çağırıyor.

## 3) Site tarafı

- `app.js` içindeki `DEFAULT_CLOUD` = Supabase adresi + yayınlanabilir anahtar.
- Açılışta `cloudPull()`; boşsa yerel veriyi `cloudPush()` ile tohumlar.
- `saveDB()` → 1.8 sn sonra `cloudPush()` (rev artırır).
- Ayarlar → Ortak veri kartından adres/anahtar değiştirilebilir, elle gönder/çek yapılabilir.

## Notlar

- Apps Script kotası: günde 20.000 e-posta okuma — bu site için fazlasıyla yeterli.
- Supabase ücretsiz plan: 500 MB veritabanı, 5 GB egress; aylık ~70 KB veri ile sınırsız sayılır.
- Yedek: **Ayarlar → JSON yedeği indir**. Supabase'teki satır da tek JSON olduğu için taşınabilir.
- Site şifresi sayfa içinde tanımlıdır; kapıyı tutar, kasa değildir.

## Yönetim modülleri (v19)

**Raporlar sekmesi**

- *Borç yaşlandırma*: her daire için en eski ödenmemiş dönemin başından bugüne gün sayısı; 0-30 / 31-60 / 61-90 / 90+ kovaları. Devir borçlarında başlangıç `settings.devirDate` (varsayılan 01.10.2026).
- *Demirbaş taahhüdü*: 2.000 ₺'yi tamamlamayan daireler, yatan ve eksik tutarla.
- *Aylık rapor (PDF)* ve *Yaşlandırma (PDF)*: tarayıcının yazdırma penceresi açılır → "PDF olarak kaydet".

**Daire kartı**

- Her ödeme satırında 🧾 → tek ödeme makbuzu.
- "Ekstre (PDF)" → devir, tahakkuk, ek tahakkuk, faiz, ödemeler ve kalan borç dökümü.
- Sakin bilgileri: telefon, araç plakası, otopark yeri, evcil hayvan, not.

**Gider & Bütçe**

- *Kategori bütçesi*: kategori bazlı aylık limit; limit girilen satırlarda ilerleme çubuğu, aşımda kırmızı.
- *Fatura trendi*: son 6 ayın Elektrik/Su/Doğalgaz toplamı.
- *Personel / taşeron ödemeleri*: sözleşme listesi; o ay aynı adı içeren gider varsa "ödendi", yoksa "bekliyor".

**Duyurular ve işlem geçmişi**

- Raporlar → Duyurular: eklenen duyuru panelin en üstünde görünür.
- İşlem geçmişi son 300 kaydı tutar (ödeme/gider ekleme-silme, ayar, sözleşme, duyuru, sakin bilgisi).

**Salt-okunur (denetçi) modu**

- Ayarlar → "Salt-okunur (denetçi) modu". Açıkken `saveDB()` hiçbir şey yazmaz, işlem düğmeleri gizlenir. Denetçiye kendi cihazında bu kutuyu işaretlemesi yeterli.

**Öğrenen eşleştirme**

- Gmail'den gelen bir bildirim elle bir daireye bağlandığında `matchMemory` içine `İSİM → daire id` yazılır.
- Köprü bir sonraki eşleşmeyen bildirimde önce bu hafızaya bakar; bulursa ödemeyi otomatik ekler (`… (öğrenilmiş eşleşme)` açıklamasıyla).

**Haftalık yedek**

- `backup()` ortak veriyi aynı tabloya `backup-YYYYMMDD` satırı olarak yazar.
- Tetik: Pazartesi 03:00 (`installTrigger`) **ve** `checkMail` içinde "son yedek 7 günden eskiyse" güvencesi.
- Son yedek zamanı `meta.lastBackup` alanında; Ayarlar → Ortak veri kartında görünür.
