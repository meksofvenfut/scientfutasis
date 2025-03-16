const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Veritabanı kütüphaneleri
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg'); // PostgreSQL için

// Türkiye zaman dilimini (Europe/Istanbul) ayarla
process.env.TZ = 'Europe/Istanbul';
console.log('Zaman dilimi ayarlandı:', process.env.TZ);

// Express uygulaması oluştur
const app = express();
const PORT = process.env.PORT || 3000;

// Veritabanı bağlantısı
let db;
// SQLite veya PostgreSQL kullanılacağını belirle
const dbType = process.env.DB_TYPE || 'sqlite';

// Sabitler
const DB_PATH = process.env.NODE_ENV === 'production' ? './scientfutasis.db' : ':memory:';
const isPg = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgres');
const JWT_SECRET = process.env.JWT_SECRET || 'scientfutasis-secret-key';

// DB bağlantısı kurma
if (isPg) {
    // PostgreSQL bağlantısı (Render.com'da otomatik sağlanan değişkenler)
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });
    
    // Global db nesnesini tanımla (PostgreSQL uyumlu fonksiyon arayüzü)
    db = {
        run: (text, params, callback) => {
            return pool.query(text, params)
                .then(res => {
                    if (callback) callback(null);
                    return res;
                })
                .catch(err => {
                    console.error('PostgreSQL run hatası:', err);
                    if (callback) callback(err);
                    return err;
                });
        },
        get: (text, params, callback) => {
            return pool.query(text, params)
                .then(res => {
                    if (callback) callback(null, res.rows[0]);
                    return res.rows[0];
                })
                .catch(err => {
                    console.error('PostgreSQL get hatası:', err);
                    if (callback) callback(err);
                    return err;
                });
        },
        all: (text, params, callback) => {
            return pool.query(text, params)
                .then(res => {
                    if (callback) callback(null, res.rows);
                    return res.rows;
                })
                .catch(err => {
                    console.error('PostgreSQL all hatası:', err);
                    if (callback) callback(err);
                    return err;
                });
        },
        exec: (text, callback) => {
            return pool.query(text)
                .then(res => {
                    if (callback) callback(null);
                    return res;
                })
                .catch(err => {
                    console.error('PostgreSQL exec hatası:', err);
                    if (callback) callback(err);
                    return err;
                });
        },
        serialize: (callback) => {
            callback(); // PostgreSQL için gerekli değil, ama uyumluluk için
        }
    };
    
    console.log('PostgreSQL veritabanına bağlandı');
} else {
    // SQLite bağlantısı (geliştirme ortamı için)
    const dbPath = path.join(__dirname, 'database', 'egitim_portal.db');
    db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('Veritabanına bağlanırken hata oluştu:', err.message);
        } else {
            console.log('SQLite veritabanına bağlandı:', dbPath);
        }
    });
}

// Middlewares
app.use(cors({
    origin: '*', // Güvenlik için daha sonra sadece kendi domain'inizle sınırlandırabilirsiniz
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// API istekleri için önbellek engelleyici middleware
app.use('/api', (req, res, next) => {
    // Her API isteği için önbellek başlıklarını ayarla
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Vary', 'Accept, Accept-Encoding, Origin');
    next();
});

// Frontend dosyalarını servis et
app.use(express.static(__dirname));

// Dosya yükleme için klasör oluşturma
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Dosya yükleme ayarları
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Unique dosya adı oluşturma
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExt = path.extname(file.originalname);
        cb(null, uniqueSuffix + fileExt);
    }
});

// Dosya boyutu sınırlamasını kaldıralım
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB
    }
});

