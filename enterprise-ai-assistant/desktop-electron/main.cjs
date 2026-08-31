// Enterprise AI Assistant — Electron main process
// Manages the embedded FastAPI backend and llama.cpp LLM server, shows a
// splash while booting, and hosts a system tray. Production target: NSIS.
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  shell,
  ipcMain,
} = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { spawn } = require("child_process");

const BACKEND_PORT = 8741;
const LLM_PORT = 8742;
const BACKEND_HEALTH = `/api/health`;

const isDev = process.env.EAI_DEV === "1";
const isPackaged = app.isPackaged;

// Paths ----------------------------------------------------------------------
function resourcePath(...segments) {
  const base = isPackaged
    ? path.join(process.resourcesPath)
    : path.join(__dirname, "..");
  return path.join(base, ...segments);
}

function backendExe() {
  if (process.platform === "win32") {
    const candidates = [
      resourcePath("backend", "backend-server.exe"),
      resourcePath("backend", "backend-server", "backend-server.exe"),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return candidates[0];
  }
  // Dev / non-Windows: run the Python backend directly.
  return process.execPath;
}

function llamaExe() {
  const candidates = [
    resourcePath("llm", "llama-server.exe"),
    resourcePath("llm", "llama-server"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function modelPath() {
  const candidates = [
    resourcePath("models", "llm", "qwen2.5-1.5b-instruct-q4_k_m.gguf"),
    // 7B is split into two GGUF shards; llama-server auto-loads both when
    // pointed at the first shard.
    resourcePath("models", "llm", "qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf"),
    resourcePath("models", "llm", "qwen2.5-7b-instruct-q4_k_m.gguf"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

// Process management ---------------------------------------------------------
let backendProc = null;
let llmProc = null;
let mainWindow = null;
let tray = null;
let splashWindow = null;

function startBackend() {
  if (isDev || !isPackaged) {
    // In dev, the developer runs the Python backend separately.
    return null;
  }
  const exe = backendExe();
  const cwd = path.dirname(exe);
  const child = spawn(exe, [], {
    cwd,
    env: {
      ...process.env,
      APP_HOST: "127.0.0.1",
      APP_PORT: String(BACKEND_PORT),
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => console.log(`[backend] ${d}`.trim()));
  child.stderr?.on("data", (d) => console.error(`[backend] ${d}`.trim()));
  child.on("exit", (code) => {
    console.log(`[backend] exited with ${code}`);
    if (!app.isQuiting && code !== 0) {
      // Auto-restart once on crash (gives the backend a brief recovery window).
      setTimeout(() => {
        if (!app.isQuiting) backendProc = startBackend();
      }, 1500);
    }
  });
  return child;
}

function startLlm() {
  const exe = llamaExe();
  const model = modelPath();
  if (!exe || !model) {
    console.log("[llm] binary or model not found; using offline fallback");
    return null;
  }
  const threads = String(
    Math.max(2, require("os").cpus().length || 4)
  );
  const child = spawn(
    exe,
    [
      "--model",
      model,
      "--host",
      "127.0.0.1",
      "--port",
      String(LLM_PORT),
      "--ctx-size",
      "4096",
      "--threads",
      threads,
      "--parallel",
      "2",
    ],
    {
      cwd: path.dirname(exe),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  child.stdout?.on("data", (d) => console.log(`[llm] ${d}`.trim()));
  child.stderr?.on("data", (d) => console.error(`[llm] ${d}`.trim()));
  child.on("exit", (code) => console.log(`[llm] exited with ${code}`));
  return child;
}

function healthCheck(port, path, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const req = http.get(
        `http://127.0.0.1:${port}${path}`,
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        }
      );
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(tick, 500);
      });
      req.setTimeout(800, () => req.destroy());
    };
    tick();
  });
}

function kill(proc) {
  if (!proc) return;
  try {
    if (process.platform === "win32") {
      // Tree-kill the child so the backend/llm process group dies with the app.
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
        windowsHide: true,
      });
    } else {
      proc.kill("SIGTERM");
    }
  } catch (e) {
    console.error("kill failed", e);
  }
}

// Windows --------------------------------------------------------------------
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "دستیار هوشمند سازمانی",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const url = `http://127.0.0.1:${BACKEND_PORT}`;
  mainWindow.loadURL(url);

  mainWindow.once("ready-to-show", () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  // Minimize to tray instead of quitting on close.
  mainWindow.on("close", (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  let icon;
  const iconPath = path.join(__dirname, "build", "icon.png");
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } else {
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  tray.setToolTip("دستیار هوشمند سازمانی");
  const menu = Menu.buildFromTemplate([
    {
      label: "نمایش پنجره اصلی",
      click: () => {
        if (!mainWindow) createMainWindow();
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: "separator" },
    {
      label: "وضعیت: فعال",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "خروج کامل",
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", () => {
    if (!mainWindow) createMainWindow();
    mainWindow.show();
    mainWindow.focus();
  });
}

// App lifecycle --------------------------------------------------------------
app.disableHardwareAcceleration(); // safer for embedded WebView setups

app.whenReady().then(async () => {
  createSplash();

  if (!isDev) {
    backendProc = startBackend();
  }
  const backendOk = await healthCheck(BACKEND_PORT, BACKEND_HEALTH, 30000);
  if (!backendOk) {
    console.error("[app] backend did not become healthy");
  }

  if (!isDev) {
    llmProc = startLlm();
    await healthCheck(LLM_PORT, "/health", 4000); // best effort, non-blocking UI
  }

  createMainWindow();
  createTray();
});

app.on("before-quit", () => {
  app.isQuiting = true;
});

app.on("will-quit", () => {
  kill(backendProc);
  kill(llmProc);
});

app.on("window-all-closed", (e) => {
  // Keep running in the tray; only quit via the tray menu.
  if (process.platform !== "darwin") e.preventDefault();
});

ipcMain.handle("app:version", () => app.getVersion());
