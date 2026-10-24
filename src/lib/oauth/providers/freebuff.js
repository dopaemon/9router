import crypto from "crypto";
import { FREEBUFF_CONFIG } from "../constants/oauth.js";

const freebuff = {
  config: FREEBUFF_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const fingerprintId = `freebuff-${crypto.randomBytes(12).toString("hex")}`;
    const url = config.deviceCodeUrl || "https://freebuff.com/api/auth/cli/code";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprintId }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Freebuff auth initiation failed: ${error}`);
    }
    const data = await response.json();
    return {
      device_code: `${data.fingerprintId}:${data.fingerprintHash}:${data.expiresAt}`,
      user_code: (data.fingerprintHash || "").slice(0, 8),
      verification_uri: data.loginUrl,
      verification_uri_complete: data.loginUrl,
      expires_in: Math.floor((data.expiresInMs || 3600000) / 1000),
      interval: 3,
    };
  },
  pollToken: async (config, deviceCode) => {
    const parts = (deviceCode || "").split(":");
    if (parts.length < 3) {
      return { ok: false, data: { error: "invalid_grant", error_description: "Malformed device code" } };
    }
    const [fingerprintId, fingerprintHash, expiresAt] = parts;

    if (Date.now() > Number(expiresAt)) {
      return { ok: false, data: { error: "expired_token", error_description: "Authentication code expired" } };
    }

    const params = new URLSearchParams({
      fingerprintId,
      fingerprintHash,
      expiresAt,
    });
    const url = `${config.pollUrl || "https://freebuff.com/api/auth/cli/status"}?${params.toString()}`;
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });

    if (response.status === 401) {
      return { ok: false, data: { error: "authorization_pending" } };
    }
    if (!response.ok) {
      return { ok: false, data: { error: "poll_failed", error_description: `Poll failed with status ${response.status}` } };
    }

    const data = await response.json();
    if (data.user && data.user.authToken) {
      return {
        ok: true,
        data: {
          access_token: data.user.authToken,
          user: data.user,
        },
      };
    }

    return { ok: false, data: { error: "authorization_pending" } };
  },
  mapTokens: (tokens) => ({
    accessToken: tokens.access_token,
    refreshToken: null,
    expiresIn: null,
    email: tokens.user?.email || null,
    displayName: tokens.user?.name || tokens.user?.email || "Freebuff User",
    providerSpecificData: {
      userId: tokens.user?.id || null,
      fingerprintId: tokens.user?.fingerprintId || null,
      baseUrl: "https://codebuff.com/api/v1/chat/completions",
    },
  }),
};

export default freebuff;