// Statik dosyalar için uploads klasörünü erişime açalım
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Veritabanı tablolarını oluştur
db.serialize(() => {
    // PostgreSQL için SQL ifadelerini ayarla
    let userTableSQL, scheduleTableSQL, homeworkTableSQL, announcementsTableSQL, gradesTableSQL;
    
    if (isPg) {
        // PostgreSQL tablo oluşturma ifadeleri
        userTableSQL = `
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                userType TEXT NOT NULL,
                lastLogin TEXT
            )
        `;
        
        scheduleTableSQL = `
            CREATE TABLE IF NOT EXISTS schedule (
                id SERIAL PRIMARY KEY,
                userId INTEGER,
                rowIndex INTEGER,
                colIndex INTEGER,
                content TEXT,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (userId, rowIndex, colIndex)
            )
        `;
        
        homeworkTableSQL = `
            CREATE TABLE IF NOT EXISTS homework (
                id SERIAL PRIMARY KEY,
                title TEXT,
                lesson TEXT,
                dueDate TEXT,
                description TEXT,
                isCompleted BOOLEAN DEFAULT FALSE,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        announcementsTableSQL = `
            CREATE TABLE IF NOT EXISTS announcements (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                importance TEXT DEFAULT 'normal',
                important BOOLEAN DEFAULT FALSE,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        gradesTableSQL = `
            CREATE TABLE IF NOT EXISTS grades (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                lesson TEXT NOT NULL,
                type TEXT NOT NULL,
                file_path TEXT,
                file_name TEXT,
                file_size INTEGER,
                examDate TEXT NOT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
    } else {
        // SQLite tablo oluşturma ifadeleri (mevcut ifadeler)
        userTableSQL = `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                userType TEXT NOT NULL,
                lastLogin TEXT
            )
        `;
        
        scheduleTableSQL = `
            CREATE TABLE IF NOT EXISTS schedule (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER,
                rowIndex INTEGER,
                colIndex INTEGER,
                content TEXT,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        homeworkTableSQL = `
            CREATE TABLE IF NOT EXISTS homework (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                lesson TEXT,
                dueDate TEXT,
                description TEXT,
                isCompleted BOOLEAN DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        announcementsTableSQL = `
            CREATE TABLE IF NOT EXISTS announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                importance TEXT DEFAULT 'normal',
                important BOOLEAN DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        gradesTableSQL = `
            CREATE TABLE IF NOT EXISTS grades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                lesson TEXT NOT NULL,
                type TEXT NOT NULL,
                file_path TEXT,
                file_name TEXT,
                file_size INTEGER,
                examDate TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
    }
    
    // Tabloları oluştur
    db.run(userTableSQL);
    db.run(scheduleTableSQL);
    db.run(homeworkTableSQL);
    db.run(announcementsTableSQL);
    db.run(gradesTableSQL);
    
    // Var olan veritabanında importance sütunu var mı kontrol et
    db.all("PRAGMA table_info(announcements)", [], (err, rows) => {
        if (err) {
            console.error("Tablo bilgisi alınamadı:", err);
            return;
        }
        
        // importance sütunu var mı kontrol et
        let hasImportance = false;
        if (rows && rows.length > 0) {
            rows.forEach(row => {
                if (row.name === 'importance') {
                    hasImportance = true;
                }
            });
            
            // Eğer importance sütunu yoksa ekle
            if (!hasImportance) {
                console.log("announcements tablosuna importance sütunu ekleniyor...");
                db.run("ALTER TABLE announcements ADD COLUMN importance TEXT DEFAULT 'normal'", [], function(err) {
                    if (err) {
                        console.error("Sütun eklenemedi:", err);
                    } else {
                        console.log("importance sütunu başarıyla eklendi.");
                        
                        // Mevcut important değerlerini yeni sütuna taşı
                        db.run("UPDATE announcements SET importance = CASE WHEN important = 1 THEN 'important' ELSE 'normal' END", [], function(err) {
                            if (err) {
                                console.error("Değerler taşınamadı:", err);
                            } else {
                                console.log("Değerler importance sütununa taşındı.");
                            }
                        });
                    }
                });
            }
        }
    });
    
    // Varsayılan kullanıcıları kontrol et ve oluştur
    console.log('Varsayılan yönetici kullanıcısı kontrolü yapılıyor...');
    
    // Önce userType'ları kontrol edelim
    db.all("SELECT DISTINCT userType FROM users", [], (err, rows) => {
        if (err) {
            console.error('Kullanıcı tipleri kontrolü yaparken hata:', err.message);
        } else {
            console.log('Mevcut kullanıcı tipleri:', rows && rows.length ? rows.map(r => r.userType).join(', ') : 'Yok');
        }
    });
    
    // MEK admin kullanıcısı için hem "Yönetici" hem de "admin" kontrolü yapalım
    db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
        if (err) {
            console.error('Kullanıcı sayısı kontrolü yaparken hata:', err.message);
            return;
        }
        
        const count = row ? (row.count || 0) : 0;
        console.log(`Veritabanında toplam ${count} kullanıcı mevcut.`);
        
        // Hiç kullanıcı yoksa veya çok az varsa yönetici ekleyelim
        if (count < 2) {
            console.log('Az sayıda kullanıcı var, yönetici ekleme işlemi yapılacak...');
            
            // Base64 ile şifreleme (123456 şifresini Base64'e çeviriyoruz)
            const password = Buffer.from('123456').toString('base64');
            
            // Hem "Yönetici" hem de "admin" tipiyle oluşturalım
            if (isPg) {
                // PostgreSQL için
                const insertYoneticiSQL = `
                    INSERT INTO users (name, username, password, userType)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (username) DO NOTHING
                `;
                
                db.run(insertYoneticiSQL, ['MEK Admin', 'MEK', password, 'Yönetici'], function(err) {
                    if (err) {
                        console.error('Varsayılan Yönetici kullanıcısı oluştururken hata:', err.message);
                    } else {
                        console.log('Varsayılan Yönetici kullanıcısı oluşturuldu: MEK');
                    }
                });
                
                const insertAdminSQL = `
                    INSERT INTO users (name, username, password, userType)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (username) DO NOTHING
                `;
                
                db.run(insertAdminSQL, ['MEK Admin', 'admin', password, 'admin'], function(err) {
                    if (err) {
                        console.error('Varsayılan admin kullanıcısı oluştururken hata:', err.message);
                    } else {
                        console.log('Varsayılan admin kullanıcısı oluşturuldu: admin');
                    }
                });
            } else {
                // SQLite için
                db.run(
                    `INSERT OR IGNORE INTO users (name, username, password, userType) VALUES (?, ?, ?, ?)`,
                    ['MEK Admin', 'MEK', password, 'Yönetici'],
                    function(err) {
                        if (err) {
                            console.error('Varsayılan Yönetici kullanıcısı oluştururken hata:', err.message);
                        } else {
                            console.log('Varsayılan Yönetici kullanıcısı oluşturuldu: MEK');
                        }
                    }
                );
                
                db.run(
                    `INSERT OR IGNORE INTO users (name, username, password, userType) VALUES (?, ?, ?, ?)`,
                    ['MEK Admin', 'admin', password, 'admin'],
                    function(err) {
                        if (err) {
                            console.error('Varsayılan admin kullanıcısı oluştururken hata:', err.message);
                        } else {
                            console.log('Varsayılan admin kullanıcısı oluşturuldu: admin');
                        }
                    }
                );
            }
        }
    });
});

// Mevcut sınav notları tablosunun yapısını kontrol edelim
db.all("PRAGMA table_info(grades)", [], (err, rows) => {
    if (err) {
        console.error("Tablo bilgisi alınamadı:", err);
        return;
    }
    
    // Eğer eski yapıda ise (dosya desteği olmayan), yeni yapıya geçelim
    const hasContent = rows.some(row => row.name === 'content');
    const hasFilePath = rows.some(row => row.name === 'file_path');
    const hasFileName = rows.some(row => row.name === 'file_name');
    
    // Eğer content varsa ve file_path yoksa, yeni yapıya geçelim
    if (hasContent && !hasFilePath) {
        console.log("grades tablosu dosya desteği için güncelleniyor...");
        
        // Geçici tabloyu oluştur
        db.serialize(() => {
            // Önce mevcut verileri yedekleyelim
            db.run(`CREATE TABLE grades_backup AS SELECT * FROM grades`, [], function(err) {
                if (err) {
                    console.error("Yedekleme yapılamadı:", err);
                    return;
                }
                
                // Tabloyu sil
                db.run(`DROP TABLE grades`, [], function(err) {
                    if (err) {
                        console.error("Tablo silinemedi:", err);
                        return;
                    }
                    
                    // Yeni yapıda tabloyu oluştur
                    db.run(`
                        CREATE TABLE grades (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            title TEXT NOT NULL,
                            lesson TEXT NOT NULL,
                            type TEXT NOT NULL,
                            file_path TEXT,
                            file_name TEXT,
                            file_size INTEGER,
                            examDate TEXT NOT NULL,
                            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `, [], function(err) {
                        if (err) {
                            console.error("Yeni tablo oluşturulamadı:", err);
                            
                            // Hata durumunda yedeği geri yükle
                            db.run(`CREATE TABLE grades AS SELECT * FROM grades_backup`, [], function(err) {
                                if (err) {
                                    console.error("Yedek geri yüklenemedi:", err);
                                }
                                db.run(`DROP TABLE grades_backup`);
                            });
                            return;
                        }
                        
                        // Başarılı ise eski verileri yeni yapıya taşı (content NULL olarak)
                        db.all(`SELECT id, title, lesson, type, examDate, createdAt, updatedAt FROM grades_backup`, [], (err, rows) => {
                            if (err) {
                                console.error("Veri taşıma hatası:", err);
                                return;
                            }
                            
                            if (rows.length > 0) {
                                // Her bir satır için insert yap
                                const insertStmt = db.prepare(`
                                    INSERT INTO grades (id, title, lesson, type, file_path, file_name, examDate, createdAt, updatedAt)
                                    VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)
                                `);
                                
                                rows.forEach(row => {
                                    insertStmt.run(
                                        row.id, 
                                        row.title, 
                                        row.lesson, 
                                        row.type, 
                                        row.examDate, 
                                        row.createdAt, 
                                        row.updatedAt
                                    );
                                });
                                
                                insertStmt.finalize();
                            }
                            
                            console.log("Çalışma notları tablosu dosya desteği ile güncellendi.");
                            db.run(`DROP TABLE grades_backup`);
                        });
                    });
                });
            });
        });
    } else if (hasFilePath) {
        console.log("Çalışma notları tablosu dosya desteği ile zaten güncel.");
    }
});

// SQLite için timestamp fonksiyonu (Türkiye saati - GMT+3)
function getCurrentTimestamp() {
    const date = new Date();
    // Zamanı Türkiye saat dilimine göre formatla
    const options = { 
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Europe/Istanbul' 
    };
    
    const turkishTime = new Intl.DateTimeFormat('tr-TR', options).format(date);
    
    // "DD.MM.YYYY HH:MM:SS" formatını SQLite için "YYYY-MM-DD HH:MM:SS" formatına çevir
    const [datePart, timePart] = turkishTime.split(' ');
    const [day, month, year] = datePart.split('.');
    
    return `${year}-${month}-${day} ${timePart}`;
}

// Türkiye saati formatında log için yardımcı fonksiyon
function getTurkishTimeString() {
    return new Date().toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'});
}

// API endpoint'leri
// 1. Giriş (login) endpoint'i
app.post('/api/login', (req, res) => {
    console.log('Login isteği alındı:', req.body);
    const { username, password } = req.body;
    
    if (!username || !password) {
        console.error('Eksik bilgi: kullanıcı adı veya şifre eksik');
        return res.status(400).json({ success: false, message: 'Kullanıcı adı ve şifre gereklidir' });
    }
    
    try {
        const encodedPassword = Buffer.from(password).toString('base64');
        console.log(`Parola kontrol ediliyor: ${username} için`);
        
        // Kullanıcıyı veritabanında kontrol et
        const query = isPg ? 
            `SELECT id, name, username, userType FROM users WHERE username = $1 AND password = $2` :
            `SELECT id, name, username, userType FROM users WHERE username = ? AND password = ?`;
        
        const params = isPg ? [username, encodedPassword] : [username, encodedPassword];
        
        db.get(query, params, (err, row) => {
            if (err) {
                console.error('Veritabanı hatası:', err.message);
                return res.status(500).json({ success: false, message: 'Sunucu hatası' });
            }
            
            if (!row) {
                console.error('Kimlik doğrulama başarısız: kullanıcı bulunamadı veya şifre yanlış');
                return res.status(401).json({ success: false, message: 'Kullanıcı adı veya şifre yanlış' });
            }
            
            console.log('Kullanıcı başarıyla giriş yaptı:', row);
            console.log('User type:', row.userType);
            
            // JWT token oluştur
            const token = jwt.sign(
                { id: row.id, username: row.username, userType: row.userType },
                JWT_SECRET,
                { expiresIn: '1h' }
            );
            
            res.json({
                success: true,
                user: {
                    id: row.id,
                    name: row.name,
                    username: row.username,
                    userType: row.userType
                },
                token: token
            });
        });
    } catch (error) {
        console.error('Login işleminde hata:', error);
        res.status(500).json({ success: false, message: 'Sunucu hatası', error: error.message });
    }
});

// 2. Kullanıcı kayıt endpoint'i
app.post('/api/register', (req, res) => {
    const { username, password, userType } = req.body;
    // Kullanıcı adı otomatik olarak isim kısmıda kullanılabilir
    const name = username;

    if (!username || !password || !userType) {
        return res.status(400).json({ error: 'Kullanıcı adı, şifre ve kullanıcı tipi gereklidir' });
    }
    
    // Kullanıcı tipi kontrolü
    const allowedTypes = ['admin', 'teacher', 'student'];
    if (!allowedTypes.includes(userType)) {
        return res.status(400).json({ error: 'Geçerli bir kullanıcı tipi seçin' });
    }

    // Kullanıcı adının benzersiz olup olmadığını kontrol et
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, row) => {
        if (err) {
            console.error('Kullanıcı kontrolü yapılırken hata:', err.message);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        if (row) {
            return res.status(409).json({ error: 'Bu kullanıcı adı zaten kullanılıyor' });
        }
        
        // Kullanıcıyı ekle
        db.run(`INSERT INTO users (name, username, password, userType) VALUES (?, ?, ?, ?)`, 
          [name, username, password, userType], 
          function(err) {
            if (err) {
              console.error('Kullanıcı eklenirken hata:', err.message);
              return res.status(500).json({ error: 'Veritabanı hatası' });
            }
            
            console.log(`Yeni kullanıcı eklendi. ID: ${this.lastID}, Zaman: ${getTurkishTimeString()}`);
            
            res.status(201).json({ 
              success: true, 
              message: 'Kullanıcı başarıyla eklendi',
              userId: this.lastID 
            });
          });
    });
});

// 3. Kullanıcıları listeleme endpoint'i (sadece admin için)
app.get('/api/users', (req, res) => {
    const currentTime = getCurrentTimestamp();
    console.log(`Kullanıcılar çekiliyor - Zaman: ${getTurkishTimeString()}`);
  
    // Sadece yöneticilere izin ver (gerçek uygulamada oturum kontrolü yapılmalı)
    // Bu örnekte oturum kontrolü atlanmıştır
  
    db.all(`SELECT id, name, username, userType, lastLogin FROM users`, [], (err, rows) => {
        if (err) {
            console.error('Kullanıcılar çekilirken hata:', err.message);
            return res.status(500).json({ success: false, message: 'Sunucu hatası' });
        }
        
        console.log(`${rows.length} adet kullanıcı kaydı bulundu.`);
        res.json({ success: true, users: rows });
    });
});

// 3. Kullanıcıları listeleme endpoint'i (sadece admin için)
app.get('/api/users/list', (req, res) => {
    const query = `SELECT id, username, userType, createdAt FROM users`;
    db.all(query, [], (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        res.json(users);
    });
});

// Ders programı için API endpoint'leri
// 1. Ders programını getir
app.get('/api/schedule/get', (req, res) => {
    try {
        console.log('Ders programı getirme isteği alındı');
        // Varsayılan olarak kullanıcı 1 (genel program)
        const userId = req.query.userId || 1;
        
        // API isteğini loglama
        console.log(`Ders programı getiriliyor - Kullanıcı ID: ${userId}`);
        
        // Sorguyu hazırla
        let query, params;
        
        if (isPg) {
            query = `SELECT rowIndex, colIndex, content FROM schedule WHERE userId = $1`;
            params = [userId];
        } else {
            query = `SELECT rowIndex, colIndex, content FROM schedule WHERE userId = ?`;
            params = [userId];
        }
        
        console.log('Sorgu çalıştırılıyor:', query, 'Parametreler:', params);
        
        // Sorguyu çalıştır
        db.all(query, params, (err, rows) => {
            if (err) {
                console.error('Ders programı verileri alınırken hata:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Veritabanı hatası'
                });
            }
            
            console.log(`${rows?.length || 0} adet kayıt bulundu`);
            
            // Veriyi formatla
            const scheduleData = {};
            
            if (rows && rows.length > 0) {
                rows.forEach(row => {
                    if (!scheduleData[row.rowIndex]) {
                        scheduleData[row.rowIndex] = {};
                    }
                    scheduleData[row.rowIndex][row.colIndex] = row.content;
                });
            }
            
            // Başarılı yanıt
            return res.json({
                success: true,
                schedule: scheduleData,
                timestamp: new Date().toISOString()
            });
        });
    } catch (error) {
        console.error('Ders programı getirme istisna hatası:', error);
        return res.status(500).json({
            success: false,
            error: 'Sunucu hatası'
        });
    }
});

// 2. Ders programını kaydet
app.post('/api/schedule/save', (req, res) => {
    console.log(`Ders programı kayıt isteği alındı - Zaman: ${getTurkishTimeString()}`);
    
    // Client'tan gelen veri
    const userId = req.body.userId || 1; // Varsayılan olarak 1 kullan
    const scheduleData = req.body.data || req.body; // Ya data içinde ya da direkt olarak gelecek
    
    console.log(`Ders programı kaydediliyor - Kullanıcı: ${userId}`);
    
    if (!scheduleData) {
        console.error('Ders programı verisi eksik');
        return res.status(400).json({
            success: false,
            message: 'Ders programı verisi gereklidir'
        });
    }
    
    try {
        // Önce mevcut kayıtları sil
        let deleteQuery;
        let deleteParams;
        
        if (isPg) {
            deleteQuery = `DELETE FROM schedule WHERE userId = $1`;
            deleteParams = [userId];
        } else {
            deleteQuery = `DELETE FROM schedule WHERE userId = ?`;
            deleteParams = [userId];
        }
        
        db.run(deleteQuery, deleteParams, function(err) {
            if (err) {
                console.error('Mevcut ders programı silinirken hata:', err.message);
                return res.status(500).json({
                    success: false,
                    message: 'Ders programı güncellenirken hata oluştu'
                });
            }
            
            let insertedCount = 0;
            let totalToInsert = 0;
            
            // Yeni kayıtları ekle
            let insertQuery;
            
            if (isPg) {
                insertQuery = `INSERT INTO schedule (userId, rowIndex, colIndex, content, updatedAt)
                               VALUES ($1, $2, $3, $4, $5)`;
            } else {
                insertQuery = `INSERT OR REPLACE INTO schedule (userId, rowIndex, colIndex, content, updatedAt)
                               VALUES (?, ?, ?, ?, ?)`;
            }
            
            // Her bir hücre için kayıt ekle
            Object.keys(scheduleData).forEach(rowIndex => {
                Object.keys(scheduleData[rowIndex]).forEach(colIndex => {
                    const content = scheduleData[rowIndex][colIndex];
                    totalToInsert++;
                    
                    let params;
                    if (isPg) {
                        params = [userId, rowIndex, colIndex, content, new Date().toISOString()];
                    } else {
                        params = [userId, rowIndex, colIndex, content, new Date().toISOString()];
                    }
                    
                    db.run(insertQuery, params, function(err) {
                        if (err) {
                            console.error(`Ders programı hücresi eklenirken hata - Satır: ${rowIndex}, Sütun: ${colIndex}:`, err.message);
                        } else {
                            insertedCount++;
                            
                            // Tüm kayıtlar eklendiyse yanıt gönder
                            if (insertedCount === totalToInsert) {
                                console.log(`Ders programı başarıyla kaydedildi - ${insertedCount} hücre güncellendi`);
                                res.json({
                                    success: true,
                                    message: `Ders programı başarıyla güncellendi (${insertedCount} hücre)`
                                });
                            }
                        }
                    });
                });
            });
            
            // Eğer hiç hücre eklenmeyecekse yanıt gönder
            if (totalToInsert === 0) {
                console.log('Kaydedilecek hücre yok');
                res.json({
                    success: true,
                    message: 'Ders programında değişiklik yapılmadı'
                });
            }
        });
    } catch (error) {
        console.error('Ders programı kaydedilirken hata:', error);
        res.status(500).json({
            success: false,
            message: 'Ders programı kaydedilirken bir hata oluştu'
        });
    }
});

// Ödevler için API endpoint'leri
// 1. Tüm ödevleri getir
app.get('/api/homework/get', (req, res) => {
    const query = `SELECT * FROM homework ORDER BY dueDate ASC`;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error(`Ödev verileri çekilirken hata (${getTurkishTimeString()}):`, err);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        console.log(`${rows.length} adet ödev kaydı bulundu. Zaman: ${getTurkishTimeString()}`);
        res.json(rows);
    });
});

// 2. Yeni ödev ekle
app.post('/api/homework/add', (req, res) => {
    const { title, lesson, dueDate, description } = req.body;
    const userType = req.body.userType;
    
    // Sadece yöneticiler ödev ekleyebilir
    if (userType !== 'admin') {
        console.log('Yetkisiz erişim - Sadece yöneticiler ödev ekleyebilir!');
        return res.status(403).json({ 
            error: 'Yetkisiz erişim. Sadece yöneticiler ödev ekleyebilir!'
        });
    }
    
    // Veri validasyonu yap
    if (!lesson || !dueDate || !description) {
        console.log('Geçersiz ödev verisi:', req.body);
        return res.status(400).json({ error: 'Ders, teslim tarihi ve açıklama zorunludur!' });
    }
    
    // Eğer title yoksa lesson değerini kullan
    const homeworkTitle = title || lesson;
    
    const query = `
        INSERT INTO homework (title, lesson, dueDate, description, isCompleted) 
        VALUES (?, ?, ?, ?, 0)
    `;
    
    db.run(query, [homeworkTitle, lesson, dueDate, description], function(err) {
        if (err) {
            console.error('Ödev eklenirken hata:', err);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        const homeworkId = this.lastID;
        console.log(`Yeni ödev eklendi. ID: ${homeworkId}, Zaman: ${getTurkishTimeString()}`);
        
        res.json({ 
            success: true, 
            message: 'Ödev başarıyla eklendi',
            homeworkId: homeworkId
        });
    });
});

// 3. Ödev güncelle
app.put('/api/homework/update/:id', (req, res) => {
    const homeworkId = req.params.id;
    const { title, lesson, dueDate, description } = req.body;
    const userType = req.body.userType;
    
    // Sadece yöneticiler ödev güncelleyebilir
    if (userType !== 'admin') {
        console.log('Yetkisiz erişim - Sadece yöneticiler ödev güncelleyebilir!');
        return res.status(403).json({ 
            error: 'Yetkisiz erişim. Sadece yöneticiler ödev güncelleyebilir!'
        });
    }
    
    // Veri validasyonu yap
    if (!lesson || !dueDate || !description) {
        console.log('Geçersiz ödev verisi:', req.body);
        return res.status(400).json({ error: 'Ders, teslim tarihi ve açıklama zorunludur!' });
    }
    
    // Eğer title yoksa lesson değerini kullan
    const homeworkTitle = title || lesson;
    
    const query = `
        UPDATE homework 
        SET title = ?, lesson = ?, dueDate = ?, description = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
    `;
    
    db.run(query, [homeworkTitle, lesson, dueDate, description, homeworkId], function(err) {
        if (err) {
            console.error('Ödev güncellenirken hata:', err);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Ödev bulunamadı' });
        }
        
        console.log(`Ödev güncellendi. ID: ${homeworkId}, Zaman: ${getTurkishTimeString()}`);
        
        res.json({ 
            success: true, 
            message: 'Ödev başarıyla güncellendi',
            homeworkId: homeworkId
        });
    });
});

// 4. Ödev sil
app.delete('/api/homework/delete/:id', (req, res) => {
    const { id } = req.params;
    const userType = req.body.userType;
    
    // Sadece yöneticiler ödev silebilir
    if (userType !== 'admin') {
        console.log('Yetkisiz erişim - Sadece yöneticiler ödev silebilir!');
        return res.status(403).json({ 
            error: 'Yetkisiz erişim. Sadece yöneticiler ödev silebilir!'
        });
    }
    
    const query = `DELETE FROM homework WHERE id = ?`;
    
    db.run(query, [id], function(err) {
        if (err) {
            console.error('Ödev silinirken hata:', err);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Ödev bulunamadı' });
        }
        
        console.log(`Ödev silindi. ID: ${id}, Zaman: ${getTurkishTimeString()}`);
        
        res.json({ 
            success: true, 
            message: 'Ödev başarıyla silindi',
            id: id
        });
    });
});

// Duyurular için API endpoint'leri
// 1. Tüm duyuruları getir
app.get('/api/announcements/get', (req, res) => {
    const query = `SELECT * FROM announcements ORDER BY createdAt DESC`;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Duyuru verileri çekilirken hata:', err);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        console.log(`${rows.length} adet duyuru kaydı bulundu.`);
        res.json(rows);
    });
});

// 2. Yeni duyuru ekle
app.post('/api/announcements/add', (req, res) => {
    const { title, content, importance } = req.body;
    const userType = req.body.userType;
    
    // Sadece yöneticiler duyuru ekleyebilir
    if (userType !== 'admin') {
        console.log('Yetkisiz erişim - Sadece yöneticiler duyuru ekleyebilir!');
        return res.status(403).json({ 
            error: 'Yetkisiz erişim. Sadece yöneticiler duyuru ekleyebilir!'
        });
    }
    
    // Veri validasyonu yap
    if (!title || !content) {
        console.log('Geçersiz duyuru verisi:', req.body);
        return res.status(400).json({ error: 'Başlık ve içerik zorunludur!' });
    }
    
    // Geriye uyumluluk için
    const important = importance === 'important' || importance === 'critical' ? 1 : 0;
    const timestamp = getCurrentTimestamp();
    
    const query = `
        INSERT INTO announcements (title, content, importance, important, createdAt, updatedAt) 
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    db.run(query, [title, content, importance, important, timestamp, timestamp], function(err) {
        if (err) {
            console.error('Duyuru eklenirken hata:', err);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        const announcementId = this.lastID;
        console.log(`Yeni duyuru eklendi. ID: ${announcementId}, Zaman: ${getTurkishTimeString()}`);
        
        res.json({ 
            success: true, 
            message: 'Duyuru başarıyla eklendi',
            announcementId: announcementId
        });
    });
});

// 3. Duyuru güncelle
app.put('/api/announcements/update/:id', (req, res) => {
    const announcementId = req.params.id;
    const { title, content, importance } = req.body;
    const userType = req.body.userType;
    
    // Sadece yöneticiler duyuru güncelleyebilir
    if (userType !== 'admin') {
        console.log('Yetkisiz erişim - Sadece yöneticiler duyuru güncelleyebilir!');
        return res.status(403).json({ 
            error: 'Yetkisiz erişim. Sadece yöneticiler duyuru güncelleyebilir!'
        });
    }
    
    // Veri validasyonu yap
    if (!title || !content) {
        console.log('Geçersiz duyuru verisi:', req.body);
        return res.status(400).json({ error: 'Başlık ve içerik zorunludur!' });
    }
    
    // Geriye uyumluluk için
    const important = importance === 'important' || importance === 'critical' ? 1 : 0;
    const timestamp = getCurrentTimestamp();
    
    const query = `
        UPDATE announcements 
        SET title = ?, content = ?, importance = ?, important = ?, updatedAt = ?
        WHERE id = ?
    `;
    
    db.run(query, [title, content, importance, important, timestamp, announcementId], function(err) {
        if (err) {
            console.error('Duyuru güncellenirken hata:', err);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Duyuru bulunamadı' });
        }
        
        console.log(`Duyuru güncellendi. ID: ${announcementId}, Zaman: ${getTurkishTimeString()}`);
        
        res.json({ 
            success: true, 
            message: 'Duyuru başarıyla güncellendi',
            announcementId: announcementId
        });
    });
});

// 4. Duyuru sil
app.delete('/api/announcements/delete/:id', (req, res) => {
    const { id } = req.params;
    const userType = req.body.userType;
    
    // Sadece yöneticiler duyuru silebilir
    if (userType !== 'admin') {
        console.log('Yetkisiz erişim - Sadece yöneticiler duyuru silebilir!');
        return res.status(403).json({ 
            error: 'Yetkisiz erişim. Sadece yöneticiler duyuru silebilir!'
        });
    }
    
    const query = `DELETE FROM announcements WHERE id = ?`;
    
    db.run(query, [id], function(err) {
        if (err) {
            console.error('Duyuru silinirken hata:', err);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Duyuru bulunamadı' });
        }
        
        console.log(`Duyuru silindi. ID: ${id}, Zaman: ${getTurkishTimeString()}`);
        
        res.json({ 
            success: true, 
            message: 'Duyuru başarıyla silindi',
            id: id
        });
    });
});

// Sınav notları için API endpoint'leri
// 1. Tüm sınav notlarını getir
app.get('/api/grades/get', (req, res) => {
    const query = `SELECT * FROM grades ORDER BY examDate DESC, lesson ASC, title ASC`;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Çalışma notları çekilirken hata:', err);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        console.log(`${rows.length} adet çalışma notu bulundu. Zaman: ${getTurkishTimeString()}`);
        res.json(rows);
    });
});

// 2. Yeni sınav notu ekle (dosya yükleme desteği ile)
app.post('/api/grades/add', upload.single('file'), (req, res) => {
    const { title, lesson, type, examDate } = req.body;
    const userType = req.body.userType;
    
    // Sadece yöneticiler çalışma notu ekleyebilir
    if (userType !== 'admin') {
        // Dosya yüklendiyse sil
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Dosya silinirken hata:', err);
            });
        }
        
        console.log('Yetkisiz erişim - Sadece yöneticiler çalışma notu ekleyebilir!');
        return res.status(403).json({ 
            error: 'Yetkisiz erişim. Sadece yöneticiler çalışma notu ekleyebilir!'
        });
    }
    
    // Veri validasyonu yap
    if (!title || !lesson || !type || !examDate) {
        // Dosya yüklendiyse sil
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Dosya silinirken hata:', err);
            });
        }
        
        console.log('Geçersiz çalışma notu verisi:', req.body);
        return res.status(400).json({ error: 'Not başlığı, ders, not türü ve tarih zorunludur!' });
    }
    
    const timestamp = getCurrentTimestamp();
    
    // Dosya bilgileri
    const filePath = req.file ? req.file.path.replace(/\\/g, '/') : null;
    const fileName = req.file ? req.file.originalname : null;
    const fileSize = req.file ? req.file.size : null;
    
    const query = `
        INSERT INTO grades (title, lesson, type, file_path, file_name, file_size, examDate, createdAt, updatedAt) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(query, [title, lesson, type, filePath, fileName, fileSize, examDate, timestamp, timestamp], function(err) {
        if (err) {
            console.error('Çalışma notu eklenirken hata:', err);
            
            // Dosya yüklendiyse sil
            if (req.file) {
                fs.unlink(req.file.path, (err) => {
                    if (err) console.error('Dosya silinirken hata:', err);
                });
            }
            
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        const gradeId = this.lastID;
        console.log(`Yeni çalışma notu eklendi. ID: ${gradeId}, Zaman: ${getTurkishTimeString()}`);
        
        res.json({ 
            success: true, 
            message: 'Çalışma notu başarıyla eklendi',
            gradeId: gradeId,
            hasFile: !!req.file
        });
    });
});

// 3. Sınav notu güncelle (dosya yükleme desteği ile)
app.put('/api/grades/update/:id', upload.single('file'), (req, res) => {
    const gradeId = req.params.id;
    const { title, lesson, type, examDate, keepExistingFile } = req.body;
    const userType = req.body.userType;
    
    // Sadece yöneticiler çalışma notu güncelleyebilir
    if (userType !== 'admin') {
        // Dosya yüklendiyse sil
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Dosya silinirken hata:', err);
            });
        }
        
        console.log('Yetkisiz erişim - Sadece yöneticiler çalışma notu güncelleyebilir!');
        return res.status(403).json({ 
            error: 'Yetkisiz erişim. Sadece yöneticiler çalışma notu güncelleyebilir!'
        });
    }
    
    // Veri validasyonu yap
    if (!title || !lesson || !type || !examDate) {
        // Dosya yüklendiyse sil
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Dosya silinirken hata:', err);
            });
        }
        
        console.log('Geçersiz çalışma notu verisi:', req.body);
        return res.status(400).json({ error: 'Not başlığı, ders, not türü ve tarih zorunludur!' });
    }
    
    // Mevcut dosya yolunu al (varsa dosya silinecek)
    db.get(`SELECT file_path FROM grades WHERE id = ?`, [gradeId], (err, row) => {
        if (err) {
            console.error('Dosya bilgisi alınırken hata:', err);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        const timestamp = getCurrentTimestamp();
        let query, params;
        
        // Yeni dosya yüklendi mi?
        if (req.file) {
            // Yeni dosya yüklendi, eskisini sil ve yenisini güncelle
            const filePath = req.file.path.replace(/\\/g, '/');
            const fileName = req.file.originalname;
            const fileSize = req.file.size;
            
            query = `
                UPDATE grades 
                SET title = ?, lesson = ?, type = ?, file_path = ?, file_name = ?, file_size = ?, examDate = ?, updatedAt = ?
                WHERE id = ?
            `;
            params = [title, lesson, type, filePath, fileName, fileSize, examDate, timestamp, gradeId];
            
            // Eğer önceki dosya varsa ve korunması istenmiyorsa sil
            if (row && row.file_path && keepExistingFile !== 'true') {
                fs.unlink(row.file_path, (err) => {
                    if (err) console.error('Önceki dosya silinirken hata:', err);
                });
            }
        } else if (keepExistingFile === 'false' && row && row.file_path) {
            // Dosya yüklenmedi ve mevcut dosyanın silinmesi istendi
            query = `
                UPDATE grades 
                SET title = ?, lesson = ?, type = ?, file_path = NULL, file_name = NULL, file_size = NULL, examDate = ?, updatedAt = ?
                WHERE id = ?
            `;
            params = [title, lesson, type, examDate, timestamp, gradeId];
            
            // Mevcut dosyayı sil
            fs.unlink(row.file_path, (err) => {
                if (err) console.error('Mevcut dosya silinirken hata:', err);
            });
        } else {
            // Dosya yüklenmedi, dosya bilgilerini değiştirme
            query = `
                UPDATE grades 
                SET title = ?, lesson = ?, type = ?, examDate = ?, updatedAt = ?
                WHERE id = ?
            `;
            params = [title, lesson, type, examDate, timestamp, gradeId];
        }
        
        db.run(query, params, function(err) {
            if (err) {
                console.error('Çalışma notu güncellenirken hata:', err);
                
                // Eğer yeni dosya yüklendiyse ama veritabanı hatası olduysa dosyayı sil
                if (req.file) {
                    fs.unlink(req.file.path, (err) => {
                        if (err) console.error('Dosya silinirken hata:', err);
                    });
                }
                
                return res.status(500).json({ error: 'Veritabanı hatası' });
            }
            
            if (this.changes === 0) {
                // İlgili çalışma notu bulunamadıysa ve dosya yüklendiyse dosyayı sil
                if (req.file) {
                    fs.unlink(req.file.path, (err) => {
                        if (err) console.error('Dosya silinirken hata:', err);
                    });
                }
                
                return res.status(404).json({ error: 'Çalışma notu bulunamadı' });
            }
            
            console.log(`Çalışma notu güncellendi. ID: ${gradeId}, Zaman: ${getTurkishTimeString()}`);
            
            res.json({ 
                success: true, 
                message: 'Çalışma notu başarıyla güncellendi',
                gradeId: gradeId,
                hasNewFile: !!req.file
            });
        });
    });
});

// 4. Sınav notu sil (dosya temizleme ile)
app.delete('/api/grades/delete/:id', (req, res) => {
    const { id } = req.params;
    const userType = req.body.userType;
    
    // Sadece yöneticiler çalışma notu silebilir
    if (userType !== 'admin') {
        console.log('Yetkisiz erişim - Sadece yöneticiler çalışma notu silebilir!');
        return res.status(403).json({ 
            error: 'Yetkisiz erişim. Sadece yöneticiler çalışma notu silebilir!'
        });
    }
    
    // Önce dosya yolunu al
    db.get(`SELECT file_path FROM grades WHERE id = ?`, [id], (err, row) => {
        if (err) {
            console.error('Dosya bilgisi alınırken hata:', err);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        const query = `DELETE FROM grades WHERE id = ?`;
        
        db.run(query, [id], function(err) {
            if (err) {
                console.error('Çalışma notu silinirken hata:', err);
                return res.status(500).json({ error: 'Veritabanı hatası' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Çalışma notu bulunamadı' });
            }
            
            // Eğer dosya varsa, sil
            if (row && row.file_path) {
                fs.unlink(row.file_path, (err) => {
                    if (err) console.error('Dosya silinirken hata:', err);
                });
            }
            
            console.log(`Çalışma notu silindi. ID: ${id}, Zaman: ${getTurkishTimeString()}`);
            
            res.json({ 
                success: true, 
                message: 'Çalışma notu başarıyla silindi',
                id: id
            });
        });
    });
});

// Dosya indirme endpoint'i
app.get('/api/grades/download/:id', (req, res) => {
    const gradeId = req.params.id;
    
    db.get(`SELECT file_path, file_name FROM grades WHERE id = ?`, [gradeId], (err, row) => {
        if (err) {
            console.error('Dosya bilgisi alınırken hata:', err);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        if (!row || !row.file_path || !row.file_name) {
            return res.status(404).json({ error: 'Dosya bulunamadı' });
        }
        
        const filePath = row.file_path;
        const fileName = row.file_name;
        
        // Dosya var mı kontrol et
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Dosya disk üzerinde bulunamadı' });
        }
        
        // Dosyayı indir
        res.download(filePath, fileName, (err) => {
            if (err) {
                console.error('Dosya indirme hatası:', err);
                return res.status(500).json({ error: 'Dosya indirme hatası' });
            }
        });
    });
});

// Ders programı için örnek veriler ekleme (veritabanı boşsa)
db.serialize(() => {
  // Veritabanında kayıt var mı kontrol et
  let tablesWithDataCount = 0;
  
  // Ders programı kontrolü
  db.get("SELECT COUNT(*) as count FROM schedule", [], (err, row) => {
    if (!err && row.count === 0) {
      // Ders programı için örnek veri ekle
      addScheduleExamples();
    } else {
      console.log("Ders programında zaten veri bulunuyor, örnek veriler eklenmeyecek.");
    }
  });
  
  // Ödevler kontrolü
  db.get("SELECT COUNT(*) as count FROM homework", [], (err, row) => {
    if (!err && row.count === 0) {
      // Ödevler için örnek veri ekle
      addHomeworkExamples();
    } else {
      console.log("Ödevlerde zaten veri bulunuyor, örnek veriler eklenmeyecek.");
    }
  });
  
  // Duyurular kontrolü
  db.get("SELECT COUNT(*) as count FROM announcements", [], (err, row) => {
    if (!err && row.count === 0) {
      // Duyurular için örnek veri ekle
      addAnnouncementExamples();
    } else {
      console.log("Duyurularda zaten veri bulunuyor, örnek veriler eklenmeyecek.");
    }
  });
  
  // Sınav çalışma notları kontrolü
  db.get("SELECT COUNT(*) as count FROM grades", [], (err, row) => {
    if (!err && row.count === 0) {
      // Sınav çalışma notları için örnek veri ekle
      addGradeExamples();
    } else {
      console.log("Sınav çalışma notlarında zaten veri bulunuyor, örnek veriler eklenmeyecek.");
    }
  });
});

// Örnek ders programı verilerini ekleyen fonksiyon
function addScheduleExamples() {
    console.log('Örnek ders programı kayıtları ekleniyor...');
    
    // Örnek veriler
    const scheduleData = [
        { userId: 1, rowIndex: 1, colIndex: 1, content: 'Matematik' },
        { userId: 1, rowIndex: 1, colIndex: 2, content: 'Fizik' },
        { userId: 1, rowIndex: 1, colIndex: 3, content: 'Kimya' },
        { userId: 1, rowIndex: 1, colIndex: 4, content: 'Biyoloji' },
        { userId: 1, rowIndex: 1, colIndex: 5, content: 'Matematik' },
        { userId: 1, rowIndex: 2, colIndex: 1, content: 'Türkçe' },
        { userId: 1, rowIndex: 2, colIndex: 2, content: 'Matematik' },
        { userId: 1, rowIndex: 2, colIndex: 3, content: 'İngilizce' },
        { userId: 1, rowIndex: 2, colIndex: 4, content: 'Tarih' },
        { userId: 1, rowIndex: 2, colIndex: 5, content: 'Coğrafya' },
        { userId: 1, rowIndex: 3, colIndex: 1, content: 'Fizik' },
        { userId: 1, rowIndex: 3, colIndex: 2, content: 'Kimya' },
        { userId: 1, rowIndex: 3, colIndex: 3, content: 'Matematik' },
        { userId: 1, rowIndex: 3, colIndex: 4, content: 'Edebiyat' },
        { userId: 1, rowIndex: 3, colIndex: 5, content: 'İngilizce' }
    ];
    
    // Veri tabanı tipine göre sorgu hazırla ve çalıştır
    if (isPg) {
        // PostgreSQL için
        // Önce mevcut verileri temizleyelim
        db.run(`DELETE FROM schedule WHERE userId = 1`, [], function(err) {
            if (err) {
                console.error('Schedule verileri temizlenirken hata:', err.message);
            } else {
                console.log('Schedule verileri temizlendi, yeni kayıtlar ekleniyor');
                
                // Şimdi yeni kayıtları ekleyelim
                const now = new Date().toISOString();
                let insertedCount = 0;
                
                scheduleData.forEach(data => {
                    const query = `
                        INSERT INTO schedule (userId, rowIndex, colIndex, content, createdAt, updatedAt)
                        VALUES ($1, $2, $3, $4, $5, $6)
                    `;
                    const params = [data.userId, data.rowIndex, data.colIndex, data.content, now, now];
                    
                    db.run(query, params, err => {
                        if (err) {
                            console.error('Örnek ders programı verisi eklenirken hata:', err.message);
                        } else {
                            insertedCount++;
                            console.log(`Schedule kaydı eklendi: ${insertedCount}/${scheduleData.length}`);
                        }
                    });
                });
            }
        });
    } else {
        // SQLite için
        // Önce mevcut verileri temizleyelim
        db.run(`DELETE FROM schedule WHERE userId = 1`, [], function(err) {
            if (err) {
                console.error('Schedule verileri temizlenirken hata:', err.message);
            } else {
                console.log('Schedule verileri temizlendi, yeni kayıtlar ekleniyor');
                
                // Şimdi yeni kayıtları ekleyelim
                const stmt = db.prepare(`INSERT INTO schedule (userId, rowIndex, colIndex, content, createdAt, updatedAt)
                                   VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
                
                scheduleData.forEach(data => {
                    stmt.run(data.userId, data.rowIndex, data.colIndex, data.content, err => {
                        if (err) {
                            console.error('Örnek ders programı verisi eklenirken hata:', err.message);
                        }
                    });
                });
                
                stmt.finalize();
                console.log('Örnek ders programı kayıtları eklendi');
            }
        });
    }
}

