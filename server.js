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

// Kullanıcı oturumlarının yönetimi için geçersiz kılınmış token listesi
// Bu liste, şifresi değiştirilen kullanıcıların ID'lerini ve şifre değişim zamanını içerir
// Bu sayede, kullanıcının şifresi değiştirildiğinde eski oturumları geçersiz kılınabilir
const revokedUserTokens = new Map();

// Veritabanı bağlantısı için değişkenler
let db;
let pool; // Global pool değişkeni tanımlıyorum

// SQLite veya PostgreSQL kullanılacağını belirle
const isPg = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgres');
const dbType = isPg ? 'postgresql' : 'sqlite';
console.log('Veritabanı URL:', process.env.DATABASE_URL ? 'Mevcut (gizli)' : 'Tanımlanmamış');
console.log('isPg değeri:', isPg);
console.log('Veritabanı türü (dbType):', dbType);

// Sabitler
const DB_PATH = process.env.NODE_ENV === 'production' ? './scientfutasis.db' : ':memory:';
const JWT_SECRET = process.env.JWT_SECRET || 'scientfutasis-secret-key';

// DB bağlantısı kurma
if (isPg) {
    // PostgreSQL bağlantısı (Render.com'da otomatik sağlanan değişkenler)
    pool = new Pool({
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
        },
        query: (text, params, callback) => {
            return pool.query(text, params)
                .then(res => {
                    if (callback) callback(null, res);
                    return res;
                })
                .catch(err => {
                    console.error('PostgreSQL query hatası:', err);
                    if (callback) callback(err);
                    return err;
                });
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

// JWT token doğrulama middleware'i
// Bu middleware, istek headerlarında token varsa bunu çözümler ve geçerliliğini kontrol eder
app.use('/api', (req, res, next) => {
    // Login ve register endpointleri için token kontrolü yapma
    if (req.path === '/api/login' || req.path === '/api/register' || req.path === '/api/init' || req.path === '/api/init-data') {
        return next();
    }
    
    // Authorization header'ından token'ı al
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(); // Token yoksa bir sonraki middleware'e geç
    }
    
    const token = authHeader.split(' ')[1];
    if (!token) {
        return next();
    }
    
    try {
        // Token'ı doğrula
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Token'ın şifre değişikliği sonrası geçersiz kılınıp kılınmadığını kontrol et
        const userId = decoded.id.toString();
        const tokenIssuedAt = new Date(decoded.iat * 1000).getTime(); // Token oluşturulma zamanı (saniyeden milisaniyeye çevir)
        
        // Kullanıcının token'ı geçersiz kılma zamanını al
        const revocationTime = revokedUserTokens.get(userId);
        
        // Eğer token geçersiz kılma zamanından önce oluşturulmuşsa, geçersiz say
        if (revocationTime && tokenIssuedAt < revocationTime) {
            console.log(`Kullanıcı ID: ${userId} için geçersiz token tespit edildi. Token tarihi: ${new Date(tokenIssuedAt).toISOString()}, Geçersiz kılma tarihi: ${new Date(revocationTime).toISOString()}`);
            return res.status(401).json({ 
                success: false, 
                message: 'Oturumunuz sonlandırıldı, lütfen tekrar giriş yapın',
                code: 'TOKEN_REVOKED'
            });
        }
        
        // Token geçerliyse, kullanıcı bilgilerini request nesnesine ekle
        req.user = decoded;
        next();
    } catch (error) {
        console.error('Token doğrulama hatası:', error.message);
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Oturumunuz sona erdi, lütfen tekrar giriş yapın',
                code: 'TOKEN_EXPIRED'
            });
        }
        next();
    }
});

// URL düzeltmesi için middleware - /users gibi çağrıları /api/users'a yönlendir
app.use((req, res, next) => {
    // API ile ilgili endpointleri kontrol et
    const apiPaths = [
        '/users', 
        '/login', 
        '/register', 
        '/schedule', 
        '/homework', 
        '/announcements', 
        '/grades', 
        '/init', 
        '/init-data', 
        '/debug'
    ];
    
    // Eğer path /api ile başlamıyorsa ve bilinen bir API path'i ise
    if (!req.path.startsWith('/api/') && apiPaths.some(p => req.path.startsWith(p))) {
        console.log(`URL yönlendirme: ${req.path} -> /api${req.path}`);
        // /api/ ekleyerek yönlendir
        req.url = `/api${req.url}`;
    }
    next();
});

// Frontend dosyalarını servis et
app.use(express.static(__dirname));

// Dosya yükleme için klasör oluşturma
const renderBasePath = '/opt/render/project/src';
const isRunningOnRender = fs.existsSync(renderBasePath);
const uploadDir = isRunningOnRender 
    ? path.join(renderBasePath, 'uploads') 
    : path.join(__dirname, 'uploads');

console.log('Uploads klasörü yolu:', uploadDir);
console.log('isRunningOnRender:', isRunningOnRender);

if (!fs.existsSync(uploadDir)) {
    console.log(`Uploads klasörü (${uploadDir}) bulunamadı, oluşturuluyor...`);
    try {
    fs.mkdirSync(uploadDir, { recursive: true });
        console.log('Uploads klasörü başarıyla oluşturuldu.');
        // Klasörün izinlerini kontrol et ve logla
        const stats = fs.statSync(uploadDir);
        console.log('Uploads klasörü izinleri:', stats.mode.toString(8));
    } catch (error) {
        console.error('Uploads klasörü oluşturulurken hata:', error);
    }
}

