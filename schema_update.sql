-- Render.com veritabanı şema güncellemesi
-- eventDate sütununun mevcut olup olmadığını kontrol et
DO $$
BEGIN
    -- eventDate sütunu yoksa ekle
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'announcements' 
        AND column_name = 'eventdate'
    ) THEN
        ALTER TABLE announcements ADD COLUMN "eventDate" TEXT;
        RAISE NOTICE 'eventDate sütunu eklendi';
    ELSE
        RAISE NOTICE 'eventDate sütunu zaten mevcut';
    END IF;
END $$;
