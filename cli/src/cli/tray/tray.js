const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

let trayInstance = null;
let isWinTray = false;

/**
 * Get icon base64 from file — used for systray (mac/linux)
 */
function getIconBase64() {
  const isWin = process.platform === "win32";
  const iconFile = isWin ? "icon.ico" : "icon.png";
  try {
    const iconPath = path.join(__dirname, iconFile);
    if (fs.existsSync(iconPath)) {
      return fs.readFileSync(iconPath).toString("base64");
    }
  } catch (e) {}
  // Fallback: minimal green dot icon (PNG)
  return "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAALEwAACxMBAJqcGAAAAHpJREFUOE9jYBgFgwEwMjIy/Gdg+P8fyP4PxP8ZGBgEcBnGyMjIsICBgSEAhyH/gfgBUNN8XJoZsdkCVL8Ah+b/QPwbqvkBMvk/AwMDAzYX/GdgYAhAN+A/SICRWAMYGfFEJSMjzriEiwDR/xmIa2RkZCSqnZERb3QCAAo3KxzxbKe1AAAAAElFTkSuQmCC";
}

/**
 * Check if system tray is supported on current OS
 * Supported: macOS, Windows, Linux (with GUI)
 */
function isTraySupported() {
  const platform = process.platform;
  if (!["darwin", "win32", "linux"].includes(platform)) {
    return false;
  }
  if (platform === "linux" && !process.env.DISPLAY) {
    return false;
  }
  return true;
}

/**
 * Initialize system tray with menu
 * @param {Object} options - { port, onQuit, onOpenDashboard }
 * @returns {Object|null} tray instance or null if not supported/failed
 */
function initTray(options) {
  if (!isTraySupported()) {
    return null;
  }

  // Windows uses PowerShell NotifyIcon (AV-safe), others use systray
  if (process.platform === "win32") {
    return initWindowsTray(options);
  }
  return initUnixTray(options);
}

let currentPkg = { name: "@dopaemon/9router", version: "0.5.135" };
try {
  currentPkg = require("../../../package.json");
} catch (_) {
  try {
    currentPkg = require("../../../../package.json");
  } catch (_) {}
}

let updateState = {
  checking: false,
  updating: false,
  latestVersion: null,
  hasUpdate: false
};