// Dosya yükleme ayarları
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Mevcut olduğundan emin ol
        if (!fs.existsSync(uploadDir)) {
            console.log('Uploads klasörü tekrar kontrol edildi, bulunamadı. Yeniden oluşturuluyor...');
            try {
                fs.mkdirSync(uploadDir, { recursive: true });
                console.log('Uploads klasörü başarıyla yeniden oluşturuldu.');
            } catch (dirError) {
                console.error('Uploads klasörü oluşturulurken hata:', dirError);
            }
        }
        
        console.log('Dosya yükleme hedefi:', uploadDir);
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Dosya adı içindeki Türkçe karakterleri düzgün şekilde sakla
        // HTTP başlığından gelen dosya adını UTF-8'e dönüştür
        // Multer dosya adlarını binary olarak alır, bu yüzden açıkça dönüştürüyoruz
        let originalName = file.originalname;
        
        try {
            // Dosya adını UTF-8'e dönüştür
            // Latin1 (ISO-8859-1) encoding'den başlayacağız çünkü HTTP başlıkları genellikle bu şekilde gelir
            originalName = Buffer.from(originalName, 'binary').toString('utf8');
        } catch (error) {
            console.error('Dosya adı dönüştürme hatası:', error);
        }
        
        // Dosya adında güvenlik için zararlı karakterleri temizle, ama Türkçe karakterleri koru
        const safeName = originalName.replace(/[\/\\:*?"<>|]/g, '_');
        console.log(`Orijinal dosya adı: ${file.originalname}, Kayıt edilecek: ${safeName}`);
        
        // Dosyanın tam yolunu da logla
        const fullPath = path.join(uploadDir, safeName);
        console.log('Oluşturulacak tam dosya yolu:', fullPath);
        
        cb(null, safeName);
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
                "usertype" TEXT NOT NULL,
                "lastlogin" TEXT
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
                "eventDate" TEXT,
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
                "examDate" TEXT NOT NULL,
                file_path TEXT,
                file_name TEXT,
                file_size INTEGER,
                file_data TEXT,  -- Base64 formatında dosya içeriği
                file_type TEXT,  -- Dosya MIME tipi
                "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
            eventDate TEXT,
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
    db.all("SELECT DISTINCT usertype FROM users", [], (err, rows) => {
        if (err) {
            console.error('Kullanıcı tipleri kontrolü yaparken hata:', err.message);
        } else {
            console.log('Mevcut kullanıcı tipleri:', rows && rows.length ? rows.map(r => r.usertype).join(', ') : 'Yok');
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
                    INSERT INTO users (name, username, password, "usertype")
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (username) DO NOTHING
                `;
                
                db.run(insertYoneticiSQL, ['MEK Admin', 'MEK', password, 'admin'], function(err) {
                    if (err) {
                        console.error('Varsayılan Yönetici kullanıcısı oluştururken hata:', err.message);
                    } else {
                        console.log('Varsayılan Yönetici kullanıcısı oluşturuldu: MEK');
                    }
                });
                
                const insertAdminSQL = `
                    INSERT INTO users (name, username, password, "usertype")
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
    
    // Duyurular tablosunda eventDate sütunu var mı kontrol et
    const announcementsQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'announcements'
    `;
    
    db.all(announcementsQuery, [], (err, columns) => {
        if (err) {
            console.error("PostgreSQL announcements tablosu sütun bilgisi alınamadı:", err);
            return;
        }
        
        // Sütun isimlerini bir listeye çevir
        const columnNames = columns.map(col => col.column_name);
        
        // eventDate sütunu var mı kontrol et (küçük harfle de olabilir)
        const hasEventDate = columnNames.includes('eventdate') || columnNames.includes('eventDate');
        
        if (!hasEventDate) {
            console.log("PostgreSQL announcements tablosuna eventDate sütunu ekleniyor...");
            
            // PostgreSQL için eventDate sütunu ekle
            db.run(`ALTER TABLE announcements ADD COLUMN "eventDate" TEXT`, [], function(err) {
                if (err) {
                    console.error("PostgreSQL eventDate sütunu eklenemedi:", err);
                } else {
                    console.log("PostgreSQL: announcements tablosuna eventDate sütunu eklendi.");
                }
            });
        } else {
            console.log("PostgreSQL: announcements tablosunda eventDate sütunu zaten var.");
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
            `SELECT id, name, username, "usertype" FROM users WHERE username = $1 AND password = $2` :
            `SELECT id, name, username, userType FROM users WHERE username = ? AND password = ?`;
        
        const params = isPg ? [username, encodedPassword] : [username, encodedPassword];
        
        console.log("Sorgu çalıştırılıyor:", query);
        console.log("Parametreler:", params);
        
        db.get(query, params, (err, row) => {
        if (err) {
                console.error('Veritabanı hatası:', err.message, err.stack);
                return res.status(500).json({ success: false, message: 'Sunucu hatası', details: err.message });
            }
            
            if (!row) {
                console.error('Kimlik doğrulama başarısız: kullanıcı bulunamadı veya şifre yanlış');
                return res.status(401).json({ success: false, message: 'Kullanıcı adı veya şifre yanlış' });
            }
            
            console.log('Kullanıcı bulundu:', row);
            
            // Kullanıcı türünü kontrol et - PostgreSQL büyük/küçük harf duyarlılığı
            // PostgreSQL'de artık direkt usertype gelecek
            let userTypeValue = row.usertype || '';
            
            console.log('Orijinal userType değeri:', userTypeValue);
            userTypeValue = userTypeValue.toLowerCase();
            
            // Admin kontrolü yapılıyor
            if (userTypeValue === 'yönetici' || userTypeValue === 'admin') {
                userTypeValue = 'admin';
                console.log('Kullanıcı tipi "admin" olarak ayarlandı');
            }
            
            // JWT token oluştur
            const token = jwt.sign(
                { id: row.id, username: row.username, userType: userTypeValue },
                JWT_SECRET,
                { expiresIn: '30d' } // 30 gün boyunca geçerli olacak
            );
            
            console.log('Token oluşturuldu, kullanıcı bilgileri gönderiliyor');
        
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
            
            // Kullanıcı login zamanını güncelle
            const loginTimeUpdateQuery = isPg ? 
                `UPDATE users SET "lastlogin" = $1 WHERE id = $2` :
                `UPDATE users SET lastLogin = ? WHERE id = ?`;
            
            const loginTimeParams = isPg ? [new Date().toISOString(), row.id] : [new Date().toISOString(), row.id];
            
            db.run(loginTimeUpdateQuery, loginTimeParams, err => {
                if (err) console.error('Login zamanı güncellenirken hata:', err.message);
                else console.log(`${username} kullanıcısı için login zamanı güncellendi`);
            });
        });
    } catch (error) {
        console.error('Login işleminde hata:', error.message, error.stack);
        res.status(500).json({ success: false, message: 'Sunucu hatası', error: error.message });
    }
});

// 2. Kullanıcı kayıt endpoint'i
app.post('/api/register', (req, res) => {
    try {
        const { name, username, password, userType } = req.body;
        
        console.log('Yeni kullanıcı kayıt isteği alındı:', { name, username, userType });
    
        // İsim yoksa kullanıcı adını kullan
        const userName = name || username;

    if (!username || !password || !userType) {
            console.log('Eksik bilgilerle kullanıcı kayıt girişimi');
            return res.status(400).json({ 
                success: false, 
                error: 'Kullanıcı adı, şifre ve kullanıcı tipi gereklidir' 
            });
    }
    
    // Kullanıcı tipi kontrolü
    const allowedTypes = ['admin', 'teacher', 'student'];
    if (!allowedTypes.includes(userType)) {
        return res.status(400).json({ error: 'Geçerli bir kullanıcı tipi seçin' });
    }
    
        // Şifreyi kodla (encode) - login ile aynı yöntemi kullan
        const encodedPassword = Buffer.from(password).toString('base64');
        console.log(`Şifre kodlandı: Orijinal uzunluk = ${password.length}, Kodlanmış uzunluk = ${encodedPassword.length}`);

    // Kullanıcı adının benzersiz olup olmadığını kontrol et
        let query, params;
        
        if (isPg) {
            query = `SELECT * FROM users WHERE username = $1`;
        } else {
            query = `SELECT * FROM users WHERE username = ?`;
        }
        params = [username];
        
        db.get(query, params, (err, row) => {
        if (err) {
            console.error('Kullanıcı kontrolü yapılırken hata:', err.message);
                return res.status(500).json({ 
                    success: false,
                    error: 'Veritabanı hatası', 
                    message: err.message 
                });
        }
        
        if (row) {
                return res.status(409).json({ 
                    success: false,
                    error: 'Bu kullanıcı adı zaten kullanılıyor' 
                });
        }
        
        // Kullanıcıyı ekle
            const now = new Date().toISOString();
            
            if (isPg) {
                query = `
                    INSERT INTO users (name, username, password, "usertype", "lastlogin")
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id
                `;
                params = [userName, username, encodedPassword, userType, now];
            } else {
                query = `
                    INSERT INTO users (name, username, password, userType, lastLogin)
                    VALUES (?, ?, ?, ?, ?)
                `;
                params = [userName, username, encodedPassword, userType, now];
            }
            
            db.run(query, params, function(err) {
            if (err) {
              console.error('Kullanıcı eklenirken hata:', err.message);
                    return res.status(500).json({ 
                        success: false, 
                        error: 'Veritabanı hatası',
                        message: err.message
                    });
            }
            
            console.log(`Yeni kullanıcı eklendi. ID: ${this.lastID}, Zaman: ${getTurkishTimeString()}`);
            
            res.status(201).json({ 
              success: true, 
              message: 'Kullanıcı başarıyla eklendi',
              userId: this.lastID 
            });
          });
    });
    } catch (error) {
        console.error('Kullanıcı kayıt hatası:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Sunucu hatası',
            message: error.message 
        });
    }
});

// 3. Kullanıcıları listeleme endpoint'i (sadece admin için)
app.get('/api/users', (req, res) => {
    const currentTime = getCurrentTimestamp();
    console.log(`Kullanıcılar çekiliyor - Zaman: ${getTurkishTimeString()}`);
  
    try {
        let query;
        if (isPg) {
            // PostgreSQL sorgusu - küçük harfle sütun adları kullanır
            query = `SELECT id, name, username, "usertype" as userType, "lastlogin" as lastLogin FROM users`;
        } else {
            query = `SELECT id, name, username, userType, lastLogin FROM users`;
        }
        
        console.log("Kullanıcılar için sorgu çalıştırılıyor:", query);
      
        db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Kullanıcılar çekilirken hata:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Veritabanı hatası', 
                    error: err.message 
                });
            }
            
            if (!rows) {
                console.log('Kullanıcı sonuçları undefined');
                return res.json([]);
            }
            
            const safeRows = Array.isArray(rows) ? rows : [];
            
            console.log(`${safeRows.length} adet kullanıcı kaydı bulundu.`);
            if (safeRows.length > 0) {
                console.log('İlk kullanıcı örneği:', safeRows[0]);
            }
            
            // Kullanıcılarda type alanlarını düzelt
            const cleanedRows = safeRows.map(user => {
                // Kullanıcı tipi PostgreSQL'de küçük harfle gelebilir, normalize et
                const userType = user.userType || user.usertype || 'student';
                // Temiz bir nesne oluştur
                return {
                    id: user.id,
                    name: user.name,
                    username: user.username,
                    userType: userType, // Normalize edilmiş değeri kullan
                    lastLogin: user.lastLogin || user.lastlogin
                };
            });
            
            // Direkt dizi olarak dön
            return res.json(cleanedRows);
        });
    } catch (error) {
        console.error('Kullanıcılar getirme hatası:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası', 
            error: error.message 
        });
    }
});

// 3. Kullanıcıları listeleme endpoint'i (sadece admin için)
app.get('/api/users/list', (req, res) => {
    let query;
    if (isPg) {
        query = `SELECT id, username, "usertype" as userType, "createdat" as createdAt FROM users`;
    } else {
        query = `SELECT id, username, userType, createdAt FROM users`;
    }
    
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
            deleteQuery = `DELETE FROM schedule WHERE "userId" = $1`;
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
                    error: 'Veritabanı hatası',
                    details: err.message
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
                        INSERT INTO schedule ("userId", "rowIndex", "colIndex", content, "createdAt", "updatedAt")
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT ("userId", "rowIndex", "colIndex") 
                        DO UPDATE SET content = $4, "updatedAt" = $6
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
    let query;
    
    if (isPg) {
        query = `SELECT * FROM homework ORDER BY "dueDate" ASC`;
    } else {
        query = `SELECT * FROM homework ORDER BY dueDate ASC`;
    }
    
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
                INSERT INTO homework (title, lesson, "dueDate", description, "isCompleted", "createdAt", "updatedAt")
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
                SET title = $1, lesson = $2, "dueDate" = $3, description = $4, "updatedAt" = $5
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
                        "eventDate" TEXT,
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
                        "examDate" TEXT NOT NULL,
                        file_path TEXT,
                        file_name TEXT,
                        file_size INTEGER,
                        file_data TEXT,  -- Base64 formatında dosya içeriği
                        file_type TEXT,  -- Dosya MIME tipi
                        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
                INSERT INTO users (name, username, password, "usertype")
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (username) DO UPDATE SET "usertype" = $4
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
        
        // Başarılı yanıt
        res.json({
            success: true,
            message: 'Veritabanına örnek veriler ekleniyor...'
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

// Örnek ders programı ekle
function addScheduleExamples() {
    console.log('Örnek ders programı ekleniyor...');
    
    // Önce mevcut kayıtları sil
    db.run(isPg ? `DELETE FROM schedule WHERE "userId" = $1` : `DELETE FROM schedule WHERE userId = ?`, [1], err => {
        if (err) {
            console.error('Mevcut ders programı temizleme hatası:', err.message);
            return;
        }
        
        console.log('Mevcut ders programı temizlendi');
        
        // Örnek dersler
        const lessons = [
            { row: 1, col: 1, content: 'Matematik' },
            { row: 1, col: 2, content: 'Fizik' },
            { row: 1, col: 3, content: 'Kimya' },
            { row: 1, col: 4, content: 'Biyoloji' },
            { row: 1, col: 5, content: 'İngilizce' },
            { row: 2, col: 1, content: 'Türkçe' },
            { row: 2, col: 2, content: 'Tarih' },
            { row: 2, col: 3, content: 'Coğrafya' },
            { row: 2, col: 4, content: 'Sosyal Bilgiler' },
            { row: 2, col: 5, content: 'Bilgisayar' }
        ];
        
        const now = new Date().toISOString();
        
        // Her bir ders için kayıt ekle
        lessons.forEach(lesson => {
            const insertQuery = isPg ?
                `INSERT INTO schedule ("userId", "rowIndex", "colIndex", content, "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT ("userId", "rowIndex", "colIndex") 
                DO UPDATE SET content = $4, "updatedAt" = $6` :
                `INSERT OR REPLACE INTO schedule (userId, rowIndex, colIndex, content, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
                
            const insertParams = isPg ?
                [1, lesson.row, lesson.col, lesson.content, now, now] :
                [1, lesson.row, lesson.col, lesson.content];
                
            db.run(insertQuery, insertParams, err => {
                if (err) {
                    console.error(`Ders ekleme hatası (${lesson.row}, ${lesson.col}):`, err.message);
                } else {
                    console.log(`Ders eklendi (${lesson.row}, ${lesson.col}): ${lesson.content}`);
                }
            });
        });
    });
}

// Örnek ödevler ekle
function addHomeworkExamples() {
    console.log('Örnek ödevler ekleniyor...');
    
    // Önceki kayıtları temizle
    db.run(`DELETE FROM homework`, [], err => {
        if (err) {
            console.error('Ödev temizleme hatası:', err.message);
            return;
        }
        
        console.log('Mevcut ödevler temizlendi');
        
        // Örnek ödevler
        const homeworks = [
            { title: 'Matematik Proje', lesson: 'Matematik', dueDate: '2024-07-01', description: 'Türev ve integral konularını içeren bir proje hazırlamanız gerekmektedir.' },
            { title: 'Fizik Deney Raporu', lesson: 'Fizik', dueDate: '2024-06-15', description: 'Elektromanyetizma deneyi için rapor hazırlayınız.' },
            { title: 'İngilizce Kompozisyon', lesson: 'İngilizce', dueDate: '2024-06-20', description: 'Technology in Education konulu bir kompozisyon yazınız (500 kelime).' }
        ];
        
        const now = new Date().toISOString();
        
        // Her bir ödev için kayıt ekle
        homeworks.forEach(hw => {
            const insertQuery = isPg ?
                `INSERT INTO homework (title, lesson, "dueDate", description, "isCompleted", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (title, lesson) DO NOTHING` :
                `INSERT OR IGNORE INTO homework (title, lesson, dueDate, description, isCompleted, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
                
            const insertParams = isPg ?
                [hw.title, hw.lesson, hw.dueDate, hw.description, false, now, now] :
                [hw.title, hw.lesson, hw.dueDate, hw.description, 0];
                
            db.run(insertQuery, insertParams, err => {
                if (err) {
                    console.error(`Ödev ekleme hatası (${hw.title}):`, err.message);
                } else {
                    console.log(`Ödev eklendi: ${hw.title} - ${hw.lesson}`);
                }
            });
        });
    });
}

// Örnek duyurular ekle
function addAnnouncementExamples() {
    console.log('Örnek duyurular ekleniyor...');
    
    // Önceki kayıtları temizle
    db.run(`DELETE FROM announcements`, [], err => {
        if (err) {
            console.error('Duyuru temizleme hatası:', err.message);
            return;
        }
        
        console.log('Mevcut duyurular temizlendi');
        
        // Örnek duyurular
        const announcements = [
            { title: 'Ara Tatil Duyurusu', content: 'Okulumuz 15-19 Nisan tarihleri arasında ara tatil nedeniyle kapalı olacaktır.', importance: 'important' },
            { title: 'Veli Toplantısı', content: 'Veli toplantımız 10 Nisan Cuma günü saat 14:00\'da yapılacaktır. Tüm velilerimiz davetlidir.', importance: 'normal' },
            { title: 'Bilim Şenliği', content: 'Okulumuzda 25 Mayıs tarihinde bilim şenliği düzenlenecektır. Tüm öğrencilerimizin katılımını bekliyoruz.', importance: 'normal' }
        ];
        
        const now = new Date().toISOString();
        
        // Her bir duyuru için kayıt ekle
        announcements.forEach(announcement => {
            const insertQuery = isPg ?
                `INSERT INTO announcements (title, content, importance, "eventDate", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id` :
                `INSERT OR IGNORE INTO announcements (title, content, importance, eventDate, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
                
            const params = isPg ?
                [announcement.title, announcement.content, announcement.importance, announcement.eventDate || null, now, now] :
                [announcement.title, announcement.content, announcement.importance, announcement.eventDate || null];
                
            db.run(insertQuery, params, function(err) {
                if (err) {
                    console.error('Duyuru eklenirken hata:', err.message);
                    return; // Örnek verileri eklerken hata döndürmek gerekmez
                }
                
                console.log(`Yeni duyuru eklendi: ${announcement.title} - ID: ${this.lastID || 0}`);
            });
        });
    });
}

// Örnek sınav notları ekle
function addGradeExamples() {
    console.log('Örnek sınav notları ekleniyor...');
    
    // Önceki kayıtları temizle
    db.run(`DELETE FROM grades`, [], err => {
        if (err) {
            console.error('Sınav notu temizleme hatası:', err.message);
            return;
        }
        
        console.log('Mevcut sınav notları temizlendi');
        
        // Örnek sınav notları
        const grades = [
            { title: '1. Dönem Sınavı', lesson: 'Matematik', type: 'Yazılı', examDate: '2024-04-15' },
            { title: '2. Dönem Sınavı', lesson: 'Fizik', type: 'Yazılı', examDate: '2024-05-10' },
            { title: 'Final Sınavı', lesson: 'Kimya', type: 'Final', examDate: '2024-06-20' }
        ];
        
        const now = new Date().toISOString();
        
        // Her bir sınav notu için kayıt ekle
        grades.forEach(grade => {
            const insertQuery = isPg ?
                `INSERT INTO grades (title, lesson, type, "examDate", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (title, lesson) DO NOTHING` :
                `INSERT OR IGNORE INTO grades (title, lesson, type, examDate, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
                
            const insertParams = isPg ?
                [grade.title, grade.lesson, grade.type, grade.examDate, now, now] :
                [grade.title, grade.lesson, grade.type, grade.examDate];
                
            db.run(insertQuery, insertParams, err => {
                if (err) {
                    console.error(`Sınav notu ekleme hatası (${grade.title}):`, err.message);
                } else {
                    console.log(`Sınav notu eklendi: ${grade.title} - ${grade.lesson}`);
                }
            });
        });
    });
}

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
        
        db.all(tablesQuery, [], async (err, tables) => {
            if (err) {
                console.error('Tablo listesi alınırken hata:', err.message);
                return res.status(500).json({
                    success: false,
                    error: 'Veritabanı tabloları alınamadı',
                    details: err.message
                });
            }
            
            // Bulunan tablolar için bilgi topla
            const tablePromises = tables.map(async (table) => {
                const tableName = table.table_name;
                
                // Sistem tablolarını atla
                if (tableName.startsWith('pg_') || 
                    tableName === 'sqlite_sequence' || 
                    tableName.startsWith('information_schema') || 
                    tableName.startsWith('_')) {
                    return null;
                }
                
                // Tablo bilgilerini al (kayıt sayısı ve örnek veriler)
                try {
                    // Kayıt sayısı
                    const countQuery = isPg ?
                        `SELECT COUNT(*) as count FROM "${tableName}"` :
                        `SELECT COUNT(*) as count FROM "${tableName}"`;
                    
                    const countResult = await new Promise((resolve, reject) => {
                        db.get(countQuery, [], (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                        });
                    });
                    
                    // Örnek veriler (ilk 5 kayıt)
                    const sampleQuery = isPg ?
                        `SELECT * FROM "${tableName}" LIMIT 5` :
                        `SELECT * FROM "${tableName}" LIMIT 5`;
                    
                    const sampleResult = await new Promise((resolve, reject) => {
                        db.all(sampleQuery, [], (err, results) => {
                            if (err) reject(err);
                            else resolve(results || []);
                        });
                    });
                    
                    return {
                        tableName,
                        recordCount: countResult ? countResult.count : 0,
                        sampleRecords: sampleResult || []
                    };
                } catch (err) {
                    console.error(`Tablo bilgisi alınırken hata (${tableName}):`, err.message);
                    return {
                        tableName,
                        error: err.message,
                        recordCount: 0,
                        sampleRecords: []
                    };
                }
            });
            
            // Tüm tablo bilgilerini topla
            try {
                const tableResults = await Promise.all(tablePromises);
                // null sonuçları filtrele
                result.tables = tableResults.filter(t => t !== null);
                
                // Sonuçları döndür
                return res.json({
                    success: true,
                    ...result
                });
            } catch (error) {
                console.error('Tablo bilgileri toplanırken hata:', error);
                return res.status(500).json({
                    success: false,
                    error: 'Tablo bilgileri toplanamadı',
                    details: error.message
                });
            }
        });
    } catch (error) {
        console.error('Veritabanı durumu kontrolü hatası:', error);
        return res.status(500).json({
            success: false,
            error: 'Sunucu hatası',
            details: error.message
        });
    }
});

// Duyurular için API endpoint'leri
// 1. Tüm duyuruları getir
app.get('/api/announcements/get', (req, res) => {
    let query;
    
    if (isPg) {
        query = `SELECT * FROM announcements ORDER BY "createdAt" DESC`;
    } else {
        query = `SELECT * FROM announcements ORDER BY createdAt DESC`;
    }
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error(`Duyuru verileri çekilirken hata (${getTurkishTimeString()}):`, err);
            return res.status(500).json({ error: 'Veritabanı hatası' });
        }
        
        console.log(`${rows.length} adet duyuru bulundu. Zaman: ${getTurkishTimeString()}`);
        res.json(rows);
    });
});

// 2. Yeni duyuru ekle
app.post('/api/announcements/add', (req, res) => {
    console.log('Yeni duyuru ekleme isteği alındı:', req.body);
    
    const { title, content, importance, eventDate, userType } = req.body;
    
    // Yönetici kontrolü
    if (userType !== 'admin' && userType !== 'Yönetici') {
        console.error('Yetkisiz duyuru ekleme girişimi:', userType);
        return res.status(403).json({ 
            success: false, 
            message: 'Bu işlem için yönetici yetkileri gerekiyor' 
        });
    }
    
    // Gerekli alanların kontrolü
    if (!title || !content) {
        console.error('Eksik bilgi ile duyuru ekleme girişimi');
        return res.status(400).json({ 
            success: false, 
            message: 'Başlık ve içerik gereklidir' 
        });
    }
    
    try {
        const announcementImportance = importance || 'normal';
        
        // Türkiye saati (UTC+3) olarak şu anki zamanı al
        const now = new Date();
        // 3 saat ekleyerek Türkiye saatine çevir
        now.setHours(now.getHours() + 3);
        const turkeyTime = now.toISOString();
        
        let query, params;
        
        if (isPg) {
            query = `
                INSERT INTO announcements (title, content, importance, "eventDate", "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id
            `;
            params = [title, content, announcementImportance, eventDate || null, turkeyTime, turkeyTime];
        } else {
            query = `
                INSERT INTO announcements (title, content, importance, eventDate, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `;
            params = [title, content, announcementImportance, eventDate || null];
        }
        
        db.run(query, params, function(err) {
        if (err) {
                console.error('Duyuru eklenirken hata:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Veritabanı hatası', 
                    error: err.message 
                });
            }
            
            console.log(`Yeni duyuru eklendi: ${title} - ID: ${this.lastID}`);
        res.json({ 
            success: true, 
            message: 'Duyuru başarıyla eklendi',
                id: this.lastID 
        });
    });
    } catch (error) {
        console.error('Duyuru ekleme hatası:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası', 
            error: error.message 
        });
    }
});

// 3. Duyuru düzenle
app.put('/api/announcements/update/:id', (req, res) => {
    console.log('Duyuru güncelleme isteği alındı:', req.params.id);
    
    const announcementId = req.params.id;
    const { title, content, importance, eventDate, userType } = req.body;
    
    // Yönetici kontrolü
    if (userType !== 'admin' && userType !== 'Yönetici') {
        console.error('Yetkisiz duyuru güncelleme girişimi:', userType);
        return res.status(403).json({ 
            success: false, 
            message: 'Bu işlem için yönetici yetkileri gerekiyor' 
        });
    }
    
    // Gerekli alanların kontrolü
    if (!announcementId || !title || !content) {
        console.error('Eksik bilgi ile duyuru güncelleme girişimi');
        return res.status(400).json({ 
            success: false, 
            message: 'ID, başlık ve içerik gereklidir' 
        });
    }
    
    try {
        const announcementImportance = importance || 'normal';
        
        // Türkiye saati (UTC+3) olarak şu anki zamanı al
        const now = new Date();
        // 3 saat ekleyerek Türkiye saatine çevir
        now.setHours(now.getHours() + 3);
        const turkeyTime = now.toISOString();
        
        let query, params;
        
        if (isPg) {
            query = `
        UPDATE announcements 
                SET title = $1, content = $2, importance = $3, "eventDate" = $4, "updatedAt" = $5
                WHERE id = $6
                RETURNING id
            `;
            params = [title, content, announcementImportance, eventDate || null, turkeyTime, announcementId];
        } else {
            query = `
                UPDATE announcements 
                SET title = ?, content = ?, importance = ?, eventDate = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
    `;
            params = [title, content, announcementImportance, eventDate || null, announcementId];
        }
    
        db.run(query, params, function(err) {
        if (err) {
                console.error('Duyuru güncellenirken hata:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Veritabanı hatası', 
                    error: err.message 
                });
        }
        
        if (this.changes === 0) {
                console.log(`Güncellenecek duyuru bulunamadı - ID: ${announcementId}`);
                return res.status(404).json({ 
                    success: false, 
                    message: 'Güncellenecek duyuru bulunamadı' 
                });
            }
            
            console.log(`Duyuru güncellendi - ID: ${announcementId}`);
        res.json({ 
            success: true, 
            message: 'Duyuru başarıyla güncellendi',
                id: announcementId 
        });
    });
    } catch (error) {
        console.error('Duyuru güncelleme hatası:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası', 
            error: error.message 
        });
    }
});

// 4. Duyuru sil
app.delete('/api/announcements/delete/:id', (req, res) => {
    console.log('Duyuru silme isteği alındı:', req.params.id);
    
    const announcementId = req.params.id;
    const userType = req.body.userType || req.query.userType; // Body veya query'den al
    
    // Yönetici kontrolü
    if (userType !== 'admin' && userType !== 'Yönetici') {
        console.error('Yetkisiz duyuru silme girişimi:', userType);
        return res.status(403).json({ 
            success: false, 
            message: 'Bu işlem için yönetici yetkileri gerekiyor' 
        });
    }
    
    if (!announcementId) {
        return res.status(400).json({ 
            success: false, 
            message: 'Silinecek duyuru ID\'si gereklidir' 
        });
    }
    
    try {
        let query, params;
        
        if (isPg) {
            query = `DELETE FROM announcements WHERE id = $1`;
            params = [announcementId];
        } else {
            query = `DELETE FROM announcements WHERE id = ?`;
            params = [announcementId];
        }
        
        db.run(query, params, function(err) {
        if (err) {
                console.error('Duyuru silinirken hata:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Veritabanı hatası', 
                    error: err.message 
                });
        }
        
        if (this.changes === 0) {
                console.log(`Silinecek duyuru bulunamadı - ID: ${announcementId}`);
                return res.status(404).json({ 
                    success: false, 
                    message: 'Silinecek duyuru bulunamadı' 
                });
            }
            
            console.log(`Duyuru silindi - ID: ${announcementId}`);
        res.json({ 
            success: true, 
                message: 'Duyuru başarıyla silindi'
        });
    });
    } catch (error) {
        console.error('Duyuru silme hatası:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası', 
            error: error.message 
        });
    }
});

// Sınav notları için API endpoint'leri
// 1. Tüm sınav notlarını getir
app.get('/api/grades/get', (req, res) => {
    console.log('Sınav notları getirme isteği alındı');
    
    let query;
    
    if (isPg) {
        query = `SELECT * FROM grades ORDER BY "examDate" DESC`;
    } else {
        query = `SELECT * FROM grades ORDER BY examDate DESC`;
    }
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error(`Sınav notları çekilirken hata (${getTurkishTimeString()}):`, err);
            return res.status(500).json({ 
                success: false, 
                error: 'Veritabanı hatası' 
            });
        }
        
        console.log(`${rows?.length || 0} adet sınav notu bulundu. Zaman: ${getTurkishTimeString()}`);
        // Doğrudan dizi döndür, data wrap'i kullanma
        res.json(rows || []);
    });
});

// 2. Sınav notu ekleme
app.post('/api/grades/add', upload.single('file'), (req, res) => {
    try {
        console.log('Yeni sınav notu ekleme isteği alındı:', req.body);
        
        // Kullanıcı tipi kontrolü - sadece admin kullanıcılar ekleyebilir
        const userType = req.body.userType;
        if (!userType || userType.toLowerCase() !== 'admin') {
            console.error('Yetkisiz kullanıcı sınav notu ekleme girişimi:', userType);
            return res.status(403).json({ 
                success: false, 
                message: 'Bu işlem için yönetici yetkisi gereklidir' 
            });
        }
        
        // Parametreleri al
        const title = req.body.title;
        const lesson = req.body.lesson;
        const type = req.body.type;
        const examDate = req.body.examDate;
        
        // Girilen verileri kontrol et
        if (!title || !lesson || !type || !examDate) {
            console.error('Eksik bilgi ile sınav notu ekleme girişimi');
            return res.status(400).json({ 
                success: false, 
                message: 'Başlık, ders, tür ve tarih gereklidir' 
            });
        }
        
        // Dosya bilgisi
        const file = req.file;
        
        console.log('İşlenmiş parametreler:', {
            title,
            lesson,
            type,
            examDate
        });
        
        const now = new Date().toISOString();
    
        // Dosya bilgileri
        let filePath = '';
        let fileName = '';
        let fileSize = 0;
        let fileData = null;
        let fileType = '';
        
        if (file) {
            // Dosya bilgilerini al
            fileName = file.originalname;
            fileSize = file.size;
            fileType = file.mimetype;
            
            // Dosyayı base64'e çevir
            fileData = fs.readFileSync(file.path).toString('base64');
            
            // Geçici dosyayı sil
            fs.unlinkSync(file.path);
            
            console.log('Dosya bilgileri:', {
                name: fileName,
                size: fileSize,
                type: fileType,
                dataLength: fileData.length
            });
        }
        
        let query, params;
        
        if (isPg) {
            query = `
                INSERT INTO grades (title, lesson, type, "examDate", file_path, file_name, file_size, file_data, file_type, "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING id
            `;
            params = [title, lesson, type, examDate, filePath, fileName, fileSize, fileData, fileType, now, now];
        } else {
            query = `
                INSERT INTO grades (title, lesson, type, examDate, file_path, file_name, file_size, file_data, file_type, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `;
            params = [title, lesson, type, examDate, filePath, fileName, fileSize, fileData, fileType];
        }
        
        db.run(query, params, function(err) {
            if (err) {
                console.error('Sınav notu eklenirken hata:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Sınav notu eklenirken bir hata oluştu', 
                    error: err.message 
                });
            }
            
            console.log(`Yeni sınav notu eklendi - ID: ${this.lastID || 0}`);
            
            return res.json({ 
                success: true, 
                message: 'Sınav notu başarıyla eklendi',
                id: this.lastID || 0
            });
        });
    } catch (error) {
        console.error('Sınav notu ekleme hatası:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası', 
            error: error.message 
        });
    }
});

// 3. Sınav notu güncelleme
app.put('/api/grades/update/:id', upload.single('file'), (req, res) => {
    try {
    const gradeId = req.params.id;
        console.log('Sınav notu güncelleme isteği alındı:', gradeId);
        
        // Kullanıcı tipi kontrolü - sadece admin kullanıcılar güncelleyebilir
        const userType = req.body.userType;
        if (!userType || userType.toLowerCase() !== 'admin') {
            console.error('Yetkisiz kullanıcı sınav notu güncelleme girişimi:', userType);
        return res.status(403).json({ 
                success: false, 
                message: 'Bu işlem için yönetici yetkisi gereklidir' 
            });
        }
        
        // FormData ile gönderilen veriler
        const title = req.body.title;
        const lesson = req.body.lesson;
        const type = req.body.type;
        const examDate = req.body.examDate;
        const keepExistingFile = req.body.keepExistingFile === 'true';
        
        console.log('Güncelleme parametreleri:', { title, lesson, type, examDate, keepExistingFile });
        
        // Gerekli alanların kontrolü
        if (!gradeId || !title || !lesson || !type || !examDate) {
            console.error('Eksik bilgi ile sınav notu güncelleme girişimi');
            return res.status(400).json({ 
                success: false, 
                message: 'Tüm alanları doldurunuz' 
            });
        }
        
        // Dosya bilgisi
        const file = req.file;
        let filePath = null;
        let fileName = null;
        let fileSize = null;
        
        if (file) {
            filePath = file.path;
            // Dosya adı için filename kullan (kodlama düzeltilmiş hali)
            fileName = file.filename;
            fileSize = file.size;
            console.log('Yeni dosya yüklendi:', {
                path: filePath,
                name: fileName,
                originalName: file.originalname,
                size: fileSize
            });
        }
        
        const now = new Date().toISOString();
        let query, params;
        
        // Yeni dosya yüklendiyse veya mevcut dosya kaldırıldıysa dosya bilgilerini güncelle
        if (file || !keepExistingFile) {
            if (isPg) {
            query = `
                UPDATE grades 
                    SET title = $1, lesson = $2, type = $3, "examDate" = $4, "updatedAt" = $5, 
                        file_path = $6, file_name = $7, file_size = $8, file_data = $9, file_type = $10
                    WHERE id = $11
                    RETURNING id
                `;
                params = [title, lesson, type, examDate, now, filePath, fileName, fileSize, fileData, fileType, gradeId];
            } else {
                query = `
                    UPDATE grades 
                    SET title = ?, lesson = ?, type = ?, examDate = ?, updatedAt = CURRENT_TIMESTAMP,
                        file_path = ?, file_name = ?, file_size = ?, file_data = ?, file_type = ?
                WHERE id = ?
            `;
                params = [title, lesson, type, examDate, filePath, fileName, fileSize, fileData, fileType, gradeId];
            }
        } else {
            // Dosya değişmiyorsa sadece diğer bilgileri güncelle
            if (isPg) {
            query = `
                UPDATE grades 
                    SET title = $1, lesson = $2, type = $3, "examDate" = $4, "updatedAt" = $5, 
                        file_path = $6, file_name = $7, file_size = $8, file_data = $9, file_type = $10
                    WHERE id = $11
                    RETURNING id
                `;
                params = [title, lesson, type, examDate, now, gradeId, fileSize, fileData, fileType];
        } else {
            query = `
                UPDATE grades 
                    SET title = ?, lesson = ?, type = ?, examDate = ?, updatedAt = CURRENT_TIMESTAMP,
                    SET title = ?, lesson = ?, type = ?, examDate = ?, updatedAt = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
                params = [title, lesson, type, examDate, gradeId];
            }
        }
        
        db.run(query, params, function(err) {
            if (err) {
                console.error('Sınav notu güncellenirken hata:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Sınav notu güncellenirken bir hata oluştu',
                    error: err.message
                });
            }
            
            if (this.changes === 0) {
                console.log(`${gradeId} ID'li sınav notu bulunamadı`);
                return res.status(404).json({
                    success: false,
                    message: 'Sınav notu bulunamadı'
                });
            }
            
            console.log('Sınav notu güncellendi - ID:', gradeId);
            return res.json({
                success: true, 
                message: 'Sınav notu başarıyla güncellendi',
                id: gradeId
            });
        });
    } catch (error) {
        console.error('Sınav notu güncelleme hatası:', error);
        return res.status(500).json({
            success: false,
            message: 'Sınav notu güncellenirken bir hata oluştu',
            error: error.message
        });
    }
});

// 4. Sınav notu silme
app.delete('/api/grades/delete/:id', (req, res) => {
    try {
        const gradeId = req.params.id;
        console.log('Sınav notu silme isteği alındı:', gradeId);
        
        // Kullanıcı tipi kontrolü - sadece admin kullanıcılar silebilir
        const userType = req.query.userType; // DELETE isteklerinde body ile değil query ile gönderilir
        if (!userType || userType.toLowerCase() !== 'admin') {
            console.error('Yetkisiz kullanıcı sınav notu silme girişimi:', userType);
        return res.status(403).json({ 
                success: false, 
                message: 'Bu işlem için yönetici yetkisi gereklidir' 
            });
        }
        
        if (!gradeId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Silinecek sınav notu ID\'si gereklidir' 
            });
        }
        
        let query, params;
        
        if (isPg) {
            query = `DELETE FROM grades WHERE id = $1`;
            params = [gradeId];
        } else {
            query = `DELETE FROM grades WHERE id = ?`;
            params = [gradeId];
        }
        
        db.run(query, params, function(err) {
            if (err) {
                console.error('Sınav notu silinirken hata:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Sınav notu silinirken bir hata oluştu', 
                    error: err.message 
                });
            }
            
            if (this.changes === 0) {
                console.log(`${gradeId} ID'li sınav notu bulunamadı`);
                return res.status(404).json({ 
                    success: false, 
                    message: 'Silinecek sınav notu bulunamadı' 
                });
            }
            
            console.log('Sınav notu silindi - ID:', gradeId);
            return res.json({ 
                success: true, 
                message: 'Sınav notu başarıyla silindi', 
                id: gradeId 
            });
        });
    } catch (error) {
        console.error('Sınav notu silme hatası:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Sınav notu silinirken bir hata oluştu', 
            error: error.message 
        });
    }
});

// 5. Sınav notu dosyasını indir
app.get('/api/grades/download/:id', (req, res) => {
    try {
        const id = req.params.id;
        console.log('Sınav notu indirme isteği:', id);
        
        let query;
        if (isPg) {
            query = 'SELECT file_name, file_type, file_data FROM grades WHERE id = $1';
        } else {
            query = 'SELECT file_name, file_type, file_data FROM grades WHERE id = ?';
        }
        
        db.get(query, [id], (err, row) => {
            if (err) {
                console.error('Dosya bilgileri alınırken hata:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Dosya bilgileri alınırken bir hata oluştu',
                    error: err.message
                });
            }
            
            if (!row || !row.file_data) {
                console.error('Dosya bulunamadı:', id);
                return res.status(404).json({
                    success: false,
                    message: 'Dosya bulunamadı'
                });
            }
            
            try {
                // Base64'ten dosyayı çöz
                const fileBuffer = Buffer.from(row.file_data, 'base64');
                
                // Dosya bilgilerini ayarla
                res.setHeader('Content-Type', row.file_type);
                res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.file_name)}"`);
                res.setHeader('Content-Length', fileBuffer.length);
                
                // Dosyayı gönder
                res.send(fileBuffer);
                
                console.log('Dosya başarıyla gönderildi:', row.file_name);
            } catch (error) {
                console.error('Dosya gönderilirken hata:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Dosya gönderilirken bir hata oluştu',
                    error: error.message
                });
            }
        });
    } catch (error) {
        console.error('Dosya indirme hatası:', error);
        return res.status(500).json({
            success: false,
            message: 'Sunucu hatası',
            error: error.message
        });
    }
});

