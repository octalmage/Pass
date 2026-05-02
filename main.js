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
const { execFile, execFileSync } = require("child_process");

let mainWindow = null;
let tray = null;
let isQuitting = false;
let hideSourceEnabled = true;
let activeHiddenState = null;

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
      label: "Hide window while sharing",
      type: "checkbox",
      checked: hideSourceEnabled,
      click: (item) => {
        hideSourceEnabled = item.checked;
      },
    },
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

/* ---------------- Source-window hide/restore (macOS) ---------------- */

function runOsa(script) {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

function escapeAS(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function captureFrontmostWindow() {
  const script = `
    tell application "System Events"
      set frontProc to first application process whose frontmost is true
      tell frontProc
        if (count of windows) = 0 then return ""
        set winName to name of front window
        set winPos to position of front window
        return (name of frontProc) & "\\t" & winName & "\\t" & (item 1 of winPos) & "\\t" & (item 2 of winPos)
      end tell
    end tell
  `;
  try {
    const out = await runOsa(script);
    if (!out) return null;
    const [appName, title, x, y] = out.split("\t");
    return { app: appName, title, x: parseInt(x, 10), y: parseInt(y, 10) };
  } catch (err) {
    console.error("[Pass] captureFrontmostWindow failed:", err.message);
    return null;
  }
}

async function moveWindowOffscreen(state) {
  const script = `
    tell application "System Events"
      tell application process "${escapeAS(state.app)}"
        try
          set position of (first window whose name is "${escapeAS(state.title)}") to {-99999, -99999}
        end try
      end tell
    end tell
  `;
  try {
    await runOsa(script);
    return true;
  } catch (err) {
    console.error("[Pass] moveWindowOffscreen failed:", err.message);
    return false;
  }
}

function restoreWindowSync(state) {
  const script = `
    tell application "System Events"
      tell application process "${escapeAS(state.app)}"
        try
          set position of (first window whose name is "${escapeAS(state.title)}") to {${state.x}, ${state.y}}
        end try
      end tell
    end tell
  `;
  try {
    execFileSync("osascript", ["-e", script], { timeout: 2000 });
  } catch (err) {
    console.error("[Pass] restoreWindowSync failed:", err.message);
  }
}

async function restoreWindow(state) {
  const script = `
    tell application "System Events"
      tell application process "${escapeAS(state.app)}"
        try
          set position of (first window whose name is "${escapeAS(state.title)}") to {${state.x}, ${state.y}}
        end try
      end tell
    end tell
  `;
  try {
    await runOsa(script);
  } catch (err) {
    console.error("[Pass] restoreWindow failed:", err.message);
  }
}

ipcMain.handle("capture-source-window", async () => {
  if (!hideSourceEnabled || process.platform !== "darwin") return null;
  return captureFrontmostWindow();
});

ipcMain.handle("hide-source-window", async (_e, state) => {
  if (!state || process.platform !== "darwin") return null;
  const ok = await moveWindowOffscreen(state);
  if (!ok) return null;
  activeHiddenState = state;
  return state;
});

ipcMain.handle("restore-source-window", async (_e, state) => {
  if (!state || process.platform !== "darwin") return;
  await restoreWindow(state);
  if (
    activeHiddenState &&
    activeHiddenState.app === state.app &&
    activeHiddenState.title === state.title
  ) {
    activeHiddenState = null;
  }
});

app.on("will-quit", () => {
  if (activeHiddenState) {
    restoreWindowSync(activeHiddenState);
    activeHiddenState = null;
  }
});
