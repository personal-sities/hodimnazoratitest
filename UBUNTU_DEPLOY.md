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

## 3. Domen ulash (`workmeter.uz`) va Bepul SSL (HTTPS) o'rnatish

Saytda **kamera (Face-ID yuzni tanish)** va **PWA (ilovadek o'rnatish)** to'liq ishlashi uchun brauzerlar **HTTPS (SSL)** sertifikatini talab qiladi.

### 1-qadam: DNS sozlamalari (Domen boshqaruv panelida)
Domen sotib olgan joyingizda (masalan, Eskiz.uz, Reg.uz, GoDaddy, Cloudflare yoki Webname):
**DNS Records** bo'limiga kiring va 2 ta **A Record** qo'shing:
- **Type**: `A` | **Name/Host**: `@` | **Value/Points to**: `SERVER_IP` (serveringizning ommaviy IP manzili)
- **Type**: `A` | **Name/Host**: `www` | **Value/Points to**: `SERVER_IP`

*(DNS yangilanishi odatda 5-15 daqiqa vaqt oladi).*

---

### 2-qadam: Nginx va Certbot o'rnatish
Server terminalida quyidagilarni bajaring:
```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

### 3-qadam: Nginx konfiguratsiyasini o'rnatish
Loyiha papkasidagi tayyor `nginx-workmeter.uz.conf` faylidan foydalanishingiz yoki yangi fayl ochishingiz mumkin:
```bash
sudo nano /etc/nginx/sites-available/workmeter.uz
```
Ushbu konfiguratsiyani nusxalab qo'ying:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name workmeter.uz www.workmeter.uz;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```
Saqlash: `Ctrl + O` -> `Enter`, chiqish: `Ctrl + X`.

---

### 4-qadam: Konfiguratsiyani faollashtirish
```bash
# Saytni faollashtirish
sudo ln -s /etc/nginx/sites-available/workmeter.uz /etc/nginx/sites-enabled/

# Standart default saytni o'chirish (agar mavjud bo'lsa)
sudo rm -f /etc/nginx/sites-enabled/default

# Nginx sintaksisini tekshirish
sudo nginx -t

# Nginx'ni qayta yuklash
sudo systemctl reload nginx
```

---

### 5-qadam: Xavfsizlik devori (Firewall / UFW)ni sozlash
```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

---

### 6-qadam: Bepul SSL (HTTPS) sertifikatini olish (Let's Encrypt)
```bash
sudo certbot --nginx -d workmeter.uz -d www.workmeter.uz
```
- Sizdan e-pochta so'raydi (xabarnomalar uchun kiriting).
- Shartlarga `Y` (ha) deb javob bering.
- Certbot avtomatik ravishda SSL sertifikatini ulab, barcha HTTP so'rovlarni HTTPS ga yo'naltiradi.

SSL sertifikati avtomatik yangilanishini tekshirish:
```bash
sudo certbot renew --dry-run
```

Endi saytingiz to'liq **https://workmeter.uz** manzili orqali xavfsiz ishlaydi!

---

## 4. Ma'lumotlar Tozalash Siyosati (Data Retention)

Talab bo'yicha: **Har 2 oyda 3 oydan eski ma'lumotlar o'chib boradi**.

- **Qachon tozalash bajariladi?**
  Server avtomatik tarzda har 2 oyda bir marta (va server yangi yoqilganda 2 oydan oshgan bo'lsa) tozalash vazifasini bajaradi.
- **Nimalar o'chiriladi?**
  1. `attendance` (3 oydan eski davomat/ish soatlari)
  2. `notifications` (3 oydan eski bildirishnomalar)
  3. `feedback` (3 oydan eski fikr-mulohazalar)
  4. `employee_leaves` (3 oydan eski ta'tillar)
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

## 5. Google Sheets integratsiyasi

- Google Sheet'ga har qanday ma'lumot jo'natilishi to'liq to'xtatilgan.
- `.env` da `ENABLE_GOOGLE_SHEETS=false` qo'yilgan.
- Barcha ma'lumotlar 100% serverning o'zidagi ma'lumotlar bazasida saqlanadi.
- Admin hisobotni faqat o'zi xohlagan paytda mahalliy kompyuteriga Excel (.xlsx) yoki PDF sifatida yuklab olishi mumkin.

---

## 6. Foydali Buyruqlar

```bash
# Server holatini tekshirish
curl http://localhost:3000/api/health

# Nginx holatini tekshirish va qayta ishga tushirish
sudo nginx -t
sudo systemctl status nginx
sudo systemctl reload nginx

# PM2 loglarini ko'rish
pm2 logs aloqapro

# Serverni qayta ishga tushirish
pm2 restart aloqapro
```



