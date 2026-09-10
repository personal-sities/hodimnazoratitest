# AloqaPro: Ubuntu Serverda Mustaqil O'rnatish va Ishlatish Qo'llanmasi

Ushbu qo'llanma loyihani **GitHub'ga bog'lanmasdan**, to'g'ridan-to'g'ri **Ubuntu serverda** o'rnatish va ishga tushirish uchun tayyorlangan. Barcha ma'lumotlar serverning o'zida saqlanadi.

---

## 1. Loyihani Serverga Ko'chirish (GitHub'siz)

GitHub kerak emas. Loyiha papkasini serveringizga quyidagi usullardan biri orqali tashlashingiz mumkin:

### A) `scp` yoki `rsync` orqali (Terminal orqali)
```bash
# Windows terminalida (loyiha papkasida):
scp -r * root@SERVER_IP:/var/www/aloqapro/
```

### B) Zip arxiv qilib ko'chirish
1. Kompyuteringizda ushbu loyiha papkasini zip qilib arxivlang (`aloqapro.zip`).
2. Serverga yuklang va oching:
```bash
sudo mkdir -p /var/www/aloqapro
sudo unzip aloqapro.zip -d /var/www/aloqapro
cd /var/www/aloqapro
```

### C) WinSCP yoki FileZilla dasturi orqali
Grafik interfeys orqali fayllarni to'g'ridan-to'g'ri `/var/www/aloqapro` papkasiga ko'chiring.

---

## 2. Serverda Ishga Tushirish: 2 xil usul

### 1-USUL: Docker orqali (Tavsiya etiladi - 1 daqiqada tayyor)
Serverda Docker va Docker Compose o'rnatilgan bo'lsa:

1. Papkaga kiring:
```bash
cd /var/www/aloqapro
```

2. `.env` faylini tekshiring yoki o'zingizga moslang:
```bash
cp .env.example .env
nano .env
```

3. Birgina buyruq bilan PostgreSQL va ilovani ishga tushiring:
```bash
docker compose up -d --build
```

Bo'ldi!
- PostgreSQL avtomatik `schema.sql` orqali jadvallarni yaratadi.
- Ilova `http://SERVER_IP:3000` manzilida ishlaydi.
- Ma'lumotlar serverdagi `./data/postgres` papkasida doimiy saqlanadi.

---

### 2-USUL: Ubuntu Native (Node.js + PostgreSQL + PM2)

#### 1. Kerakli paketlarni o'rnatish
```bash
sudo apt update
sudo apt install -y nodejs npm postgresql postgresql-contrib
```

#### 2. PostgreSQL bazasini yaratish
```bash
sudo -u postgres psql
```
PostgreSQL terminalida:
```sql
CREATE DATABASE aloqapro;
CREATE USER aloqa_user WITH ENCRYPTED PASSWORD 'aloqa_password';
GRANT ALL PRIVILEGES ON DATABASE aloqapro TO aloqa_user;
\q
```

#### 3. Sxemani yuklash
```bash
sudo -u postgres psql -d aloqapro -f /var/www/aloqapro/schema.sql
```

#### 4. Dependency'larni o'rnatish va sozlash
```bash
cd /var/www/aloqapro
npm install --production

# .env faylini sozlang
nano .env
```
`.env` ichida `DATABASE_URL`:
```ini
DATABASE_URL=postgres://aloqa_user:aloqa_password@localhost:5432/aloqapro
```

#### 5. PM2 orqali fonga ishga tushirish
```bash
sudo npm install -g pm2
pm2 start server.js --name "aloqapro"
pm2 save
pm2 startup
```

---

## 3. Ma'lumotlar Tozalash Siyosati (Data Retention)

Talab bo'yicha: **Har 2 oyda 3 oydan eski ma'lumotlar o'chib boradi**.

- **Qachon tozalash bajariladi?**
  Server avtomatik tarzda har 2 oyda bir marta (va server yangi yoqilganda 2 oydan oshgan bo'lsa) tozalash vazifasini bajaradi.
- **Nimalar o'chiriladi?**
  1. `attendance` (3 oydan eski davomat/ish soatlari)
  2. `notifications` (3 oydan eski bildirishnomalar)
  3. `feedback` (3 oydan eski fikr-mulohazalar)
  4. `employee_leaves` (3 oydan eski ta'tillar)
  5. `calls` (3 oydan eski OnlinePBX qo'ng'iroqlari)
- **Nimalar aslo o'chirilmaydi?**
  `employees` (xodimlar hisoblari), `admins` (adminlar), `face_profiles` (yuz qoliplari), `settings` (sozlamalar) doimiy saqlanadi.

### Qo'lda tozalashni chaqirish:
Istalgan payt terminaldan qo'lda tozalash uchun:
```bash
npm run cleanup
```
Yoki API orqali:
```bash
curl -X POST http://localhost:3000/api/admin/cleanup \
  -H "x-admin-key: aloqa_cleanup_secret_key_2026"
```

---

## 4. Google Sheets integratsiyasi

- Google Sheet'ga har qanday ma'lumot jo'natilishi to'liq to'xtatilgan.
- `.env` da `ENABLE_GOOGLE_SHEETS=false` qo'yilgan.
- Barcha ma'lumotlar 100% serverning o'zidagi ma'lumotlar bazasida saqlanadi.
- Admin hisobotni faqat o'zi xohlagan paytda mahalliy kompyuteriga Excel (.xlsx) yoki PDF sifatida yuklab olishi mumkin.

---

## 5. OnlinePBX va amoCRM holati

- Agar kerak bo'lmasa, `.env` ichida `ENABLE_AMOCRM=false` va `ENABLE_ONLINEPBX=false` turadi.
- Bu holatda tizim xatolik chiqarmaydi va xodimlarning ish yakunlashi (`empEnd`) to'xtab qolmaydi.
- Yoqish kerak bo'lsa, tegishli tokenlarni `.env` ga kiritib `true` qilasiz.

---

## 6. Foydali Buyruqlar

```bash
# Server holatini tekshirish
curl http://localhost:3000/api/health

# PM2 loglarini ko'rish
pm2 logs aloqapro

# Serverni qayta ishga tushirish
pm2 restart aloqapro
```

---

## 7. Supabasedagi Ma'lumotlarni Serverga O'tkazish (Migratsiya)

Supabasedagi barcha xodimlar, davomat, yuz qoliplari va boshqa ma'lumotlarni yangi serverga ko'chirish uchun 2 ta qulay usul tayyorlangan:

### A) Avtomatik Skript orqali (Tavsiya etiladi)
1. `.env` faylida `SUPABASE_SERVICE_ROLE_KEY` ni ko'rsating (Supabase Dashboard -> Project Settings -> API -> `service_role` secret kaliti).
2. Serverda quyidagi buyruqni bering:
```bash
npm run migrate
```
Ushbu skript Supabasedagi barcha jadvallarni (`employees`, `admins`, `attendance`, `face_profiles`, `settings`, `feedback`, `notifications`, `lunch_plans`, `employee_leaves`, `kpi_bonuses`) avtomatik o'qib, yangi serverdagi PostgreSQL bazasiga to'liq ko'chiradi.

### B) `pg_dump` orqali (To'liq baza kloni)
Agar Supabase PostgreSQL parolini bilsangiz:
```bash
# 1. Supabasedan faylga olish:
pg_dump "postgres://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres" > backup.sql

# 2. Serverdagi PostgreSQL bazasiga yuklash:
sudo -u postgres psql -d aloqapro < backup.sql
```