// 3. Kullanıcı detaylarını getirme endpoint'i
app.get('/api/users/:id', (req, res) => {
    try {
    const userId = req.params.id;
        console.log(`Kullanıcı bilgisi isteniyor - ID: ${userId}, Zaman: ${getTurkishTimeString()}`);
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Kullanıcı ID gereklidir' 
            });
        }
        
        let query, params;
        
        if (isPg) {
            query = `SELECT id, name, username, "usertype" as "userType", "lastlogin" as "lastLogin" FROM users WHERE id = $1`;
            params = [userId];
        } else {
            query = `SELECT id, name, username, userType, lastLogin FROM users WHERE id = ?`;
            params = [userId];
        }
        
        db.get(query, params, (err, user) => {
        if (err) {
                console.error('Kullanıcı bilgisi çekilirken hata:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Veritabanı hatası', 
                    error: err.message 
                });
            }
            
            if (!user) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Kullanıcı bulunamadı' 
                });
            }
            
            console.log(`Kullanıcı bilgisi bulundu: ${user.username}`);
            return res.json({ 
                    success: true, 
                user: user 
                });
            });
    } catch (error) {
        console.error('Kullanıcı bilgisi getirme hatası:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası', 
            error: error.message 
        });
    }
});

// 4. Kullanıcı güncelleme endpoint'i
app.put('/api/users/:id', (req, res) => {
    try {
    const userId = req.params.id;
        console.log(`Kullanıcı güncelleme isteği - ID: ${userId}, Zaman: ${getTurkishTimeString()}`);
        
    const { name, username, password, userType } = req.body;
        
        if (!userId || !name || !username || !userType) {
            return res.status(400).json({ 
                success: false, 
                message: 'Kullanıcı ID, isim, kullanıcı adı ve tipi gereklidir' 
            });
    }
    
    // Kullanıcı tipi kontrolü
    const allowedTypes = ['admin', 'teacher', 'student'];
    if (!allowedTypes.includes(userType)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Geçerli bir kullanıcı tipi seçin' 
            });
        }
        
        // Kullanıcının var olup olmadığını kontrol et
        let checkQuery, checkParams;
        
        if (isPg) {
            checkQuery = `SELECT * FROM users WHERE id = $1`;
            checkParams = [userId];
        } else {
            checkQuery = `SELECT * FROM users WHERE id = ?`;
            checkParams = [userId];
        }
        
        db.get(checkQuery, checkParams, (err, existingUser) => {
        if (err) {
            console.error('Kullanıcı kontrolü yapılırken hata:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Veritabanı hatası', 
                    error: err.message 
                });
            }
            
            if (!existingUser) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Kullanıcı bulunamadı' 
                });
            }
            
            // Kullanıcı adı değiştiyse, benzersiz olup olmadığını kontrol et
            if (username !== existingUser.username) {
                let uniqueQuery, uniqueParams;
                
                if (isPg) {
                    uniqueQuery = `SELECT * FROM users WHERE username = $1 AND id != $2`;
                    uniqueParams = [username, userId];
                } else {
                    uniqueQuery = `SELECT * FROM users WHERE username = ? AND id != ?`;
                    uniqueParams = [username, userId];
                }
                
                db.get(uniqueQuery, uniqueParams, (err, user) => {
            if (err) {
                console.error('Kullanıcı adı kontrolü yapılırken hata:', err.message);
                        return res.status(500).json({ 
                            success: false, 
                            message: 'Veritabanı hatası', 
                            error: err.message 
                        });
                    }
                    
                    if (user) {
                        return res.status(409).json({ 
                            success: false, 
                            message: 'Bu kullanıcı adı zaten kullanılıyor' 
                        });
                    }
                    
                    updateUser();
                });
            } else {
                updateUser();
            }
            
            // Kullanıcıyı güncelleme işlemi
            function updateUser() {
                let query, params;
                let passwordChanged = false;
                
                // Eğer şifre de değiştirilmek isteniyorsa
            if (password && password.trim() !== '') {
                    // Şifreyi kodla (encode) - login ve register ile aynı yöntemi kullan
                    const encodedPassword = Buffer.from(password).toString('base64');
                    console.log(`Şifre güncelleme kodlandı: Orijinal uzunluk = ${password.length}, Kodlanmış uzunluk = ${encodedPassword.length}`);
                    passwordChanged = true;
                    
                    if (isPg) {
                        query = `
                            UPDATE users 
                            SET name = $1, username = $2, password = $3, "usertype" = $4
                            WHERE id = $5
                        `;
                        params = [name, username, encodedPassword, userType, userId];
                    } else {
                        query = `
                            UPDATE users 
                            SET name = ?, username = ?, password = ?, userType = ?
                            WHERE id = ?
                        `;
                        params = [name, username, encodedPassword, userType, userId];
                    }
                } else {
                    // Şifre değiştirilmiyorsa
                    if (isPg) {
                        query = `
                            UPDATE users 
                            SET name = $1, username = $2, "usertype" = $3
                            WHERE id = $4
                        `;
                        params = [name, username, userType, userId];
                    } else {
                        query = `
                            UPDATE users 
                            SET name = ?, username = ?, userType = ?
                            WHERE id = ?
                        `;
                        params = [name, username, userType, userId];
                    }
                }
                
            db.run(query, params, function(err) {
                if (err) {
                    console.error('Kullanıcı güncellenirken hata:', err.message);
                        return res.status(500).json({ 
                            success: false, 
                            message: 'Veritabanı hatası', 
                            error: err.message 
                        });
                    }
                    
                    console.log(`Kullanıcı güncellendi - ID: ${userId}, Kullanıcı adı: ${username}`);
                    
                    // Eğer şifre değiştirildiyse, kullanıcının önceki oturumlarını geçersiz kıl
                    if (passwordChanged) {
                        // Geçersiz kılma zamanını kaydet
                        const revocationTime = new Date().getTime();
                        revokedUserTokens.set(userId.toString(), revocationTime);
                        console.log(`Kullanıcı ID: ${userId} için tüm önceki oturumlar geçersiz kılındı. Zaman: ${new Date(revocationTime).toISOString()}`);
                    }
                    return res.json({ 
                    success: true, 
                        message: 'Kullanıcı başarıyla güncellendi',
                        userId: userId
                });
            });
            }
        });
    } catch (error) {
        console.error('Kullanıcı güncelleme hatası:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası', 
            error: error.message 
        });
    }
});

