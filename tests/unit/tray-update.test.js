import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  buildMenuItems,
  MENU_INDEX,
  compareSemver
} = require("../../cli/src/cli/tray/tray.js");

describe("Tray Update Controls", () => {
  it("defines expected MENU_INDEX positions", () => {
    expect(MENU_INDEX).toEqual({
      STATUS: 0,
      DASHBOARD: 1,
      CHECK_UPDATE: 2,
      UPDATE_NOW: 3,
      AUTOSTART: 4,
      QUIT: 5
    });
  });

  it("builds initial menu items with Check for Updates and disabled Update Now", () => {
    const items = buildMenuItems(20128, false, { hasUpdate: false, latestVersion: null });
    expect(items).toHaveLength(6);
    expect(items[MENU_INDEX.STATUS].title).toBe("9Router (Port 20128)");
    expect(items[MENU_INDEX.STATUS].enabled).toBe(false);

    expect(items[MENU_INDEX.DASHBOARD].title).toBe("Open Dashboard");
    expect(items[MENU_INDEX.DASHBOARD].enabled).toBe(true);

    expect(items[MENU_INDEX.CHECK_UPDATE].title).toBe("Check for Updates");
    expect(items[MENU_INDEX.CHECK_UPDATE].enabled).toBe(true);

    expect(items[MENU_INDEX.UPDATE_NOW].title).toBe("Update Now");
    expect(items[MENU_INDEX.UPDATE_NOW].enabled).toBe(false);

    expect(items[MENU_INDEX.AUTOSTART].title).toBe("Enable Auto-start");
    expect(items[MENU_INDEX.QUIT].title).toBe("Quit");
  });

  it("builds active Update Now item when new version is available", () => {
    const items = buildMenuItems(20128, true, { hasUpdate: true, latestVersion: "0.5.140" });
    expect(items[MENU_INDEX.CHECK_UPDATE].title).toBe("Update Available: v0.5.140");
    expect(items[MENU_INDEX.CHECK_UPDATE].enabled).toBe(true);

    expect(items[MENU_INDEX.UPDATE_NOW].title).toBe("⬆ Update Now (v0.5.140)");
    expect(items[MENU_INDEX.UPDATE_NOW].enabled).toBe(true);

    expect(items[MENU_INDEX.AUTOSTART].title).toBe("✓ Auto-start Enabled");
  });

  it("correctly compares semver versions", () => {
    expect(compareSemver("0.5.136", "0.5.135")).toBe(1);
    expect(compareSemver("0.5.135", "0.5.135")).toBe(0);
    expect(compareSemver("0.5.134", "0.5.135")).toBe(-1);
    expect(compareSemver("1.0.0", "0.9.99")).toBe(1);
    expect(compareSemver("v0.5.140", "0.5.135")).toBe(1);
  });
});