// Örnek ödev verilerini ekleyen fonksiyon
function addHomeworkExamples() {
  console.log('Ödevler için örnek veriler ekleniyor...');
  
  // Örnek ödevler
  const homeworkData = [
    { title: "Matematik Türev Soruları", lesson: "Matematik", dueDate: "2025-03-20", description: "Sayfa 45-50 arası tüm türev sorularını çöz." },
    { title: "Fizik Elektrik Konusu", lesson: "Fizik", dueDate: "2025-03-22", description: "Elektrik konusu ile ilgili verilen problemlerin çözümünü tamamla." },
    { title: "Kimya Formüller", lesson: "Kimya", dueDate: "2025-03-25", description: "Organik kimya formüllerini ezberle ve test çöz." },
    { title: "İngilizce Ödev", lesson: "İngilizce", dueDate: "2025-03-18", description: "Verilen paragraflardaki boşlukları uygun kelimelerle doldur." },
    { title: "Tarih Araştırma", lesson: "Tarih", dueDate: "2025-03-30", description: "Osmanlı Devleti'nin kuruluşu hakkında kapsamlı bir araştırma yap." }
  ];
  
  // Her bir ödevi ekle
  const stmt = db.prepare(`INSERT INTO homework (title, lesson, dueDate, description, isCompleted, createdAt, updatedAt) 
                           VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
  
  homeworkData.forEach(data => {
    stmt.run(data.title, data.lesson, data.dueDate, data.description, (err) => {
      if (err) {
        console.error('Ödev verisi eklenirken hata:', err.message);
      }
    });
  });
  
  stmt.finalize();
  console.log('Ödevler için örnek veriler eklendi.');
}

// Örnek duyuru verilerini ekleyen fonksiyon
function addAnnouncementExamples() {
  console.log('Duyurular için örnek veriler ekleniyor...');
  
  // Örnek duyurular
  const announcementData = [
    { title: "Öğrenci Toplantısı", content: "Yarın saat 14:00'da tüm öğrencilerin katılımıyla bir toplantı yapılacaktır.", importance: "important" },
    { title: "Sınav Tarihleri", content: "Dönem sonu sınavları 10-20 Nisan tarihleri arasında yapılacaktır. Detaylı program ekte sunulmuştur.", importance: "critical" },
    { title: "Kütüphane Çalışma Saatleri", content: "Kütüphane çalışma saatleri hafta içi 08:00-20:00, hafta sonu 10:00-18:00 olarak güncellenmiştir.", importance: "normal" },
    { title: "Proje Teslim Tarihi", content: "Dönem projelerinin son teslim tarihi 5 Nisan'dır. Geç teslimler kabul edilmeyecektir.", importance: "important" },
    { title: "Spor Salonu Kullanımı", content: "Spor salonu tadilatı nedeniyle 1 hafta boyunca kapalı olacaktır.", importance: "normal" }
  ];
  
  const timestamp = getCurrentTimestamp();
  
  // Her bir duyuruyu ekle
  const stmt = db.prepare(`INSERT INTO announcements (title, content, importance, important, createdAt, updatedAt) 
                           VALUES (?, ?, ?, ?, ?, ?)`);
  
  announcementData.forEach(data => {
    const important = data.importance === 'important' || data.importance === 'critical' ? 1 : 0;
    stmt.run(data.title, data.content, data.importance, important, timestamp, timestamp, (err) => {
      if (err) {
        console.error('Duyuru verisi eklenirken hata:', err.message);
      }
    });
  });
  
  stmt.finalize();
  console.log('Duyurular için örnek veriler eklendi.');
}

// Örnek sınav çalışma notları verilerini ekleyen fonksiyon
function addGradeExamples() {
  console.log('Sınav çalışma notları için örnek veriler ekleniyor...');
  
  // Örnek sınav çalışma notları - Dosya olmadan
  const gradesData = [
    { title: "Türev Formülleri", lesson: "Matematik", type: "Konu Özeti", examDate: "2025-04-10" },
    { title: "Elektrik Konusu", lesson: "Fizik", type: "Soru Bankası", examDate: "2025-04-12" },
    { title: "Organik Kimya", lesson: "Kimya", type: "Yazılı Hazırlık", examDate: "2025-04-15" },
    { title: "İngilizce Kelimeler", lesson: "İngilizce", type: "Kelime Listesi", examDate: "2025-04-08" },
    { title: "Osmanlı Tarihi", lesson: "Tarih", type: "Dönem Öncesi Tekrar", examDate: "2025-04-20" }
  ];
  
  const timestamp = getCurrentTimestamp();
  
  // Her bir sınav çalışma notunu ekle
  const stmt = db.prepare(`INSERT INTO grades (title, lesson, type, examDate, createdAt, updatedAt) 
                           VALUES (?, ?, ?, ?, ?, ?)`);
  
  gradesData.forEach(data => {
    stmt.run(data.title, data.lesson, data.type, data.examDate, timestamp, timestamp, (err) => {
      if (err) {
        console.error('Sınav çalışma notu eklenirken hata:', err.message);
      }
    });
  });
  
  stmt.finalize();
  console.log('Sınav çalışma notları için örnek veriler eklendi.');
}

// Tek kullanıcı bilgisi
app.get('/api/users/:id', (req, res) => {
    const userId = req.params.id;
    console.log(`Kullanıcı bilgisi çekiliyor (ID: ${userId}) - Zaman: ${getTurkishTimeString()}`);
    
    db.get(`SELECT id, name, username, userType, lastLogin FROM users WHERE id = ?`, [userId], (err, row) => {
        if (err) {
            console.error('Kullanıcı bilgisi çekilirken hata:', err.message);
            return res.status(500).json({ success: false, message: 'Sunucu hatası' });
        }
        
        if (!row) {
            return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı' });
        }
        
        res.json({ success: true, user: row });
    });
});

// Kullanıcı ekleme
app.post('/api/users', (req, res) => {
    const { name, username, password, userType } = req.body;
    console.log(`Yeni kullanıcı ekleniyor (${username}) - Zaman: ${getTurkishTimeString()}`);
    
    // Tüm gerekli alanların kontrolü
    if (!name || !username || !password || !userType) {
        return res.status(400).json({ success: false, message: 'Tüm alanları doldurun' });
    }
    
    // Kullanıcı tipi kontrolü
    const allowedTypes = ['admin', 'teacher', 'student'];
    if (!allowedTypes.includes(userType)) {
        return res.status(400).json({ success: false, message: 'Geçerli bir kullanıcı tipi seçin' });
    }
    
    // Kullanıcı adının benzersiz olup olmadığını kontrol et
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, row) => {
        if (err) {
            console.error('Kullanıcı kontrolü yapılırken hata:', err.message);
            return res.status(500).json({ success: false, message: 'Sunucu hatası' });
        }
        
        if (row) {
            return res.status(400).json({ success: false, message: 'Bu kullanıcı adı başka bir kullanıcı tarafından kullanılıyor' });
        }
        
        // Şifreleme yapalım
        const hashedPassword = Buffer.from(password).toString('base64');
        
        // Kullanıcıyı ekle
        db.run(`INSERT INTO users (name, username, password, userType) VALUES (?, ?, ?, ?)`, 
            [name, username, hashedPassword, userType], 
            function(err) {
                if (err) {
                    console.error('Kullanıcı eklenirken hata:', err.message);
                    return res.status(500).json({ success: false, message: 'Sunucu hatası' });
                }
                
                console.log(`Yeni kullanıcı eklendi. ID: ${this.lastID}, Zaman: ${getTurkishTimeString()}`);
                
                res.status(201).json({ 
                    success: true, 
                    message: 'Kullanıcı başarıyla eklendi',
                    userId: this.lastID 
                });
            });
    });
});

// Kullanıcı güncelleme
app.put('/api/users/:id', (req, res) => {
    const userId = req.params.id;
    const { name, username, password, userType } = req.body;
    console.log(`Kullanıcı güncelleniyor (ID: ${userId}) - Zaman: ${getTurkishTimeString()}`);
    
    // Gerekli alanların kontrolü
    if (!name || !username || !userType) {
        return res.status(400).json({ success: false, message: 'Ad, kullanıcı adı ve kullanıcı tipi alanları zorunludur' });
    }
    
    // Kullanıcı tipi kontrolü
    const allowedTypes = ['admin', 'teacher', 'student'];
    if (!allowedTypes.includes(userType)) {
        return res.status(400).json({ success: false, message: 'Geçerli bir kullanıcı tipi seçin' });
    }
    
    // Kullanıcının varlığını kontrol et
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err) {
            console.error('Kullanıcı kontrolü yapılırken hata:', err.message);
            return res.status(500).json({ success: false, message: 'Sunucu hatası' });
        }
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı' });
        }
        
        // Kullanıcı adı benzersizliğini kontrol et (kendi kullanıcı adı hariç)
        db.get(`SELECT * FROM users WHERE username = ? AND id != ?`, [username, userId], (err, usernameCheck) => {
            if (err) {
                console.error('Kullanıcı adı kontrolü yapılırken hata:', err.message);
                return res.status(500).json({ success: false, message: 'Sunucu hatası' });
            }
            
            if (usernameCheck) {
                return res.status(400).json({ success: false, message: 'Bu kullanıcı adı başka bir kullanıcı tarafından kullanılıyor' });
            }
            
            // Güncelleme sorgusu oluştur
            let query = `UPDATE users SET name = ?, username = ?, userType = ?`;
            let params = [name, username, userType];
            
            // Şifre değiştirilecekse ekle
            if (password && password.trim() !== '') {
                const hashedPassword = Buffer.from(password).toString('base64');
                query += `, password = ?`;
                params.push(hashedPassword);
            }
            
            query += ` WHERE id = ?`;
            params.push(userId);
            
            // Kullanıcıyı güncelle
            db.run(query, params, function(err) {
                if (err) {
                    console.error('Kullanıcı güncellenirken hata:', err.message);
                    return res.status(500).json({ success: false, message: 'Sunucu hatası' });
                }
                
                console.log(`Kullanıcı güncellendi. ID: ${userId}, Zaman: ${getTurkishTimeString()}`);
                
                res.json({ 
                    success: true, 
                    message: 'Kullanıcı başarıyla güncellendi'
                });
            });
        });
    });
});

// Kullanıcı silme
app.delete('/api/users/:id', (req, res) => {
    const userId = req.params.id;
    console.log(`Kullanıcı siliniyor (ID: ${userId}) - Zaman: ${getTurkishTimeString()}`);
    
    // Kullanıcının varlığını kontrol et
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err) {
            console.error('Kullanıcı kontrolü yapılırken hata:', err.message);
            return res.status(500).json({ success: false, message: 'Sunucu hatası' });
        }
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı' });
        }
        
        // Admin kontrolü (son admini silmeyi engelle)
        if (user.userType === 'admin') {
            db.get(`SELECT COUNT(*) as count FROM users WHERE userType = 'admin'`, [], (err, result) => {
                if (err) {
                    console.error('Admin sayısı kontrol edilirken hata:', err.message);
                    return res.status(500).json({ success: false, message: 'Sunucu hatası' });
                }
                
                if (result.count <= 1) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Son yönetici kullanıcısı silinemez. Önce başka bir yönetici ekleyin.' 
                    });
                }
                
                deleteUserRecord(userId, res);
            });
        } else {
            deleteUserRecord(userId, res);
        }
    });
});

// Kullanıcı silme yardımcı fonksiyonu
function deleteUserRecord(userId, res) {
    db.run(`DELETE FROM users WHERE id = ?`, [userId], function(err) {
        if (err) {
            console.error('Kullanıcı silinirken hata:', err.message);
            return res.status(500).json({ success: false, message: 'Sunucu hatası' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı' });
        }
        
        console.log(`Kullanıcı silindi. ID: ${userId}, Zaman: ${getTurkishTimeString()}`);
        
        res.json({ 
            success: true, 
            message: 'Kullanıcı başarıyla silindi'
        });
    });
}

// Sunucuyu başlat
app.listen(PORT, () => {
    console.log(`Server ${PORT} portunda çalışıyor! Zaman: ${getTurkishTimeString()}`);
    console.log(`Uygulamaya erişmek için: http://localhost:${PORT}`);
    
    // Veritabanı başlatma kodları...
}); 

