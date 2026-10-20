"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input } from "@/shared/components";

export default function SetupPage() {
  const [driver, setDriver] = useState("cloudflare-d1");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // D1 form fields
  const [cfAccountId, setCfAccountId] = useState("");
  const [cfDatabaseId, setCfDatabaseId] = useState("");
  const [cfApiToken, setCfApiToken] = useState("");

  // Postgres / Supabase form fields
  const [pgUrl, setPgUrl] = useState("");

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch("/api/setup/status");
        if (res.ok) {
          const data = await res.json();
          if (data.setupCompleted && !data.setupNeeded) {
            window.location.assign("/dashboard");
            return;
          }
        }
      } catch (e) {
        console.warn("Could not check setup status:", e);
      } finally {
        setChecking(false);
      }
    }
    checkStatus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const payload = {
        driver,
        d1: {
          accountId: cfAccountId,
          databaseId: cfDatabaseId,
          apiToken: cfApiToken,
        },
        postgres: {
          url: pgUrl,
        },
      };

      const res = await fetch("/api/setup/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Cấu hình thất bại");
      }

      setSuccess(true);
      setTimeout(() => {
        window.location.assign("/dashboard");
      }, 1000);
    } catch (err) {
      setError(err.message || "Đã xảy ra lỗi khi kết nối cơ sở dữ liệu");
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500"></div>
          <p className="text-text-muted mt-4">Đang kiểm tra trạng thái cài đặt...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4 relative overflow-hidden">
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-brand-500 mb-2">9Router Setup</h1>
          <p className="text-text-muted">
            Thiết lập cơ sở dữ liệu ban đầu cho hệ thống định tuyến AI của bạn
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div>
              <label className="text-sm font-semibold text-text-main block mb-3">
                Chọn cơ sở dữ liệu (Database Backend)
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => { setDriver("cloudflare-d1"); setError(""); }}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                    driver === "cloudflare-d1"
                      ? "border-brand-500 bg-brand-500/10 shadow-sm"
                      : "border-border-subtle bg-surface hover:border-brand-500/40"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="material-symbols-outlined text-brand-500 text-[20px]">cloud</span>
                    <span className="font-semibold text-sm">Cloudflare D1</span>
                  </div>
                  <p className="text-xs text-text-muted">Serverless SQLite, miễn phí, không sleep</p>
                </button>

                <button
                  type="button"
                  onClick={() => { setDriver("postgres"); setError(""); }}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                    driver === "postgres"
                      ? "border-brand-500 bg-brand-500/10 shadow-sm"
                      : "border-border-subtle bg-surface hover:border-brand-500/40"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="material-symbols-outlined text-brand-500 text-[20px]">database</span>
                    <span className="font-semibold text-sm">Supabase / Postgres</span>
                  </div>
                  <p className="text-xs text-text-muted">Multi-instance / Cloud PostgreSQL</p>
                </button>

                <button
                  type="button"
                  onClick={() => { setDriver("sqlite"); setError(""); }}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                    driver === "sqlite"
                      ? "border-brand-500 bg-brand-500/10 shadow-sm"
                      : "border-border-subtle bg-surface hover:border-brand-500/40"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="material-symbols-outlined text-brand-500 text-[20px]">folder</span>
                    <span className="font-semibold text-sm">SQLite Cục bộ</span>
                  </div>
                  <p className="text-xs text-text-muted">Lưu trên máy, không cần cấu hình</p>
                </button>
              </div>
            </div>

            {driver === "cloudflare-d1" && (
              <div className="flex flex-col gap-4 p-4 rounded-xl bg-surface-2 border border-border-subtle">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-brand-500 text-[18px]">info</span>
                  <span className="text-xs font-medium text-text-muted">
                    Lấy thông tin từ Cloudflare Dashboard (Workers & Pages &gt; D1)
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-text-main">Cloudflare Account ID *</label>
                  <Input
                    placeholder="e.g. 8f9a2b3c4d5e6f7a8b9c0d1e2f3a4b5c"
                    value={cfAccountId}
                    onChange={(e) => setCfAccountId(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-text-main">D1 Database ID (UUID) *</label>
                  <Input
                    placeholder="e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={cfDatabaseId}
                    onChange={(e) => setCfDatabaseId(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-text-main">Cloudflare API Token *</label>
                  <Input
                    type="password"
                    placeholder="Token có quyền Account > D1 > Edit"
                    value={cfApiToken}
                    onChange={(e) => setCfApiToken(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}

            {driver === "postgres" && (
              <div className="flex flex-col gap-4 p-4 rounded-xl bg-surface-2 border border-border-subtle">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-brand-500 text-[18px]">info</span>
                  <span className="text-xs font-medium text-text-muted">
                    Khuyên dùng Transaction Pooler URL (port 6543) của Supabase
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-text-main">PostgreSQL Connection String *</label>
                  <Input
                    type="password"
                    placeholder="postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres"
                    value={pgUrl}
                    onChange={(e) => setPgUrl(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}

            {driver === "sqlite" && (
              <div className="p-4 rounded-xl bg-surface-2 border border-border-subtle text-sm text-text-muted">
                Dữ liệu sẽ được lưu tự động tại thư mục mặc định: <code className="text-xs bg-bg px-2 py-1 rounded">~/.9router/db/data.sqlite</code>.
                Bạn có thể bắt đầu ngay mà không cần tài khoản cloud hay token API.
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-xs font-medium">
                {error}
              </div>
            )}

            {success && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-500 text-xs font-medium">
                Kết nối thành công! Đang chuyển hướng vào hệ thống...
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              disabled={success}
            >
              {driver === "sqlite" ? "Bắt đầu với SQLite" : "Kiểm tra & Lưu cấu hình"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