// 5. Kullanıcı silme endpoint'i
app.delete('/api/users/:id', (req, res) => {
    try {
    const userId = req.params.id;
        console.log(`Kullanıcı silme isteği - ID: ${userId}, Zaman: ${getTurkishTimeString()}`);
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Kullanıcı ID gereklidir' 
            });
        }
        
        // Kullanıcının var olup olmadığını kontrol et
        let checkQuery, checkParams;
        
        if (isPg) {
            checkQuery = `SELECT * FROM users WHERE id = $1`;
            checkParams = [userId];
        } else {
            checkQuery = `SELECT * FROM users WHERE id = ?`;
            checkParams = [userId];
        }
        
        db.get(checkQuery, checkParams, (err, user) => {
                if (err) {
                console.error('Kullanıcı kontrolü yapılırken hata:', err.message);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Veritabanı hatası', 
                    error: err.message 
                });
            }
            
            if (!user) {
                return res.status(404).json({ 
                        success: false, 
                    message: 'Kullanıcı bulunamadı' 
                });
            }
            
            // Kullanıcıyı sil
            let query, params;
            
            if (isPg) {
                query = `DELETE FROM users WHERE id = $1`;
                params = [userId];
        } else {
                query = `DELETE FROM users WHERE id = ?`;
                params = [userId];
        }

            db.run(query, params, function(err) {
        if (err) {
            console.error('Kullanıcı silinirken hata:', err.message);
                    return res.status(500).json({ 
                        success: false, 
                        message: 'Veritabanı hatası', 
                        error: err.message 
                    });
                }
                
                console.log(`Kullanıcı silindi - ID: ${userId}`);
                return res.json({ 
            success: true, 
                    message: 'Kullanıcı başarıyla silindi',
                    userId: userId
                });
            });
        });
    } catch (error) {
        console.error('Kullanıcı silme hatası:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası', 
            error: error.message 
        });
    }
});

