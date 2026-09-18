# RüzgarDesk - Uzak Masaüstü (AnyDesk benzeri)

Ekran paylaşımı, uzaktan fare/klavye kontrolü, dosya aktarımı ve sohbet içeren,
yönetici izniyle çalışan bir Windows masaüstü uygulaması.

## Kurulum / Çalıştırma

Derlenmiş dosyalar `release/` klasöründedir:

| Dosya | Ne işe yarar |
|-------|--------------|
| **RuzgarDesk-Portable-2.0.0.exe** | Kurulum gerektirmez. Çift tıkla, çalışır. |
| **RuzgarDesk-Setup-2.0.0.exe** | Bilgisayara kurar (Başlat menüsü + masaüstü kısayolu). |

> Her açılışta **Yönetici İzni (UAC)** penceresi çıkar → **Evet** deyin.
> Yönetici izni, uzaktan yönetimde yönetici pencerelerini de kontrol edebilmek için gereklidir.

Uygulama açıldığında size **9 haneli bir Masa ID** verir (örn. `123 456 789`).
Bu ID her açılışta **aynı kalır** — bir kez paylaşman yeterli.

## İki bilgisayarı bağlama (AnyDesk gibi — sadece kod)

**Hiçbir adres/sunucu ayarı yok.** Uygulama açılınca internetteki ortak buluşma
sunucusuna otomatik bağlanır.

1. **Kontrol edeceğin** bilgisayarda, karşı tarafın **Masa ID**'sini kutuya yaz → **Bağlan**.
2. **Kontrol edilecek** bilgisayarda ekrana "**Gelen Bağlantı İsteği**" penceresi çıkar →
   **Kabul Et**'e bas.
3. Bağlantı kurulur; ekranı görür ve fare/klavye ile yönetirsin. Oturum **sınırsızdır**.

> İki bilgisayar farklı şehir/ağda olsa bile çalışır (internet üzerinden, uçtan uca şifreli).

## Gözetimsiz erişim (karşıda kimse yokken bağlanma)

Uzaktaki bilgisayarı, başında biri "Kabul Et" demeden yönetmek için:
1. Kontrol edilecek bilgisayarda ana ekranda **Erişim Parolası** belirle.
2. **Gözetimsiz Erişim** anahtarını aç.
3. Bağlanırken, kontrol eden bilgisayarda **Parola** kutusuna aynı parolayı yaz.
   Doğru parola girildiğinde bağlantı otomatik kabul edilir.

Parola girilmezse veya yanlışsa, karşı tarafta onay penceresi çıkar (elle Kabul/Reddet).

## Özellikler
- 🖥️ **Sessiz ekran paylaşımı** — karşı tarafta ekran seçme penceresi çıkmaz, otomatik.
- 🖱️ **Tam uzaktan kontrol** — fare (sol/sağ/orta tık, çift tık, tekerlek), klavye (Türkçe karakterler ve Ctrl+C gibi kombinasyonlar dahil).
- 🛡️ **Yönetici pencereleri** — kabul edilmiş bir uzak oturum sırasında UAC istemleri de görüntülenip kontrol edilebilir. Windows'un güvenli masaüstü ilkesi yalnızca oturum boyunca değiştirilir ve oturum bitince otomatik geri alınır.
- 🔄 **Otomatik güncelleme** — yeni sürüm arka planda indirilir, sessizce kurulur ve RüzgarDesk otomatik yeniden açılır. Masa ID'si ve gözetimsiz erişim parolası korunur.
- 📋 **Ortak metin panosu** — uzaktaki ekranda Ctrl+V kullanıldığında yerel bilgisayardaki metin karşı tarafa aktarılır; Ctrl+C ile alınan uzak metin yerel panoya geri yazılır.
- 📁 **Dosya aktarımı** — Dosyalar sekmesine sürükle-bırak. Gelen dosyalar `İndirilenler\RuzgarDesk` klasörüne kaydedilir.
- 💬 **Sohbet** — oturum sırasında yazışma.
- 🔒 Bağlantılar uçtan uca (WebRTC/DTLS) şifrelidir.

## Sorun giderme
- **Bağlanamıyorum:** İki bilgisayarın da internete bağlı ve uygulamanın açık olduğundan emin olun. Durum çubuğunda "Hazır" yazmalı.
- **Nadir ağlarda bağlantı kurulmuyor:** Bazı katı kurumsal/mobil ağlarda P2P engellenebilir; farklı bir ağ (ör. telefon hotspot) deneyin. (Uygulama ücretsiz TURN aktarma sunucularını otomatik dener.)
- **Kayıt/log dosyası:** `%APPDATA%\RuzgarDesk\ruzgardesk.log` — sorun olursa buraya bakın.
- **Gelişmiş:** Kendi PeerJS sunucunuzu kurduysanız Ayarlar → "Özel Sinyal Sunucusu" alanına `host:port` yazabilirsiniz (çoğu kullanıcı için gereksiz).

## Geliştirici komutları
```bash
npm install            # bağımlılıklar
npm start              # uygulamayı geliştirme modunda çalıştır
npm run dist           # release/ içine .exe üret
npm run server         # sadece sinyal sunucusunu ayrı çalıştır (opsiyonel)
```