function compareSemver(a, b) {
  if (!a || !b) return 0;
  const pa = String(a).replace(/^v/, "").split(".").map(Number);
  const pb = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const na = Number.isFinite(pa[i]) ? pa[i] : 0;
    const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function updateTrayItem(index, title, enabled, tooltip = "") {
  if (!trayInstance) return;
  if (isWinTray) {
    try {
      trayInstance.updateItem(index, title, enabled);
    } catch (_) {}
  } else {
    try {
      trayInstance.sendAction({
        type: "update-item",
        item: {
          title,
          tooltip: tooltip || title,
          enabled
        },
        seq_id: index
      });
    } catch (_) {}
  }
}

/**
 * Build menu items array shared between platforms
 */
function buildMenuItems(port, autostartEnabled, updateInfo = updateState) {
  const hasUpdate = Boolean(updateInfo?.hasUpdate && updateInfo?.latestVersion);
  const checkTitle = hasUpdate
    ? `Update Available: v${updateInfo.latestVersion}`
    : "Check for Updates";
  const updateNowTitle = hasUpdate
    ? `⬆ Update Now (v${updateInfo.latestVersion})`
    : "Update Now";

  return [
    { title: `9Router (Port ${port})`, tooltip: "Server is running", enabled: false },
    { title: "Open Dashboard", tooltip: "Open in browser", enabled: true },
    {
      title: checkTitle,
      tooltip: hasUpdate ? `New version v${updateInfo.latestVersion} available` : "Check for new versions",
      enabled: true
    },
    {
      title: updateNowTitle,
      tooltip: hasUpdate ? `Install v${updateInfo.latestVersion} and restart` : "No update available",
      enabled: hasUpdate
    },
    {
      title: autostartEnabled ? "✓ Auto-start Enabled" : "Enable Auto-start",
      tooltip: "Run on OS startup",
      enabled: true
    },
    { title: "Quit", tooltip: "Stop server and exit", enabled: true }
  ];
}

// Menu item indexes
const MENU_INDEX = {
  STATUS: 0,
  DASHBOARD: 1,
  CHECK_UPDATE: 2,
  UPDATE_NOW: 3,
  AUTOSTART: 4,
  QUIT: 5
};

/**
 * Check for newer CLI / server version
 */
function runCheckForUpdate(port) {
  if (updateState.checking || updateState.updating) return;
  updateState.checking = true;

  updateTrayItem(MENU_INDEX.CHECK_UPDATE, "Checking for updates...", false);

  const done = (info) => {
    updateState.checking = false;
    if (info && info.hasUpdate && info.latestVersion) {
      updateState.hasUpdate = true;
      updateState.latestVersion = info.latestVersion;
      updateTrayItem(MENU_INDEX.CHECK_UPDATE, `Update Available: v${info.latestVersion}`, true);
      updateTrayItem(MENU_INDEX.UPDATE_NOW, `⬆ Update Now (v${info.latestVersion})`, true);
    } else if (info) {
      updateState.hasUpdate = false;
      updateState.latestVersion = null;
      const current = info.currentVersion || currentPkg.version;
      updateTrayItem(MENU_INDEX.CHECK_UPDATE, `✓ Up to date (v${current})`, true);
      updateTrayItem(MENU_INDEX.UPDATE_NOW, "Update Now", false);
    } else {
      updateTrayItem(MENU_INDEX.CHECK_UPDATE, "Check for Updates (failed)", true);
      updateTrayItem(MENU_INDEX.UPDATE_NOW, "Update Now", false);
    }
  };

  // 1. Try local server API
  const http = require("http");
  const req = http.get(
    `http://127.0.0.1:${port}/api/version`,
    { timeout: 4000 },
    (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json && typeof json.latestVersion === "string") {
            const hasUp = compareSemver(json.latestVersion, currentPkg.version) > 0;
            done({
              currentVersion: json.currentVersion || currentPkg.version,
              latestVersion: json.latestVersion,
              hasUpdate: hasUp
            });
            return;
          }
        } catch (_) {}
        fallbackNpm();
      });
    }
  );

  req.on("error", () => fallbackNpm());
  req.on("timeout", () => {
    req.destroy();
    fallbackNpm();
  });

  function fallbackNpm() {
    const https = require("https");
    const pkgName = currentPkg.name || "@dopaemon/9router";
    const npmReq = https.get(
      `https://registry.npmjs.org/${encodeURIComponent(pkgName)}/latest`,
      { timeout: 5000 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const latest = JSON.parse(data);
            if (latest?.version) {
              const hasUp = compareSemver(latest.version, currentPkg.version) > 0;
              done({
                currentVersion: currentPkg.version,
                latestVersion: latest.version,
                hasUpdate: hasUp
              });
              return;
            }
          } catch (_) {}
          done(null);
        });
      }
    );
    npmReq.on("error", () => done(null));
    npmReq.on("timeout", () => {
      npmReq.destroy();
      done(null);
    });
  }
}

/**
 * Trigger update immediately
 */
function runUpdateNow(port, onQuit) {
  if (updateState.updating || !updateState.latestVersion) return;
  updateState.updating = true;

  const targetVer = updateState.latestVersion;
  updateTrayItem(MENU_INDEX.UPDATE_NOW, `⏳ Updating to v${targetVer}...`, false);
  updateTrayItem(MENU_INDEX.CHECK_UPDATE, "Installing update...", false);
  updateTrayItem(MENU_INDEX.STATUS, `9Router - Updating to v${targetVer}`, false);

  const http = require("http");
  const postData = JSON.stringify({});
  const req = http.request(
    {
      hostname: "127.0.0.1",
      port: port,
      path: "/api/version/update",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      },
      timeout: 6000
    },
    (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // App server accepted update and spawned detached updater
        return;
      }
      fallbackDirectInstall();
    }
  );

  req.on("error", () => fallbackDirectInstall());
  req.on("timeout", () => {
    req.destroy();
    fallbackDirectInstall();
  });
  req.write(postData);
  req.end();

  function fallbackDirectInstall() {
    const { spawn } = require("child_process");
    const isWin = process.platform === "win32";
    const npmCmd = isWin ? "npm.cmd" : "npm";
    const pkgName = currentPkg.name || "@dopaemon/9router";

    console.log(`\n⬆ Starting 9Router update to v${targetVer}...`);
    const child = spawn(npmCmd, ["i", "-g", `${pkgName}@latest`, "--prefer-online"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: isWin
    });
    child.unref();

    setTimeout(() => {
      console.log("\n👋 Exiting for update to complete...");
      if (onQuit) onQuit();
      killTray();
      setTimeout(() => process.exit(0), 500);
    }, 1500);
  }
}

