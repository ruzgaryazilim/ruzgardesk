# RüzgarDesk Tanıtım Sitesi — Cloudflare Yayını

Site Cloudflare üzerinde yayına alındı.

## Yayındaki adresler
- **Site (Pages):** https://ruzgardesk.pages.dev
- **Özel alan adı:** https://ruzgardesk.ruzgaryazilim.com.tr  *(DNS CNAME kaydı eklenince aktifleşir)*
- **İndirmeler (Worker → R2):**
  - https://api.ruzgaryazilim.com.tr/download/RuzgarDesk-Setup-2.1.5.exe
  - https://api.ruzgaryazilim.com.tr/download/RuzgarDesk-Portable-2.1.5.exe
  - https://api.ruzgaryazilim.com.tr/download/RuzgarDesk-2.1.5-mac.zip
  - Sürümden bağımsız kısayollar: `/download/setup`, `/download/portable`, `/download/mac`
    (her zaman `latest.yml`'deki sürüme otomatik yönlenir)
- **Otomatik güncelleme:** https://api.ruzgaryazilim.com.tr/updates/latest.yml

Otomatik güncelleme adresi `updates-worker/` içindeki Cloudflare Worker üzerinden
`ruzgardesk-downloads` R2 bucket'ına bağlanır. Worker manifesti önbelleğe almaz ve
Setup dosyalarında Electron Updater'ın kullandığı HTTP range isteklerini destekler.

## Mimari
- **Cloudflare Pages** projesi `ruzgardesk` → statik site (`pages-dist/`: index.html + logo.png).
- **Cloudflare R2** bucket `ruzgardesk-downloads` → büyük `.exe` ve `.zip` dosyaları (Pages'in 25 MB/dosya
  sınırını aşmamak için). Herkese açık r2.dev URL'si etkin.
- `website/index.html` içindeki indirme linkleri **kendi alan adımızdaki Worker'a**
  (`api.ruzgaryazilim.com.tr/download/...`) yönlendirilmiştir.

## Neden doğrudan r2.dev linkleri kullanılmıyor
Butonlardaki `download` özniteliği tarayıcılarda **çapraz kaynaklı** linklerde yok sayılır; bu
yüzden `pub-...r2.dev/...` adresine tıklandığında tarayıcı dosyayı indirmek yerine o adrese
gidiyordu. Ayrıca `*.r2.dev` alan adı birçok ISP/antivirüs tarafından filtrelenir ve Cloudflare
tarafından üretim trafiği için hız sınırlıdır. Worker `/download/` yolunda
`Content-Disposition: attachment` başlığı gönderdiği için indirme her tarayıcıda garanti çalışır.

## Özel alan adını aktifleştirme (tek seferlik)
Alan adı Pages projesine eklendi ama "pending". Aktifleştirmek için:
- Panel → **Workers & Pages → ruzgardesk → Custom domains** → bekleyen alan adında
  **Activate / Set up DNS** butonuna tıkla (aynı hesapta olduğu için CNAME tek tıkla kurulur), **veya**
- Panel → **DNS → Add record**: `CNAME` · Name `ruzgardesk` · Target `ruzgardesk.pages.dev` · **Proxied**.

## Güncelleme (yeni sürüm çıkınca)
```bash
# 1) Windows ve macOS paketlerini üret
npm run dist
# macOS için (Windows üzerinde):
npx electron-packager . RuzgarDesk --platform=darwin --arch=arm64 --out=release/mac-build --overwrite --asar --prune=true --ignore="^/(release|\.git|pages-dist|\.wrangler|website|build|cloudflared\.exe)"
tar -a -c -f "release/RuzgarDesk-2.1.5-mac.zip" -C "release/mac-build/RuzgarDesk-darwin-arm64" "RuzgarDesk.app"

# 2) Dosyaları R2'ye yükle
npx wrangler r2 object put "ruzgardesk-downloads/RuzgarDesk-Setup-2.1.5.exe" --file="release/RuzgarDesk-Setup-2.1.5.exe" --content-type="application/octet-stream" --remote
npx wrangler r2 object put "ruzgardesk-downloads/RuzgarDesk-Portable-2.1.5.exe" --file="release/RuzgarDesk-Portable-2.1.5.exe" --content-type="application/octet-stream" --remote
npx wrangler r2 object put "ruzgardesk-downloads/RuzgarDesk-2.1.5-mac.zip" --file="release/RuzgarDesk-2.1.5-mac.zip" --content-type="application/zip" --remote

# 3) Sürüm numarası veya arayüz değiştiyse pages-dist'e kopyalayıp yeniden deploy et
cp website/index.html website/logo.png pages-dist/
npx wrangler pages deploy pages-dist --project-name=ruzgardesk --branch=main --commit-dirty=true
```

> Not: Dağıtımı yapan Cloudflare hesabı **RuzgarYazilim** (zxxzv.com@gmail.com), wrangler ile
> OAuth oturumu üzerinden. Bu oturum token'ında DNS yazma yetkisi yoktur; DNS kayıtları panelden
> ya da DNS yetkili bir API token ile eklenir.