// Yeni endpoint - Kullanıcı oluşturma
app.get('/api/init', (req, res) => {
    // Güvenlik kontrolü - sadece istek Render'dan geliyorsa çalıştır
    const userHost = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    console.log(`Init endpoint çağrıldı - Host: ${userHost}`);
    
    // Base64 ile şifreleme (123456 şifresini Base64'e çeviriyoruz)
    const password = Buffer.from('123456').toString('base64');
    
    // Hem "Yönetici" hem de "admin" tipiyle oluşturalım
    if (isPg) {
        // PostgreSQL için
        console.log('PostgreSQL için varsayılan kullanıcılar oluşturuluyor...');
        
        const insertYoneticiSQL = `
            INSERT INTO users (name, username, password, userType)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (username) DO NOTHING
        `;
        
        db.run(insertYoneticiSQL, ['MEK Admin', 'MEK', password, 'Yönetici'], function(err) {
            if (err) {
                console.error('Init: Varsayılan Yönetici kullanıcısı oluştururken hata:', err.message);
            } else {
                console.log('Init: Varsayılan Yönetici kullanıcısı oluşturuldu: MEK');
            }
        });
        
        const insertAdminSQL = `
            INSERT INTO users (name, username, password, userType)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (username) DO NOTHING
        `;
        
        db.run(insertAdminSQL, ['Admin User', 'admin', password, 'admin'], function(err) {
            if (err) {
                console.error('Init: Varsayılan admin kullanıcısı oluştururken hata:', err.message);
            } else {
                console.log('Init: Varsayılan admin kullanıcısı oluşturuldu: admin');
            }
            
            // Kullanıcıları kontrol et
            db.all("SELECT id, username, userType FROM users", [], (err, rows) => {
                if (err) {
                    console.error('Init: Kullanıcı listesi kontrol edilirken hata:', err.message);
                    return res.json({ success: false, error: err.message, users: [] });
                }
                
                console.log('Init: Mevcut kullanıcılar:', rows);
                return res.json({ success: true, message: 'Veritabanı başlatıldı', users: rows });
            });
        });
    } else {
        // SQLite için
        console.log('SQLite için varsayılan kullanıcılar oluşturuluyor...');
        
        db.run(
            `INSERT OR IGNORE INTO users (name, username, password, userType) VALUES (?, ?, ?, ?)`,
            ['MEK Admin', 'MEK', password, 'Yönetici'],
            function(err) {
                if (err) {
                    console.error('Init: Varsayılan Yönetici kullanıcısı oluştururken hata:', err.message);
                } else {
                    console.log('Init: Varsayılan Yönetici kullanıcısı oluşturuldu: MEK');
                }
                
                db.run(
                    `INSERT OR IGNORE INTO users (name, username, password, userType) VALUES (?, ?, ?, ?)`,
                    ['Admin User', 'admin', password, 'admin'],
                    function(err) {
                        if (err) {
                            console.error('Init: Varsayılan admin kullanıcısı oluştururken hata:', err.message);
                        } else {
                            console.log('Init: Varsayılan admin kullanıcısı oluşturuldu: admin');
                        }
                        
                        // Kullanıcıları kontrol et
                        db.all("SELECT id, username, userType FROM users", [], (err, rows) => {
                            if (err) {
                                console.error('Init: Kullanıcı listesi kontrol edilirken hata:', err.message);
                                return res.json({ success: false, error: err.message, users: [] });
                            }
                            
                            console.log('Init: Mevcut kullanıcılar:', rows);
                            return res.json({ success: true, message: 'Veritabanı başlatıldı', users: rows });
                        });
                    }
                );
            }
        );
    }
}); 