// Teslim tarihi geçmiş ödevleri otomatik olarak silen fonksiyon
function cleanupOverdueHomework() {
    console.log(`Süresi geçmiş ödevleri temizleme işlemi başlatıldı. Zaman: ${getTurkishTimeString()}`);
    console.log('Otomatik Temizleme - Veritabanı türü:', dbType, 'isPg değeri:', isPg);
    
    try {
        // Türkiye saati ile şu anki tarihi al
        const now = new Date();
        // Türkiye saati Offset'i: UTC+3 (saat olarak 3*60*60*1000 milisaniye)
        const turkishOffset = 3 * 60 * 60 * 1000;
        // Yerel saat ile UTC arasındaki fark
        const localOffset = now.getTimezoneOffset() * 60 * 1000;
        // Türkiye saati için düzeltilmiş tarih
        const turkishNow = new Date(now.getTime() + localOffset + turkishOffset);
        
        // Bugünün tarihini YYYY-MM-DD formatında alalım
        const today = turkishNow.toISOString().split('T')[0];
        
        console.log(`Otomatik Temizleme - Bugünün tarihi: ${today} - Şu anki TR zamanı: ${turkishNow.toISOString()}`);
        
        // PostgreSQL için işlemler
        if (isPg || dbType === 'postgresql') {
            console.log('PostgreSQL için otomatik temizleme işlemi başlatılıyor...');
            
            if (!pool) {
                console.error('HATA: PostgreSQL havuzu (pool) tanımlı değil!');
                return;
            }
            
            // PostgreSQL sorgusu - Double quote kullanılarak sütun adları belirtilir
            const checkQuery = `SELECT id, title, "dueDate" FROM homework WHERE "dueDate" < $1 AND "isCompleted" = false`;
            const checkParams = [today];
            
            console.log('PostgreSQL Sorgusu:', checkQuery);
            console.log('PostgreSQL Parametreleri:', checkParams);
            
            // Doğrudan pool.query kullanarak sorgu yap
            pool.query(checkQuery, checkParams)
                .then(result => {
                    const rows = result.rows || [];
                    console.log(`Otomatik - PostgreSQL: Silinecek ${rows.length} adet ödev bulundu:`, rows);
                    
                    if (rows.length > 0) {
                        const deleteQuery = `DELETE FROM homework WHERE "dueDate" < $1 AND "isCompleted" = false`;
                        const deleteParams = [today];
                        
                        pool.query(deleteQuery, deleteParams)
                            .then(deleteResult => {
                                const rowCount = deleteResult.rowCount || 0;
                                console.log(`Otomatik - PostgreSQL: Temizleme tamamlandı. ${rowCount} adet ödev silindi.`);
                            })
                            .catch(deleteErr => {
                                console.error('Otomatik - PostgreSQL silme hatası:', deleteErr);
                            });
                    } else {
                        console.log('Otomatik - PostgreSQL: Silinecek ödev bulunamadı');
                    }
                })
                .catch(err => {
                    console.error('Otomatik - PostgreSQL sorgu hatası:', err);
                });
        } 
        // SQLite için işlemler
        else {
            console.log('SQLite için otomatik temizleme işlemi başlatılıyor...');
            
            const checkQuery = 'SELECT id, title, dueDate FROM homework WHERE dueDate < ? AND isCompleted = 0';
            const checkParams = [today];
            
            console.log('SQLite Sorgusu:', checkQuery);
            console.log('SQLite Parametreleri:', checkParams);
            
            db.all(checkQuery, checkParams, (err, rows) => {
                if (err) {
                    console.error('Otomatik - SQLite: Silinecek ödevleri kontrol ederken hata:', err.message);
                    return;
                }
                
                console.log(`Otomatik - SQLite: Silinecek ${rows.length} adet ödev bulundu:`, rows);
                
                if (rows.length > 0) {
                    const deleteQuery = 'DELETE FROM homework WHERE dueDate < ? AND isCompleted = 0';
                    const deleteParams = [today];
                    
                    db.run(deleteQuery, deleteParams, function(err) {
                        if (err) {
                            console.error('Otomatik - SQLite: Süresi geçmiş ödevleri temizlerken hata:', err.message);
                            return;
                        }
                        
                        console.log(`Otomatik - SQLite: Temizleme tamamlandı. ${this.changes} adet ödev silindi.`);
                    });
                } else {
                    console.log('Otomatik - SQLite: Silinecek süresi geçmiş ödev bulunamadı');
                }
            });
        }
    } catch (error) {
        console.error('Otomatik - Süresi geçmiş ödevleri temizlerken beklenmeyen hata:', error);
    }
}

