FROM node:20-alpine

WORKDIR /app

# Dependency fayllarni ko'chirish
COPY package.json ./

# Faqat ishlab chiqarish (production) kutubxonalarini o'rnatish
RUN npm install --production --no-audit --no-fund

# Barcha loyiha fayllarini ko'chirish
COPY . .

# Port
EXPOSE 3000

# Serverni ishga tushirish
CMD ["node", "server.js"]
