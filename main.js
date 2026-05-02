const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  desktopCapturer,
  nativeImage,
  session,
} = require("electron");

let mainWindow = null;
let tray = null;
let isQuitting = false;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile("index.html");

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  if (process.platform === "darwin") {
    tray.setTitle("P");
  }

  const menu = Menu.buildFromTemplate([
    { label: "Pass", enabled: false },
    { type: "separator" },
    { label: "v" + app.getVersion(), enabled: false },
    { type: "separator" },
    { label: "Send Window", click: () => triggerSend() },
    {
      label: "Toggle DevTools",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.toggleDevTools({ mode: "detach" });
        }
      },
    },
    { label: "Exit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function triggerSend() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("hotkey-send");
  }
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.dock.hide();
  }

  createMainWindow();
  createTray();

  globalShortcut.register("CommandOrControl+Alt+P", triggerSend);

  Menu.setApplicationMenu(
    process.platform === "darwin" ? Menu.getApplicationMenu() : null,
  );

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ["window"] });
        const usable = sources.filter((s) => s.name && s.name.trim());
        callback(usable[0] ? { video: usable[0] } : {});
      } catch (_) {
        callback({});
      }
    },
    { useSystemPicker: true },
  );
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", (e) => {
  e.preventDefault();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

ipcMain.on("show-window", (_e, opts = {}) => {
  if (!mainWindow) return;
  if (opts.center) mainWindow.center();
  if (opts.alwaysOnTop !== undefined) {
    mainWindow.setAlwaysOnTop(!!opts.alwaysOnTop);
  }
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }
});

ipcMain.on("hide-window", () => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.hide();
  }
});

ipcMain.on("set-window-size", (_e, { width, height }) => {
  if (mainWindow && width > 0 && height > 0) {
    mainWindow.setSize(Math.round(width), Math.round(height));
  }
});
