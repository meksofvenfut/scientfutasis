document.addEventListener('DOMContentLoaded', () => {
    // Service worker'ı unregister etmek için
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for(let registration of registrations) {
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
    try {
        userInfo = JSON.parse(localStorage.getItem('user'));
    } catch (e) {
        // Geçici test kullanıcısı oluştur
        userInfo = {
            username: "Kullanıcı",
            userType: "admin",
            email: "kullanici@ornek.com"
        };
        localStorage.setItem('user', JSON.stringify(userInfo));
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
        // Kullanıcı oturumunu sonlandır
        localStorage.removeItem('user');
        
        // Giriş sayfasına yönlendir (göreceli yol kullanarak)
        window.location.href = 'index.html';
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
    
    // Modalı açma ve kapatma fonksiyonları
    function openModal(modalElement) {
        // Önce sayfayı kaydıralım, görüntünün bozulmaması için
        window.scrollTo(0, 0);
        
        // Modal'ı göster
        modalElement.style.display = 'flex';
        
        // Modaldaki scroll'u üste taşı
        const modalBody = modalElement.querySelector('.modal-body');
        if (modalBody) {
            modalBody.scrollTop = 0;
        }
        
        hasChanges = false; // Modal açıldığında değişiklik durumunu sıfırla
        
        // Ödevler modalı açıldıysa ödevleri yükle
        if (modalElement === homeworkModal) {
            fetchHomeworks();
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
        
        // Modal kapatıldığında alt blok ikonlarındaki active efektini kaldır
        document.querySelectorAll('.icon-item').forEach(item => {
            item.classList.remove('active');
            item.classList.remove('hovered');
        });
    }
    
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
    
    // Ödevler için fonksiyonlar
    
    // Ödevleri sunucudan çek
    function fetchHomeworks() {
        // Yükleniyor göstergesini görünür yap, element varlığını kontrol ederek
        const loadingIndicator = document.querySelector('.loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'flex';
        }
        
        const noHomeworkMessage = document.getElementById('noHomeworkMessage');
        if (noHomeworkMessage) {
            noHomeworkMessage.style.display = 'none';
        }
        
        const homeworkCards = document.getElementById('homeworkCards');
        if (homeworkCards) {
            homeworkCards.innerHTML = '<div class="loading-indicator"><div class="spinner"></div><p>Ödevler yükleniyor...</p></div>';
        } else {
            console.error('homeworkCards elementi bulunamadı!');
            // Element bulunamadıysa, bir hata mesajı göster
            showNotification('Ödev listesi yüklenemiyor, sayfayı yenileyin!', 'error');
            return;
        }
        
        fetch('/api/homework/get')
            .then(response => response.json())
            .then(data => {
                homeworkData = data;
                displayHomeworks();
            })
            .catch(error => {
                console.error('Ödev yükleme hatası:', error);
                showNotification('Ödevler yüklenirken bir hata oluştu!', 'error');
                
                if (homeworkCards) {
                    homeworkCards.innerHTML = '<div class="error-message">Ödevler yüklenirken bir hata oluştu!</div>';
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
            // Teslim tarihi geçmiş mi kontrol et
            const dueDate = new Date(homework.dueDate);
            const today = new Date();
            const isOverdue = dueDate < today && !homework.isCompleted;
            
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
            
            // Kalan gün sayısını hesapla
            const timeDiff = dueDate.getTime() - today.getTime();
            const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
            let daysText = '';
            
            if (homework.isCompleted) {
                daysText = 'Tamamlandı';
            } else if (isOverdue) {
                daysText = `${Math.abs(daysDiff)} gün gecikti`;
            } else {
                daysText = `${daysDiff} gün kaldı`;
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
    
    // Modal dışına tıklandığında modalı kapat
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
        
        fetch('/api/announcements/get')
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
                    let createdDateStr = announcement.createdAt;
                    let updatedDateStr = announcement.updatedAt;
                    
                    // ISO formatına dönüştür ve Türkiye saat dilimini ekle
                    let createdDate = new Date(createdDateStr + '+03:00');
                    let updatedDate = new Date(updatedDateStr + '+03:00');
                    
                    // Hangisini göstereceğimizi belirle
                    let displayDate = createdDate;
                    let datePrefix = "Oluşturulma: ";
                    
                    // Eğer güncelleme tarihi, oluşturma tarihinden farklıysa ve geçerliyse
                    if (updatedDate > createdDate && !isNaN(updatedDate.getTime())) {
                        displayDate = updatedDate;
                        datePrefix = "Güncelleme: ";
                    }
                    
                    // Tarihi formatla
                    let dateStr = datePrefix + displayDate.toLocaleString('tr-TR', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
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
                let createdDateStr = announcement.createdAt;
                let updatedDateStr = announcement.updatedAt;
                
                // ISO formatına dönüştür ve Türkiye saat dilimini ekle
                let createdDate = new Date(createdDateStr + '+03:00');
                let updatedDate = new Date(updatedDateStr + '+03:00');
                
                // Hangisini göstereceğimizi belirle
                let displayDate = createdDate;
                let datePrefix = "Oluşturulma: ";
                
                // Eğer güncelleme tarihi, oluşturma tarihinden farklıysa ve geçerliyse
                if (updatedDate > createdDate && !isNaN(updatedDate.getTime())) {
                    displayDate = updatedDate;
                    datePrefix = "Güncelleme: ";
                }
                
                // Tarihi formatla
                let dateStr = datePrefix + displayDate.toLocaleString('tr-TR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
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
        addGradeBtn.addEventListener('click', function() {
            resetGradeForm();
            openModal(addGradeModal);
        });
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
            
            // API'den notları al
            fetch('/api/grades/get')
                .then(response => response.json())
                .then(data => {
                    grades = data;
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
                                <div class="action-buttons">
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
                                </div>
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
        // Yeni sekme/pencerede dosyayı aç
        window.open(`/api/grades/download/${gradeId}`, '_blank');
    }
    
    // Not düzenleme modal'ını aç
    function editGradeItem(gradeId) {
        const grade = grades.find(g => g.id === gradeId);
        if (grade) {
            document.getElementById('editGradeId').value = grade.id;
            document.getElementById('editGradeTitle').value = grade.title;
            document.getElementById('editGradeLesson').value = grade.lesson;
            document.getElementById('editGradeType').value = grade.type;
            document.getElementById('editGradeDate').value = grade.examDate.split('T')[0]; // Tarih formatı ayarı
            
            // Dosya bilgilerini ayarla
            const existingFileEl = document.getElementById('editGradeExistingFile');
            const existingFileNameEl = document.getElementById('editGradeExistingFileName');
            const keepExistingFileEl = document.getElementById('editGradeKeepExistingFile');
            const viewFileBtn = document.getElementById('editGradeViewFileBtn');
            
            if (grade.file_name) {
                existingFileEl.style.display = 'flex';
                existingFileNameEl.textContent = grade.file_name;
                keepExistingFileEl.value = 'true';
                
                // Görüntüle butonuna event listener ekle
                viewFileBtn.onclick = function() {
                    window.open(`/api/grades/download/${grade.id}`, '_blank');
                };
                
                // Dosya kaldırma butonuna event listener ekle
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
        }
    }
    
    // Not silme modal'ını aç
    function deleteGradeItem(gradeId) {
        const grade = grades.find(g => g.id === gradeId);
        if (grade) {
            document.getElementById('deleteGradeId').value = grade.id;
            document.getElementById('deleteGradeTitle').textContent = grade.title;
            document.getElementById('deleteGradeLesson').textContent = grade.lesson;
            document.getElementById('deleteGradeType').textContent = grade.type;
            
            // Tarih formatı düzenleme
            const examDate = new Date(grade.examDate);
            const formattedDate = examDate.toLocaleDateString('tr-TR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            document.getElementById('deleteGradeDate').textContent = formattedDate;
            
            openModal(deleteGradeModal);
        }
    }
    
    // Yeni not ekle
    function addNewGrade() {
        const title = document.getElementById('addGradeTitle').value;
        const lesson = document.getElementById('addGradeLesson').value;
        const type = document.getElementById('addGradeType').value;
        const examDate = document.getElementById('addGradeDate').value;
        const fileInput = document.getElementById('addGradeFile');
        
        // Kullanıcı tip kontrolü - direkt olarak userInfo'dan al
        const userType = userInfo ? userInfo.userType : '';
        
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
        formData.append('userType', userType);
        
        // Dosya varsa ekle
        if (fileInput.files.length > 0) {
            formData.append('file', fileInput.files[0]);
        }
        
        // Debug için kullanıcı tipini konsola yazdır
        console.log('Gönderilen userType:', userType);
        
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
        const fileInput = document.getElementById('editGradeFile');
        const keepExistingFile = document.getElementById('editGradeKeepExistingFile').value;
        
        // Kullanıcı tip kontrolü - direkt olarak userInfo'dan al
        const userType = userInfo ? userInfo.userType : '';
        
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
        formData.append('userType', userType);
        formData.append('keepExistingFile', keepExistingFile);
        
        // Dosya varsa ekle
        if (fileInput.files.length > 0) {
            formData.append('file', fileInput.files[0]);
        }
        
        // Debug için kullanıcı tipini konsola yazdır
        console.log('Güncelleme için gönderilen userType:', userType);
        
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
        
        // Kullanıcı tip kontrolü - direkt olarak userInfo'dan al
        const userType = userInfo ? userInfo.userType : '';
        
        // Debug için kullanıcı tipini konsola yazdır
        console.log('Silme için gönderilen userType:', userType);
        
        fetch(`/api/grades/delete/${gradeId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userType })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                closeModal(deleteGradeModal);
                showNotification('Sınav notu başarıyla silindi.', 'success');
                fetchGrades();
            } else {
                showNotification(data.error || 'Sınav notu silinirken bir hata oluştu.', 'error');
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
        const addGradeFile = document.getElementById('addGradeFile');
        const addGradeFileName = document.getElementById('addGradeFileName');
        const addFileUploadBox = addGradeFile ? addGradeFile.nextElementSibling : null;
        
        if (addGradeFile && addGradeFileName && addFileUploadBox) {
            // Dosya değişikliği için listener
            addGradeFile.addEventListener('change', function() {
                console.log('Dosya seçildi: ', this.files);
                if (this.files.length > 0) {
                    addGradeFileName.textContent = this.files[0].name;
                    addGradeFileName.style.display = 'block';
                } else {
                    addGradeFileName.textContent = '';
                    addGradeFileName.style.display = 'none';
                }
            });
            
            // Sürükle-bırak olayları
            addFileUploadBox.addEventListener('dragover', function(e) {
                e.preventDefault();
                this.classList.add('drag-over');
            });
            
            addFileUploadBox.addEventListener('dragleave', function() {
                this.classList.remove('drag-over');
            });
            
            addFileUploadBox.addEventListener('drop', function(e) {
                e.preventDefault();
                this.classList.remove('drag-over');
                
                if (e.dataTransfer.files.length > 0) {
                    addGradeFile.files = e.dataTransfer.files;
                    const event = new Event('change');
                    addGradeFile.dispatchEvent(event);
                }
            });
            
            // Tıklama işleminde input'u tetikle - hem kutuya hem de metin bölümüne tıklama için
            addFileUploadBox.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('Dosya yükleme kutusu tıklandı');
                addGradeFile.click();
            });
            
            // SVG ve span elementlerine tıklama olayları ekle (event propagation sorunlarını önlemek için)
            const uploadSvg = addFileUploadBox.querySelector('svg');
            const uploadText = addFileUploadBox.querySelector('.upload-text');
            
            if (uploadSvg) {
                uploadSvg.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('SVG tıklandı');
                    addGradeFile.click();
                });
            }
            
            if (uploadText) {
                uploadText.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Metin tıklandı');
                    addGradeFile.click();
                });
            }
        }
        
        // Dosya seçim göstergesi - Düzenleme formu
        const editGradeFile = document.getElementById('editGradeFile');
        const editGradeFileName = document.getElementById('editGradeFileName');
        const editFileUploadBox = editGradeFile ? editGradeFile.nextElementSibling : null;
        
        if (editGradeFile && editGradeFileName && editFileUploadBox) {
            // Dosya değişikliği için listener
            editGradeFile.addEventListener('change', function() {
                console.log('Düzenleme: Dosya seçildi: ', this.files);
                if (this.files.length > 0) {
                    editGradeFileName.textContent = this.files[0].name;
                    editGradeFileName.style.display = 'block';
                } else {
                    editGradeFileName.textContent = '';
                    editGradeFileName.style.display = 'none';
                }
            });
            
            // Sürükle-bırak olayları
            editFileUploadBox.addEventListener('dragover', function(e) {
                e.preventDefault();
                this.classList.add('drag-over');
            });
            
            editFileUploadBox.addEventListener('dragleave', function() {
                this.classList.remove('drag-over');
            });
            
            editFileUploadBox.addEventListener('drop', function(e) {
                e.preventDefault();
                this.classList.remove('drag-over');
                
                if (e.dataTransfer.files.length > 0) {
                    editGradeFile.files = e.dataTransfer.files;
                    const event = new Event('change');
                    editGradeFile.dispatchEvent(event);
                }
            });
            
            // Tıklama işleminde input'u tetikle - hem kutuya hem de metin bölümüne tıklama için
            editFileUploadBox.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('Düzenleme: Dosya yükleme kutusu tıklandı');
                editGradeFile.click();
            });
            
            // SVG ve span elementlerine tıklama olayları ekle (event propagation sorunlarını önlemek için)
            const uploadSvg = editFileUploadBox.querySelector('svg');
            const uploadText = editFileUploadBox.querySelector('.upload-text');
            
            if (uploadSvg) {
                uploadSvg.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Düzenleme: SVG tıklandı');
                    editGradeFile.click();
                });
            }
            
            if (uploadText) {
                uploadText.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Düzenleme: Metin tıklandı');
                    editGradeFile.click();
                });
            }
        }
        
        // Silme butonu için event listener
        const deleteGradeBtn = document.getElementById('deleteGradeBtn');
        if (deleteGradeBtn) {
            deleteGradeBtn.addEventListener('click', function() {
                deleteGrade();
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
        fetch('/api/users')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    displayUsers(data.users);
                } else {
                    console.error('Kullanıcılar çekilirken hata oluştu:', data.message);
                    showNotification('Kullanıcılar yüklenirken bir hata oluştu.', 'error');
                }
            })
            .catch(error => {
                console.error('Kullanıcılar çekilirken hata oluştu:', error);
                showNotification('Kullanıcılar yüklenirken bir hata oluştu.', 'error');
            });
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
        
        // Her kullanıcı için tablo satırı oluştur
        users.forEach(user => {
            const row = document.createElement('tr');
            
            // Kullanıcı tipi gösterimi için CSS sınıfı
            const userTypeClass = user.userType.toLowerCase();
            const userTypeText = {
                'admin': 'Yönetici',
                'teacher': 'Öğretmen',
                'student': 'Öğrenci'
            }[user.userType] || user.userType;
            
            // Son giriş formatını düzenle
            const lastLoginDate = user.lastLogin ? new Date(user.lastLogin) : null;
            const formattedLastLogin = lastLoginDate 
                ? `${lastLoginDate.toLocaleDateString('tr-TR')} ${lastLoginDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`
                : 'Hiç giriş yapılmadı';
            
            row.innerHTML = `
                <td>${user.id}</td>
                <td>${user.name}</td>
                <td>${user.username}</td>
                <td><span class="user-type-badge ${userTypeClass}">${userTypeText}</span></td>
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
        
        const userData = {
            name,
            username,
            password,
            userType
        };
        
        fetch('/api/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showNotification('Kullanıcı başarıyla eklendi.', 'success');
                    closeModal(addUserModal);
                    openModal(userManagementModal);
                    fetchUsers();
                    resetUserForm();
                } else {
                    console.error('Kullanıcı eklenirken hata oluştu:', data.message);
                    showNotification(`Kullanıcı eklenirken bir hata oluştu: ${data.message}`, 'error');
                }
            })
            .catch(error => {
                console.error('Kullanıcı eklenirken hata oluştu:', error);
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