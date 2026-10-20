"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import UsageStats from "@/shared/components/UsageStats";
import RequestDetailsTab from "./components/RequestDetailsTab";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
];

const INTERVAL_OPTIONS = [
  { value: 1000, label: "1s" },
  { value: 1500, label: "1.5s" },
  { value: 2000, label: "2s" },
  { value: 2500, label: "2.5s" },
  { value: 3000, label: "3s" },
  { value: 4000, label: "4s" },
  { value: 5000, label: "5s" },
];

function LiveModeSelector({ liveMode, onToggle, liveInterval, onIntervalChange }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownOpen]);

  const currentLabel = INTERVAL_OPTIONS.find((i) => i.value === liveInterval)?.label || `${liveInterval / 1000}s`;

  return (
    <div className="relative inline-flex items-center" ref={dropdownRef}>
      <div
        className={`inline-flex items-center h-9 rounded-[10px] border text-xs font-medium transition-all ${
          liveMode
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "border-border bg-surface-2 text-text-muted hover:text-text-main"
        }`}
      >
        <button
          type="button"
          onClick={() => onToggle(!liveMode)}
          aria-pressed={liveMode}
          className={`flex items-center gap-1.5 px-3 h-full ${liveMode ? "rounded-l-[10px]" : "rounded-[10px]"} hover:opacity-80 transition-opacity`}
          title={liveMode ? `Live mode on (${currentLabel}) — click to turn off` : "Enable live mode"}
        >
          <span className={`size-2 rounded-full ${liveMode ? "bg-emerald-500 animate-pulse" : "bg-text-muted/60"}`} />
          <span>Live</span>
        </button>

        {liveMode && (
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className="flex items-center gap-0.5 px-2 h-full border-l border-emerald-500/20 font-semibold hover:bg-emerald-500/15 rounded-r-[10px] transition-colors"
            title="Change refresh interval"
          >
            <span>{currentLabel}</span>
            <span className={`material-symbols-outlined text-[16px] transition-transform duration-150 ${dropdownOpen ? "rotate-180" : ""}`}>
              expand_more
            </span>
          </button>
        )}
      </div>

      {dropdownOpen && (
        <div className="absolute left-0 top-full mt-1.5 w-36 bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 p-1">
          <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted border-b border-black/5 dark:border-white/5">
            Refresh Interval
          </div>
          <div className="py-1 flex flex-col gap-0.5">
            {INTERVAL_OPTIONS.map((opt) => {
              const selected = opt.value === liveInterval;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onIntervalChange(opt.value);
                    setDropdownOpen(false);
                  }}
                  className={`flex items-center justify-between w-full px-2.5 py-1.5 text-xs rounded-lg transition-colors ${
                    selected
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold"
                      : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  <span>{opt.label}</span>
                  {selected && (
                    <span className="material-symbols-outlined text-[14px] text-emerald-500">
                      check
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [period, setPeriod] = useState("today");
  const [liveMode, setLiveMode] = useState(false);
  const [liveInterval, setLiveInterval] = useState(1000);

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem("9router_usage_live_mode");
      if (savedMode !== null) setLiveMode(savedMode === "true");
      const savedInterval = localStorage.getItem("9router_usage_live_interval");
      if (savedInterval) {
        const num = Number(savedInterval);
        if ([1000, 1500, 2000, 2500, 3000, 4000, 5000].includes(num)) {
          setLiveInterval(num);
        }
      }
    } catch {}
  }, []);

  const handleLiveModeToggle = (next) => {
    setLiveMode(next);
    try {
      localStorage.setItem("9router_usage_live_mode", String(next));
    } catch {}
  };

  const handleIntervalChange = (val) => {
    setLiveInterval(val);
    try {
      localStorage.setItem("9router_usage_live_interval", String(val));
    } catch {}
  };

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Tabs + period selector on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <SegmentedControl
            options={[
              { value: "overview", label: "Overview" },
              { value: "details", label: "Details" },
            ]}
            value={activeTab}
            onChange={handleTabChange}
            className="w-full sm:w-auto"
          />
          {activeTab === "overview" && (
            <LiveModeSelector
              liveMode={liveMode}
              onToggle={handleLiveModeToggle}
              liveInterval={liveInterval}
              onIntervalChange={handleIntervalChange}
            />
          )}
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">

          {activeTab === "overview" && (
            <SegmentedControl
              options={PERIODS}
              value={period}
              onChange={setPeriod}
              size="sm"
              className="w-auto"
            />
          )}
        </div>
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats period={period} setPeriod={setPeriod} hidePeriodSelector liveMode={liveMode} setLiveMode={handleLiveModeToggle} liveInterval={liveInterval} />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" && <RequestDetailsTab />}
    </div>
  );
}
