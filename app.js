document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const installButton = document.getElementById('installButton');
    const themeToggle = document.getElementById('themeToggle');
    const passwordInput = document.getElementById('password');
    const passwordToggle = document.getElementById('passwordToggle');
    const userTypeInputs = document.querySelectorAll('input[name="userType"]');
    let deferredPrompt;
    
    // Parola göster/gizle işlevi
    passwordToggle.addEventListener('click', () => {
        const passwordContainer = passwordToggle.closest('.password-container');
        const isVisible = passwordContainer.classList.toggle('password-visible');
        
        // Input tipini değiştir
        passwordInput.type = isVisible ? 'text' : 'password';
        
        // Ekran okuyucular için erişilebilirlik
        passwordToggle.setAttribute('aria-label', 
            isVisible ? 'Parolayı gizle' : 'Parolayı göster');
    });
    
    // Uygulama yükleme butonunu başlangıçta gizle
    installButton.style.display = 'none';
    
    // Tema değiştirme işlevi
    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        
        // Temayı localStorage'a kaydet
        localStorage.setItem('theme', newTheme);
    });
    
    // Sayfa yüklendiğinde kaydedilmiş temayı kontrol et
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        // Sistem temasını kontrol et
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    
    // Kullanıcı tipi seçimi için görsel iyileştirme
    userTypeInputs.forEach(input => {
        input.addEventListener('change', () => {
            // Tüm etiketlerin belirgin stilini temizle
            document.querySelectorAll('.user-type-label').forEach(label => {
                label.classList.remove('selected');
                // Hata görünümünü de temizle
                label.classList.remove('error-field');
            });
            
            // Seçilen etiketin belirgin stilini ekle
            if (input.checked) {
                input.closest('.user-type-label').classList.add('selected');
            }
        });
    });
    
    // Input alanlarında değişiklik olduğunda hata görünümünü temizle
    document.getElementById('username').addEventListener('input', function() {
        this.classList.remove('error-field');
    });
    
    document.getElementById('password').addEventListener('input', function() {
        this.classList.remove('error-field');
    });
    
    // PWA yükleme olayını yakalama
    window.addEventListener('beforeinstallprompt', (e) => {
        // Tarayıcının otomatik yükleme komutunu önle
        e.preventDefault();
        // Daha sonra kullanmak için olayı sakla
        deferredPrompt = e;
        // Yükleme butonunu göster
        installButton.style.display = 'flex';
    });
    
    // Yükleme butonu tıklama olayı
    installButton.addEventListener('click', () => {
        if (!deferredPrompt) {
            return;
        }
        // Yükleme komutunu göster
        deferredPrompt.prompt();
        
        // Kullanıcı yanıtını kontrol et
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                console.log('Kullanıcı kurulumu kabul etti');
                installButton.style.display = 'none';
            }
            deferredPrompt = null;
        });
    });
    
    // Uygulama kurulduğunda butonu gizle
    window.addEventListener('appinstalled', () => {
        installButton.style.display = 'none';
        deferredPrompt = null;
    });
    
    // Login mesajı elementi oluştur
    const loginMessage = document.createElement('div');
    loginMessage.className = 'login-message';
    document.querySelector('.login-card').appendChild(loginMessage);
    
    // Tüm hata görünümlerini temizle
    function clearAllErrors() {
        document.querySelectorAll('.error-field').forEach(el => {
            el.classList.remove('error-field');
        });
    }
    
    // Form gönderimini API'ye yönlendir
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Önce tüm hata görünümlerini temizle
        clearAllErrors();
        
        // Form verilerini al
        const userTypeElement = document.querySelector('input[name="userType"]:checked');
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();
        
        // Sıralı validasyon - her hata için ayrı kontrol edip hemen dönüş yap
        
        // 1. Önce kullanıcı tipi kontrolü
        if (!userTypeElement) {
            // Tüm kullanıcı tipi seçeneklerine kırmızı kenarlık ekle
            document.querySelectorAll('.user-type-label').forEach(label => {
                label.classList.add('error-field');
            });
            showMessage('Lütfen kullanıcı tipi seçin', 'error');
            return;
        }
        
        // 2. Sonra kullanıcı adı kontrolü
        if (!username) {
            document.getElementById('username').classList.add('error-field');
            showMessage('Lütfen kullanıcı adı girin', 'error');
            return;
        }
        
        // 3. Son olarak parola kontrolü
        if (!password) {
            document.getElementById('password').classList.add('error-field');
            showMessage('Lütfen parola girin', 'error');
            return;
        }
        
        const userType = userTypeElement.value;
        
        // Login butonunu devre dışı bırak
        const loginButton = loginForm.querySelector('button[type="submit"]');
        loginButton.disabled = true;
        loginButton.textContent = 'Giriş yapılıyor...';
        
        try {
            // API'ye istek at
            const response = await fetch('http://localhost:3000/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password, userType })
            });
            
            // Yanıt kontrolü
            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = 'Giriş başarısız';
                try {
                    const errorData = JSON.parse(errorText);
                    errorMessage = errorData.error || errorMessage;
                    console.log('Sunucudan gelen hata:', errorData.error);
                } catch (e) {
                    console.error('Yanıt JSON formatında değil:', errorText);
                }
                throw new Error(errorMessage);
            }
            
            const data = await response.json();
            
            // Başarılı giriş
            showMessage(`${userType === 'student' ? 'Öğrenci' : userType === 'teacher' ? 'Öğretmen' : 'Yönetici'} olarak giriş başarılı!`, 'success');
            
            // Kullanıcı bilgilerini sakla (gerçek uygulamada token kullanılabilir)
            localStorage.setItem('user', JSON.stringify(data.user));
            
            // Tüm önbelleği temizle
            try {
                // Performans nedenlerinden dolayı sadece scheduleData ile ilgili localStorage verileri temizlenir
                localStorage.removeItem('scheduleData');
                localStorage.removeItem('temporaryScheduleData');
                
                // Tarayıcı önbelleğini sıfırlamak ideal olacaktır, fakat burada yapılamamaktadır
                console.log('Ders programı önbelleği temizlendi');
            } catch (e) {
                console.warn('Önbellek temizleme hatası:', e);
            }
            
            // Kısa bir süre bekleyip anasayfaya yönlendir
            setTimeout(() => {
                // Temiz URL kullan
                window.location.href = '/dashboard.html';
            }, 1500);
            
        } catch (error) {
            console.error('Giriş hatası:', error);
            showMessage(error.message, 'error');
            
            // Login butonunu etkinleştir
            loginButton.disabled = false;
            loginButton.textContent = 'Giriş Yap';
        }
    });
    
    // Mesaj gösterme fonksiyonu
    function showMessage(text, type) {
        loginMessage.textContent = text;
        loginMessage.className = `login-message ${type}`;
        
        // Mesajı belirli bir süre sonra kaldır
        setTimeout(() => {
            loginMessage.textContent = '';
            loginMessage.className = 'login-message';
        }, 3000);
    }
}); 