/**
 * Get current autostart state
 */
function getAutostartEnabled() {
  try {
    const { isAutoStartEnabled } = require("./autostart");
    return isAutoStartEnabled();
  } catch (e) {
    return false;
  }
}

/**
 * Handle menu item click (shared logic)
 */
function handleClick(index, options, onAutostartToggle) {
  const { onQuit, onOpenDashboard, port } = options;
  if (index === MENU_INDEX.DASHBOARD) {
    if (onOpenDashboard) onOpenDashboard();
    else openBrowser(`http://localhost:${port}/dashboard`);
  } else if (index === MENU_INDEX.CHECK_UPDATE) {
    runCheckForUpdate(port);
  } else if (index === MENU_INDEX.UPDATE_NOW) {
    runUpdateNow(port, onQuit);
  } else if (index === MENU_INDEX.AUTOSTART) {
    const enabled = getAutostartEnabled();
    try {
      const { enableAutoStart, disableAutoStart } = require("./autostart");
      if (enabled) disableAutoStart();
      else enableAutoStart();
      onAutostartToggle(!enabled);
    } catch (e) {}
  } else if (index === MENU_INDEX.QUIT) {
    console.log("\n👋 Shutting down...");
    if (onQuit) onQuit();
    killTray();
    setTimeout(() => process.exit(0), 500);
  }
}

/**
 * Windows tray via PowerShell NotifyIcon
 */
function initWindowsTray(options) {
  const { port } = options;
  try {
    const { initWinTray } = require("./trayWin");
    const iconPath = path.join(__dirname, "icon.ico");
    const autostartEnabled = getAutostartEnabled();
    const items = buildMenuItems(port, autostartEnabled, updateState);

    trayInstance = initWinTray({
      iconPath,
      tooltip: `9Router - Port ${port}`,
      items,
      onClick: (index) => {
        handleClick(index, options, (newEnabled) => {
          const newTitle = newEnabled ? "✓ Auto-start Enabled" : "Enable Auto-start";
          updateTrayItem(MENU_INDEX.AUTOSTART, newTitle, true);
        });
      }
    });
    isWinTray = true;
    return trayInstance;
  } catch (err) {
    return null;
  }
}

/**
 * macOS/Linux tray via systray binary
 *
 * Prefers `systray2`, the active fork of `systray`. Both ship only an x86_64
 * `tray_darwin_release` and select it by process.platform alone, so on Apple
 * Silicon the tray runs under Rosetta 2 and fails with EBADARCH when Rosetta is
 * absent. hooks/trayRuntime.js overlays a native arm64 build over that file to
 * avoid the dependency; the fallbacks below are Intel-only.
 *
 * Falls back to legacy `systray@1.0.5` if systray2 is unavailable, though that
 * binary's Mach-O headers are rejected by modern dyld and no icon will appear.
 */
function resolveSystray() {
  let runtimeDir = null;
  try {
    const { getRuntimeNodeModules } = require("../../../hooks/sqliteRuntime");
    runtimeDir = getRuntimeNodeModules();
  } catch (e) {}

  // 1) systray2 in runtime dir (where ensureTrayRuntime installs it)
  if (runtimeDir) {
    try { return { mod: require(path.join(runtimeDir, "systray2")).default, isV2: true }; } catch (e) {}
  }
  // 2) systray2 resolvable from the package's own node_modules / NODE_PATH
  try { return { mod: require("systray2").default, isV2: true }; } catch (e) {}
  // 3) Legacy systray fallback (unlikely to render on modern macOS)
  try { return { mod: require("systray").default, isV2: false }; } catch (e) {}
  if (runtimeDir) {
    try { return { mod: require(path.join(runtimeDir, "systray")).default, isV2: false }; } catch (e) {}
  }
  return null;
}

function chmodTrayBin(pkgName) {
  // systray2's npm tarball occasionally lands without +x on the bundled Go
  // binary (observed on macOS). spawn() then fails with EACCES. Best-effort
  // chmod on every init avoids a hard-to-diagnose silent tray failure.
  try {
    const { getRuntimeNodeModules } = require("../../../hooks/sqliteRuntime");
    const binName = process.platform === "darwin" ? "tray_darwin_release" : "tray_linux_release";
    const candidates = [
      path.join(getRuntimeNodeModules(), pkgName, "traybin", binName),
      path.join(__dirname, "..", "..", "..", "node_modules", pkgName, "traybin", binName)
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) fs.chmodSync(p, 0o755);
    }
  } catch (e) {}
}