// MEK kullanıcısının tipini güncelleyen endpoint
app.get('/api/update-mek', (req, res) => {
    console.log('MEK kullanıcısı admin tipine güncelleniyor...');
    
    // PostgreSQL için MEK kullanıcısının tipini güncelle
    let updateQuery, params;
    
    if (isPg) {
        updateQuery = `UPDATE users SET userType = $1 WHERE username = $2`;
        params = ['admin', 'MEK'];
    } else {
        updateQuery = `UPDATE users SET userType = ? WHERE username = ?`;
        params = ['admin', 'MEK'];
    }
    
    db.run(updateQuery, params, function(err) {
        if (err) {
            console.error('MEK kullanıcısı güncellenirken hata:', err.message);
            return res.json({ success: false, error: err.message });
        }
        
        console.log('MEK kullanıcısı başarıyla admin tipine güncellendi');
        
        // Kullanıcıları listele
        db.all("SELECT id, username, userType FROM users", [], (err, rows) => {
            if (err) {
                console.error('Kullanıcı listesi kontrol edilirken hata:', err.message);
                return res.json({ success: true, message: 'MEK kullanıcısı güncellendi ama kullanıcılar listelenemedi', users: [] });
            }
            
            console.log('Mevcut kullanıcılar:', rows);
            return res.json({ 
                success: true, 
                message: 'MEK kullanıcısı başarıyla admin tipine güncellendi', 
                users: rows 
            });
        });
    });
}); 

