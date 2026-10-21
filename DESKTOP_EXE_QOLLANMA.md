# AloqaPro — Windows Desktop (.EXE) Ilovasini Yig'ish Bo'yicha Qo'llanma

Ushbu qo'llanma orqali loyihani Windows kompyuterlariga o'rnatiladigan to'liq **`.exe` (Setup va Portable)** ilova qilib yig'ishingiz mumkin.

---

## 1. Server manzilini sozlash

Loyiha ichidagi [`desktop-config.json`](./desktop-config.json) faylini oching va serveringiz manzilini kiriting:

```json
{
  "serverUrl": "https://sizning-server-manzilingiz.uz",
  "loadDirectUrl": false,
  "openAtLogin": true,
  "minimizeToTray": true,
  "window": {
    "width": 1280,
    "height": 820,
    "minWidth": 1024,
    "minHeight": 680
  }
}
```

- **`serverUrl`**: Serveringiz internetdagi domeni yoki IP manzili (masalan: `https://aloqapro.uz` yoki `http://192.168.1.50:3000`). Barcha davomat, PBX, xodimlar API so'rovlari ushbu manzilga yuboriladi.
- **`loadDirectUrl`**:
  - `false` (tavsiya etiladi): Dastur kompyuterda lokal fayllar bilan bir zumda tez ochiladi va faqat ma'lumotlarni internetdan oladi.
  - `true`: Dastur to'g'ridan-to'g'ri sayt sahifasini brauzerdagidek yuklaydi.
- **`openAtLogin`**: `true` bo'lsa, Windows yoqilganda xodim kompyuterida dastur avtomatik o'zi ishga tushadi.
- **`minimizeToTray`**: `true` bo'lsa, xodim oynani yopsa ham, dastur soat oldidagi panelda (System Tray) orqa fonda ishlab turadi.

---

## 2. Terminalda bajariladigan buyruqlar

Loyihaning asosiy papkasida terminalni (PowerShell, Command Prompt yoki Git Bash) oching:

### A) Paketlarni o'rnatish (Faqat birinchi marta):
```bash
npm install
```
*(Bu buyruq Electron va electron-builder kutubxonalarini o'rnatadi)*

---

### B) Dasturni `.exe` qilmasdan avval sinab ko'rish:
```bash
npm run electron:start
```
*(Bu buyruq dasturni desktop oynada ochib beradi, kamerasini, keshini va dizaynini tekshirib olishingiz mumkin)*

---

### C) Tayyor Windows `.EXE` faylini yig'ish (Build):
```bash
npm run electron:build
```

Yoki faqat Portable (o'rnatmasdan to'g'ridan-to'g'ri ochiladigan) `.exe` kerak bo'lsa:
```bash
npm run electron:build:portable
```

---

## 3. Tayyor `.exe` fayllari qayerda bo'ladi?

Yig'ish (build) tugagach, loyiha ichida yangi **`dist/`** papkasi paydo bo'ladi. Uning ichida:

1. **`AloqaPro Setup 2.0.0.exe`** — O'rnatgich (Installer). Uni xodimlar kompyuteriga o'rnatasiz. Ish stoli (Desktop) va Pusk menyusiga dastur yorlig'ini chiqaradi.
2. **`AloqaPro 2.0.0.exe`** — Portable talqin (o'rnatmasdan to'g'ridan-to'g'ri fleshka yoki papkadan ochiladi).

---

## 4. Xususiyatlari
- **Face Detection (Kamera nazorati)**: Web-kamera ruxsatlari avtomatik beriladi, brauzerdagidek ruxsat so'rab qotib qolmaydi.
- **Yagona nusxa (Single-Instance)**: Xodim dastur belgisini necha marta bossa ham, yangi nusxa ochilmaydi, mavjud oyna oldinga chiqadi.
- **System Tray**: Soat yonida AloqaPro logotipi turadi, ikki marta bosganda oyna ochiladi yoki sichqonchaning o'ng tugmasi orqali menyu chiqadi.
