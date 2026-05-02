const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  desktopCapturer,
  nativeImage,
} = require("electron");
const path = require("path");

let mainWindow = null;
let tray = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile("index.html");
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
});

app.on("window-all-closed", (e) => {
  e.preventDefault();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle("get-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 0, height: 0 },
  });
  return sources.map((s) => ({ id: s.id, name: s.name }));
});

ipcMain.on("show-window", () => {
  if (mainWindow) mainWindow.show();
});

ipcMain.on("hide-window", () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on("set-window-size", (_e, { width, height }) => {
  if (mainWindow && width > 0 && height > 0) {
    mainWindow.setSize(Math.round(width), Math.round(height));
  }
});
