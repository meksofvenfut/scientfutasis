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
            
            // Veriyi formatla (key formatını değiştiriyorum)
            const scheduleData = {};
            
            if (rows && rows.length > 0) {
                rows.forEach(row => {
                    // Her hücre için benzersiz bir key oluştur: {rowIndex}_{colIndex}
                    const cellKey = `${row.rowIndex}_${row.colIndex}`;
                    // Veriyi doğrudan bu key altına yerleştir
                    scheduleData[cellKey] = row.content;
                });
            }
            
            // Log ekleyelim
            console.log('Formatlanmış ders programı verileri:', scheduleData);
            
            // Başarılı yanıt
            return res.json({
                success: true,
                schedule: scheduleData,
                timestamp: new Date().toISOString()
            });
        });
    } catch (error) {
        console.error('Ders programı getirme hatası:', error);
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