function initUnixTray(options) {
  const { port } = options;
  try {
    const resolved = resolveSystray();
    if (!resolved) return null;
    const { mod: SysTray, isV2 } = resolved;

    chmodTrayBin(isV2 ? "systray2" : "systray");

    const autostartEnabled = getAutostartEnabled();
    const items = buildMenuItems(port, autostartEnabled, updateState);

    const menu = {
      icon: getIconBase64(),
      // The bundled icon.png is a full-color RGBA logo. Don't mark it as a
      // template icon: macOS would then render it as a solid white square
      // because template mode only uses the alpha channel.
      isTemplateIcon: false,
      title: "",
      tooltip: `9Router - Port ${port}`,
      items
    };

    trayInstance = new SysTray({ menu, debug: false, copyDir: true });
    isWinTray = false;
    trayInstance.onClick((action) => {
      const idx = typeof action?.seq_id === "number" ? action.seq_id : (action?.__id != null ? action.__id - 1 : -1);
      if (idx < 0) return;
      handleClick(idx, options, (newEnabled) => {
        const newTitle = newEnabled ? "✓ Auto-start Enabled" : "Enable Auto-start";
        updateTrayItem(MENU_INDEX.AUTOSTART, newTitle, true);
      });
    });

    if (isV2) {
      // systray2 exposes a ready() promise instead of onReady/onError. Surface
      // failures (binary crash, EACCES, etc.) so users can see why the icon
      // didn't appear instead of getting a misleading "running in tray" log.
      trayInstance.ready().catch((err) => {
        process.stderr.write(`[9router] tray failed to start: ${err && err.message ? err.message : err}\n`);
      });
    } else {
      trayInstance.onReady(() => {});
      trayInstance.onError(() => {});
    }
    return trayInstance;
  } catch (err) {
    process.stderr.write(`[9router] tray init error: ${err.message}\n`);
    return null;
  }
}

/**
 * Kill tray, wait Go binary fully exit (returns Promise).
 * Critical for hide-to-tray: macOS must release NSStatusItem before bgProcess
 * spawns a new tray, otherwise the new icon silently fails to register.
 */
function killTray() {
  const instance = trayInstance;
  const wasWin = isWinTray;
  trayInstance = null;
  if (!instance) return Promise.resolve();

  if (wasWin) {
    try { instance.kill(); } catch (e) {}
    return Promise.resolve();
  }

  // Unix: get the Go tray child process handle.
  let proc = null;
  try {
    proc = instance._process || (typeof instance.process === "function" ? instance.process() : null);
  } catch (e) {}

  // Graceful shutdown: send {type:"exit"} via IPC so the Go binary can call
  // systray.Quit() and release NSStatusItem. SIGKILL leaves a ghost icon on
  // the macOS menubar until logout, causing duplicate icons after re-spawn.
  const gracefulQuit = () => { try { instance.kill(true); } catch (e) {} };
  const closeIpc = () => { try { instance.kill(false); } catch (e) {} };

  if (!proc || !proc.pid) {
    gracefulQuit();
    closeIpc();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; closeIpc(); resolve(); };

    proc.once("exit", finish);
    gracefulQuit();

    // Escalate: SIGTERM after 800ms, SIGKILL after 1600ms if still alive.
    setTimeout(() => { try { process.kill(proc.pid, 0); proc.kill("SIGTERM"); } catch (e) {} }, 800);
    setTimeout(() => { try { process.kill(proc.pid, 0); proc.kill("SIGKILL"); } catch (e) {} }, 1600);

    // Fallback poll in case "exit" never fires (detached child, pipe closed)
    const deadline = Date.now() + 3000;
    const poll = setInterval(() => {
      try { process.kill(proc.pid, 0); } catch { clearInterval(poll); finish(); return; }
      if (Date.now() > deadline) { clearInterval(poll); finish(); }
    }, 50);
  });
}

/**
 * Open browser
 */
function openBrowser(url) {
  const platform = process.platform;
  let cmd;

  if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else if (platform === "win32") {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd);
}

module.exports = {
  initTray,
  killTray,
  buildMenuItems,
  MENU_INDEX,
  compareSemver,
  runCheckForUpdate,
  runUpdateNow
};
