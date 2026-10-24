import { describe, expect, it } from "vitest";
import { PROVIDER_FILTER_STORAGE_KEY, AUTO_REFRESH_STORAGE_KEY } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("ProviderLimits storage constants", () => {
  it("exports unique storage keys for quota filters", () => {
    expect(PROVIDER_FILTER_STORAGE_KEY).toBe("quotaProviderFilter");
    expect(AUTO_REFRESH_STORAGE_KEY).toBe("quotaAutoRefresh");
    expect(PROVIDER_FILTER_STORAGE_KEY).not.toBe(AUTO_REFRESH_STORAGE_KEY);
  });
});