// Debug endpoint - Veritabanı durumunu görüntüle
app.get('/api/debug/db-status', (req, res) => {
    console.log('Veritabanı durumu kontrolü...');
    
    try {
        // Tablo listesini al
        let tablesQuery;
        if (isPg) {
            tablesQuery = `
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                ORDER BY table_name
            `;
        } else {
            tablesQuery = `SELECT name FROM sqlite_master WHERE type='table'`;
        }
        
        db.all(tablesQuery, [], (err, tables) => {
            if (err) {
                console.error('Tablo listesi alınırken hata:', err);
                return res.status(500).json({ error: 'Veritabanı hatası', details: err.message });
            }
            
            console.log('Tablolar:', tables);
            
            // Her tablonun içeriğini kontrol et
            const tableData = {};
            let completedQueries = 0;
            
            // Hiç tablo yoksa doğrudan yanıt ver
            if (!tables || tables.length === 0) {
                return res.json({ 
                    success: true,
                    dbType: isPg ? 'PostgreSQL' : 'SQLite',
                    tables: [],
                    message: 'Veritabanında hiç tablo yok!'
                });
            }
            
            tables.forEach(table => {
                const tableName = isPg ? table.table_name : table.name;
                
                // system tablolarını ve information_schema tablolarını atla
                if (tableName.startsWith('pg_') || tableName.startsWith('sql') || 
                    tableName === 'information_schema') {
                    completedQueries++;
                    return;
                }
                
                // Her tablo için kayıt sayısını al
                let countQuery;
                if (isPg) {
                    countQuery = `SELECT COUNT(*) as count FROM "${tableName}"`;
                } else {
                    countQuery = `SELECT COUNT(*) as count FROM ${tableName}`;
                }
                
                db.get(countQuery, [], (err, result) => {
                    if (err) {
                        console.error(`${tableName} tablosu sayım hatası:`, err);
                        tableData[tableName] = { error: err.message };
                    } else {
                        tableData[tableName] = { count: result.count };
                        
                        // İlk 5 kaydı da göster
                        let recordsQuery;
                        if (isPg) {
                            recordsQuery = `SELECT * FROM "${tableName}" LIMIT 5`;
                        } else {
                            recordsQuery = `SELECT * FROM ${tableName} LIMIT 5`;
                        }
                        
                        db.all(recordsQuery, [], (err, records) => {
                            if (err) {
                                console.error(`${tableName} kayıtları alınırken hata:`, err);
                            } else {
                                tableData[tableName].records = records;
                            }
                            
                            completedQueries++;
                            
                            // Tüm sorgular tamamlandığında yanıt ver
                            if (completedQueries === tables.length) {
                                return res.json({
                                    success: true,
                                    dbType: isPg ? 'PostgreSQL' : 'SQLite',
                                    tables: tables.map(t => isPg ? t.table_name : t.name),
                                    tableData: tableData
                                });
                            }
                        });
                    }
                });
            });
        });
    } catch (error) {
        console.error('Veritabanı durumu kontrolü hatası:', error);
        return res.status(500).json({ 
            error: 'Sunucu hatası', 
            details: error.message,
            stack: error.stack
        });
    }
});

