# RüzgarDesk - Uzak Masaüstü (AnyDesk benzeri)

Ekran paylaşımı, uzaktan fare/klavye kontrolü, dosya aktarımı ve sohbet içeren,
yönetici izniyle çalışan modern bir Windows ve macOS masaüstü uygulaması.

---

## Kurulum / Çalıştırma

Derlenmiş dosyalar `release/` klasöründedir:

### Windows
| Dosya | Ne işe yarar |
|-------|--------------|
| **RuzgarDesk-Portable-2.1.5.exe** | Kurulum gerektirmez. Çift tıkla, doğrudan çalışır. |
| **RuzgarDesk-Setup-2.1.5.exe** | Bilgisayara kurar (Başlat menüsü + masaüstü kısayolu). |

> Her açılışta **Yönetici İzni (UAC)** penceresi çıkar → **Evet** deyin.
> Yönetici izni, uzaktan yönetimde yönetici pencerelerini de kontrol edebilmek için gereklidir.

---

### macOS (Apple Silicon M1/M2/M3/M4 & Intel)
| Dosya | Ne işe yarar |
|-------|--------------|
| **RuzgarDesk-2.1.5-arm64.dmg** | Apple Silicon (M1, M2, M3, M4 vb.) Mac'ler için kurulum kalıbı. |
| **RuzgarDesk-2.1.5-x64.dmg** | Intel işlemcili Mac'ler için kurulum kalıbı. |
| **RuzgarDesk-2.1.5-arm64-mac.zip** | Apple Silicon için taşınabilir sıkıştırılmış paket. |

#### ⚠️ macOS "MacBook Kendini Korumaya Alıyor / Geliştirici Doğrulanamadı / Açılamıyor" Uyarısı ve Çözümü:
Apple, App Store dışından indirilen ve yıllık 99$'lık Apple Developer sertifikasıyla noter onayından geçmemiş tüm uygulamalarda **Gatekeeper Korumasını** devreye sokar.
Uygulamayı ilk kez açtığınızda şu yöntemlerden **biriyle** uygulamaya izin verin:

* **1. Yöntem (En Hızlı & Kesin Çözüm - Terminal):**
  Uygulamayı `/Applications` (Uygulamalar) klasörüne sürükledikten sonra **Terminal**'i açıp şu komutu yapıştırın ve Enter'a basın:
  ```bash
  xattr -cr /Applications/RuzgarDesk.app
  ```
  *(Bu komut macOS'un internetten indirme karantinasını kaldırır ve uygulamanın doğrudan açılmasını sağlar.)*

* **2. Yöntem (Sistem Ayarları):**
  1. `RuzgarDesk.app` üzerine çift tıklayın (uyarı çıkarsa Tamam diyerek kapatın).
  2. Mac'inizde **Sistem Ayarları (System Settings) > Gizlilik ve Güvenlik (Privacy & Security)** bölümüne gidin.
  3. Aşağı kaydırın; **Güvenlik** başlığı altında *"RuzgarDesk adlı uygulamanın kullanımı engellendi"* yazısını göreceksiniz.
  4. Yanındaki **"Yine de Aç" (Open Anyway)** butonuna tıklayın ve Mac parolanızı girin.

* **3. Yöntem (Control Tuşu ile Aç):**
  Finder'da Uygulamalar klasöründeki `RuzgarDesk.app` dosyasına klavyeden **Control tuşuna basılı tutarak sağ tıklayın** ve **Aç**'ı seçin. Çıkan onay kutusunda **Aç** butonuna tıklayın.

#### 🔐 macOS Gerekli İzinler:
Uzak masaüstü uygulamasının çalışabilmesi için macOS'ta 2 izin şarttır:
1. **Ekran Kaydı (Screen Recording):** Karşı tarafın ekranınızı canlı görebilmesi için (`Sistem Ayarları > Gizlilik ve Güvenlik > Ekran Kaydı`).
2. **Erişilebilirlik (Accessibility):** Karşı tarafın fare ve klavye hareketlerini iletebilmesi için (`Sistem Ayarları > Gizlilik ve Güvenlik > Erişilebilirlik`).

---

## İki bilgisayarı bağlama (AnyDesk gibi — sadece kod)

**Hiçbir adres/sunucu ayarı yok.** Uygulama açılınca internetteki ortak buluşma
sunucusuna otomatik bağlanır.

1. **Kontrol edeceğin** bilgisayarda, karşı tarafın **Masa ID**'sini kutuya yaz → **Bağlan**.
2. **Kontrol edilecek** bilgisayarda ekrana "**Gelen Bağlantı İsteği**" penceresi çıkar →
   **Kabul Et**'e bas.
3. Bağlantı kurulur; ekranı görür ve fare/klavye ile yönetirsin. Oturum **sınırsızdır**.

> İki bilgisayar farklı şehir/ağda olsa bile çalışır (internet üzerinden, uçtan uca şifreli).

---

## Gözetimsiz erişim (karşıda kimse yokken bağlanma)

Uzaktaki bilgisayarı, başında biri "Kabul Et" demeden yönetmek için:
1. Kontrol edilecek bilgisayarda ana ekranda **Erişim Parolası** belirle.
2. **Gözetimsiz Erişim** anahtarını aç.
3. Bağlanırken, kontrol eden bilgisayarda **Parola** kutusuna aynı parolayı yaz.
   Doğru parola girildiğinde bağlantı otomatik kabul edilir.

Parola girilmezse veya yanlışsa, karşı tarafta onay penceresi çıkar (elle Kabul/Reddet).

---

## Özellikler
- 🖥️ **Sessiz ekran paylaşımı** — karşı tarafta ekran seçme penceresi çıkmaz, otomatik.
- 🖱️ **Tam uzaktan kontrol** — fare (sol/sağ/orta tık, çift tık, tekerlek), klavye (Türkçe karakterler ve kısayollar dahil).
- 🍎 **macOS Native Universal İkili** — Apple Silicon ve Intel işlemciler için C/Swift tabanlı yüksek hızlı girdi iletimi (`macInputHelper`).
- 🛡️ **Yönetici pencereleri** — Windows'ta UAC istemleri kabul edilmiş bir oturum boyunca görüntülenebilir ve yönetilebilir.
- 🔄 **Otomatik güncelleme** — yeni sürüm arka planda indirilir ve otomatik güncellenir.
- 📋 **Ortak metin panosu** — pano metinleri iki bilgisayar arasında otomatik senkronize edilir.
- 📁 **Dosya aktarımı** — Dosyalar sekmesine sürükle-bırak ile dosya aktarımı.
- 💬 **Sohbet** — oturum sırasında canlı yazışma.
- 🔒 Bağlantılar uçtan uca (WebRTC/DTLS) şifrelidir.

---

## Sorun giderme
- **Mac'te açılmıyor / hasarlı diyor:** Terminal'den `xattr -cr /Applications/RuzgarDesk.app` komutunu çalıştırın.
- **Mac'te ekran siyah görünüyor veya fare tıklamıyor:** Sistem Ayarları > Gizlilik ve Güvenlik altından **Ekran Kaydı** ve **Erişilebilirlik** izinlerinin RuzgarDesk için açık olduğundan emin olun.
- **Bağlanamıyorum:** İki bilgisayarın da internete bağlı ve uygulamanın açık olduğundan emin olun. Durum çubuğunda "Hazır" yazmalı.
- **Kayıt/log dosyası:**
  - Windows: `%APPDATA%\RuzgarDesk\ruzgardesk.log`
  - macOS: `~/Library/Application Support/RuzgarDesk/ruzgardesk.log`

---

## Geliştirici komutları
```bash
npm install               # bağımlılıklar
npm start                 # uygulamayı geliştirme modunda çalıştır
npm run dist:win          # Windows için .exe üretir
npm run dist:mac:arm      # macOS Apple Silicon için .dmg ve .zip üretir
npm run dist:mac:x64      # macOS Intel için .dmg ve .zip üretir
npm run dist:all          # Tüm platformlar için paketler
```
