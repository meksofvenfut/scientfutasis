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

// Hata ayıklama ve hata mesajı yazdırma yardımcı fonksiyonu
function debugLog(title, ...args) {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    console.log(`[${timeStr}] ${title}:`, ...args);
}

// API route hatalarını kontrol eden middleware
app.use('/api', (req, res, next) => {
    debugLog('API isteği', req.method, req.path);
    next();
});

// Genel hata yakalama middleware'i
app.use((err, req, res, next) => {
    debugLog('Hata yakalandı', err);
    
    if (!res.headersSent) {
        res.status(500).json({
            success: false, 
            error: 'Sunucu hatası',
            message: err.message,
            code: err.code
        });
    }
    
    next(err);
});

// API istekleri için önbellek engelleyici middleware
app.use('/api', (req, res, next) => {
    // Her API isteği için önbellek başlıklarını ayarla
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('X-Cache-Control', 'no-cache'); // Pragma header'ını değiştirdim
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
                "userId" INTEGER,
                "rowIndex" INTEGER,
                "colIndex" INTEGER,
                content TEXT,
                "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE ("userId", "rowIndex", "colIndex")
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
                "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (title, lesson)
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
    if (isPg) {
        const query = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'announcements' 
            AND column_name = 'importance'
        `;
        
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error("PostgreSQL sütun bilgisi alınamadı:", err);
                return;
            }
            
            // Importance sütunu var mı kontrol et
            const hasImportance = rows && rows.length > 0;
            
            // Eğer importance sütunu yoksa ekle
            if (!hasImportance) {
                console.log("announcements tablosuna importance sütunu ekleniyor (PostgreSQL)...");
                db.run("ALTER TABLE announcements ADD COLUMN importance TEXT DEFAULT 'normal'", [], function(err) {
                    if (err) {
                        console.error("PostgreSQL sütun eklenemedi:", err);
                    } else {
                        console.log("PostgreSQL: importance sütunu başarıyla eklendi.");
                        
                        // Mevcut important değerlerini yeni sütuna taşı
                        db.run("UPDATE announcements SET importance = CASE WHEN important = true THEN 'important' ELSE 'normal' END", [], function(err) {
                            if (err) {
                                console.error("PostgreSQL değerler taşınamadı:", err);
                            } else {
                                console.log("PostgreSQL: Değerler importance sütununa taşındı.");
                            }
                        });
                    }
                });
            }
        });
    } else {
        // SQLite için
        db.all("PRAGMA table_info(announcements)", [], (err, rows) => {
            if (err) {
                console.error("SQLite tablo bilgisi alınamadı:", err);
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
                    console.log("announcements tablosuna importance sütunu ekleniyor (SQLite)...");
                    db.run("ALTER TABLE announcements ADD COLUMN importance TEXT DEFAULT 'normal'", [], function(err) {
                        if (err) {
                            console.error("SQLite sütun eklenemedi:", err);
                        } else {
                            console.log("SQLite: importance sütunu başarıyla eklendi.");
                            
                            // Mevcut important değerlerini yeni sütuna taşı
                            db.run("UPDATE announcements SET importance = CASE WHEN important = 1 THEN 'important' ELSE 'normal' END", [], function(err) {
                                if (err) {
                                    console.error("SQLite değerler taşınamadı:", err);
                                } else {
                                    console.log("SQLite: Değerler importance sütununa taşındı.");
                                }
                            });
                        }
                    });
                }
            }
        });
    }
    
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
if (isPg) {
    const query = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'grades'
    `;
    
    db.all(query, [], (err, columns) => {
        if (err) {
            console.error("PostgreSQL grades tablosu sütun bilgisi alınamadı:", err);
            return;
        }
        
        // Sütun isimlerini bir listeye çevir
        const columnNames = columns.map(col => col.column_name);
        
        // Eğer eski yapıda ise (dosya desteği olmayan), yeni yapıya geçelim
        const hasContent = columnNames.includes('content');
        const hasFilePath = columnNames.includes('file_path');
        
        // Eğer content varsa ve file_path yoksa, yeni yapıya geçelim
        if (hasContent && !hasFilePath) {
            console.log("PostgreSQL grades tablosu dosya desteği için güncelleniyor...");
            
            // PostgreSQL için yeni dosya sütunları ekle
            db.run(`ALTER TABLE grades ADD COLUMN file_path TEXT`, [], function(err) {
                if (err) {
                    console.error("PostgreSQL file_path sütunu eklenemedi:", err);
                } else {
                    db.run(`ALTER TABLE grades ADD COLUMN file_name TEXT`, [], function(err) {
                        if (err) {
                            console.error("PostgreSQL file_name sütunu eklenemedi:", err);
                        } else {
                            db.run(`ALTER TABLE grades ADD COLUMN file_size INTEGER`, [], function(err) {
                                if (err) {
                                    console.error("PostgreSQL file_size sütunu eklenemedi:", err);
                                } else {
                                    console.log("PostgreSQL: grades tablosu dosya desteği ile güncellendi.");
                                }
                            });
                        }
                    });
                }
            });
        } else if (hasFilePath) {
            console.log("PostgreSQL: grades tablosu dosya desteği ile zaten güncel.");
        }
    });
} else {
    // SQLite için
    db.all("PRAGMA table_info(grades)", [], (err, rows) => {
        if (err) {
            console.error("SQLite grades tablosu bilgisi alınamadı:", err);
            return;
        }
        
        // Eğer eski yapıda ise (dosya desteği olmayan), yeni yapıya geçelim
        const hasContent = rows.some(row => row.name === 'content');
        const hasFilePath = rows.some(row => row.name === 'file_path');
        const hasFileName = rows.some(row => row.name === 'file_name');
        
        // Eğer content varsa ve file_path yoksa, yeni yapıya geçelim
        if (hasContent && !hasFilePath) {
            console.log("SQLite grades tablosu dosya desteği için güncelleniyor...");
            
            // Geçici tabloyu oluştur
            db.serialize(() => {
                // Önce mevcut verileri yedekleyelim
                db.run(`CREATE TABLE grades_backup AS SELECT * FROM grades`, [], function(err) {
                    if (err) {
                        console.error("Yedekleme tablosu oluşturma hatası:", err);
                        return;
                    }
                    
                    // Sonra mevcut tabloyu silelim
                    db.run(`DROP TABLE grades`, [], function(err) {
                        if (err) {
                            console.error("Tablo silme hatası:", err);
                            return;
                        }
                        
                        // Yeni şema ile tabloyu yeniden oluşturalım
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
                                console.error("Yeni tablo oluşturma hatası:", err);
                                return;
                            }
                            
                            // Yedekten verileri geri yükleyelim
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
                                
                                console.log("SQLite: Çalışma notları tablosu dosya desteği ile güncellendi.");
                                db.run(`DROP TABLE grades_backup`);
                            });
                        });
                    });
                });
            });
        } else if (hasFilePath) {
            console.log("SQLite: Çalışma notları tablosu dosya desteği ile zaten güncel.");
        }
    });
}

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
    const { username, password, userType } = req.body;
    
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
            
            // Kullanıcı türünü kontrol et - 'admin' değeri yoksa ve Türkçe 'Yönetici' varsa, 'admin' olarak ayarla
            let userTypeValue = row.userType;
            if (userTypeValue === 'Yönetici') {
                userTypeValue = 'admin';
                console.log('Türkçe "Yönetici" değeri "admin" olarak güncellendi');
            }
            
            // JWT token oluştur
            const token = jwt.sign(
                { id: row.id, username: row.username, userType: userTypeValue },
                JWT_SECRET,
                { expiresIn: '1h' }
            );
            
            res.json({
                success: true,
                user: {
                    id: row.id,
                    name: row.name,
                    username: row.username,
                    userType: userTypeValue
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
        debugLog('Ders programı getirme isteği alındı');
        // Varsayılan olarak kullanıcı 1 (genel program)
        const userId = req.query.userId || 1;
        
        // API isteğini loglama
        debugLog(`Ders programı getiriliyor - Kullanıcı ID: ${userId}`);
        
        // Sorguyu hazırla
        let query, params;
        
        if (isPg) {
            query = `SELECT "rowIndex", "colIndex", content FROM schedule WHERE "userId" = $1`;
            params = [userId];
        } else {
            query = `SELECT rowIndex, colIndex, content FROM schedule WHERE userId = ?`;
            params = [userId];
        }
        
        debugLog('Sorgu çalıştırılıyor:', query, 'Parametreler:', params);
        
        // Sorguyu çalıştır
        db.all(query, params, (err, rows) => {
            if (err) {
                debugLog('Ders programı verileri alınırken hata:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Veritabanı hatası',
                    details: err.message
                });
            }
            
            debugLog(`${rows?.length || 0} adet kayıt bulundu`);
            
            // Veriyi formatla (key formatını değiştiriyorum)
            const scheduleData = {};
            
            if (rows && rows.length > 0) {
                rows.forEach(row => {
                    // PostgreSQL'de sütun isimleri küçük harfle dönebilir, bu yüzden kontrol ediyoruz
                    debugLog('Satır verisi:', JSON.stringify(row));
                    
                    const rowIndex = row.rowIndex || row.rowindex || row["rowIndex"] || row["rowindex"];
                    const colIndex = row.colIndex || row.colindex || row["colIndex"] || row["colindex"];
                    
                    if (rowIndex && colIndex) {
                        // Her hücre için benzersiz bir key oluştur: {rowIndex}_{colIndex}
                        const cellKey = `${rowIndex}_${colIndex}`;
                        // Veriyi doğrudan bu key altına yerleştir
                        scheduleData[cellKey] = row.content;
                    } else {
                        debugLog('Hatalı veri formatı:', row);
                    }
                });
            }
            
            // Log ekleyelim
            debugLog('Formatlanmış ders programı verileri:', scheduleData);
            
            // Başarılı yanıt
            return res.json({
                success: true,
                schedule: scheduleData,
                timestamp: new Date().toISOString()
            });
        });
    } catch (error) {
        debugLog('Ders programı getirme hatası:', error);
        return res.status(500).json({
            success: false,
            error: 'Sunucu hatası',
            details: error.message
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
                console.error('Mevcut kayıtları silerken hata:', err.message);
                return res.status(500).json({
                    success: false,
                    error: 'Veritabanı hatası'
                });
            }
            
            console.log(`${userId} kullanıcısının ders programı kayıtları silindi`);
            
            // Key'lere göre işlem yapıyoruz
            const keys = Object.keys(scheduleData);
            if (keys.length === 0) {
                return res.json({
                    success: true,
                    message: 'Ders programı güncellendi (boş)'
                });
            }
            
            let insertCount = 0;
            let errorCount = 0;
            
            // Her key için veri ekle - key formatı "rowIndex_colIndex"
            keys.forEach(key => {
                // Key'i parse ederek rowIndex ve colIndex elde et
                const [rowIndex, colIndex] = key.split('_').map(Number);
                
                if (!rowIndex || !colIndex) {
                    console.error(`Geçersiz key formatı: ${key}`);
                    errorCount++;
                    return;
                }
                
                const content = scheduleData[key];
                
                // Veri ekle
                let insertQuery, insertParams;
                const now = new Date().toISOString();
                
                if (isPg) {
                    insertQuery = `
                        INSERT INTO schedule (userId, rowIndex, colIndex, content, createdAt, updatedAt)
                        VALUES ($1, $2, $3, $4, $5, $6)
                    `;
                    insertParams = [userId, rowIndex, colIndex, content, now, now];
                } else {
                    insertQuery = `
                        INSERT INTO schedule (userId, rowIndex, colIndex, content, createdAt, updatedAt)
                        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    `;
                    insertParams = [userId, rowIndex, colIndex, content];
                }
                
                db.run(insertQuery, insertParams, function(err) {
                    if (err) {
                        console.error(`Kayıt eklenirken hata (${rowIndex}, ${colIndex}): ${err.message}`);
                        errorCount++;
                    } else {
                        insertCount++;
                        console.log(`Kayıt eklendi (${rowIndex}, ${colIndex}): ${content}`);
                    }
                    
                    // Tüm işlemler tamamlandı mı kontrol et
                    if (insertCount + errorCount === keys.length) {
                        return res.json({
                            success: true,
                            message: `Ders programı güncellendi. ${insertCount} kayıt eklendi, ${errorCount} hata.`,
                            insertCount,
                            errorCount
                        });
                    }
                });
            });
        });
    } catch (error) {
        console.error('Ders programı kayıt hatası:', error);
        return res.status(500).json({
            success: false,
            message: 'Sunucu hatası',
            error: error.message
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
    console.log('Yeni ödev ekleme isteği alındı:', req.body);
    
    const { title, lesson, dueDate, description, userType } = req.body;
    
    // Yönetici kontrolü
    if (userType !== 'admin' && userType !== 'Yönetici') {
        console.error('Yetkisiz ödev ekleme girişimi:', userType);
        return res.status(403).json({ 
            success: false, 
            message: 'Bu işlem için yönetici yetkileri gerekiyor' 
        });
    }
    
    // Gerekli alanların kontrolü
    if (!lesson || !dueDate || !description) {
        console.error('Eksik bilgi ile ödev ekleme girişimi');
        return res.status(400).json({ 
            success: false, 
            message: 'Ders, teslim tarihi ve açıklama gereklidir' 
        });
    }
    
    try {
        // Başlık eğer yoksa dersi kullan
        const homeworkTitle = title || lesson;
        const now = new Date().toISOString();
        
        let query, params;
        
        if (isPg) {
            query = `
                INSERT INTO homework (title, lesson, dueDate, description, isCompleted, createdAt, updatedAt)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `;
            params = [homeworkTitle, lesson, dueDate, description, false, now, now];
        } else {
            query = `
                INSERT INTO homework (title, lesson, dueDate, description, isCompleted, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `;
            params = [homeworkTitle, lesson, dueDate, description, 0]; // SQLite için boolean 0 olarak saklanır
        }
        
        db.run(query, params, function(err) {
            if (err) {
                console.error('Ödev eklenirken hata:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Veritabanı hatası', 
                    error: err.message 
                });
            }
            
            console.log(`Yeni ödev eklendi: ${homeworkTitle} - ID: ${this.lastID}`);
            res.json({ 
                success: true, 
                message: 'Ödev başarıyla eklendi', 
                id: this.lastID 
            });
        });
    } catch (error) {
        console.error('Ödev ekleme hatası:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası', 
            error: error.message 
        });
    }
});

