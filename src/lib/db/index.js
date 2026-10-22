// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { upsertSql } from "./sqlDialect.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { keyAccessFromColumns, keyAccessToColumns, validateKeyAccessInput } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

const KV_UPSERT = upsertSql("kv", ["scope", "key", "value"], ["scope", "key"]);

// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
} from "./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, getApiKeyByKey, createApiKey, updateApiKey, deleteApiKey, validateApiKey,
} from "./repos/apiKeysRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

// Aliases (model + custom + mitm)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
} from "./repos/aliasRepo.js";

// Pricing
export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
} from "./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders, getDistinctModels,
} from "./repos/requestDetailsRepo.js";

// Export/import full DB
export async function exportDb() {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");

  const out = {
    settings: await exportSettings(),
    providerConnections: (await db.all(`SELECT * FROM providerConnections`)).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: (await db.all(`SELECT * FROM providerNodes`)).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: (await db.all(`SELECT * FROM proxyPools`)).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: (await db.all(`SELECT * FROM apiKeys`)).map((r) => ({ id: r.id, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt, access: keyAccessFromColumns(r.accessRestricted, r.accessAllow) })),
    combos: (await db.all(`SELECT * FROM combos`)).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
  };

  for (const r of await db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) out.modelAliases[r.key] = parseJson(r.value);
  for (const r of await db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r.value));
  for (const r of await db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) out.mitmAlias[r.key] = parseJson(r.value);
  for (const r of await db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r.key] = parseJson(r.value);

  const disabledRows = await db.all(`SELECT key, value FROM kv WHERE scope = 'disabledModels'`);
  if (disabledRows.length > 0) {
    out.disabledModels = {};
    for (const r of disabledRows) out.disabledModels[r.key] = parseJson(r.value, []);
  }

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const db = await getAdapter();

  await db.transaction(async (tx) => {
    // Wipe all tables (keep _meta)
    await tx.run(`DELETE FROM settings`);
    await tx.run(`DELETE FROM providerConnections`);
    await tx.run(`DELETE FROM providerNodes`);
    await tx.run(`DELETE FROM proxyPools`);
    await tx.run(`DELETE FROM apiKeys`);
    await tx.run(`DELETE FROM combos`);
    await tx.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing', 'disabledModels')`);

    // Preserve existing password if payload does not supply one
    let preservedPassword = null;
    const cur = await tx.get(`SELECT data FROM settings WHERE id = 1`);
    if (cur) {
      preservedPassword = parseJson(cur.data, {})?.password || null;
    }

    // Settings
    if (payload.settings) {
      const settingsToSave = { ...payload.settings };
      if (!settingsToSave.password && preservedPassword) {
        settingsToSave.password = preservedPassword;
      }
      await tx.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(settingsToSave)]);
    }
    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      await tx.run(
        upsertSql("providerConnections", ["id", "provider", "authType", "name", "email", "priority", "isActive", "data", "createdAt", "updatedAt"], ["id"]),
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      await tx.run(
        upsertSql("providerNodes", ["id", "type", "name", "data", "createdAt", "updatedAt"], ["id"]),
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      await tx.run(
        upsertSql("proxyPools", ["id", "isActive", "testStatus", "data", "createdAt", "updatedAt"], ["id"]),
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of payload.apiKeys || []) {
      // Per-key access: a backup without `access` (older version) restores
      // unrestricted, exactly as before; a malformed `access` is refused.
      let access = KEY_ACCESS_UNRESTRICTED;
      if (k.access !== undefined) {
        const checked = validateKeyAccessInput(k.access);
        if (!checked.ok) throw new Error(`apiKeys ${k.id}: ${checked.error}`);
        access = checked.value;
      }
      const cols = keyAccessToColumns(access);
      await tx.run(
        upsertSql("apiKeys", ["id", "key", "name", "machineId", "isActive", "createdAt", "accessRestricted", "accessAllow"], ["id"]),
        [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString(), cols.accessRestricted, cols.accessAllow]
      );
    }
    for (const c of payload.combos || []) {
      await tx.run(
        upsertSql("combos", ["id", "name", "kind", "models", "createdAt", "updatedAt"], ["id"]),
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const [a, m] of Object.entries(payload.modelAliases || {})) {
      await tx.run(KV_UPSERT, ["modelAliases", a, stringifyJson(m)]);
    }
    for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      await tx.run(KV_UPSERT, ["customModels", k, stringifyJson(m)]);
    }
    for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
      await tx.run(KV_UPSERT, ["mitmAlias", tool, stringifyJson(mappings || {})]);
    }
    for (const [provider, models] of Object.entries(payload.pricing || {})) {
      await tx.run(KV_UPSERT, ["pricing", provider, stringifyJson(models || {})]);
    }
    for (const [provider, models] of Object.entries(payload.disabledModels || {})) {
      await tx.run(KV_UPSERT, ["disabledModels", provider, stringifyJson(models || [])]);
    }
  });

  return await exportDb();
}

export async function resetDb(keepPassword = true) {
  const db = await getAdapter();
  const { DEFAULT_SETTINGS } = await import("./repos/settingsRepo.js");

  await db.transaction(async (tx) => {
    let preservedPassword = null;
    if (keepPassword) {
      const cur = await tx.get(`SELECT data FROM settings WHERE id = 1`);
      if (cur) {
        preservedPassword = parseJson(cur.data, {})?.password || null;
      }
    }

    await tx.run(`DELETE FROM settings`);
    await tx.run(`DELETE FROM providerConnections`);
    await tx.run(`DELETE FROM providerNodes`);
    await tx.run(`DELETE FROM proxyPools`);
    await tx.run(`DELETE FROM apiKeys`);
    await tx.run(`DELETE FROM combos`);
    await tx.run(`DELETE FROM kv`);
    await tx.run(`DELETE FROM usageHistory`);
    await tx.run(`DELETE FROM usageDaily`);
    await tx.run(`DELETE FROM requestDetails`);
    await tx.run(`DELETE FROM _meta WHERE key = 'totalRequestsLifetime'`);

    const newSettings = { ...DEFAULT_SETTINGS };
    if (preservedPassword) {
      newSettings.password = preservedPassword;
    }
    await tx.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(newSettings)]
    );
  });

  if (global._recentRing) global._recentRing.items = [];
  if (global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
  if (global._connectionMapCache) global._connectionMapCache = { map: {}, ts: 0 };

  return { success: true };
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
