const { app, BrowserWindow, Menu, Tray, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let tray = null;
let isQuitting = false;

// 1. Standart konfiguratsiyani o'qish (desktop-config.json)
function loadConfig() {
  const defaultConfig = {
    serverUrl: 'http://localhost:3000',
    loadDirectUrl: false,
    openAtLogin: true,
    minimizeToTray: true,
    window: {
      width: 1280,
      height: 820,
      minWidth: 1024,
      minHeight: 680
    }
  };

  try {
    const configPath = path.join(__dirname, 'desktop-config.json');
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ...defaultConfig, ...data, window: { ...defaultConfig.window, ...(data.window || {}) } };
    }
  } catch (err) {
    console.warn('[desktop-config.json o\'qishda ogohlantirish]:', err.message);
  }
  return defaultConfig;
}

const config = loadConfig();

// 2. Yagona nusxa (Single instance lock) - xodim bir vaqtning o'zida bir nechta dastur ochib yubormasligi uchun
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
    }
  });
}

function showWindow() {
  if (!win) {
    createWindow();
  } else {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  }
}

function createWindow() {
  const iconPath = fs.existsSync(path.join(__dirname, 'images', 'logo2.png'))
    ? path.join(__dirname, 'images', 'logo2.png')
    : path.join(__dirname, 'favicon.ico');

  win = new BrowserWindow({
    width: config.window.width || 1280,
    height: config.window.height || 820,
    minWidth: config.window.minWidth || 1024,
    minHeight: config.window.minHeight || 680,
    title: 'AloqaPro - Xodimlar nazorati',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      webSecurity: false // CORS muammolarisiz tashqi server API'lariga so'rov yuborish imkoni
    }
  });

  win.setMenuBarVisibility(false);

  // 3. Web-kamera va mikrofon ruxsatlarini avtomatik berish (Yuz nazorati / Face-detection uchun)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'camera', 'microphone', 'notifications', 'fullscreen'];
    if (allowed.includes(permission)) {
      return callback(true);
    }
    callback(true);
  });

  // 4. Sahifani yuklash
  if (config.loadDirectUrl && config.serverUrl && (config.serverUrl.startsWith('http://') || config.serverUrl.startsWith('https://'))) {
    console.log(`[Desktop App]: Masofaviy serverdan yuklanmoqda: ${config.serverUrl}`);
    win.loadURL(config.serverUrl).catch(err => {
      console.warn('[loadURL xatosi]:', err.message);
      // Agar serverga ulanib bo'lmasa, lokal index.html ga o'tish
      loadLocalApp();
    });
  } else {
    loadLocalApp();
  }

  function loadLocalApp() {
    win.loadFile('index.html');
    win.webContents.on('did-finish-load', () => {
      if (config.serverUrl) {
        win.webContents.executeJavaScript(`
          window.ALOQA_SERVER_URL = ${JSON.stringify(config.serverUrl)};
          try { localStorage.setItem('aloqa_server_url', ${JSON.stringify(config.serverUrl)}); } catch(_) {}
        `).catch(() => {});
      }
    });
  }

  // Tarmoq xatosi bo'lganda ogohlantirish
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    if (errorCode === -102 || errorCode === -105 || errorCode === -106) {
      console.warn(`[Tarmoqqa ulanish xatosi]: ${errorDescription}`);
    }
  });

  // Oynani yopish bosilganda (Tray sozlamasiga qarab yashirish)
  win.on('close', event => {
    if (isQuitting || !config.minimizeToTray) return;
    event.preventDefault();
    win.hide();
  });

  win.on('closed', () => {
    win = null;
  });
}

// 5. System Tray (Soat oldidagi panelda ikonka va boshqaruv)
function createTray() {
  if (tray) return;

  const iconPath = fs.existsSync(path.join(__dirname, 'images', 'logo2.png'))
    ? path.join(__dirname, 'images', 'logo2.png')
    : path.join(__dirname, 'favicon.ico');
  if (!fs.existsSync(iconPath)) return;

  tray = new Tray(iconPath);
  tray.setToolTip('AloqaPro - Xodimlar nazorati');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Dasturni ochish',
      click: showWindow
    },
    { type: 'separator' },
    {
      label: 'Dasturdan butunlay chiqish',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', showWindow);
  tray.on('click', showWindow);
}

// 6. Windows yoqilganda avtomatik ishga tushish (Auto-start)
function setupAutoLaunch() {
  try {
    if (config.openAtLogin) {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath
      });
    }
  } catch (e) {
    console.warn('[Auto-start sozlashda ogohlantirish]:', e.message);
  }
}

app.whenReady().then(() => {
  createWindow();
  if (config.minimizeToTray) {
    createTray();
  }
  setupAutoLaunch();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    showWindow();
  }
});