// 3. Ödev düzenle
app.put('/api/homework/update/:id', (req, res) => {
    console.log('Ödev güncelleme isteği alındı:', req.params.id);
    
    const homeworkId = req.params.id;
    const { title, lesson, dueDate, description, userType } = req.body;
    
    // Yönetici kontrolü
    if (userType !== 'admin' && userType !== 'Yönetici') {
        console.error('Yetkisiz ödev güncelleme girişimi:', userType);
        return res.status(403).json({ 
            success: false, 
            message: 'Bu işlem için yönetici yetkileri gerekiyor' 
        });
    }
    
    // Gerekli alanların kontrolü
    if (!homeworkId || !lesson || !dueDate || !description) {
        console.error('Eksik bilgi ile ödev güncelleme girişimi');
        return res.status(400).json({ 
            success: false, 
            message: 'ID, ders, teslim tarihi ve açıklama gereklidir' 
        });
    }
    
    try {
        // Başlık eğer yoksa dersi kullan
        const homeworkTitle = title || lesson;
        const now = new Date().toISOString();
        
        let query, params;
        
        if (isPg) {
            query = `
                UPDATE homework 
                SET title = $1, lesson = $2, dueDate = $3, description = $4, updatedAt = $5
                WHERE id = $6
                RETURNING id
            `;
            params = [homeworkTitle, lesson, dueDate, description, now, homeworkId];
        } else {
            query = `
                UPDATE homework 
                SET title = ?, lesson = ?, dueDate = ?, description = ?, updatedAt = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            params = [homeworkTitle, lesson, dueDate, description, homeworkId];
        }
        
        db.run(query, params, function(err) {
            if (err) {
                console.error('Ödev güncellenirken hata:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Veritabanı hatası', 
                    error: err.message 
                });
            }
            
            if (this.changes === 0) {
                console.log(`Güncellenecek ödev bulunamadı - ID: ${homeworkId}`);
                return res.status(404).json({ 
                    success: false, 
                    message: 'Güncellenecek ödev bulunamadı' 
                });
            }
            
            console.log(`Ödev güncellendi - ID: ${homeworkId}`);
            res.json({ 
                success: true, 
                message: 'Ödev başarıyla güncellendi', 
                id: homeworkId 
            });
        });
    } catch (error) {
        console.error('Ödev güncelleme hatası:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası', 
            error: error.message 
        });
    }
});

// 4. Ödev sil
app.delete('/api/homework/delete/:id', (req, res) => {
    console.log('Ödev silme isteği alındı:', req.params.id);
    
    const homeworkId = req.params.id;
    const { userType } = req.body;
    
    // Yönetici kontrolü
    if (userType !== 'admin' && userType !== 'Yönetici') {
        console.error('Yetkisiz ödev silme girişimi:', userType);
        return res.status(403).json({ 
            success: false, 
            message: 'Bu işlem için yönetici yetkileri gerekiyor' 
        });
    }
    
    if (!homeworkId) {
        return res.status(400).json({ 
            success: false, 
            message: 'Silinecek ödev ID\'si gereklidir' 
        });
    }
    
    try {
        let query, params;
        
        if (isPg) {
            query = `DELETE FROM homework WHERE id = $1`;
            params = [homeworkId];
        } else {
            query = `DELETE FROM homework WHERE id = ?`;
            params = [homeworkId];
        }
        
        db.run(query, params, function(err) {
            if (err) {
                console.error('Ödev silinirken hata:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Veritabanı hatası', 
                    error: err.message 
                });
            }
            
            if (this.changes === 0) {
                console.log(`Silinecek ödev bulunamadı - ID: ${homeworkId}`);
                return res.status(404).json({ 
                    success: false, 
                    message: 'Silinecek ödev bulunamadı' 
                });
            }
            
            console.log(`Ödev silindi - ID: ${homeworkId}`);
            res.json({ 
                success: true, 
                message: 'Ödev başarıyla silindi'
            });
        });
    } catch (error) {
        console.error('Ödev silme hatası:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası', 
            error: error.message 
        });
    }
});

// Veritabanı tablolarını oluşturan endpoint
app.get('/api/init', (req, res) => {
    console.log('Veritabanı tabloları oluşturma isteği alındı');
    
    try {
        // PostgreSQL için tabloları önce DROP edip sonra yeniden oluştur
        if (isPg) {
            console.log('PostgreSQL tabloları sıfırlanıyor...');
            
            // Önce her tabloyu DROP et
            db.run(`DROP TABLE IF EXISTS schedule`, [], err => {
                if (err) console.error('Schedule tablosu silinemedi:', err.message);
                else console.log('Schedule tablosu silindi');
                
                // Sonra yeniden oluştur
                db.run(`
                    CREATE TABLE IF NOT EXISTS schedule (
                        id SERIAL PRIMARY KEY,
                        "userId" INTEGER,
                        "rowIndex" INTEGER,
                        "colIndex" INTEGER,
                        content TEXT,
                        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE ("userId", "rowIndex", "colIndex")
                    )
                `, [], err => {
                    if (err) console.error('Schedule tablosu oluşturulamadı:', err.message);
                    else console.log('Schedule tablosu yeniden oluşturuldu');
                });
            });
            
            // Homework tablosu
            db.run(`DROP TABLE IF EXISTS homework`, [], err => {
                if (err) console.error('Homework tablosu silinemedi:', err.message);
                else console.log('Homework tablosu silindi');
                
                // Sonra yeniden oluştur
                db.run(`
                    CREATE TABLE IF NOT EXISTS homework (
                        id SERIAL PRIMARY KEY,
                        title TEXT,
                        lesson TEXT,
                        "dueDate" TEXT,
                        description TEXT,
                        "isCompleted" BOOLEAN DEFAULT FALSE,
                        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE (title, lesson)
                    )
                `, [], err => {
                    if (err) console.error('Homework tablosu oluşturulamadı:', err.message);
                    else console.log('Homework tablosu yeniden oluşturuldu');
                });
            });
            
            // Announcements tablosu
            db.run(`DROP TABLE IF EXISTS announcements`, [], err => {
                if (err) console.error('Announcements tablosu silinemedi:', err.message);
                else console.log('Announcements tablosu silindi');
                
                // Sonra yeniden oluştur
                db.run(`
                    CREATE TABLE IF NOT EXISTS announcements (
                        id SERIAL PRIMARY KEY,
                        title TEXT NOT NULL,
                        content TEXT NOT NULL,
                        importance TEXT DEFAULT 'normal',
                        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE (title)
                    )
                `, [], err => {
                    if (err) console.error('Announcements tablosu oluşturulamadı:', err.message);
                    else console.log('Announcements tablosu yeniden oluşturuldu');
                });
            });
            
            // Grades tablosu
            db.run(`DROP TABLE IF EXISTS grades`, [], err => {
                if (err) console.error('Grades tablosu silinemedi:', err.message);
                else console.log('Grades tablosu silindi');
                
                // Sonra yeniden oluştur
                db.run(`
                    CREATE TABLE IF NOT EXISTS grades (
                        id SERIAL PRIMARY KEY,
                        title TEXT NOT NULL,
                        lesson TEXT NOT NULL,
                        type TEXT NOT NULL,
                        file_path TEXT,
                        file_name TEXT,
                        file_size INTEGER,
                        "examDate" TEXT NOT NULL,
                        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE (title, lesson)
                    )
                `, [], err => {
                    if (err) console.error('Grades tablosu oluşturulamadı:', err.message);
                    else console.log('Grades tablosu yeniden oluşturuldu');
                });
            });
            
            res.json({
                success: true,
                message: 'PostgreSQL tabloları sıfırlanıp yeniden oluşturuldu'
            });
        } else {
            // SQLite için normal oluşturma işlemi
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
                lesson TEXT,
                dueDate TEXT,
                description TEXT,
                isCompleted BOOLEAN DEFAULT FALSE,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (title, lesson)
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
                importance TEXT DEFAULT 'normal',
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(title)
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
                title TEXT NOT NULL,
                lesson TEXT NOT NULL,
                type TEXT NOT NULL,
                file_path TEXT,
                file_name TEXT,
                file_size INTEGER,
                examDate TEXT NOT NULL, 
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(title, lesson)
            )`, [], err => {
                if (err) {
                    console.error('Grades tablosu oluşturulurken hata:', err.message);
                } else {
                    console.log('Grades tablosu oluşturuldu veya zaten var');
                }
            });
            
            // Yanıt döndür
            res.json({
                success: true,
                message: 'Veritabanı tabloları oluşturuldu',
            });
        }
    } catch (error) {
        console.error('Veritabanı tabloları oluşturulurken hata:', error);
        res.status(500).json({
            success: false,
            error: 'Sunucu hatası',
            details: error.message
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
        
        // Admin kullanıcıları ekledikten sonra, mevcut kullanıcıların userType'larını kontrol et
        db.all("SELECT id, username, userType FROM users", [], (err, rows) => {
            if (err) {
                console.error('Kullanıcı tipleri kontrolü hatası:', err.message);
            } else {
                console.log('Mevcut kullanıcılar ve tipleri:');
                rows.forEach(user => {
                    console.log(`- ${user.username}: ${user.userType}`);
                    
                    // Yönetici tipindeki kullanıcıları admin olarak güncelle
                    if (user.userType === 'Yönetici') {
                        const updateQuery = isPg ? 
                            `UPDATE users SET userType = $1 WHERE id = $2` :
                            `UPDATE users SET userType = ? WHERE id = ?`;
                            
                        const updateParams = isPg ? ['admin', user.id] : ['admin', user.id];
                        
                        db.run(updateQuery, updateParams, err => {
                            if (err) console.error(`${user.username} kullanıcısının tipi güncellenirken hata:`, err.message);
                            else console.log(`${user.username} kullanıcısının tipi "Yönetici"den "admin"e güncellendi`);
                        });
                    }
                });
            }
        });
        
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

// Debug endpoint - veritabanı durumunu kontrol etmek için
app.get('/api/debug/db-status', (req, res) => {
    console.log('Veritabanı durumu kontrol ediliyor...');
    
    try {
        const result = {
            dbType: isPg ? 'PostgreSQL' : 'SQLite',
            tables: {},
            timestamp: new Date().toISOString()
        };
        
        // Tabloları listeleme sorgusu
        let tablesQuery;
        if (isPg) {
            tablesQuery = `
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
            `;
        } else {
            tablesQuery = `
                SELECT name as table_name
                FROM sqlite_master 
                WHERE type='table'
                AND name NOT LIKE 'sqlite_%'
            `;
        }
        
        db.all(tablesQuery, [], (err, tables) => {
            if (err) {
                console.error('Tablo listesi alınırken hata:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Veritabanı tabloları listelenirken hata oluştu',
                    details: err.message
                });
            }
            
            if (!tables || tables.length === 0) {
                return res.json({
                    success: true,
                    message: 'Veritabanında hiç tablo bulunamadı',
                    dbType: result.dbType
                });
            }
            
            let processedTables = 0;
            
            tables.forEach(table => {
                const tableName = table.table_name;
                
                // Sistem tablolarını atla
                if (tableName.startsWith('pg_') || 
                    tableName.startsWith('sql_') || 
                    tableName === 'sqlite_sequence' ||
                    tableName.includes('information_schema')) {
                    processedTables++;
                    return;
                }
                
                // Her tablo için kayıt sayısını al
                const countQuery = isPg ?
                    `SELECT COUNT(*) as count FROM "${tableName}"` :
                    `SELECT COUNT(*) as count FROM ${tableName}`;
                
                db.get(countQuery, [], (err, countResult) => {
                    if (err) {
                        console.error(`${tableName} tablosu kayıt sayısı alınırken hata:`, err);
                        result.tables[tableName] = {
                            error: 'Kayıt sayısı alınamadı: ' + err.message
                        };
                    } else {
                        const recordCount = countResult.count;
                        result.tables[tableName] = {
                            recordCount: recordCount
                        };
                        
                        // İlk 5 kaydı al
                        if (recordCount > 0) {
                            const recordsQuery = isPg ?
                                `SELECT * FROM "${tableName}" LIMIT 5` :
                                `SELECT * FROM ${tableName} LIMIT 5`;
                            
                            db.all(recordsQuery, [], (err, records) => {
                                if (err) {
                                    console.error(`${tableName} tablosu kayıtları alınırken hata:`, err);
                                    result.tables[tableName].sampleRecords = 'Kayıtlar alınamadı';
                                } else {
                                    result.tables[tableName].sampleRecords = records;
                                }
                                
                                processedTables++;
                                if (processedTables === tables.length) {
                                    res.json({
                                        success: true,
                                        dbStatus: result
                                    });
                                }
                            });
                        } else {
                            result.tables[tableName].sampleRecords = [];
                            
                            processedTables++;
                            if (processedTables === tables.length) {
                                res.json({
                                    success: true,
                                    dbStatus: result
                                });
                            }
                        }
                    }
                });
            });
        });
    } catch (error) {
        console.error('Veritabanı durum bilgisi alınırken hata:', error);
        res.status(500).json({
            success: false,
            error: 'Sunucu hatası',
            details: error.message
        });
    }
});

// Örnek ders programı verilerini ekle
function addScheduleExamples() {
    console.log('Ders programı örnek kayıtları ekleniyor...');
    
    // Örnek ders programı verileri
    const scheduleData = [
        { userId: 1, rowIndex: 1, colIndex: 1, content: "Matematik" },
        { userId: 1, rowIndex: 1, colIndex: 2, content: "Fen Bilgisi" },
        { userId: 1, rowIndex: 1, colIndex: 3, content: "Türkçe" },
        { userId: 1, rowIndex: 1, colIndex: 4, content: "Sosyal Bilgiler" },
        { userId: 1, rowIndex: 1, colIndex: 5, content: "İngilizce" },
        { userId: 1, rowIndex: 2, colIndex: 1, content: "Türkçe" },
        { userId: 1, rowIndex: 2, colIndex: 2, content: "Matematik" },
        { userId: 1, rowIndex: 2, colIndex: 3, content: "Beden Eğitimi" },
        { userId: 1, rowIndex: 2, colIndex: 4, content: "Fen Bilgisi" },
        { userId: 1, rowIndex: 2, colIndex: 5, content: "Görsel Sanatlar" }
    ];
    
    const now = new Date().toISOString();
    
    // Her kayıt için veritabanına ekle
    scheduleData.forEach(item => {
        try {
            if (isPg) {
                // PostgreSQL için
                const query = `
                    INSERT INTO schedule ("userId", "rowIndex", "colIndex", content, "createdAt", "updatedAt")
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT ("userId", "rowIndex", "colIndex") DO UPDATE SET content = $4, "updatedAt" = $6
                `;
                db.run(query, [item.userId, item.rowIndex, item.colIndex, item.content, now, now], err => {
                    if (err) console.error('Ders programı kaydı eklenirken hata:', err.message);
                });
            } else {
                // SQLite için
                const query = `
                    INSERT OR REPLACE INTO schedule (userId, rowIndex, colIndex, content, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `;
                db.run(query, [item.userId, item.rowIndex, item.colIndex, item.content], err => {
                    if (err) console.error('Ders programı kaydı eklenirken hata:', err.message);
                });
            }
        } catch (error) {
            console.error('Ders programı kaydı eklenirken hata:', error);
        }
    });
    
    console.log('Ders programı örnek kayıtları eklendi.');
}

// Örnek ödev verilerini ekle
function addHomeworkExamples() {
    console.log('Ödev örnek kayıtları ekleniyor...');
    
    // Bugünün tarihini al ve örnek ödevler için tarih oluştur
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    
    // Örnek ödev verileri
    const homeworkData = [
        { 
            title: "Matematik Çalışma Sayfası", 
            lesson: "Matematik", 
            dueDate: tomorrow.toISOString().split('T')[0],
            description: "Sayfa 42-45 arası problemleri çözün"
        },
        { 
            title: "Türkçe Kompozisyon", 
            lesson: "Türkçe", 
            dueDate: nextWeek.toISOString().split('T')[0],
            description: "Hayalinizdeki meslek hakkında bir kompozisyon yazın."
        },
        { 
            title: "Fen Bilgisi Projesi", 
            lesson: "Fen Bilgisi", 
            dueDate: nextWeek.toISOString().split('T')[0],
            description: "Güneş sistemi maketi hazırlayın."
        }
    ];
    
    const now = new Date().toISOString();
    
    // Her kayıt için veritabanına ekle
    homeworkData.forEach(item => {
        try {
            if (isPg) {
                // PostgreSQL için
                const query = `
                    INSERT INTO homework (title, lesson, dueDate, description, isCompleted, createdAt, updatedAt)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (title, lesson) DO NOTHING
                `;
                db.run(query, [item.title, item.lesson, item.dueDate, item.description, false, now, now], err => {
                    if (err) console.error('Ödev kaydı eklenirken hata:', err.message);
                });
            } else {
                // SQLite için
                const query = `
                    INSERT OR IGNORE INTO homework (title, lesson, dueDate, description, isCompleted, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `;
                db.run(query, [item.title, item.lesson, item.dueDate, item.description, 0], err => {
                    if (err) console.error('Ödev kaydı eklenirken hata:', err.message);
                });
            }
        } catch (error) {
            console.error('Ödev kaydı eklenirken hata:', error);
        }
    });
    
    console.log('Ödev örnek kayıtları eklendi.');
}

// Örnek duyuru verilerini ekle
function addAnnouncementExamples() {
    console.log('Duyuru örnek kayıtları ekleniyor...');
    
    // Örnek duyuru verileri
    const announcementData = [
        { 
            title: "Veli Toplantısı", 
            content: "Önümüzdeki Cuma günü saat 15:00'te okul salonunda veli toplantısı yapılacaktır. Tüm velilerimizin katılımını bekliyoruz.",
            importance: "important" 
        },
        { 
            title: "Okul Gezisi", 
            content: "Gelecek hafta Çarşamba günü Bilim Merkezi'ne gezi düzenlenecektir. İzin formlarını Pazartesi gününe kadar teslim ediniz.",
            importance: "normal" 
        },
        { 
            title: "Yarıyıl Tatili", 
            content: "Yarıyıl tatili 22 Ocak - 5 Şubat tarihleri arasında olacaktır. Tüm öğrencilerimize iyi tatiller dileriz.",
            importance: "normal" 
        }
    ];
    
    const now = new Date().toISOString();
    
    // Her kayıt için veritabanına ekle
    announcementData.forEach(item => {
        try {
            if (isPg) {
                // PostgreSQL için
                const query = `
                    INSERT INTO announcements (title, content, importance, createdAt, updatedAt)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (title) DO NOTHING
                `;
                db.run(query, [item.title, item.content, item.importance, now, now], err => {
                    if (err) console.error('Duyuru kaydı eklenirken hata:', err.message);
                });
            } else {
                // SQLite için
                const query = `
                    INSERT OR IGNORE INTO announcements (title, content, importance, createdAt, updatedAt)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `;
                db.run(query, [item.title, item.content, item.importance], err => {
                    if (err) console.error('Duyuru kaydı eklenirken hata:', err.message);
                });
            }
        } catch (error) {
            console.error('Duyuru kaydı eklenirken hata:', error);
        }
    });
    
    console.log('Duyuru örnek kayıtları eklendi.');
}

// Örnek not verilerini ekle
function addGradeExamples() {
    console.log('Not örnek kayıtları ekleniyor...');
    
    // Bugünün tarihini al
    const today = new Date();
    const lastMonth = new Date(today);
    lastMonth.setMonth(today.getMonth() - 1);
    
    // Örnek not verileri
    const gradeData = [
        { 
            title: "Matematik 1. Sınav", 
            lesson: "Matematik", 
            type: "Yazılı Sınav", 
            examDate: lastMonth.toISOString().split('T')[0]
        },
        { 
            title: "Türkçe 1. Sınav", 
            lesson: "Türkçe", 
            type: "Yazılı Sınav", 
            examDate: lastMonth.toISOString().split('T')[0]
        },
        { 
            title: "Fen Bilgisi Proje", 
            lesson: "Fen Bilgisi", 
            type: "Proje", 
            examDate: today.toISOString().split('T')[0]
        }
    ];
    
    const now = new Date().toISOString();
    
    // Her kayıt için veritabanına ekle
    gradeData.forEach(item => {
        try {
            if (isPg) {
                // PostgreSQL için
                const query = `
                    INSERT INTO grades (title, lesson, type, examDate, createdAt, updatedAt)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (title, lesson) DO NOTHING
                `;
                db.run(query, [item.title, item.lesson, item.type, item.examDate, now, now], err => {
                    if (err) console.error('Not kaydı eklenirken hata:', err.message);
                });
            } else {
                // SQLite için
                const query = `
                    INSERT OR IGNORE INTO grades (title, lesson, type, examDate, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `;
                db.run(query, [item.title, item.lesson, item.type, item.examDate], err => {
                    if (err) console.error('Not kaydı eklenirken hata:', err.message);
                });
            }
        } catch (error) {
            console.error('Not kaydı eklenirken hata:', error);
        }
    });
    
    console.log('Not örnek kayıtları eklendi.');
}

// Duyurular için API endpoint'leri
// 1. Tüm duyuruları getir
app.get('/api/announcements/get', (req, res) => {
    console.log('Duyurular getiriliyor...');
    
    try {
        let query;
        if (isPg) {
            query = `SELECT * FROM announcements ORDER BY "createdAt" DESC`;
        } else {
            query = `SELECT * FROM announcements ORDER BY createdAt DESC`;
        }
        
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error('Duyurular çekilirken hata:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Veritabanı hatası',
                    details: err.message 
                });
            }
            
            console.log(`${rows.length} adet duyuru kaydı bulundu.`);
            res.json({
                success: true,
                announcements: rows
            });
        });
    } catch (error) {
        console.error('Duyuru getirme hatası:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası',
            details: error.message
        });
    }
});

