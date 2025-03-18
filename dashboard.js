// Sayfa ilk yüklendiğinde arka planda verileri yükle - gecikmeli stratejisi
document.addEventListener('DOMContentLoaded', () => {
    // Tüm modalları kapat - otomatik açılan modal sorunu için
    closeAllModals();
    
    // Sayfa yüklendikten sonra tekrar modalların kapalı olduğundan emin olalım
    setTimeout(() => {
        closeAllModals();
    }, 100);
    
    // Sayfa hazır olduğunda bir kerelik bildirimi göster
    const loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'loading-overlay';
    loadingOverlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.2); z-index:9999; display:flex; justify-content:center; align-items:center; transition:opacity 0.5s';
    
    const loadingIndicator = document.createElement('div');
    loadingIndicator.innerHTML = `
        <div style="background:var(--card-bg); border-radius:8px; padding:20px; box-shadow:0 4px 15px rgba(0,0,0,0.1); text-align:center; max-width:90%; width:300px">
            <div class="spinner" style="margin:0 auto 15px auto"></div>
            <p style="margin:0; color:var(--text-color)">Uygulama hazırlanıyor...</p>
        </div>
    `;
    loadingOverlay.appendChild(loadingIndicator);
    document.body.appendChild(loadingOverlay);
    
    
    // Kaynakları aşamalı olarak yükle
    const loadResources = () => {
        console.log('Kaynaklar aşamalı olarak yükleniyor...');
        
        // İlk aşama - sayfanın temel içeriği için gerekli veriler
        setTimeout(() => {
            // Tekrar modalları kapatmayı dene
            closeAllModals();
            
            // 500ms sonra ilk kritik verileri yükle (örn. ders programı)
            initializeScheduleData();
            
            // 1 saniye sonra bildirime gerek olmayan ders programı verilerini hazırla
            setTimeout(() => {
                // Son kontrol - tüm modalları kapattığımızdan emin olalım
                closeAllModals();
                
                loadDataFromTable();
                
                // Yükleme göstergesini kapat
                loadingOverlay.style.opacity = '0';
                setTimeout(() => {
                    document.body.removeChild(loadingOverlay);
                }, 500);
                
                // Modalların erken açılmasını engelle
                closeAllModals();
                
                // İkinci aşama - geri kalan veriler için
                setTimeout(() => {
                    // Sınav notlarını arka planda yükle
                    if (!cachedGrades) {
                        console.log('Sınav notları arka planda yükleniyor...');
                        fetch('/api/grades/get?meta_only=true')
                            .then(response => response.json())
                            .then(data => {
                                grades = data;
                                cachedGrades = data;
                                gradesCacheTimestamp = new Date().getTime();
                                console.log('Sınav notları arka planda yüklendi:', data.length);
                            })
                            .catch(error => {
                                console.error('Sınav notları arka planda yüklenirken hata:', error);
                            });
                    }
                    
                    // Üçüncü aşama - en az önemli veriler
                    setTimeout(() => {
                        // Kullanıcıları arka planda yükle
                        if (isAdmin && !cachedUsers) {
                            console.log('Kullanıcılar arka planda yükleniyor...');
                            fetchWithTokenCheck('/api/users?minimal=true')
                                .then(response => response.json())
                                .then(data => {
                                    // Veri formatını kontrol et
                                    if (Array.isArray(data)) {
                                        cachedUsers = data;
                                        usersCacheTimestamp = new Date().getTime();
                                        console.log('Kullanıcılar arka planda yüklendi:', data.length);
                                    } else if (data.users && Array.isArray(data.users)) {
                                        cachedUsers = data.users;
                                        usersCacheTimestamp = new Date().getTime();
                                        console.log('Kullanıcılar arka planda yüklendi:', data.users.length);
                                    }
                                })
                                .catch(error => {
                                    console.error('Kullanıcılar arka planda yüklenirken hata:', error);
                                });
                        }
                    }, 3000);
                }, 2000);
            }, 1000);
        }, 500);
    };
    
    // Kaynak yüklemeyi başlat
    loadResources();
    
    // Service worker'ı unregister etmek için
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for (let registration of registrations) {
                registration.unregister().then(function(success) {
                    console.log('Service worker unregister edildi:', success);
                    // Cache'i temizle
                    if ('caches' in window) {
                        caches.keys().then(function(cacheNames) {
                            cacheNames.forEach(function(cacheName) {
                                caches.delete(cacheName);
                                console.log('Cache silindi:', cacheName);
                            });
                        });
                    }
                });
            }
        });
    }
    
    const themeToggle = document.getElementById('themeToggle');
    const navLogoutButton = document.getElementById('navLogoutButton');
    const userAccount = document.getElementById('userAccount');
    
    // Oturum kontrolü
    let userInfo;
    const token = localStorage.getItem('token');
    
    // İsteği handle eden wrapper fonksiyon
    // Tüm fetch isteklerimizi bu fonksiyon üzerinden yapacağız
    async function fetchWithTokenCheck(url, options = {}) {
        // Kullanıcı token'ını header'lara ekle
        const token = userInfo?.token || localStorage.getItem('token') || '';
        if (token) {
            if (!options.headers) {
                options.headers = {};
            }
            options.headers['Authorization'] = `Bearer ${token}`;
        }
        
        try {
            const response = await fetch(url, options);
            
            // API yanıtını kontrol et, token geçersiz kılındıysa
            if (response.status === 401) { // Unauthorized
                const data = await response.json();
                
                // Şifre değişikliği nedeniyle token geçersiz kılındıysa
                if (data.code === 'TOKEN_REVOKED' || data.code === 'TOKEN_EXPIRED') {
                    // Kullanıcıya uyarı göster
                    showNotification(data.message || 'Oturumunuz sonlandırıldı, lütfen tekrar giriş yapın.', 'error');
                    
                    // 3 saniye sonra çıkış yap
                    setTimeout(() => {
                        logout();
                    }, 3000);
                    
                    // İsteği iptal et
                    throw new Error(data.message || 'Oturum sonlandırıldı');
                }
            }
            
            return response;
        } catch (error) {
            console.error('Fetch hatası:', error);
            throw error;
        }
    }
    
    // Token yoksa login sayfasına yönlendir
    if (!token) {
        console.log('Token bulunamadı, giriş sayfasına yönlendiriliyor...');
        window.location.href = '/index.html';
        return;
    }
    
    try {
        userInfo = JSON.parse(localStorage.getItem('user'));
        console.log('Yüklenen kullanıcı bilgisi:', userInfo);
        
        if (!userInfo) {
            console.log('Kullanıcı bilgisi bulunamadı, giriş sayfasına yönlendiriliyor...');
            window.location.href = '/index.html';
            return;
        }
    } catch (e) {
        console.error('Kullanıcı bilgisi yüklenirken hata:', e);
        // Giriş sayfasına yönlendir
        window.location.href = '/index.html';
        return;
    }
    
    // Kullanıcı tipini kontrol et - sadece yöneticiler düzenleyebilsin
    const isAdmin = userInfo && userInfo.userType === 'admin';
    
    // Duyuru ekleme butonunu kontrol et - sadece adminler görsün
    const addAnnouncementBtn = document.getElementById('addAnnouncementBtn');
    if (addAnnouncementBtn) {
        if (isAdmin) {
            addAnnouncementBtn.style.display = 'flex';
        } else {
            addAnnouncementBtn.style.display = 'none';
        }
    }
    
    // Gerçek bir ortamda yönlendirme yapmak için
    // if (!userInfo) {
    //     window.location.href = '/index.html';
    //     return;
    // }
    
    // Hesap bilgilerini doldur
    if (userInfo && userInfo.username) {
        const accountName = document.querySelector('.account-name');
        const accountType = document.querySelector('.account-type');
        const accountEmail = document.querySelector('.account-email');
        
        if (accountName) accountName.textContent = userInfo.username;
        
        // Kullanıcı tipine göre özel bilgiler
        let typeLabel = '';
        
        switch (userInfo && userInfo.userType) {
            case 'student':
                typeLabel = 'Öğrenci';
                break;
            case 'teacher':
                typeLabel = 'Öğretmen';
                break;
            case 'admin':
                typeLabel = 'Yönetici';
                break;
            default:
                typeLabel = 'Kullanıcı';
        }
        
        if (accountType) accountType.textContent = typeLabel;
        if (accountEmail && userInfo.email) {
            accountEmail.textContent = userInfo.email;
        } else if (accountEmail) {
            accountEmail.textContent = 'kullanici@ornek.com';
        }
    }
    
    // Tema değiştirme işlevi
    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        
        // Temayı localStorage'a kaydet
        localStorage.setItem('theme', newTheme);
        
        console.log('Tema değiştirildi:', newTheme);
    });
    
    // Sayfa yüklendiğinde kaydedilmiş temayı kontrol et
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
        console.log('Kaydedilmiş tema yüklendi:', savedTheme);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        // Sistem temasını kontrol et
        document.documentElement.setAttribute('data-theme', 'dark');
        console.log('Sistem teması yüklendi: dark');
    }
    
    // Navbar'daki çıkış ikonu
    if (navLogoutButton) {
        navLogoutButton.addEventListener('click', () => {
            logout();
        });
    }
    
    // Hesap ikonu tıklama işlemi
    if (userAccount) {
        userAccount.addEventListener('click', (e) => {
            e.stopPropagation();
            userAccount.classList.toggle('active');
        });
        
        // Dropdown dışında bir yere tıklandığında dropdown'ı kapat
        document.addEventListener('click', (e) => {
            if (!userAccount.contains(e.target) && userAccount.classList.contains('active')) {
                userAccount.classList.remove('active');
            }
        });
    }
    
    // Çıkış yapma fonksiyonu
    function logout() {
        // LocalStorage'dan kullanıcı bilgilerini ve token'ı temizle
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        localStorage.removeItem('scheduleData');
        localStorage.removeItem('temporaryScheduleData');
        
        // Giriş sayfasına yönlendir
        window.location.href = '/index.html';
    }
    
    // Alt ikon butonları için tıklama ve hover işlemleri
    const iconItems = document.querySelectorAll('.icon-item');
    
    // Modal işlemleri için elemanları seçiyoruz
    const scheduleModal = document.getElementById('scheduleModal');
    const closeModalBtn = scheduleModal.querySelector('.close-modal');
    
    // Ödevler modalı için elemanları seçiyoruz
    const homeworkModal = document.getElementById('homeworkModal');
    const homeworkCloseBtn = homeworkModal.querySelector('.close-modal');
    const addHomeworkBtn = document.getElementById('addHomeworkBtn');
    const homeworkForm = document.getElementById('homeworkForm');
    const cancelHomeworkBtn = document.getElementById('cancelHomeworkBtn');
    const homeworkTableBody = document.getElementById('homeworkTableBody');
    
    // Duyurular modalı
    const announcementsModal = document.getElementById('announcementsModal');
    
    // Veri depoları
    let homeworkData = [];
    let editingHomeworkId = null;
    
    // İkonlar için tıklama ve hover işlemleri
    iconItems.forEach((item, index) => {
        // Hover durumunda tüm alanın vurgulanması için
        item.addEventListener('mouseenter', () => {
            item.classList.add('hovered');
        });
        
        item.addEventListener('mouseleave', () => {
            item.classList.remove('hovered');
        });
        
        // Tıklama işlemi
        item.addEventListener('click', (e) => {
            const bölümler = ["Ders Programı", "Ödevler", "Duyurular", "Sınav Notları"];
            console.log(`${bölümler[index]} bölümüne tıklandı`);
            
            // Aktif olan ikonu vurgula
            iconItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            // İlgili modalı aç
            if (index === 0) { // İlk ikon Ders Programı
                openModal(scheduleModal);
            } else if (index === 1) { // İkinci ikon Ödevler
                openModal(homeworkModal);
            } else if (index === 2) { // Üçüncü ikon Duyurular
                openModal(announcementsModal);
                fetchAnnouncements();
            }
        });
    });
    
    // Ders programı düzenleme işlevselliği
    const editableCells = document.querySelectorAll('.editable-cell');
    let scheduleData = {}; // Ders programı verilerini saklayacak nesne
    let hasChanges = false; // Değişiklik yapılıp yapılmadığını takip eden değişken
    
    // Başlangıçta mevcut ders programını oku
    function initializeScheduleData() {
        // Global ders programı için sabit userId kullan
        let userId = 0; // Global program
        
        // Önce DOM'daki tüm hücreleri temizle - zorla yeniden yüklensin
        editableCells.forEach(cell => {
            cell.textContent = '';
        });
        
        // Yükleniyor göstergesi ekle
        const loadingIndicator = document.createElement('div');
        loadingIndicator.textContent = 'Ders programı yükleniyor...';
        loadingIndicator.style.cssText = 'position: fixed; top: 70px; right: 20px; background-color: var(--accent-color); color: white; padding: 10px 15px; border-radius: 4px; z-index: 1000; box-shadow: 0 2px 10px rgba(0,0,0,0.2);';
        document.body.appendChild(loadingIndicator);
        
        // Benzersiz bir zaman damgası oluştur - önbelleği engelle
        const timestamp = new Date().getTime();
        
        // URL'de zaman damgası göstermeden önbelleği devre dışı bırak
        const fetchOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            credentials: 'same-origin',
            cache: 'no-store' // Fetch API önbelleğini devre dışı bırak
        };
        
        // Fetch API'sini yapılandır - tarayıcının önbelleği kullanmasını engelle
        const fetchController = new AbortController();
        fetchOptions.signal = fetchController.signal;
        
        console.log(`Ders programı isteği yapılıyor`);
        
        // Sunucudan verileri çek - önbellek kullanımını engelle
        fetch(`/api/schedule/get`, fetchOptions)
        .then(response => {
            console.log('API yanıtı status:', response.status);
            
            // Tarayıcı önbelleğini devre dışı bırakmak için response'u kontrol et
            const freshResponse = response.clone();
            if (response.ok) {
                return freshResponse.json();
            }
            throw new Error('Ders programı yüklenemedi');
        })
        .then(data => {
            // API yanıtını detaylı logla
            console.log('API yanıtı:', data);
            
            // Kullanıcı bilgilerini logla
            console.log('Aktif kullanıcı:', userInfo);
            
            // Yanıt formatını kontrol et ve doğru veri yapısını kullan
            if (data && data.schedule && typeof data.schedule === 'object') {
                // Yeni API formatı - data.schedule içinde
                scheduleData = data.schedule;
            } else if (data && typeof data === 'object' && !data.error) {
                // Eski format - direkt data nesnesinde
                scheduleData = data;
            } else {
                // Hata varsa boş bir nesne kullan
                console.error('API yanıtından veri okunamadı:', data);
                scheduleData = {};
            }
            
            console.log('Ders programı verileri yüklendi:', scheduleData);
            
            // Yanıt meta verilerini kontrol et
            if (data && data.meta) {
                console.log('Yanıt meta verileri:', data.meta);
            }
            
            // Tabloya mevcut değerleri yerleştir
            editableCells.forEach(cell => {
                const row = cell.getAttribute('data-row');
                const col = cell.getAttribute('data-col');
                
                // Yeni format: "row_col" formatında key kullanıyor
                const cellKey = `${row}_${col}`;
                const content = scheduleData[cellKey];
                
                if (content) {
                    cell.textContent = content;
                    cell.classList.add('has-content');
                } else {
                    cell.textContent = '';
                    cell.classList.remove('has-content');
                    console.log(`Veri yok: row=${row}, col=${col}`);
                }
            });
            
            // Veri kontrolü yap - boş ise kullanıcıya bildir
            const hasData = Object.keys(scheduleData).length > 0;
            console.log('Veri var mı?', hasData);
            
            if (!hasData) {
                const noDataNotice = document.createElement('div');
                noDataNotice.textContent = 'Hiç ders programı verisi bulunamadı!';
                noDataNotice.style.cssText = 'position: fixed; top: 70px; right: 20px; background-color: #FF9800; color: white; padding: 10px 15px; border-radius: 4px; z-index: 1000; box-shadow: 0 2px 10px rgba(0,0,0,0.2);';
                document.body.appendChild(noDataNotice);
                
                setTimeout(() => {
                    noDataNotice.style.opacity = '0';
                    noDataNotice.style.transition = 'opacity 0.5s';
                    setTimeout(() => noDataNotice.remove(), 500);
                }, 4000);
            }
            
            hasChanges = false;
            loadingIndicator.remove();
        })
        .catch(error => {
            console.error('Ders programı yüklenirken hata:', error);
            
            // Hata durumunda tablodan veri yükle
            loadDataFromTable();
            
            // Hata bildirimi göster
            loadingIndicator.remove();
            const errorNotification = document.createElement('div');
            errorNotification.textContent = 'Ders programı yüklenemedi! Veriler varsayılan olarak gösteriliyor.';
            errorNotification.style.cssText = 'position: fixed; top: 70px; right: 20px; background-color: #F44336; color: white; padding: 10px 15px; border-radius: 4px; z-index: 1000; box-shadow: 0 2px 10px rgba(0,0,0,0.2);';
            document.body.appendChild(errorNotification);
            
            // 4 saniye sonra hata bildirimini kaldır
            setTimeout(() => {
                errorNotification.style.opacity = '0';
                errorNotification.style.transition = 'opacity 0.5s';
                setTimeout(() => errorNotification.remove(), 500);
            }, 4000);
        });
    }
    
    // Tablodan veri yükleme yardımcı fonksiyonu
    function loadDataFromTable() {
        scheduleData = {};
        editableCells.forEach(cell => {
            const row = cell.getAttribute('data-row');
            const col = cell.getAttribute('data-col');
            const content = cell.textContent.trim();
            
            if (content) {
                // Yeni format: "row_col" formatında key kullanıyor
                const cellKey = `${row}_${col}`;
                scheduleData[cellKey] = content;
            }
        });
        
        console.log('Ders programı tablodaki değerlerden yüklendi:', scheduleData);
        hasChanges = false;
    }
    
    // Hücreyi düzenleme moduna geçir
    function makeEditable(cell) {
        // Sadece yöneticiler düzenleyebilir
        if (!isAdmin) {
            console.log('Sadece yöneticiler ders programını düzenleyebilir.');
            
            // Kullanıcıya bildirim göster
            const notification = document.createElement('div');
            notification.textContent = 'Sadece yöneticiler ders programını düzenleyebilir!';
            notification.style.cssText = 'position: fixed; top: 70px; right: 20px; background-color: #F44336; color: white; padding: 10px 15px; border-radius: 4px; z-index: 1000; box-shadow: 0 2px 10px rgba(0,0,0,0.2);';
            document.body.appendChild(notification);
            
            // 3 saniye sonra bildirimi kaldır
            setTimeout(() => {
                notification.style.opacity = '0';
                notification.style.transition = 'opacity 0.5s';
                setTimeout(() => notification.remove(), 500);
            }, 3000);
            
            return;
        }
        
        // Zaten düzenleme modundaysa çıkış yap
        if (cell.classList.contains('editing')) {
            return;
        }
        
        // Açık olan diğer düzenleme alanlarını kapat
        document.querySelectorAll('.editable-cell.editing').forEach(editingCell => {
            const input = editingCell.querySelector('input');
            if (input) {
                editingCell.textContent = input.value;
            }
            editingCell.classList.remove('editing');
        });
        
        const value = cell.textContent.trim();
        const row = cell.getAttribute('data-row');
        const col = cell.getAttribute('data-col');
        
        // Hücre içeriğini temizle ve düzenleme moduna geçir
        const originalContent = cell.textContent;
        cell.textContent = '';
        cell.classList.add('editing');
        
        // Input oluştur ve ekle
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value;
        input.setAttribute('data-row', row);
        input.setAttribute('data-col', col);
        cell.appendChild(input);
        
        // Input'a odaklan
        input.focus();
        input.select();
        
        // Tab, Enter, Escape tuşu ve blur olaylarını ekle
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cell.textContent = originalContent;
                cell.classList.remove('editing');
            } else if (e.key === 'Tab') {
                e.preventDefault(); // Tab'ın varsayılan davranışını engelle
                
                // Mevcut hücrenin değişikliklerini kaydet
                saveCurrentCell(cell, input, row, col);
                
                // Sonraki hücreyi bul ve düzenleme moduna geç
                const nextCell = findNextCell(row, col, e.shiftKey);
                if (nextCell) {
                    makeEditable(nextCell);
                }
            }
        });
        
        input.addEventListener('blur', function() {
            if (!cell.contains(input)) return;
            
            saveCurrentCell(cell, input, row, col);
        });
    }
    
    // Mevcut hücrenin değişikliklerini kaydet
    function saveCurrentCell(cell, input, row, col) {
        const newValue = input.value.trim();
        
        // Hücreyi normal moda getir
        cell.textContent = newValue;
        cell.classList.remove('editing');
        
        // Veri değişikliğini kaydet
        if (!scheduleData[row]) {
            scheduleData[row] = {};
        }
        
        if (scheduleData[row][col] !== newValue) {
            scheduleData[row][col] = newValue;
            hasChanges = true;
        }
    }
    
    // Ders programı tablosunda bir sonraki hücreyi bul
    function findNextCell(currentRow, currentCol, isShiftTab) {
        // Sıradaki hücrenin konumunu belirle
        let nextRow = parseInt(currentRow);
        let nextCol = parseInt(currentCol);
        
        if (isShiftTab) {
            // Shift+Tab basıldıysa önceki hücreye git
            nextRow--;
            
            // Eğer satır başına döndüyse, önceki sütunun sonuna git
            if (nextRow < 1) {
                nextCol--;
                nextRow = 8; // Son satır numarası
                
                // Eğer ilk sütundan öncesine geçtiyse, en son hücreye git
                if (nextCol < 1) {
                    nextCol = 5; // Son sütun numarası
                }
            }
        } else {
            // Sonraki hücreye git (önce aşağıya doğru aynı sütunda)
            nextRow++;
            
            // Eğer satır sonu aşıldıysa, bir sonraki sütunun başına git
            if (nextRow > 8) { // 8 satır olduğunu varsayıyoruz
                nextRow = 1;
                nextCol++;
                
                // Eğer sütun sayısı aşıldıysa, ilk hücreye geri dön
                if (nextCol > 5) { // 5 sütun olduğunu varsayıyoruz
                    nextCol = 1;
                }
            }
        }
        
        // Sonraki hücreyi bulup döndür
        return document.querySelector(`.editable-cell[data-row="${nextRow}"][data-col="${nextCol}"]`);
    }
    
    // Ders hücrelerine tıklama olayları ekle
    editableCells.forEach(cell => {
        // Eğer yönetici değilse, sadece düzenleme özelliklerini kaldır ama veri özniteliklerini koru
        if (!isAdmin) {
            cell.classList.remove('editable-cell');
            // data-row ve data-col özniteliklerini SİLME çünkü bunlar verileri göstermek için gerekli
            cell.style.cursor = 'default';
        } else {
            cell.addEventListener('click', function() {
                makeEditable(cell);
            });
        }
    });
    
    // Sayfa yüklendiğinde mevcut ders programını yükle
    initializeScheduleData();
    
    // Ayrıca tarayıcının 'pageshow' olayında da yükle (önbellekten geri gelme durumları için)
    window.addEventListener('pageshow', (event) => {
        // bfcache'den geliyorsa verileri yeniden yükle
        if (event.persisted) {
            console.log('Sayfa önbellekten yüklendi, ders programı yeniden yükleniyor...');
            initializeScheduleData();
        }
    });
    
    // Önbellek değişkenleri - Modal verilerini saklayacak
    let cachedGrades = null;
    let cachedUsers = null;
    let gradesCacheTimestamp = null;
    let usersCacheTimestamp = null;
    const CACHE_EXPIRY = 5 * 60 * 1000; // 5 dakika (milisaniye)
    
    // Modal Açma/Kapama İşlevleri
    function openModal(modalElement) {
        // Parametre kontrolü - geçersiz modal ise işlemi iptal et
        if (!modalElement || typeof modalElement !== 'object') {
            console.log('Geçersiz modal referansı:', modalElement);
            return;
        }

        // Önce açık olan tüm modalları kapat
        closeAllModals();
        
        // Sayfayı kaydıralım, görüntünün bozulmaması için
        window.scrollTo(0, 0);
        
        // Modal'ı göster
        modalElement.style.display = 'block';
        
        // Body scroll'u kapat
        document.body.style.overflow = 'hidden';
        
        // Modaldaki scroll'u üste taşı
        const modalBody = modalElement.querySelector('.modal-body');
        if (modalBody) {
            modalBody.scrollTop = 0;
        }
        
        hasChanges = false; // Modal açıldığında değişiklik durumunu sıfırla
        
        // Modal'a göre veri yükleme - Önbellekten yükle
        if (modalElement === homeworkModal) {
            fetchHomeworks();
        } else if (modalElement === gradesModal) {
            if (isDataCached(cachedGrades, gradesCacheTimestamp)) {
                console.log('Önbellekten sınav notları yükleniyor...');
                displayGrades();
            } else {
                console.log('API\'den sınav notları yükleniyor...');
                fetchGrades();
            }
        } else if (modalElement === userManagementModal) {
            if (isDataCached(cachedUsers, usersCacheTimestamp)) {
                console.log('Önbellekten kullanıcılar yükleniyor...');
                displayUsers(cachedUsers);
            } else {
                console.log('API\'den kullanıcılar yükleniyor...');
                fetchUsers();
            }
        }
    }

    function closeModal(modalElement) {
        // Değişiklikler yapıldıysa ve ders programıysa kaydet
        if (hasChanges && modalElement === scheduleModal) {
            saveSchedule();
        }
        
        // Ödev formunu gizle ve sıfırla
        if (modalElement === homeworkModal) {
            homeworkForm.style.display = 'none';
            resetHomeworkForm();
        }
        
        modalElement.style.display = 'none';
        
        // Body scroll'u geri aç
        document.body.style.overflow = '';
        
        // Modal kapatıldığında alt blok ikonlarındaki active efektini kaldır
        document.querySelectorAll('.icon-item').forEach(item => {
            item.classList.remove('active');
            item.classList.remove('hovered');
        });
    }

    // Tüm modalları kapatmayı sağlayan fonksiyon
    function closeAllModals() {
        console.log('Tüm modallar kapatılıyor...');
        
        // Tüm modalları al
        const allModals = document.querySelectorAll('.modal');
        
        // Her bir modalı kapat
        allModals.forEach(modal => {
            // Önce display:none yap
            modal.style.display = 'none';
            
            // Forceyle düzgün kapanması için ek adım
            setTimeout(() => {
                modal.style.display = 'none';
            }, 10);
        });
        
        // Arka plan scrollunu geri aç
        document.body.style.overflow = '';
        
        // Alt blok ikonlarındaki active efektini kaldır
        document.querySelectorAll('.icon-item').forEach(item => {
            item.classList.remove('active');
            item.classList.remove('hovered');
        });
        
        // Modalların kapatıldığını logla
        console.log('Modallar kapatıldı');
    }

    // ESC tuşuyla açık olan modalı kapat
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            closeAllModals();
        }
    });
    
    // Kapatma düğmesi için olay dinleyicisi - Ders Programı
    closeModalBtn.addEventListener('click', () => {
        closeModal(scheduleModal);
    });
    
    // Kapatma düğmesi için olay dinleyicisi - Ödevler
    homeworkCloseBtn.addEventListener('click', () => {
        closeModal(homeworkModal);
    });
    
    // Modal dışına tıklandığında kapat
    window.addEventListener('click', (e) => {
        if (e.target === scheduleModal) {
            closeModal(scheduleModal);
        } else if (e.target === homeworkModal) {
            closeModal(homeworkModal);
        }
    });
    
    // Klavye ESC tuşu ile kapatma
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (scheduleModal.style.display === 'flex') {
                closeModal(scheduleModal);
            } else if (homeworkModal.style.display === 'flex') {
                closeModal(homeworkModal);
            }
        }
    });
    
    // Ders programını sunucuya kaydet
    function saveSchedule() {
        // Sadece yöneticiler kaydedebilir
        if (userInfo && (userInfo.userType === 'admin' || userInfo.userType === 'Yönetici')) {
            
            // Veriyi tablodan topla
            collectDataFromTable();
            
            // Global ders programı için sabit userId kullan
            let userId = 1; // Global program
            
            // Kaydetmeden önce onay al
            if (!confirm('Ders programı değişikliklerini kaydetmek istiyor musunuz?')) {
                console.log('Kullanıcı kaydetmeyi iptal etti');
            return;
        }
        
            // Yükleniyor göstergesi ekle
        const loadingNotification = document.createElement('div');
        loadingNotification.textContent = 'Ders programı kaydediliyor...';
        loadingNotification.style.cssText = 'position: fixed; bottom: 70px; right: 20px; background-color: var(--accent-color); color: white; padding: 10px 15px; border-radius: 4px; z-index: 1000; box-shadow: 0 2px 10px rgba(0,0,0,0.2);';
        document.body.appendChild(loadingNotification);
        
        // Sunucuya veri gönder - önbellek kullanımını engelle
        fetch(`/api/schedule/save?t=${new Date().getTime()}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            body: JSON.stringify({
                userId: userId,
                userType: userInfo && userInfo.userType ? userInfo.userType : "", // Kullanıcı tipini sunucuya gönder
                data: scheduleData
            }),
            credentials: 'same-origin'
        })
        .then(response => {
            if (response.ok) {
                return response.json();
            }
            throw new Error('Ders programı kaydedilemedi');
        })
        .then(result => {
            console.log('Ders programı veritabanına kaydedildi', result);
            
            // Başarı bildirimi göster
            loadingNotification.remove();
            const notification = document.createElement('div');
            notification.textContent = 'Ders programı başarıyla kaydedildi';
            notification.style.cssText = 'position: fixed; bottom: 70px; right: 20px; background-color: #4CAF50; color: white; padding: 10px 15px; border-radius: 4px; z-index: 1000; box-shadow: 0 2px 10px rgba(0,0,0,0.2);';
            document.body.appendChild(notification);
            
            // 3 saniye sonra bildirimi kaldır
            setTimeout(() => {
                notification.style.opacity = '0';
                notification.style.transition = 'opacity 0.5s';
                setTimeout(() => notification.remove(), 500);
            }, 3000);
            
            hasChanges = false; // Değişiklikler kaydedildi
        })
        .catch(error => {
            console.error('Kaydetme hatası:', error);
            
            // Hata bildirimi göster
            loadingNotification.remove();
            const errorNotification = document.createElement('div');
            errorNotification.textContent = 'Ders programı kaydedilemedi! Sunucu hatası.';
            errorNotification.style.cssText = 'position: fixed; bottom: 70px; right: 20px; background-color: #F44336; color: white; padding: 10px 15px; border-radius: 4px; z-index: 1000; box-shadow: 0 2px 10px rgba(0,0,0,0.2);';
            document.body.appendChild(errorNotification);
            
            // 4 saniye sonra hata bildirimini kaldır
            setTimeout(() => {
                errorNotification.style.opacity = '0';
                errorNotification.style.transition = 'opacity 0.5s';
                setTimeout(() => errorNotification.remove(), 500);
            }, 4000);
        });
        } else {
            console.log('Sadece yöneticiler ders programını kaydedebilir.');
            
            // Kullanıcıya bildirim göster
            const notification = document.createElement('div');
            notification.textContent = 'Sadece yöneticiler ders programını kaydedebilir!';
            notification.style.cssText = 'position: fixed; bottom: 70px; right: 20px; background-color: #F44336; color: white; padding: 10px 15px; border-radius: 4px; z-index: 1000; box-shadow: 0 2px 10px rgba(0,0,0,0.2);';
            document.body.appendChild(notification);
            
            // 3 saniye sonra bildirimi kaldır
            setTimeout(() => {
                notification.style.opacity = '0';
                notification.style.transition = 'opacity 0.5s';
                setTimeout(() => notification.remove(), 500);
            }, 3000);
            
            return;
        }
    }
    
    // Önbellek kontrolü için yardımcı fonksiyon
    function isDataCached(data, timestamp) {
        if (!data || !timestamp) return false;
        const now = new Date().getTime();
        return (now - timestamp) < CACHE_EXPIRY;
    }
    
    // Ödevler için fonksiyonlar
    
    // Ödevleri sunucudan çek
    function fetchHomeworks() {
        console.log('Ödevler yükleniyor...');
        
        // Yükleme göstergesini göster
        const noHomeworkMessage = document.getElementById('noHomeworkMessage');
        if (noHomeworkMessage) {
            noHomeworkMessage.style.display = 'none';
        }
        
        const homeworkCards = document.getElementById('homeworkCards');
        if (homeworkCards) {
            homeworkCards.innerHTML = '<div class="loading-indicator"><div class="spinner"></div><p>Ödevler yükleniyor...</p></div>';
        } else {
            console.error('homeworkCards elementi bulunamadı!');
            showNotification('Ödev listesi yüklenemiyor, sayfayı yenileyin!', 'error');
        }
        
        // Ödevleri sunucudan çek
        fetch('/api/homework/get')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                homeworkData = data;
                
                // Ödevleri yüklendikten sonra göster
                displayHomeworks();
                
                // Süresi 1 günden fazla geçmiş ödevleri filtreleme - sadece gösterim için
                // Sunucu tarafında zaten silme işlemi yapılıyor
                const now = new Date();
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                
                // 1 günden fazla gecikmiş ödevleri tespit et
                const overdueTasks = homeworkData.filter(homework => {
                    const dueDate = new Date(homework.dueDate);
                    return dueDate < yesterday && !homework.isCompleted;
                });
                
                // Eğer 1 günden fazla gecikmiş ödev varsa, bildir
                if (overdueTasks.length > 0) {
                    console.log(`${overdueTasks.length} adet süresi 1 günden fazla geçmiş ödev bulundu. Bu ödevler sunucu tarafından otomatik olarak silinecektir.`);
                    
                    try {
                        // Sunucuya süresi geçmiş ödevleri silme isteği gönder
                        fetch('/api/homework/cleanup', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({})  // Boş bir JSON nesnesi gönder
                        })
                        .then(response => {
                            // Önce response'un başarılı olup olmadığını kontrol edelim
                            if (!response.ok) {
                                // Sunucu hatası durumunda daha fazla bilgi almak için yanıtı json olarak almaya çalış
                                return response.json().then(err => {
                                    throw new Error(`Server error! Status: ${response.status}, Message: ${err.message || 'Bilinmeyen hata'}`);
                                }).catch(jsonErr => {
                                    // JSON çözümlenemezse orijinal hatayı fırlat
                                    throw new Error(`HTTP error! Status: ${response.status}`);
                                });
                            }
                            return response.json();
                        })
                        .then(data => {
                            if (data && data.success) {
                                console.log('Süresi geçmiş ödevler temizlendi:', data.message);
                                showNotification(`${data.message}`, 'success');
                                // Ödevleri yeniden yükle
                                fetchHomeworks();
                            } else {
                                console.error('Süresi geçmiş ödevleri temizlerken hata:', data?.message || 'Bilinmeyen hata');
                                showNotification(`Temizleme işleminde bir sorun oluştu: ${data?.message || 'Bilinmeyen hata'}`, 'error');
                                // Hata oluştuğunda bile ödevleri göstermeye devam et
                                displayHomeworks();
                            }
                        })
                        .catch(error => {
                            console.error('Süresi geçmiş ödevleri temizlerken hata:', error);
                            // Hata durumunu göster
                            showNotification('Süresi geçmiş ödevler temizlenirken hata oluştu. Lütfen sayfayı yenileyin.', 'error');
                            // Hata oluştuğunda ödevleri göster
                            displayHomeworks();
                        });
                    } catch (e) {
                        console.error('Temizleme isteği gönderilirken beklenmeyen hata:', e);
                        showNotification('Sunucu iletişim hatası. Lütfen bağlantınızı kontrol edin.', 'error');
                        // Herhangi bir hata durumunda ödevleri göstermeye devam et
                        displayHomeworks();
                    }
                }
            })
            .catch(error => {
                console.error('Ödev yükleme hatası:', error);
                showNotification('Ödevler yüklenirken bir hata oluştu!', 'error');
                
                if (homeworkCards) {
                    homeworkCards.innerHTML = '<div class="error-message">Ödevler yüklenirken bir hata oluştu! Lütfen sayfayı yenileyin.</div>';
                }
            });
    }
    
    // Ödevleri kart yapısında göster
    function displayHomeworks() {
        const homeworkCards = document.getElementById('homeworkCards');
        const noHomeworkMessage = document.getElementById('noHomeworkMessage');
        
        // Yükleniyor göstergesini gizle - önce elementin var olup olmadığını kontrol et
        const loadingIndicator = document.querySelector('.loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
        
        // Kartları temizle
        if (homeworkCards) {
            homeworkCards.innerHTML = '';
        } else {
            console.error('homeworkCards elementi bulunamadı!');
            return; // Element yoksa işlemi sonlandır
        }
        
        // noHomeworkMessage elementinin varlığını kontrol et
        if (!noHomeworkMessage) {
            console.error('noHomeworkMessage elementi bulunamadı!');
            // Element yoksa hata oluşmasını engelle ama devam et
        }
        
        if (homeworkData.length === 0) {
            // Eğer hiç ödev yoksa mesajı göster (element varsa)
            if (noHomeworkMessage) {
                noHomeworkMessage.style.display = 'block';
            }
            return;
        } else {
            // Element varsa gizle
            if (noHomeworkMessage) {
                noHomeworkMessage.style.display = 'none';
            }
        }
        
        // Her ödev için bir kart oluştur
        homeworkData.forEach(homework => {
            // Türkiye saatini kullan - saat bilgisini elle ekleyip tarihi düzgün oluştur
            const dueDate = new Date(`${homework.dueDate}T23:59:59`);
            
            // Şu anki Türkiye saatini al (daha güvenilir bir yöntemle)
            const now = new Date();
            // Türkiye saati Offset'i: UTC+3 (saat olarak 3*60*60*1000 milisaniye)
            const turkishOffset = 3 * 60 * 60 * 1000;
            // Yerel saat ile UTC arasındaki fark
            const localOffset = now.getTimezoneOffset() * 60 * 1000;
            // Türkiye saati için düzeltilmiş tarih
            const turkishNow = new Date(now.getTime() + localOffset + turkishOffset);
            
            console.log("Ödev tarihi: ", homework.dueDate, "İşlenen tarih: ", dueDate.toISOString());
            console.log("Şimdiki zaman: ", turkishNow.toISOString());
            
            // Teslim tarihi ve bugünün tarihini karşılaştırmak için tarih kısımlarını ayıkla
            const dueDateDay = dueDate.getDate();
            const dueDateMonth = dueDate.getMonth();
            const dueDateYear = dueDate.getFullYear();
            
            const todayDay = turkishNow.getDate();
            const todayMonth = turkishNow.getMonth();
            const todayYear = turkishNow.getFullYear();
            
            // Bugün teslim edilecek mi kontrol et
            const isDueToday = dueDateDay === todayDay && dueDateMonth === todayMonth && dueDateYear === todayYear;
            
            // Teslim tarihi geçmiş mi kontrol et - aynı gün değilse ve tarih geçmişse
            const isOverdue = dueDate < turkishNow && !isDueToday && !homework.isCompleted;
            
            // Duruma göre durumu belirle
            let statusClass = '';
            let statusText = '';
            
            if (homework.isCompleted) {
                statusClass = 'completed';
                statusText = 'Tamamlandı';
            } else if (isOverdue) {
                statusClass = 'overdue';
                statusText = 'Gecikmiş';
            }
            
            // Teslim tarihini formatlı göster
            const formattedDate = new Date(homework.dueDate).toLocaleDateString('tr-TR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            
            // Kalan gün sayısını hesapla - NaN sorununa karşı daha güvenli bir hesaplama
            let daysText = '';
            try {
                if (homework.isCompleted) {
                    daysText = 'Tamamlandı';
                } else if (isOverdue) {
                    const timeDiff = turkishNow.getTime() - dueDate.getTime();
                    const daysDiff = Math.ceil(Math.abs(timeDiff) / (1000 * 3600 * 24));
                    daysText = `${daysDiff} gün gecikti`;
                } else if (isDueToday) {
                    // Bugün teslim edilecekse "Bugün teslim" olarak göster
                    daysText = 'Bugün teslim';
                } else {
                    const timeDiff = dueDate.getTime() - turkishNow.getTime();
                    // Math.ceil yerine Math.floor kullanarak tam günü hesaplayalım
                    // 24 saatten az kaldıysa "1 gün kaldı" yerine "Yarın teslim" diyelim
                    const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));
                    if (daysDiff === 0) {
                        daysText = 'Yarın teslim';
                    } else {
                        daysText = `${daysDiff} gün kaldı`;
                    }
                }
            } catch (error) {
                console.error("Gün hesaplamada hata:", error);
                daysText = homework.isCompleted ? 'Tamamlandı' : 'Tarih hesaplanamadı';
            }
            
            // Başlık belirle
            const title = homework.title || homework.lesson;
            
            // Kart elementini oluştur
            const card = document.createElement('div');
            card.className = `homework-card ${statusClass}`;
            
            // Kartın içeriğini oluştur
            card.innerHTML = `
                ${statusClass ? `<div class="status-badge ${statusClass}">${statusText}</div>` : ''}
                <div class="card-header">
                    <h3 class="lesson-name">${title}</h3>
                    <span class="days-left ${statusClass ? statusClass : 'pending'}">${daysText}</span>
                </div>
                <div class="card-body">
                    <div class="lesson-info">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                        </svg>
                        <span>${homework.lesson}</span>
                    </div>
                    <div class="due-date-info">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <span>${formattedDate}</span>
                    </div>
                    <p class="description">${homework.description}</p>
                </div>
                <div class="card-footer">
                    ${isAdmin ? `
                    <button class="edit-button" data-id="${homework.id}" title="Düzenle">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="delete-button" data-id="${homework.id}" title="Sil">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                    ` : ''}
                </div>
            `;
            
            // Kartı listeye ekle
            homeworkCards.appendChild(card);
        });
        
        // Admin değilse olay dinleyicileri ekleme
        if (isAdmin) {
            // Düzenle butonlarına tıklama olayı ekle
            document.querySelectorAll('.edit-button').forEach(button => {
                button.addEventListener('click', function() {
                    const homeworkId = this.getAttribute('data-id');
                    const homework = homeworkData.find(hw => hw.id == homeworkId);
                    
                    if (homework) {
                        // Form alanlarını doldur
                        document.getElementById('editHomeworkId').value = homework.id;
                        document.getElementById('editHomeworkTitle').value = homework.title || homework.lesson;
                        document.getElementById('editHomeworkLesson').value = homework.lesson;
                        document.getElementById('editHomeworkDueDate').value = homework.dueDate;
                        document.getElementById('editHomeworkDescription').value = homework.description;
                        
                        // Düzenleme modalını göster
                        editHomeworkModal.style.display = 'flex';
                        document.getElementById('editHomeworkTitle').focus();
                    }
                });
            });
            
            // Sil butonlarına tıklama olayı ekle
            document.querySelectorAll('.delete-button').forEach(button => {
                button.addEventListener('click', function() {
                    const homeworkId = this.getAttribute('data-id');
                    const homework = homeworkData.find(hw => hw.id == homeworkId);
                    
                    if (homework) {
                        // Silme modalı içeriğini doldur
                        document.getElementById('deleteHomeworkId').value = homework.id;
                        document.getElementById('deleteHomeworkLesson').textContent = homework.lesson;
                        
                        // Tarihi formatla
                        const formattedDate = new Date(homework.dueDate).toLocaleDateString('tr-TR', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });
                        
                        document.getElementById('deleteHomeworkDueDate').textContent = formattedDate;
                        document.getElementById('deleteHomeworkDescription').textContent = homework.description;
                        
                        // Silme modalını göster
                        deleteHomeworkModal.style.display = 'flex';
                    }
                });
            });
        }
    }
    
    // Ödev modali açıldığında ödevleri yükle
    document.querySelector('.icon-item:nth-child(3)').addEventListener('click', function() {
        openModal(homeworkModal);
        fetchHomeworks();
        
        // Admin değilse "Yeni Ödev Ekle" butonunu gizle
        if (addHomeworkBtn) {
            addHomeworkBtn.style.display = isAdmin ? 'block' : 'none';
        }
    });
    
    // Ödev ekleme formunu gizle
    if (homeworkForm) {
        homeworkForm.style.display = 'none';
    }

    // Ödev Ekle butonuna tıklandığında
    if (addHomeworkBtn) {
        addHomeworkBtn.addEventListener('click', function() {
            if (!isAdmin) {
                showNotification('Sadece yöneticiler ödev ekleyebilir!', 'error');
                return;
            }
            
            // Yeni ödev ekleme modalını göster
            addHomeworkModal.style.display = 'flex';
            document.getElementById('addHomeworkLesson').focus();
        });
    }
    
    // İptal butonuna tıklandığında
    cancelHomeworkBtn.addEventListener('click', () => {
        // Formu gizle ve sıfırla
        homeworkForm.style.display = 'none';
        resetHomeworkForm();
    });
    
    // Ödev formları için event listener'lar
    const addHomeworkForm = document.getElementById('addHomeworkForm');
    const editHomeworkForm = document.getElementById('editHomeworkForm');
    const deleteHomeworkForm = document.getElementById('deleteHomeworkForm');
    
    // Yeni ödev ekleme formu gönderildiğinde
    if (addHomeworkForm) {
        addHomeworkForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            if (!isAdmin) {
                showNotification('Sadece yöneticiler ödev ekleyebilir!', 'error');
                return;
            }
            
            // Form verilerini al
            const title = document.getElementById('addHomeworkTitle').value;
            const lesson = document.getElementById('addHomeworkLesson').value;
            const dueDate = document.getElementById('addHomeworkDueDate').value;
            const description = document.getElementById('addHomeworkDescription').value;
            
            // Formun validasyonu
            if (!lesson || !dueDate || !description) {
                showNotification('Lütfen tüm alanları doldurun!', 'error');
                return;
            }
            
            // API isteği
            fetch('/api/homework/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title,
                    lesson,
                    dueDate,
                    description,
                    isCompleted: false,
                    userType: userInfo && userInfo.userType ? userInfo.userType : ""
                })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('İşlem başarısız oldu');
                }
                return response.json();
            })
            .then(data => {
                // Modalı kapat
                addHomeworkModal.style.display = 'none';
                
                // Formu temizle
                addHomeworkForm.reset();
                
                // Ödevleri yeniden yükle
                fetchHomeworks();
                
                // Bildirim göster
                showNotification('Ödev başarıyla eklendi', 'success');
            })
            .catch(error => {
                console.error('Ödev ekleme hatası:', error);
                showNotification('Ödev eklenirken bir hata oluştu!', 'error');
            });
        });
    }
    
    // Ödev düzenleme formu gönderildiğinde
    if (editHomeworkForm) {
        editHomeworkForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            if (!isAdmin) {
                showNotification('Sadece yöneticiler ödev düzenleyebilir!', 'error');
                return;
            }
            
            // Form verilerini al
            const homeworkId = document.getElementById('editHomeworkId').value;
            const title = document.getElementById('editHomeworkTitle').value;
            const lesson = document.getElementById('editHomeworkLesson').value;
            const dueDate = document.getElementById('editHomeworkDueDate').value;
            const description = document.getElementById('editHomeworkDescription').value;
            
            // Formun validasyonu
            if (!homeworkId || !lesson || !dueDate || !description) {
                showNotification('Lütfen tüm alanları doldurun!', 'error');
                return;
            }
            
            // API isteği
            fetch(`/api/homework/update/${homeworkId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title,
                    lesson,
                    dueDate,
                    description,
                    userType: userInfo && userInfo.userType ? userInfo.userType : ""
                })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('İşlem başarısız oldu');
                }
                return response.json();
            })
            .then(data => {
                // Modalı kapat
                editHomeworkModal.style.display = 'none';
                
                // Ödevleri yeniden yükle
                fetchHomeworks();
                
                // Bildirim göster
                showNotification('Ödev başarıyla güncellendi', 'success');
            })
            .catch(error => {
                console.error('Ödev güncelleme hatası:', error);
                showNotification('Ödev güncellenirken bir hata oluştu!', 'error');
            });
        });
    }
    
    // Ödev silme işlemi
    const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');
    if (deleteConfirmBtn) {
        deleteConfirmBtn.addEventListener('click', function() {
            const homeworkId = document.getElementById('deleteHomeworkId').value;
            
            if (!homeworkId) {
                showNotification('Silinecek ödev bulunamadı!', 'error');
                return;
            }
            
            // API isteği
            fetch(`/api/homework/delete/${homeworkId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userType: userInfo && userInfo.userType ? userInfo.userType : ""
                })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('İşlem başarısız oldu');
                }
                return response.json();
            })
            .then(data => {
                // Modalı kapat
                deleteHomeworkModal.style.display = 'none';
                
                // Ödevleri yeniden yükle
                fetchHomeworks();
                
                // Bildirim göster
                showNotification('Ödev başarıyla silindi', 'success');
            })
            .catch(error => {
                console.error('Ödev silme hatası:', error);
                showNotification('Ödev silinirken bir hata oluştu!', 'error');
            });
        });
    }
    
    // Yeni modaller için DOM elementleri
    const addHomeworkModal = document.getElementById('addHomeworkModal');
    const editHomeworkModal = document.getElementById('editHomeworkModal');
    const deleteHomeworkModal = document.getElementById('deleteHomeworkModal');
    
    // Modal kapatma düğmeleri için olay dinleyicileri ekle
    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // Bu düğmenin en yakın modal ebeveynini bul
            const modal = this.closest('.modal');
            if (modal) {
                modal.style.display = 'none';
            }
        });
    });
    
    // Modal dışına tıklandığında kapat
    window.addEventListener('click', (e) => {
        document.querySelectorAll('.modal').forEach(modal => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    });
    
    // Klavye ESC tuşu ile modalı kapatma
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal[style*="display: flex"]').forEach(modal => {
                modal.style.display = 'none';
            });
        }
    });
    
    // Ödev formunu sıfırla
    function resetHomeworkForm() {
        document.getElementById('homeworkId').value = '';
        document.getElementById('homeworkLesson').value = '';
        document.getElementById('homeworkDueDate').value = '';
        document.getElementById('homeworkDescription').value = '';
        editingHomeworkId = null;
    }
    
    // Bildirim gösterme fonksiyonu
    function showNotification(message, type) {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            background-color: ${type === 'success' ? '#4CAF50' : '#F44336'};
            color: white;
            padding: 10px 15px;
            border-radius: 4px;
            z-index: 1000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        `;
        
        document.body.appendChild(notification);
        
        // 3 saniye sonra bildirimi kaldır
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.5s';
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }

    // Duyuru yönetimi ile ilgili kodlar
    // Modal elementlerini seç
    // announcementsModal zaten tanımlandı, tekrar tanımlamıyoruz
    const addAnnouncementModal = document.getElementById('addAnnouncementModal');
    const editAnnouncementModal = document.getElementById('editAnnouncementModal');
    const deleteAnnouncementModal = document.getElementById('deleteAnnouncementModal');
    
    // Butonları seç - addAnnouncementBtn zaten tanımlandı, tekrar tanımlamıyoruz
    const deleteAnnouncementBtn = document.getElementById('deleteAnnouncementBtn');
    
    // Duyuru verilerini tutacak değişken
    let announcementData = [];
    
    // Yeni duyuru ekleme butonuna tıklandığında
    if (addAnnouncementBtn) {
        addAnnouncementBtn.addEventListener('click', function() {
            // Duyuru ekleme modalını göster
            addAnnouncementModal.style.display = 'flex';
            document.getElementById('addAnnouncementTitle').focus();
        });
    }
    
    // Modal kapatma butonları
    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(button => {
        button.addEventListener('click', function() {
            // En yakın modal elementini bul ve kapat
            const modal = this.closest('.modal');
            if (modal) modal.style.display = 'none';
        });
    });
    
    // Tıklanan yerin dışındaki modallarda kapat
    window.addEventListener('click', function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    });
    
    // Klavye ESC tuşu ile modalı kapatma
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal[style*="display: flex"]').forEach(modal => {
                modal.style.display = 'none';
            });
        }
    });
    
    // Ödev formunu sıfırla
    function resetAnnouncementForm() {
        document.getElementById('announcementId').value = '';
        document.getElementById('announcementTitle').value = '';
        document.getElementById('announcementContent').value = '';
        document.getElementById('announcementImportance').value = 'normal';
        editingAnnouncementId = null;
    }
    
    // Duyuruları sunucudan çek
    function fetchAnnouncements() {
        // Yükleniyor göstergesini görünür yap, element varlığını kontrol ederek
        const loadingIndicator = announcementsModal.querySelector('.loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'flex';
        }
        
        const noAnnouncementMessage = document.getElementById('noAnnouncementMessage');
        if (noAnnouncementMessage) {
            noAnnouncementMessage.style.display = 'none';
        }
        
        const announcementCards = document.getElementById('announcementCards');
        if (announcementCards) {
            announcementCards.innerHTML = '<div class="loading-indicator"><div class="spinner"></div><p>Duyurular yükleniyor...</p></div>';
        } else {
            console.error('announcementCards elementi bulunamadı!');
            showNotification('Duyurular yüklenemiyor, sayfayı yenileyin!', 'error');
            return;
        }
        
        fetchWithTokenCheck('/api/announcements/get')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Sunucu hatası: ' + response.status);
                }
                return response.json();
            })
            .then(data => {
                console.log('Duyurular başarıyla yüklendi:', data);
                announcementData = data;
                displayAnnouncements(); // Parametre olmadan çağır
            })
            .catch(error => {
                console.error('Duyuru yükleme hatası:', error);
                showNotification('Duyurular yüklenirken bir hata oluştu!', 'error');
                
                if (announcementCards) {
                    announcementCards.innerHTML = '<div class="error-message">Duyurular yüklenirken bir hata oluştu!</div>';
                }
            });
    }
    
    // Duyuruları görüntüle
    function displayAnnouncements() {
        const announcementsContainer = document.getElementById('announcementsContainer');
        // announcementsContainer yoksa, önceki yöntemle devam et
        if (!announcementsContainer) {
            // Eski koddan gelen dökümanı kullan
            const announcementCards = document.getElementById('announcementCards');
            const noAnnouncementMessage = document.getElementById('noAnnouncementMessage');
            
            // Yükleniyor göstergesini gizle
            const loadingIndicator = announcementsModal.querySelector('.loading-indicator');
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
            
            // Kartları temizle
            if (announcementCards) {
                announcementCards.innerHTML = '';
            } else {
                console.error('announcementCards elementi bulunamadı!');
                return; // Element yoksa işlemi sonlandır
            }
            
            // noAnnouncementMessage kontrolü
            if (!noAnnouncementMessage) {
                console.error('noAnnouncementMessage elementi bulunamadı!');
            }
            
            if (announcementData.length === 0) {
                // Eğer hiç duyuru yoksa mesajı göster
                if (noAnnouncementMessage) {
                    noAnnouncementMessage.style.display = 'block';
                }
                return;
            } else {
                // Element varsa gizle
                if (noAnnouncementMessage) {
                    noAnnouncementMessage.style.display = 'none';
                }
            }
            
            // Her duyuru için bir kart oluştur
            announcementData.forEach(announcement => {
                try {
                    // Tarih formatını düzelt (Türkiye saati olarak)
                    let createdDateStr = announcement.createdAt || new Date().toISOString();
                    let updatedDateStr = announcement.updatedAt || new Date().toISOString();
                    
                    // Tarihlerin geçerli olup olmadığını kontrol et
                    const isValidDate = (dateStr) => {
                        return dateStr && !isNaN(new Date(dateStr).getTime());
                    };
                    
                    // Geçerli tarihler için işlem yap, değilse bugünün tarihini kullan
                    let createdDate = isValidDate(createdDateStr) ? new Date(createdDateStr) : new Date();
                    let updatedDate = isValidDate(updatedDateStr) ? new Date(updatedDateStr) : new Date();
                    
                    // Türkiye saati için düzeltme (+3 saat)
                    // Türkiye saati Offset'i: UTC+3 (saat olarak 3*60*60*1000 milisaniye)
                    const turkishOffset = 3 * 60 * 60 * 1000;
                    // Yerel saat ile UTC arasındaki fark
                    const localOffset = new Date().getTimezoneOffset() * 60 * 1000;
                    
                    // Türkiye saati için düzeltilmiş tarihler
                    let turkishCreatedDate = new Date(createdDate.getTime() + localOffset + turkishOffset);
                    let turkishUpdatedDate = new Date(updatedDate.getTime() + localOffset + turkishOffset);
                    
                    // Hangisini göstereceğimizi belirle
                    let displayDate = turkishCreatedDate;
                    let datePrefix = "Oluşturulma: ";
                    
                    // Eğer güncelleme tarihi, oluşturma tarihinden farklıysa ve geçerliyse
                    if (turkishUpdatedDate > turkishCreatedDate && !isNaN(turkishUpdatedDate.getTime())) {
                        displayDate = turkishUpdatedDate;
                        datePrefix = "Güncelleme: ";
                    }
                    
                    // Tarihi formatla - doğrudan Türkçe formatında göster
                    let dateStr = datePrefix + displayDate.toLocaleString('tr-TR', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Europe/Istanbul' // Türkiye saat dilimini belirt
                    });
                    
                    // Kart elementini oluştur
                    const card = document.createElement('div');
                    
                    // Önem durumuna göre sınıf ekle
                    let importanceClass = '';
                    
                    if (announcement.importance === 'critical') {
                        importanceClass = 'critical';
                    } else if (announcement.importance === 'important' || announcement.important == 1) {
                        importanceClass = 'important';
                    }
                    
                    card.className = `announcement-card ${importanceClass}`;
                    
                    card.innerHTML = `
                        <div class="card-header">
                            <h3 class="announcement-title">${announcement.title}</h3>
                            <span class="date">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                                ${dateStr}
                            </span>
                        </div>
                        <div class="card-body">
                            <div class="content">${announcement.content}</div>
                            ${announcement.eventDate ? `
                            <div class="event-date">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                    <line x1="16" y1="2" x2="16" y2="6"></line>
                                    <line x1="8" y1="2" x2="8" y2="6"></line>
                                    <line x1="3" y1="10" x2="21" y2="10"></line>
                                </svg>
                                <div class="event-date-content">
                                ${(() => {
                                    try {
                                        const eventDate = new Date(announcement.eventDate);
                                        if (isNaN(eventDate.getTime())) {
                                            return announcement.eventDate;
                                        }
                                        return eventDate.toLocaleDateString('tr-TR', {
                                            day: 'numeric',
                                            month: 'long',
                                            year: 'numeric',
                                            timeZone: 'Europe/Istanbul'
                                        });
                                    } catch (error) {
                                        console.error('Etkinlik tarihi dönüştürme hatası:', error);
                                        return announcement.eventDate;
                                    }
                                })()}
                                </div>
                            </div>
                            ` : ''}
                        </div>
                        <div class="card-footer">
                            ${userInfo && userInfo.userType === 'admin' ? `
                            <button class="edit-button edit-announcement-btn" data-id="${announcement.id}" title="Düzenle">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                            </button>
                            <button class="delete-button delete-announcement-btn" data-id="${announcement.id}" title="Sil">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                    <line x1="10" y1="11" x2="10" y2="17"></line>
                                    <line x1="14" y1="11" x2="14" y2="17"></line>
                                </svg>
                            </button>
                            ` : ''}
                        </div>
                    `;
                    
                    announcementCards.appendChild(card);
                    
                    // Düzenleme butonlarına tıklama olayı ekle
                    if (userInfo && userInfo.userType === 'admin') {
                        const editButtons = card.querySelectorAll('.edit-announcement-btn');
                        editButtons.forEach(button => {
                            button.addEventListener('click', function() {
                                const announcementId = this.getAttribute('data-id');
                                const currentAnnouncement = announcementData.find(a => a.id == announcementId);
                                
                                if (currentAnnouncement) {
                                    // Form alanlarını doldur
                                    document.getElementById('editAnnouncementId').value = currentAnnouncement.id;
                                    document.getElementById('editAnnouncementTitle').value = currentAnnouncement.title;
                                    document.getElementById('editAnnouncementContent').value = currentAnnouncement.content;
                                    
                                    // Etkinlik tarihini doldur (varsa)
                                    const eventDateInput = document.getElementById('editAnnouncementEventDate');
                                    if (eventDateInput && currentAnnouncement.eventDate) {
                                        try {
                                            // Tarih formatını YYYY-MM-DD formatına dönüştür (input type="date" için)
                                            const eventDate = new Date(currentAnnouncement.eventDate);
                                            if (!isNaN(eventDate.getTime())) {
                                                // ISO formatından sadece tarih kısmını al (YYYY-MM-DD)
                                                eventDateInput.value = eventDate.toISOString().split('T')[0];
                                            } else {
                                                eventDateInput.value = '';
                                            }
                                        } catch (error) {
                                            console.error('Etkinlik tarihi dönüştürülürken hata:', error);
                                            eventDateInput.value = '';
                                        }
                                    } else if (eventDateInput) {
                                        eventDateInput.value = '';
                                    }
                                    
                                    // Önem durumunu seç
                                    const importanceSelect = document.getElementById('editAnnouncementImportance');
                                    if (importanceSelect) {
                                        // Veritabanında eski değer varsa uyumlu hale getir
                                        if (currentAnnouncement.importance) {
                                            importanceSelect.value = currentAnnouncement.importance;
                                        } else if (currentAnnouncement.important == 1) {
                                            importanceSelect.value = 'important';
                                        } else {
                                            importanceSelect.value = 'normal';
                                        }
                                    }
                                    
                                    // Düzenleme modalını göster
                                    editAnnouncementModal.style.display = 'flex';
                                }
                            });
                        });
                        
                        // Silme butonlarına tıklama olayı ekle
                        const deleteButtons = card.querySelectorAll('.delete-announcement-btn');
                        deleteButtons.forEach(button => {
                            button.addEventListener('click', function() {
                                const announcementId = this.getAttribute('data-id');
                                const currentAnnouncement = announcementData.find(a => a.id == announcementId);
                                
                                if (currentAnnouncement) {
                                    // Silme modalı içeriğini doldur
                                    document.getElementById('deleteAnnouncementId').value = currentAnnouncement.id;
                                    document.getElementById('deleteAnnouncementTitle').textContent = currentAnnouncement.title;
                                    document.getElementById('deleteAnnouncementContent').textContent = currentAnnouncement.content;
                                    
                                    // Silme modalını göster
                                    deleteAnnouncementModal.style.display = 'flex';
                                }
                            });
                        });
                    }
                } catch (error) {
                    console.error('Duyuru işlenirken hata oluştu:', error, announcement);
                }
            });
            
            return;
        }
        
        // Yeni container yöntemini kullan
        announcementsContainer.innerHTML = '';
        
        if (announcementData.length === 0) {
            announcementsContainer.innerHTML = '<p>Henüz duyuru bulunmamaktadır.</p>';
            return;
        }
        
        announcementData.forEach(announcement => {
            try {
                // Tarih formatını düzelt (Türkiye saati olarak)
                let createdDateStr = announcement.createdAt || new Date().toISOString();
                let updatedDateStr = announcement.updatedAt || new Date().toISOString();
                
                // Tarihlerin geçerli olup olmadığını kontrol et
                const isValidDate = (dateStr) => {
                    return dateStr && !isNaN(new Date(dateStr).getTime());
                };
                
                // Geçerli tarihler için işlem yap, değilse bugünün tarihini kullan
                let createdDate = isValidDate(createdDateStr) ? new Date(createdDateStr) : new Date();
                let updatedDate = isValidDate(updatedDateStr) ? new Date(updatedDateStr) : new Date();
                
                // Türkiye saati için düzeltme (+3 saat)
                // Türkiye saati Offset'i: UTC+3 (saat olarak 3*60*60*1000 milisaniye)
                const turkishOffset = 3 * 60 * 60 * 1000;
                // Yerel saat ile UTC arasındaki fark
                const localOffset = new Date().getTimezoneOffset() * 60 * 1000;
                
                // Türkiye saati için düzeltilmiş tarihler
                let turkishCreatedDate = new Date(createdDate.getTime() + localOffset + turkishOffset);
                let turkishUpdatedDate = new Date(updatedDate.getTime() + localOffset + turkishOffset);
                
                // Hangisini göstereceğimizi belirle
                let displayDate = turkishCreatedDate;
                let datePrefix = "Oluşturulma: ";
                
                // Eğer güncelleme tarihi, oluşturma tarihinden farklıysa ve geçerliyse
                if (turkishUpdatedDate > turkishCreatedDate && !isNaN(turkishUpdatedDate.getTime())) {
                    displayDate = turkishUpdatedDate;
                    datePrefix = "Güncelleme: ";
                }
                
                // Tarihi formatla - doğrudan Türkçe formatında göster
                let dateStr = datePrefix + displayDate.toLocaleString('tr-TR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Europe/Istanbul' // Türkiye saat dilimini belirt
                });
                
                // Kart elementini oluştur
                const card = document.createElement('div');
                
                // Önem durumuna göre sınıf ekle
                let importanceClass = '';
                
                if (announcement.importance === 'critical') {
                    importanceClass = 'critical';
                } else if (announcement.importance === 'important' || announcement.important == 1) {
                    importanceClass = 'important';
                }
                
                card.className = `announcement-card ${importanceClass}`;
                
                card.innerHTML = `
                    <div class="card-header">
                        <h3 class="announcement-title">${announcement.title}</h3>
                        <span class="date">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            ${dateStr}
                        </span>
                    </div>
                    <div class="card-body">
                        <div class="content">${announcement.content}</div>
                        ${announcement.eventDate ? `
                        <div class="event-date">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                <line x1="16" y1="2" x2="16" y2="6"></line>
                                <line x1="8" y1="2" x2="8" y2="6"></line>
                                <line x1="3" y1="10" x2="21" y2="10"></line>
                            </svg>
                            <div class="event-date-content">
                            ${(() => {
                                try {
                                    const eventDate = new Date(announcement.eventDate);
                                    if (isNaN(eventDate.getTime())) {
                                        return announcement.eventDate;
                                    }
                                    return eventDate.toLocaleDateString('tr-TR', {
                                        day: 'numeric',
                                        month: 'long',
                                        year: 'numeric',
                                        timeZone: 'Europe/Istanbul'
                                    });
                                } catch (error) {
                                    console.error('Etkinlik tarihi dönüştürme hatası:', error);
                                    return announcement.eventDate;
                                }
                            })()}
                            </div>
                        </div>
                        ` : ''}
                    </div>
                    <div class="card-footer">
                        ${userInfo && userInfo.userType === 'admin' ? `
                        <button class="edit-button edit-announcement-btn" data-id="${announcement.id}" title="Düzenle">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="delete-button delete-announcement-btn" data-id="${announcement.id}" title="Sil">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                        </button>
                        ` : ''}
                    </div>
                `;
                
                announcementsContainer.appendChild(card);
                
                // Düzenleme butonlarına tıklama olayı ekle
                if (userInfo.userType === 'admin') {
                    const editButtons = card.querySelectorAll('.edit-announcement-btn');
                    editButtons.forEach(button => {
                        button.addEventListener('click', function() {
                            const announcementId = this.getAttribute('data-id');
                            const currentAnnouncement = announcementData.find(a => a.id == announcementId);
                            
                            if (currentAnnouncement) {
                                // Form alanlarını doldur
                                document.getElementById('editAnnouncementId').value = currentAnnouncement.id;
                                document.getElementById('editAnnouncementTitle').value = currentAnnouncement.title;
                                document.getElementById('editAnnouncementContent').value = currentAnnouncement.content;
                                
                                // Önem durumunu seç
                                const importanceSelect = document.getElementById('editAnnouncementImportance');
                                if (importanceSelect) {
                                    // Veritabanında eski değer varsa uyumlu hale getir
                                    if (currentAnnouncement.importance) {
                                        importanceSelect.value = currentAnnouncement.importance;
                                    } else if (currentAnnouncement.important == 1) {
                                        importanceSelect.value = 'important';
                                    } else {
                                        importanceSelect.value = 'normal';
                                    }
                                }
                                
                                // Düzenleme modalını göster
                                editAnnouncementModal.style.display = 'flex';
                            }
                        });
                    });
                    
                    // Silme butonlarına tıklama olayı ekle
                    const deleteButtons = card.querySelectorAll('.delete-announcement-btn');
                    deleteButtons.forEach(button => {
                        button.addEventListener('click', function() {
                            const announcementId = this.getAttribute('data-id');
                            const currentAnnouncement = announcementData.find(a => a.id == announcementId);
                            
                            if (currentAnnouncement) {
                                // Silme modalı içeriğini doldur
                                document.getElementById('deleteAnnouncementId').value = currentAnnouncement.id;
                                document.getElementById('deleteAnnouncementTitle').textContent = currentAnnouncement.title;
                                document.getElementById('deleteAnnouncementContent').textContent = currentAnnouncement.content;
                                
                                // Silme modalını göster
                                deleteAnnouncementModal.style.display = 'flex';
                            }
                        });
                    });
                }
            } catch (error) {
                console.error('Duyuru işlenirken hata oluştu:', error, announcement);
            }
        });
    }
    
    // Yeni duyuru ekleme formu gönderildiğinde
    if (addAnnouncementForm) {
        addAnnouncementForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            if (!isAdmin) {
                showNotification('Sadece yöneticiler duyuru ekleyebilir!', 'error');
                return;
            }
            
            // Form verilerini al
            const title = document.getElementById('addAnnouncementTitle').value;
            const content = document.getElementById('addAnnouncementContent').value;
            const importance = document.getElementById('addAnnouncementImportance').value;
            const eventDate = document.getElementById('addAnnouncementEventDate').value;
            
            // Formun validasyonu
            if (!title || !content) {
                showNotification('Lütfen tüm alanları doldurun!', 'error');
                return;
            }
            
            // API isteği
            fetch('/api/announcements/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title,
                    content,
                    importance,
                    eventDate: eventDate || null,
                    userType: userInfo && userInfo.userType ? userInfo.userType : ""
                })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('İşlem başarısız oldu');
                }
                return response.json();
            })
            .then(data => {
                // Modalı kapat
                addAnnouncementModal.style.display = 'none';
                
                // Formu temizle
                addAnnouncementForm.reset();
                
                // Duyuruları yeniden yükle
                fetchAnnouncements();
                
                // Bildirim göster
                showNotification('Duyuru başarıyla eklendi', 'success');
            })
            .catch(error => {
                console.error('Duyuru ekleme hatası:', error);
                showNotification('Duyuru eklenirken bir hata oluştu!', 'error');
            });
        });
    }
    
    // Duyuru düzenleme formu gönderildiğinde
    if (editAnnouncementForm) {
        editAnnouncementForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            if (!isAdmin) {
                showNotification('Sadece yöneticiler duyuru düzenleyebilir!', 'error');
                return;
            }
            
            // Form verilerini al
            const announcementId = document.getElementById('editAnnouncementId').value;
            const title = document.getElementById('editAnnouncementTitle').value;
            const content = document.getElementById('editAnnouncementContent').value;
            const importance = document.getElementById('editAnnouncementImportance').value;
            const eventDate = document.getElementById('editAnnouncementEventDate').value;
            
            // Formun validasyonu
            if (!announcementId || !title || !content) {
                showNotification('Lütfen tüm alanları doldurun!', 'error');
                return;
            }
            
            // API isteği
            fetch(`/api/announcements/update/${announcementId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title,
                    content,
                    importance,
                    eventDate: eventDate || null,
                    userType: userInfo && userInfo.userType ? userInfo.userType : ""
                })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('İşlem başarısız oldu');
                }
                return response.json();
            })
            .then(data => {
                // Modalı kapat
                editAnnouncementModal.style.display = 'none';
                
                // Duyuruları yeniden yükle
                fetchAnnouncements();
                
                // Bildirim göster
                showNotification('Duyuru başarıyla güncellendi', 'success');
            })
            .catch(error => {
                console.error('Duyuru güncelleme hatası:', error);
                showNotification('Duyuru güncellenirken bir hata oluştu!', 'error');
            });
        });
    }
    
    // Duyuru silme işlemi
    if (deleteAnnouncementBtn) {
        deleteAnnouncementBtn.addEventListener('click', function() {
            const announcementId = document.getElementById('deleteAnnouncementId').value;
            
            if (!announcementId) {
                showNotification('Silinecek duyuru bulunamadı!', 'error');
                return;
            }
            
            // API isteği
            fetch(`/api/announcements/delete/${announcementId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userType: userInfo && userInfo.userType ? userInfo.userType : ""
                })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('İşlem başarısız oldu');
                }
                return response.json();
            })
            .then(data => {
                // Modalı kapat
                deleteAnnouncementModal.style.display = 'none';
                
                // Duyuruları yeniden yükle
                fetchAnnouncements();
                
                // Bildirim göster
                showNotification('Duyuru başarıyla silindi', 'success');
            })
            .catch(error => {
                console.error('Duyuru silme hatası:', error);
                showNotification('Duyuru silinirken bir hata oluştu!', 'error');
            });
        });
    }

    // Sınav Notları Modal İşlevleri
    const gradesIconBtn = document.getElementById('gradesIconBtn');
    const gradesModal = document.getElementById('gradesModal');
    const addGradeBtn = document.getElementById('addGradeBtn');
    const addGradeModal = document.getElementById('addGradeModal');
    const editGradeModal = document.getElementById('editGradeModal');
    const deleteGradeModal = document.getElementById('deleteGradeModal');
    
    let grades = [];
    
    // Event Listeners
    if (gradesIconBtn) {
        gradesIconBtn.addEventListener('click', function() {
            openModal(gradesModal);
            fetchGrades();
        });
    }
    
    if (addGradeBtn) {
        // Sadece admin kullanıcılar için ekleme butonunu göster
        if (isAdmin) {
        addGradeBtn.addEventListener('click', function() {
            resetGradeForm();
            openModal(addGradeModal);
        });
        } else {
            addGradeBtn.style.display = 'none';
        }
    }
    
    // Form event listeners - Kullanılabilir olmasını sağlamak için bu kısmı kaldıralım
    // document.addEventListener('DOMContentLoaded', function() {
    const addGradeForm = document.getElementById('addGradeForm');
    if (addGradeForm) {
        addGradeForm.addEventListener('submit', function(e) {
            e.preventDefault();
            addNewGrade();
        });
    }
    
    const editGradeForm = document.getElementById('editGradeForm');
    if (editGradeForm) {
        editGradeForm.addEventListener('submit', function(e) {
            e.preventDefault();
            updateGrade();
        });
    }
    
    const deleteGradeBtn = document.getElementById('deleteGradeBtn');
    if (deleteGradeBtn) {
        deleteGradeBtn.addEventListener('click', function() {
            deleteGrade();
        });
    }
    
    // Modal kapatma butonları
    const closeModalBtns = document.querySelectorAll('.close-modal-btn');
    closeModalBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            // En yakın modal elementini bul ve kapat
            const modal = this.closest('.modal');
            if (modal) {
                closeModal(modal);
            }
        });
    });
    // });

    // Sınav notlarını getir
    function fetchGrades() {
        const gradeCardsEl = document.getElementById('gradeCards');
        const noGradeMessage = document.getElementById('noGradeMessage');
        
        if (gradeCardsEl) {
            // Yükleme göstergesini göster
            gradeCardsEl.innerHTML = `
                <div class="loading-indicator">
                    <div class="spinner"></div>
                    <p>Sınav notları yükleniyor...</p>
                </div>
            `;
            
            // API'den notların meta verilerini al (dosya içeriği olmadan)
            fetch('/api/grades/get?meta_only=true')
                .then(response => response.json())
                .then(data => {
                    // Önbelleğe kaydet
                    grades = data;
                    cachedGrades = data;
                    gradesCacheTimestamp = new Date().getTime();
                    console.log('Sınav notları meta verileri yüklendi:', data.length);
                    
                    displayGrades();
                })
                .catch(error => {
                    console.error('Sınav notları yüklenirken hata:', error);
                    gradeCardsEl.innerHTML = `
                        <div class="error-message">
                            <p>Sınav notları yüklenirken bir hata oluştu. Lütfen sayfayı yenileyip tekrar deneyin.</p>
                        </div>
                    `;
                });
        }
    }
    
    // Sınav notlarını görüntüle
    function displayGrades() {
        const gradeCardsEl = document.getElementById('gradeCards');
        const noGradeMessage = document.getElementById('noGradeMessage');
        
        if (gradeCardsEl && noGradeMessage) {
            if (grades.length === 0) {
                gradeCardsEl.innerHTML = '';
                noGradeMessage.style.display = 'block';
            } else {
                noGradeMessage.style.display = 'none';
                
                let gradesHTML = '';
                grades.forEach(grade => {
                    // Tür için renk sınıfı belirleme
                    let typeClass = '';
                    switch(grade.type) {
                        case 'Konu Özeti':
                            typeClass = 'excellent';
                            break;
                        case 'Formüller':
                            typeClass = 'good';
                            break;
                        case 'Soru Çözümü':
                            typeClass = 'average';
                            break;
                        case 'Kaynak Önerisi':
                            typeClass = 'below-average';
                            break;
                        case 'Pratik Bilgi':
                            typeClass = 'poor';
                            break;
                        default:
                            typeClass = 'average';
                    }
                    
                    // Tarih formatı düzenleme
                    const examDate = new Date(grade.examDate);
                    const formattedDate = examDate.toLocaleDateString('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    });
                    
                    // Dosya ikonu ve indirme butonu
                    let fileHtml = '';
                    if (grade.file_name) {
                        // Dosya uzantısına göre ikon sınıfı belirle
                        const fileExt = grade.file_name.split('.').pop().toLowerCase();
                        let fileIconClass = 'other';
                        
                        if (['pdf'].includes(fileExt)) {
                            fileIconClass = 'pdf';
                        } else if (['doc', 'docx'].includes(fileExt)) {
                            fileIconClass = 'doc';
                        } else if (['xls', 'xlsx', 'csv'].includes(fileExt)) {
                            fileIconClass = 'excel';
                        } else if (['ppt', 'pptx'].includes(fileExt)) {
                            fileIconClass = 'ppt';
                        } else if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(fileExt)) {
                            fileIconClass = 'image';
                        }
                        
                        fileHtml = `
                            <div class="grade-file">
                                <div class="file-icon ${fileIconClass}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                                        <polyline points="13 2 13 9 20 9"></polyline>
                                    </svg>
                                </div>
                                <span class="file-name">${grade.file_name}</span>
                                <button class="grade-download-btn" data-id="${grade.id}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4"></path>
                                        <polyline points="7 10 12 15 17 10"></polyline>
                                        <line x1="12" y1="15" x2="12" y2="3"></line>
                                    </svg>
                                    İndir
                                </button>
                            </div>
                        `;
                    }
                    
                    gradesHTML += `
                        <div class="grade-card" data-id="${grade.id}">
                            <div class="card-header">
                                <h3 class="student-name">${grade.title}</h3>
                                <div class="exam-date">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                        <line x1="16" y1="2" x2="16" y2="6"></line>
                                        <line x1="8" y1="2" x2="8" y2="6"></line>
                                        <line x1="3" y1="10" x2="21" y2="10"></line>
                                    </svg>
                                    ${formattedDate}
                                </div>
                            </div>
                            <div class="card-body">
                                <div class="grade-info">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                    </svg>
                                    <span>${grade.lesson}</span>
                                </div>
                                <div class="grade-info">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                                    </svg>
                                    <span>${grade.type}</span>
                                </div>
                                ${fileHtml}
                            </div>
                            <div class="card-footer">
                                <span class="grade-score ${typeClass}">${grade.type}</span>
                                ${isAdmin ? `<div class="action-buttons">
                                    <button class="edit-button" onclick="editGradeItem(${grade.id})">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                        </svg>
                                    </button>
                                    <button class="delete-button" onclick="deleteGradeItem(${grade.id})">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <polyline points="3 6 5 6 21 6"></polyline>
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                            <line x1="10" y1="11" x2="10" y2="17"></line>
                                            <line x1="14" y1="11" x2="14" y2="17"></line>
                                        </svg>
                                    </button>
                                </div>` : ''}
                            </div>
                        </div>
                    `;
                });
                
                gradeCardsEl.innerHTML = gradesHTML;
                
                // İndirme butonları için event listener ekle
                document.querySelectorAll('.grade-download-btn').forEach(button => {
                    button.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        const gradeId = this.getAttribute('data-id');
                        downloadGradeFile(gradeId);
                    });
                });
                
                // Düzenleme ve silme butonları için event listener'ları ekleyelim
                document.querySelectorAll('.grade-card .edit-button').forEach(button => {
                    button.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        const gradeId = parseInt(this.closest('.grade-card').dataset.id);
                        editGradeItem(gradeId);
                    });
                });
                
                document.querySelectorAll('.grade-card .delete-button').forEach(button => {
                    button.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        const gradeId = parseInt(this.closest('.grade-card').dataset.id);
                        deleteGradeItem(gradeId);
                    });
                });
            }
        }
    }
    
    // Dosya indirme fonksiyonu
    function downloadGradeFile(gradeId) {
        console.log('Dosya indiriliyor:', gradeId);
        
        // İndirme URL'sini oluştur
        const downloadUrl = `/api/grades/download/${gradeId}`;
        
        // Yeni sekme açılması yerine doğrudan indirme
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = ''; // Sunucu adını belirleyecek
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        
        // Temizlik
        setTimeout(() => {
            document.body.removeChild(link);
        }, 100);
    }
    
    // Not düzenleme modal'ını aç
    function editGradeItem(gradeId) {
        console.log("editGradeItem fonksiyonu çağrıldı, ID:", gradeId);
        const grade = grades.find(g => g.id === gradeId);
        if (grade) {
            document.getElementById('editGradeId').value = grade.id;
            document.getElementById('editGradeTitle').value = grade.title || '';
            document.getElementById('editGradeLesson').value = grade.lesson || '';
            document.getElementById('editGradeType').value = grade.type || '';
            
            // Sınav tarihini uygun formata çevir
            const examDate = new Date(grade.examDate);
            if (!isNaN(examDate.getTime())) {
                // YYYY-MM-DD formatına çevir
                const year = examDate.getFullYear();
                const month = String(examDate.getMonth() + 1).padStart(2, '0');
                const day = String(examDate.getDate()).padStart(2, '0');
                document.getElementById('editGradeDate').value = `${year}-${month}-${day}`;
            } else {
                // Geçerli bir tarih değilse bugünün tarihini kullan
                document.getElementById('editGradeDate').value = new Date().toISOString().split('T')[0];
            }
            
            // Mevcut dosya bilgisini göster
            const existingFileEl = document.getElementById('editGradeExistingFile');
            const existingFileNameEl = document.getElementById('editGradeExistingFileName');
            const keepExistingFileEl = document.getElementById('editGradeKeepExistingFile');
            
            if (grade.file_name) {
                existingFileEl.style.display = 'flex';
                existingFileNameEl.textContent = grade.file_name;
                keepExistingFileEl.value = 'true';
                
                // Dosya görüntüleme butonu
                const viewFileBtn = document.getElementById('editGradeViewFileBtn');
                viewFileBtn.onclick = function() {
                    window.open(`/uploads/${grade.file_path}`, '_blank');
                };
                
                // Dosya kaldırma butonu
                const removeFileBtn = document.getElementById('editGradeRemoveFileBtn');
                removeFileBtn.onclick = function() {
                    existingFileEl.style.display = 'none';
                    keepExistingFileEl.value = 'false';
                };
            } else {
                existingFileEl.style.display = 'none';
                keepExistingFileEl.value = 'false';
            }
            
            openModal(editGradeModal);
        } else {
            console.error("Sınav notu bulunamadı:", gradeId);
            showNotification("Sınav notu bulunamadı", "error");
        }
    }
    
    // Not silme modal'ını aç
    function deleteGradeItem(gradeId) {
        console.log("deleteGradeItem fonksiyonu çağrıldı, ID:", gradeId);
        const grade = grades.find(g => g.id === gradeId);
        if (grade) {
            document.getElementById('deleteGradeId').value = grade.id;
            document.getElementById('deleteGradeTitle').textContent = grade.title || 'İsimsiz Not';
            document.getElementById('deleteGradeLesson').textContent = grade.lesson || 'Belirtilmemiş';
            document.getElementById('deleteGradeType').textContent = grade.type || 'Belirtilmemiş';
            
            // Tarih formatı düzenleme
            const examDate = new Date(grade.examDate);
            let formattedDate = "Belirtilmemiş";
            if (!isNaN(examDate.getTime())) {
                formattedDate = examDate.toLocaleDateString('tr-TR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            }
            document.getElementById('deleteGradeDate').textContent = formattedDate;
            
            openModal(deleteGradeModal);
        } else {
            console.error("Silinecek sınav notu bulunamadı:", gradeId);
            showNotification("Silinecek sınav notu bulunamadı", "error");
        }
    }
    
    // Yeni not ekle
    function addNewGrade() {
        const title = document.getElementById('addGradeTitle').value;
        const lesson = document.getElementById('addGradeLesson').value;
        const type = document.getElementById('addGradeType').value;
        const examDate = document.getElementById('addGradeDate').value;
        const fileInput = document.getElementById('addGradeFile');
        
        if (!title || !lesson || !type || !examDate) {
            showNotification('Lütfen tüm alanları doldurun.', 'error');
            return;
        }
        
        // FormData kullanarak dosya ve diğer verileri gönder
        const formData = new FormData();
        formData.append('title', title);
        formData.append('lesson', lesson);
        formData.append('type', type);
        formData.append('examDate', examDate);
        formData.append('userType', userInfo.userType); // Kullanıcının gerçek tipini gönder
        
        // Dosya varsa ekle
        if (fileInput.files.length > 0) {
            formData.append('file', fileInput.files[0]);
        }
        
        console.log('Gönderilen userType:', userInfo.userType);
        
        fetch('/api/grades/add', {
            method: 'POST',
            body: formData // FormData ile gönder, headers belirtme
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                closeModal(addGradeModal);
                resetGradeForm();
                showNotification('Çalışma notu başarıyla eklendi.', 'success');
                fetchGrades();
            } else {
                showNotification(data.error || 'Çalışma notu eklenirken bir hata oluştu.', 'error');
            }
        })
        .catch(error => {
            console.error('Çalışma notu eklenirken hata:', error);
            showNotification('Çalışma notu eklenirken bir hata oluştu.', 'error');
        });
    }
    
    // Not güncelle
    function updateGrade() {
        const gradeId = document.getElementById('editGradeId').value;
        const title = document.getElementById('editGradeTitle').value;
        const lesson = document.getElementById('editGradeLesson').value;
        const type = document.getElementById('editGradeType').value;
        const examDate = document.getElementById('editGradeDate').value;
        const keepExistingFile = document.getElementById('editGradeKeepExistingFile').value;
        const fileInput = document.getElementById('editGradeFile');
        
        if (!title || !lesson || !type || !examDate) {
            showNotification('Lütfen tüm alanları doldurun.', 'error');
            return;
        }
        
        const formData = new FormData();
        formData.append('title', title);
        formData.append('lesson', lesson);
        formData.append('type', type);
        formData.append('examDate', examDate);
        formData.append('keepExistingFile', keepExistingFile);
        formData.append('userType', userInfo.userType); // Kullanıcının gerçek tipini gönder
        
        // Yeni dosya seçildiyse ekle
        if (fileInput.files.length > 0) {
            formData.append('file', fileInput.files[0]);
        }
        
        console.log('Güncelleme için gönderilen userType:', userInfo.userType);
        
        fetch(`/api/grades/update/${gradeId}`, {
            method: 'PUT',
            body: formData // FormData ile gönder, headers belirtme
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                closeModal(editGradeModal);
                showNotification('Çalışma notu başarıyla güncellendi.', 'success');
                fetchGrades();
            } else {
                showNotification(data.error || 'Çalışma notu güncellenirken bir hata oluştu.', 'error');
            }
        })
        .catch(error => {
            console.error('Çalışma notu güncellenirken hata:', error);
            showNotification('Çalışma notu güncellenirken bir hata oluştu.', 'error');
        });
    }
    
    // Not sil
    function deleteGrade() {
        const gradeId = document.getElementById('deleteGradeId').value;
        
        console.log('Silme için gönderilen userType:', userInfo.userType);
        
        // DELETE isteğiyle query parametresi olarak userType gönder (body ile değil)
        fetch(`/api/grades/delete/${gradeId}?userType=${encodeURIComponent(userInfo.userType)}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                closeModal(deleteGradeModal);
                showNotification('Sınav notu başarıyla silindi.', 'success');
                fetchGrades();
            } else {
                showNotification(data.message || data.error || 'Sınav notu silinirken bir hata oluştu.', 'error');
            }
        })
        .catch(error => {
            console.error('Sınav notu silinirken hata:', error);
            showNotification('Sınav notu silinirken bir hata oluştu.', 'error');
        });
    }
    
    // Form sıfırlama
    function resetGradeForm() {
        const addGradeForm = document.getElementById('addGradeForm');
        if (addGradeForm) {
            addGradeForm.reset();
        }
        
        // Dosya yükleme alanını sıfırla
        const addGradeFileName = document.getElementById('addGradeFileName');
        if (addGradeFileName) {
            addGradeFileName.textContent = '';
            addGradeFileName.style.display = 'none';
        }
        
        // Bugünün tarihini ayarla
        const today = new Date().toISOString().split('T')[0];
        const dateInput = document.getElementById('addGradeDate');
        if (dateInput) {
            dateInput.value = today;
        }
    }
    
    // Dosya yükleme alanı için event listener'lar
    document.addEventListener('DOMContentLoaded', function() {
        // Dosya seçim göstergesi - Ekleme formu
        const addGradeFileInput = document.getElementById('addGradeFile');
        const addGradeFileName = document.getElementById('addGradeFileName');
        
        if (addGradeFileInput && addGradeFileName) {
            addGradeFileInput.addEventListener('change', function() {
                if (addGradeFileInput.files.length > 0) {
                    addGradeFileName.textContent = addGradeFileInput.files[0].name;
                    addGradeFileName.style.display = 'inline-block';
                } else {
                    addGradeFileName.textContent = '';
                    addGradeFileName.style.display = 'none';
                }
            });
        }
        
        // Dosya seçim göstergesi - Düzenleme formu
        const editGradeFileInput = document.getElementById('editGradeFile');
        const editGradeFileName = document.getElementById('editGradeFileName');
        
        if (editGradeFileInput && editGradeFileName) {
            editGradeFileInput.addEventListener('change', function() {
                if (editGradeFileInput.files.length > 0) {
                    editGradeFileName.textContent = editGradeFileInput.files[0].name;
                    editGradeFileName.style.display = 'inline-block';
                    
                    // Mevcut dosya varsa, gizle ve "dosyayı koru" değerini false yap
                    const existingFileEl = document.getElementById('editGradeExistingFile');
                    const keepExistingFileEl = document.getElementById('editGradeKeepExistingFile');
                    
                    if (existingFileEl && keepExistingFileEl) {
                        existingFileEl.style.display = 'none';
                        keepExistingFileEl.value = 'false';
                    }
                } else {
                    editGradeFileName.textContent = '';
                    editGradeFileName.style.display = 'none';
                }
            });
        }
        
        // Sınav notu silme butonuna tıklama
        const deleteGradeBtn = document.getElementById('deleteGradeBtn');
        if (deleteGradeBtn) {
            deleteGradeBtn.addEventListener('click', deleteGrade);
        }
        
        // Sınav notu düzenleme formu gönderildiğinde
        const editGradeForm = document.getElementById('editGradeForm');
        if (editGradeForm) {
            editGradeForm.addEventListener('submit', function(e) {
                e.preventDefault();
                updateGrade();
            });
        }
        
        // Sınav notu ekleme formu gönderildiğinde
        const addGradeForm = document.getElementById('addGradeForm');
        if (addGradeForm) {
            addGradeForm.addEventListener('submit', function(e) {
                    e.preventDefault();
                addNewGrade();
            });
        }
    });

    // Kullanıcı Yönetimi İşlemleri
    const userManagementButton = document.getElementById('userManagementButton');
    const userManagementModal = document.getElementById('userManagementModal');
    const addUserBtn = document.getElementById('addUserBtn');
    const addUserModal = document.getElementById('addUserModal');
    const editUserModal = document.getElementById('editUserModal');
    const deleteUserModal = document.getElementById('deleteUserModal');
    const addUserForm = document.getElementById('addUserForm');
    const editUserForm = document.getElementById('editUserForm');
    const deleteUserBtn = document.getElementById('deleteUserBtn');
    
    // Kullanıcı yönetimi butonunu sadece yönetici (admin) kullanıcı tipinde göster
    if (userManagementButton) {
        // Yönetici kullanıcı tipi kontrol: hem 'admin' hem de 'Yönetici' değerlerini kabul et
        if (userInfo && (userInfo.userType === 'admin' || userInfo.userType === 'Yönetici')) {
            userManagementButton.style.display = 'flex'; // Göster
            
            // Kullanıcı yönetimi modalını açma
        userManagementButton.addEventListener('click', function() {
            openModal(userManagementModal);
            fetchUsers();
        });
        } else {
            userManagementButton.style.display = 'none'; // Gizle
        }
    }
    
    // Yeni kullanıcı ekleme modalını açma
    if (addUserBtn) {
        addUserBtn.addEventListener('click', function() {
            closeModal(userManagementModal);
            openModal(addUserModal);
        });
    }
    
    // Kullanıcı ekleme formu gönderimi
    if (addUserForm) {
        addUserForm.addEventListener('submit', function(e) {
            e.preventDefault();
            addNewUser();
        });
    }
    
    // Kullanıcı düzenleme formu gönderimi
    if (editUserForm) {
        editUserForm.addEventListener('submit', function(e) {
            e.preventDefault();
            updateUser();
        });
    }
    
    // Kullanıcı silme butonu
    if (deleteUserBtn) {
        deleteUserBtn.addEventListener('click', function() {
            deleteUser();
        });
    }
    
    // Kullanıcıları sunucudan çekme
    function fetchUsers() {
        const userTableBody = document.getElementById('userTableBody');
        
        if (userTableBody) {
            // Yükleme göstergesini göster
            userTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="loading-cell">
                        <div class="loading-indicator">
                            <div class="spinner"></div>
                            <p>Kullanıcılar yükleniyor...</p>
                        </div>
                    </td>
                </tr>
            `;
            
            // API'den verileri al - token ile ve minimal veri setiyle
            fetchWithTokenCheck('/api/users?minimal=true')
                .then(response => response.json())
                .then(data => {
                    // Konsola veri formatını yaz
                    console.log('Kullanıcı verileri format:', data);
                    
                    let users = [];
                    
                    // Sunucu yanıt formatını kontrol et
                    if (Array.isArray(data)) {
                        // Direkt dizi olarak gelmiş
                        users = data;
                        console.log('Kullanıcılar yüklendi (dizi):', users.length);
                    } else if (data.users && Array.isArray(data.users)) {
                        // Obje içinde users dizisi olarak gelmiş
                        users = data.users;
                        console.log('Kullanıcılar yüklendi (users dizisi):', users.length);
                    } else if (data.success === true && data.users && Array.isArray(data.users)) {
                        // Success: true formatı
                        users = data.users;
                        console.log('Kullanıcılar yüklendi (success:true):', users.length);
                    } else if (data.success === false) {
                        console.error('Kullanıcılar yüklenirken hata:', data.message);
                        userTableBody.innerHTML = `
                            <tr>
                                <td colspan="6" class="error-cell">
                                    <div class="error-message">
                                        <p>Kullanıcılar yüklenirken bir hata oluştu: ${data.message || 'Bilinmeyen hata'}</p>
                                    </div>
                                </td>
                            </tr>
                        `;
                        return;
                    } else {
                        console.error('Kullanıcı verisi beklendiği formatta değil:', data);
                        userTableBody.innerHTML = `
                            <tr>
                                <td colspan="6" class="error-cell">
                                    <div class="error-message">
                                        <p>Kullanıcılar yüklenirken bir hata oluştu: Geçersiz veri formatı</p>
                                    </div>
                                </td>
                            </tr>
                        `;
                        return;
                    }
                    
                    // Önbelleğe kaydet
                    cachedUsers = users;
                    usersCacheTimestamp = new Date().getTime();
                    
                    // Kullanıcıları göster
                    displayUsers(users);
                })
                .catch(error => {
                    console.error('Kullanıcılar yüklenirken hata:', error);
                    userTableBody.innerHTML = `
                        <tr>
                            <td colspan="6" class="error-cell">
                                <div class="error-message">
                                    <p>Kullanıcılar yüklenirken bir hata oluştu. Lütfen sayfayı yenileyip tekrar deneyin.</p>
                                </div>
                            </td>
                        </tr>
                    `;
                });
        }
    }
    
    // Kullanıcıları tabloda gösterme
    function displayUsers(users) {
        const userTableBody = document.getElementById('userTableBody');
        const noUserMessage = document.getElementById('noUserMessage');
        
        // Tablodaki mevcut içeriği temizle
        userTableBody.innerHTML = '';
        
        // Kullanıcı yoksa mesaj göster
        if (!users || users.length === 0) {
            userTableBody.style.display = 'none';
            noUserMessage.style.display = 'block';
            return;
        }
        
        // Kullanıcılar varsa tabloyu göster
        userTableBody.style.display = 'table-row-group';
        noUserMessage.style.display = 'none';
        
        // Veri kontrolü - ilk kaydı konsola yazdır (debug için)
        if (users.length > 0) {
            console.log('İlk kullanıcı örneği:', users[0]);
        }
        
        // Her kullanıcı için tablo satırı oluştur
        users.forEach(user => {
            const row = document.createElement('tr');
            
            // Kullanıcı tipini normalleştir
            let userType = 'student'; // Varsayılan değer
            
            // userType alanını kontrol et (null, undefined veya geçersiz değilse kullan)
            if (user.userType) {
                const validTypes = ['admin', 'teacher', 'student'];
                const normalizedType = user.userType.toLowerCase();
                
                if (validTypes.includes(normalizedType)) {
                    userType = normalizedType;
                }
            }
            
            // Kullanıcı tipi gösterimi için metin
            const userTypeText = {
                'admin': 'Yönetici',
                'teacher': 'Öğretmen',
                'student': 'Öğrenci'
            }[userType];
            
            // Son giriş formatını düzenle
            let formattedLastLogin = 'Hiç giriş yapılmadı';
            
            try {
                if (user.lastLogin) {
                    const lastLoginDate = new Date(user.lastLogin);
                    // Geçerli bir tarih mi kontrol et
                    if (!isNaN(lastLoginDate.getTime())) {
                        formattedLastLogin = lastLoginDate.toLocaleString('tr-TR', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                    }
                }
            } catch (error) {
                console.error('Tarih formatlama hatası:', error);
            }
            
            row.innerHTML = `
                <td>${user.id || ''}</td>
                <td>${user.name || ''}</td>
                <td>${user.username || ''}</td>
                <td><span class="user-type-badge ${userType}">${userTypeText}</span></td>
                <td>${formattedLastLogin}</td>
                <td class="action-buttons">
                    <button class="edit-button" onclick="editUserItem(${user.id})" title="Düzenle">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="delete-button" onclick="deleteUserItem(${user.id})" title="Sil">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                </td>
            `;
            
            userTableBody.appendChild(row);
        });
    }
    
    // Kullanıcı düzenleme modalını açma
    function editUserItem(userId) {
        // Eğer bilerek çağrılmadıysa (document yüklenirken otomatik çağrı) işlemi yok say
        if (!userId || userId === undefined) {
            console.log('editUserItem geçersiz userId ile çağrıldı');
            return;
        }
        
        // Kullanıcı bilgilerini getir
        fetch(`/api/users/${userId}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    const user = data.user;
                    
                    // Form alanlarını doldur
                    document.getElementById('editUserId').value = user.id;
                    document.getElementById('editUserName').value = user.name;
                    document.getElementById('editUserUsername').value = user.username;
                    document.getElementById('editUserPassword').value = '';
                    document.getElementById('editUserType').value = user.userType;
                    
                    // Modalı aç
                    closeModal(userManagementModal);
                    openModal(editUserModal);
                } else {
                    console.error('Kullanıcı bilgileri çekilirken hata oluştu:', data.message);
                    showNotification('Kullanıcı bilgileri yüklenirken bir hata oluştu.', 'error');
                }
            })
            .catch(error => {
                console.error('Kullanıcı bilgileri çekilirken hata oluştu:', error);
                showNotification('Kullanıcı bilgileri yüklenirken bir hata oluştu.', 'error');
            });
    }
    
    // Kullanıcı silme modalını açma
    function deleteUserItem(userId) {
        // Eğer bilerek çağrılmadıysa (document yüklenirken otomatik çağrı) işlemi yok say
        if (!userId || userId === undefined) {
            console.log('deleteUserItem geçersiz userId ile çağrıldı');
            return;
        }
        
        // Kullanıcı bilgilerini getir
        fetch(`/api/users/${userId}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    const user = data.user;
                    
                    // Form alanlarını doldur
                    document.getElementById('deleteUserId').value = user.id;
                    document.getElementById('deleteUserName').textContent = user.name;
                    
                    const userTypeText = {
                        'admin': 'Yönetici',
                        'teacher': 'Öğretmen',
                        'student': 'Öğrenci'
                    }[user.userType] || user.userType;
                    
                    document.getElementById('deleteUserType').textContent = userTypeText;
                    
                    // Modalı aç
                    closeModal(userManagementModal);
                    openModal(deleteUserModal);
                } else {
                    console.error('Kullanıcı bilgileri çekilirken hata oluştu:', data.message);
                    showNotification('Kullanıcı bilgileri yüklenirken bir hata oluştu.', 'error');
                }
            })
            .catch(error => {
                console.error('Kullanıcı bilgileri çekilirken hata oluştu:', error);
                showNotification('Kullanıcı bilgileri yüklenirken bir hata oluştu.', 'error');
            });
    }
    
    // Yeni kullanıcı ekleme
    function addNewUser() {
        const name = document.getElementById('addUserName').value;
        const username = document.getElementById('addUserUsername').value;
        const password = document.getElementById('addUserPassword').value;
        const userType = document.getElementById('addUserType').value;
        
        // Form alanlarını kontrol et
        if (!name || !username || !password || !userType) {
            showNotification('Tüm alanlar doldurulmalıdır.', 'error');
            return;
        }
        
        const userData = {
            name,
            username,
            password,
            userType
        };
        
        console.log('Kullanıcı ekleme verileri:', userData);
        
        // Doğru endpoint'i kullan: /api/register
        fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        })
            .then(response => {
                console.log('Sunucu yanıtı status:', response.status);
                return response.json();
            })
            .then(data => {
                console.log('Sunucu yanıtı:', data);
                
                if (data.success) {
                    showNotification('Kullanıcı başarıyla eklendi.', 'success');
                    closeModal(addUserModal);
                    openModal(userManagementModal);
                    fetchUsers();
                    resetUserForm();
                } else {
                    const errorMessage = data.message || data.error || 'Bilinmeyen hata';
                    console.error('Kullanıcı eklenirken hata oluştu:', errorMessage);
                    showNotification(`Kullanıcı eklenirken bir hata oluştu: ${errorMessage}`, 'error');
                }
            })
            .catch(error => {
                console.error('Kullanıcı eklenirken ağ hatası oluştu:', error);
                showNotification('Kullanıcı eklenirken bir hata oluştu.', 'error');
            });
    }
    
    // Kullanıcı güncelleme
    function updateUser() {
        const userId = document.getElementById('editUserId').value;
        const name = document.getElementById('editUserName').value;
        const username = document.getElementById('editUserUsername').value;
        const password = document.getElementById('editUserPassword').value;
        const userType = document.getElementById('editUserType').value;
        
        const userData = {
            name,
            username,
            userType
        };
        
        // Şifre alanı doldurulmuşsa ekle
        if (password.trim() !== '') {
            userData.password = password;
        }
        
        fetch(`/api/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showNotification('Kullanıcı başarıyla güncellendi.', 'success');
                    closeModal(editUserModal);
                    openModal(userManagementModal);
                    fetchUsers();
                } else {
                    console.error('Kullanıcı güncellenirken hata oluştu:', data.message);
                    showNotification(`Kullanıcı güncellenirken bir hata oluştu: ${data.message}`, 'error');
                }
            })
            .catch(error => {
                console.error('Kullanıcı güncellenirken hata oluştu:', error);
                showNotification('Kullanıcı güncellenirken bir hata oluştu.', 'error');
            });
    }
    
    // Kullanıcı silme
    function deleteUser() {
        const userId = document.getElementById('deleteUserId').value;
        
        fetch(`/api/users/${userId}`, {
            method: 'DELETE'
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showNotification('Kullanıcı başarıyla silindi.', 'success');
                    closeModal(deleteUserModal);
                    openModal(userManagementModal);
                    fetchUsers();
                } else {
                    console.error('Kullanıcı silinirken hata oluştu:', data.message);
                    showNotification(`Kullanıcı silinirken bir hata oluştu: ${data.message}`, 'error');
                }
            })
            .catch(error => {
                console.error('Kullanıcı silinirken hata oluştu:', error);
                showNotification('Kullanıcı silinirken bir hata oluştu.', 'error');
            });
    }
    
    // Kullanıcı formunu sıfırlama
    function resetUserForm() {
        document.getElementById('addUserName').value = '';
        document.getElementById('addUserUsername').value = '';
        document.getElementById('addUserPassword').value = '';
        document.getElementById('addUserType').value = '';
    }
    
    // Global fonksiyonları tanımla
    window.editUserItem = editUserItem;
    window.deleteUserItem = deleteUserItem;
    window.editGradeItem = editGradeItem;
    window.deleteGradeItem = deleteGradeItem;

    // Ders programı verilerini güncelle
    function updateScheduleDisplay() {
        let hasData = false; // Veri olup olmadığını takip et
        
        // Tüm hücreleri al
        editableCells.forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            
            // Veri formatına göre düzelt: "row_col" formatını kullan
            const cellKey = `${row}_${col}`;
            const content = scheduleData[cellKey];
            
            if (content) {
                cell.textContent = content;
                cell.classList.add('has-content');
                hasData = true; // Veri var
            } else {
                cell.textContent = '';
                cell.classList.remove('has-content');
                console.log(`Veri yok: row=${row}, col=${col}`);
            }
        });
        
        console.log('Veri var mı?', hasData);
        
        // Eğer uyarı mesajı gösterilecekse, hasData kontrol et
        if (!hasData) {
            const noDataWarning = document.querySelector('.no-data-warning');
            if (noDataWarning) noDataWarning.style.display = 'block';
        } else {
            const noDataWarning = document.querySelector('.no-data-warning');
            if (noDataWarning) noDataWarning.style.display = 'none';
        }
    }

    // Tablodan veri toplayıp scheduleData'yı güncelle
    function collectDataFromTable() {
        scheduleData = {};
        
        editableCells.forEach(cell => {
            const row = cell.getAttribute('data-row');
            const col = cell.getAttribute('data-col');
            const content = cell.textContent.trim();
            
            if (content) {
                // Yeni format: "row_col" formatında key kullanıyor
                const cellKey = `${row}_${col}`;
                scheduleData[cellKey] = content;
            }
        });
        
        console.log('Ders programı verileri tablodaki değerlerden toplandı:', scheduleData);
        return scheduleData;
    }
}); 

// Modal başlıklarına yenileme butonları ekle
