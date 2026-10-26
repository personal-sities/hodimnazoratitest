#!/bin/bash
# ============================================================
#  workmeter.uz - To'liq avtomatik Domen va SSL sozlash skripti
# ============================================================

set -e

echo ""
echo "============================================================"
echo "  workmeter.uz Domen va SSL avtomatik o'rnatish boshlandi..."
echo "============================================================"
echo ""

# 1. Root huquqini tekshirish
if [ "$EUID" -ne 0 ]; then
  echo "XATO: Iltimos, skriptni root huquqi bilan ishga tushiring:"
  echo "      sudo bash setup-workmeter.sh"
  exit 1
fi

DOMAIN="workmeter.uz"

echo "[1/6] Paketlar ro'yxatini yangilash va Nginx hamda Certbot o'rnatish..."
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx ufw

echo "[2/6] Nginx konfiguratsiya faylini yaratish (/etc/nginx/sites-available/$DOMAIN)..."
cat > "/etc/nginx/sites-available/$DOMAIN" << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name workmeter.uz www.workmeter.uz;

    # Face-ID va fayllar uchun chegara (50MB)
    client_max_body_size 50M;

    # Xavfsizlik sarlavhalari
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Node.js ilovasiga yo'naltirish
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
EOF

echo "[3/6] Konfiguratsiyani faollashtirish..."
ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default

echo "[4/6] Nginx sozlamalarini tekshirish va qayta yuklash..."
nginx -t
systemctl enable nginx
systemctl reload nginx

echo "[5/6] Firewall (UFW) portlarini ochish..."
ufw allow 'Nginx Full' >/dev/null 2>&1 || true
ufw allow OpenSSH >/dev/null 2>&1 || true

echo "[6/6] Bepul Let's Encrypt SSL (HTTPS) sertifikatini olish..."
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || {
    echo ""
    echo "[!] OGOHLANTIRISH: SSL sertifikatini olishda xatolik yuz berdi."
    echo "    Buning sababi: Domen DNS (A-record) hali server IP siga to'liq ulanmagan bo'lishi mumkin."
    echo "    Domen paneli (Eskiz / Reg.uz)da A record to'g'rilangach, ushbu buyruqni qayta tering:"
    echo "    sudo certbot --nginx -d workmeter.uz -d www.workmeter.uz"
}

systemctl reload nginx

echo ""
echo "============================================================"
echo "  TABRIKLAYMIZ! O'rnatish yakunlandi."
echo "  Saytingiz manzili: https://$DOMAIN"
echo "============================================================"
echo ""
