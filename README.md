# Eğitim Portalı PWA

Bu proje, bir eğitim portalı için Progressive Web App (PWA) olarak geliştirilmiş giriş sayfasıdır.

## Özellikler

- Responsive tasarım (mobil ve masaüstü uyumlu)
- PWA özellikleri (çevrimdışı çalışma, ana ekrana eklenebilme)
- Minimalist ve modern kullanıcı arayüzü
- Kullanıcı tipi seçimi (öğrenci, öğretmen, yönetici)

## Kurulum

Projeyi yerel ortamınızda çalıştırmak için:

1. Repoyu klonlayın: `git clone <repo-url>`
2. Proje dizinine gidin: `cd egitim-portal-pwa`
3. Bir HTTP sunucusu başlatın. Örneğin:
   - Python ile: `python -m http.server 8000`
   - Node.js ile: `npx serve`
4. Tarayıcınızda `http://localhost:8000` adresine gidin

## Teknolojiler

- HTML5
- CSS3
- JavaScript
- Service Worker API
- Web App Manifest

## İletişim

Sorularınız veya önerileriniz için [email@example.com](mailto:email@example.com) adresinden iletişime geçebilirsiniz.

## Uygulama Dağıtımı (Deployment)

### Render.com Üzerinde Ücretsiz Yayınlama

1. [Render](https://render.com/) üzerinde ücretsiz bir hesap oluşturun.
2. Render Dashboard'da "New +" butonuna tıklayın ve "Web Service" seçin.
3. GitHub hesabınızı bağlayın ve bu projeyi seçin veya manuel olarak GitHub repo URL'nizi girin.
4. Aşağıdaki ayarları yapılandırın:
   - **Name**: scientfutasis (veya istediğiniz isim)
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free

5. "Create Web Service" butonuna tıklayın.
6. Birkaç dakika içinde uygulamanız [https://uygulamaadi.onrender.com](https://uygulamaadi.onrender.com) adresinde yayınlanacaktır.

### Önemli Notlar

1. Ücretsiz planda uygulamanız 15 dakika inaktif kaldıktan sonra uyku moduna geçecektir. İlk erişimde uyanması birkaç saniye sürebilir.
2. Veritabanınız SQLite kullanıyor. Render'ın dosya sistemi geçicidir - uygulama yeniden başladığında veritabanı dosyanız kaybolabilir. Kalıcı veri için:
   - Render'ın Disk hizmetini (ücretli) kullanabilirsiniz
   - Veritabanınızı PostgreSQL gibi bir bulut veritabanına geçirebilirsiniz

## GitHub Üzerinde Yayınlama

1. GitHub'da yeni bir repository oluşturun
2. Projeyi GitHub'a yükleyin:

```bash
git init
git add .
git commit -m "İlk commit"
git branch -M main
git remote add origin https://github.com/kullaniciadi/scientfutasis.git
git push -u origin main
```

### Heroku Üzerinde Ücretsiz Yayınlama

1. [Heroku](https://www.heroku.com/) üzerinde ücretsiz bir hesap oluşturun.
2. Heroku CLI'ı yükleyin:
   ```bash
   npm install -g heroku
   ```
3. Terminalde giriş yapın:
   ```bash
   heroku login
   ```
4. Heroku uygulaması oluşturun:
   ```bash
   heroku create scientfutasis
   ```
5. Projeyi Heroku'ya gönderin:
   ```bash
   git push heroku main
   ```
6. Uygulamanız https://scientfutasis.herokuapp.com/ adresinde yayınlanacaktır.

Not: Heroku 2022'de ücretsiz planlarını kaldırdı, ancak kredi kartı bilgilerinizi ekleyerek sınırlı ücretsiz kaynaklar kullanabilirsiniz. Render.com daha iyi bir ücretsiz alternatif olabilir. 