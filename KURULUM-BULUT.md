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