// Sınav notları için API endpoint'leri
// 1. Tüm notları getir
app.get('/api/grades/get', (req, res) => {
    console.log('Sınav notları getiriliyor...');
    
    try {
        let query;
        if (isPg) {
            query = `SELECT * FROM grades ORDER BY "examDate" DESC`;
        } else {
            query = `SELECT * FROM grades ORDER BY examDate DESC`;
        }
        
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error('Sınav notları çekilirken hata:', err);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Veritabanı hatası',
                    details: err.message 
                });
            }
            
            console.log(`${rows.length} adet sınav notu kaydı bulundu.`);
            res.json({
                success: true,
                grades: rows
            });
        });
    } catch (error) {
        console.error('Sınav notu getirme hatası:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası',
            details: error.message
        });
    }
});

// Frontend dosyalarını servis et - tüm rotalar için catch-all
app.get('*', (req, res) => {
    // Eğer bir API isteği gelirse ve aslında API yok ise, JSON hata döndür
    if (req.path.startsWith('/api/')) {
        console.log(`Bulunamayan API endpoint'i çağrıldı: ${req.path}`);
        return res.status(404).json({
            success: false,
            error: 'API endpoint bulunamadı',
            requested_endpoint: req.path
        });
    }
    
    // Frontend için index.html dosyasını gönder
    console.log(`Frontend istendi: ${req.path}`);
    res.set('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Sunucuyu dinlemeye başla
app.listen(PORT, () => {
    console.log(`Server ${PORT} portunda çalışıyor...`);
    console.log(`http://localhost:${PORT} adresinden erişebilirsiniz`);
});