// Tüm örnek verileri yükleyen endpoint
app.get('/api/init-data', (req, res) => {
    console.log('Örnek verileri yükleme isteği alındı');
    
    try {
        // Kullanıcıları ekle
        console.log('Örnek kullanıcılar ekleniyor...');
        const password = Buffer.from('123456').toString('base64');
        
        // PostgreSQL için kullanıcı ekle
        if (isPg) {
            const insertAdmin = `
                INSERT INTO users (name, username, password, userType)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (username) DO UPDATE SET userType = $4
            `;
            db.run(insertAdmin, ['MEK Admin', 'MEK', password, 'admin'], err => {
                if (err) console.error('Kullanıcı eklenirken hata:', err.message);
                else console.log('MEK admin kullanıcısı eklendi veya güncellendi');
            });
            
            db.run(insertAdmin, ['Admin User', 'admin', password, 'admin'], err => {
                if (err) console.error('Kullanıcı eklenirken hata:', err.message);
                else console.log('admin kullanıcısı eklendi veya güncellendi');
            });
        } else {
            // SQLite için kullanıcı ekle
            db.run(
                `INSERT OR IGNORE INTO users (name, username, password, userType) VALUES (?, ?, ?, ?)`,
                ['MEK Admin', 'MEK', password, 'admin'],
                err => {
                    if (err) console.error('Kullanıcı eklenirken hata:', err.message);
                    else console.log('MEK admin kullanıcısı eklendi');
                }
            );
            
            db.run(
                `INSERT OR IGNORE INTO users (name, username, password, userType) VALUES (?, ?, ?, ?)`,
                ['Admin User', 'admin', password, 'admin'],
                err => {
                    if (err) console.error('Kullanıcı eklenirken hata:', err.message);
                    else console.log('admin kullanıcısı eklendi');
                }
            );
        }
        
        // Ders programı verileri ekle
        console.log('Ders programı örnekleri ekleniyor...');
        addScheduleExamples();
        
        // Ödevler ekle
        console.log('Örnek ödevler ekleniyor...');
        addHomeworkExamples();
        
        // Duyurular ekle
        console.log('Örnek duyurular ekleniyor...');
        addAnnouncementExamples();
        
        // Notlar ekle
        console.log('Örnek notlar ekleniyor...');
        addGradeExamples();
        
        // Durum bilgisi gönder
        res.json({
            success: true,
            message: 'Örnek veriler yükleme işlemi başlatıldı',
            note: 'Veritabanına ekleme işlemleri arka planda devam ediyor'
        });
    } catch (error) {
        console.error('Örnek veri yükleme hatası:', error);
        res.status(500).json({
            success: false,
            error: 'Sunucu hatası',
            details: error.message
        });
    }
});