// Server başlangıcında ve her gün bir kere çalıştır
cleanupOverdueHomework();
// Her gün gece yarısından sonra çalıştır (00:01'de)
setInterval(() => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    
    // Gece 00:01'de temizleme işlemini yap
    if (hours === 0 && minutes === 1) {
        cleanupOverdueHomework();
    }
}, 60000); // Her dakika kontrol et

// Sunucuyu başlat
const server = app.listen(PORT, () => {
    console.log(`Server ${PORT} portunda başlatıldı: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM sinyali alındı, sunucu kapatılıyor...');
    server.close(() => {
        console.log('Sunucu kapatıldı.');
        process.exit(0);
    });
});

// 5. Süresi geçmiş ödevleri temizle
app.post('/api/homework/cleanup', (req, res) => {
    console.log('Süresi geçmiş ödevleri temizleme isteği alındı');
    console.log('API Cleanup - Veritabanı türü:', dbType, 'isPg değeri:', isPg);
    
    try {
        // Türkiye saati ile şu anki tarihi al
        const now = new Date();
        // Türkiye saati Offset'i: UTC+3 (saat olarak 3*60*60*1000 milisaniye)
        const turkishOffset = 3 * 60 * 60 * 1000;
        // Yerel saat ile UTC arasındaki fark
        const localOffset = now.getTimezoneOffset() * 60 * 1000;
        // Türkiye saati için düzeltilmiş tarih
        const turkishNow = new Date(now.getTime() + localOffset + turkishOffset);
        
        // Bugünün tarihini YYYY-MM-DD formatında alalım
        const today = turkishNow.toISOString().split('T')[0];
        
        console.log(`API - Bugünün tarihi: ${today} - Şu anki TR zamanı: ${turkishNow.toISOString()}`);

        // PostgreSQL için işlemler
        if (isPg || dbType === 'postgresql') {
            console.log('PostgreSQL için temizleme işlemi başlatılıyor...');
            
            if (!pool) {
                console.error('HATA: PostgreSQL havuzu (pool) tanımlı değil!');
                return res.status(500).json({
                    success: false,
                    message: 'Veritabanı bağlantı havuzu oluşturulmamış',
                    error: 'PostgreSQL bağlantı hatası'
                });
            }
            
            // PostgreSQL sorgusu - Double quote kullanılarak sütun adları belirtilir
            const checkQuery = `SELECT id, title, "dueDate" FROM homework WHERE "dueDate" < $1 AND "isCompleted" = false`;
            const checkParams = [today];
            
            console.log('PostgreSQL Sorgusu:', checkQuery);
            console.log('PostgreSQL Parametreleri:', checkParams);
            
            // Doğrudan pool.query kullanarak sorgu yap
            pool.query(checkQuery, checkParams)
                .then(result => {
                    const rows = result.rows || [];
                    console.log(`API - PostgreSQL: Silinecek ${rows.length} adet ödev bulundu:`, rows);
                    
                    if (rows.length > 0) {
                        const deleteQuery = `DELETE FROM homework WHERE "dueDate" < $1 AND "isCompleted" = false`;
                        const deleteParams = [today];
                        
                        pool.query(deleteQuery, deleteParams)
                            .then(deleteResult => {
                                const rowCount = deleteResult.rowCount || 0;
                                console.log(`API - PostgreSQL: Temizleme tamamlandı. ${rowCount} adet ödev silindi.`);
                                return res.json({ 
                                    success: true, 
                                    message: `${rowCount} adet süresi geçmiş ödev silindi`
                                });
                            })
                            .catch(deleteErr => {
                                console.error('API - PostgreSQL silme hatası:', deleteErr);
                                return res.status(500).json({ 
                                    success: false, 
                                    message: 'Ödevler silinirken PostgreSQL hatası oluştu',
                                    error: deleteErr.message
                                });
                            });
                    } else {
                        console.log('API - PostgreSQL: Silinecek ödev bulunamadı');
                        return res.json({
                            success: true,
                            message: 'Silinecek süresi geçmiş ödev bulunamadı'
                        });
                    }
                })
                .catch(err => {
                    console.error('API - PostgreSQL sorgu hatası:', err);
                    return res.status(500).json({ 
                        success: false, 
                        message: 'PostgreSQL sorgu hatası oluştu',
                        error: err.message
                    });
                });
        } 
        // SQLite için işlemler
        else {
            console.log('SQLite için temizleme işlemi başlatılıyor...');
            
            const checkQuery = 'SELECT id, title, dueDate FROM homework WHERE dueDate < ? AND isCompleted = 0';
            const checkParams = [today];
            
            console.log('SQLite Sorgusu:', checkQuery);
            console.log('SQLite Parametreleri:', checkParams);
            
            db.all(checkQuery, checkParams, (err, rows) => {
                if (err) {
                    console.error('API - SQLite: Silinecek ödevleri kontrol ederken hata:', err.message);
                    return res.status(500).json({ 
                        success: false, 
                        message: 'Ödevler kontrol edilirken bir hata oluştu',
                        error: err.message
                    });
                }
                
                console.log(`API - SQLite: Silinecek ${rows.length} adet ödev bulundu:`, rows);
                
                if (rows.length > 0) {
                    const deleteQuery = 'DELETE FROM homework WHERE dueDate < ? AND isCompleted = 0';
                    const deleteParams = [today];
                    
                    db.run(deleteQuery, deleteParams, function(err) {
                        if (err) {
                            console.error('API - SQLite: Süresi geçmiş ödevleri temizlerken hata:', err.message);
                            return res.status(500).json({ 
                                success: false, 
                                message: 'Ödevler temizlenirken bir hata oluştu',
                                error: err.message
                            });
                        }
                        
                        console.log(`API - SQLite: Temizleme tamamlandı. ${this.changes} adet ödev silindi.`);
                        
                        return res.json({ 
                            success: true, 
                            message: `${this.changes} adet süresi geçmiş ödev silindi`
                        });
                    });
                } else {
                    console.log('API - SQLite: Silinecek süresi geçmiş ödev bulunamadı');
                    return res.json({
                        success: true,
                        message: 'Silinecek süresi geçmiş ödev bulunamadı'
                    });
                }
            });
        }
    } catch (error) {
        console.error('API - Süresi geçmiş ödevleri temizlerken beklenmeyen hata:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'İşlem sırasında bir hata oluştu',
            error: error.message
        });
    }
}); 