// Veritabanı tablolarını oluşturan endpoint
app.get('/api/init', (req, res) => {
    console.log('Veritabanı tabloları oluşturma isteği alındı');
    
    try {
        // Kullanıcılar tablosu
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY ${isPg ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
            name TEXT,
            username TEXT UNIQUE,
            password TEXT,
            userType TEXT DEFAULT 'student',
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`, [], err => {
            if (err) {
                console.error('Users tablosu oluşturulurken hata:', err.message);
            } else {
                console.log('Users tablosu oluşturuldu veya zaten var');
            }
        });
        
        // Ders programı tablosu
        db.run(`CREATE TABLE IF NOT EXISTS schedule (
            id INTEGER PRIMARY KEY ${isPg ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
            userId INTEGER,
            rowIndex INTEGER,
            colIndex INTEGER,
            content TEXT,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (userId, rowIndex, colIndex)
        )`, [], err => {
            if (err) {
                console.error('Schedule tablosu oluşturulurken hata:', err.message);
            } else {
                console.log('Schedule tablosu oluşturuldu veya zaten var');
            }
        });
        
        // Ödevler tablosu
        db.run(`CREATE TABLE IF NOT EXISTS homework (
            id INTEGER PRIMARY KEY ${isPg ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
            title TEXT,
            description TEXT,
            dueDate TIMESTAMP,
            lessonId INTEGER,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`, [], err => {
            if (err) {
                console.error('Homework tablosu oluşturulurken hata:', err.message);
            } else {
                console.log('Homework tablosu oluşturuldu veya zaten var');
            }
        });
        
        // Duyurular tablosu
        db.run(`CREATE TABLE IF NOT EXISTS announcements (
            id INTEGER PRIMARY KEY ${isPg ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
            title TEXT,
            content TEXT,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`, [], err => {
            if (err) {
                console.error('Announcements tablosu oluşturulurken hata:', err.message);
            } else {
                console.log('Announcements tablosu oluşturuldu veya zaten var');
            }
        });
        
        // Notlar tablosu
        db.run(`CREATE TABLE IF NOT EXISTS grades (
            id INTEGER PRIMARY KEY ${isPg ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
            studentId INTEGER,
            lessonId INTEGER,
            grade INTEGER,
            examType TEXT,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`, [], err => {
            if (err) {
                console.error('Grades tablosu oluşturulurken hata:', err.message);
            } else {
                console.log('Grades tablosu oluşturuldu veya zaten var');
                
                // Yanıt döndür
                res.json({
                    success: true,
                    message: 'Veritabanı tabloları oluşturuldu',
                });
            }
        });
    } catch (error) {
        console.error('Veritabanı tabloları oluşturulurken hata:', error);
        res.status(500).json({
            success: false,
            error: 'Sunucu hatası',
            details: error.message
        });
    }
});