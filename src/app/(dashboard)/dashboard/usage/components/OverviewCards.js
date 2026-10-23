"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import AnimatedNumber from "@/shared/components/AnimatedNumber";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtPlus = (n) => `+${new Intl.NumberFormat().format(n || 0)}`;
const costFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});
const fmtCost = (n) => costFormatter.format(Number(n) || 0);

const COST_SNAP = 50;
const TOKEN_SNAP = 2_000_000;

const CARD = "flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4";
const LABEL = "text-text-muted text-xs uppercase font-semibold sm:text-sm";
const VALUE = "w-full truncate text-lg font-bold xl:text-xl";
export default function OverviewCards({ stats }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 sm:gap-4">
      <Card className={CARD}>
        <span className={LABEL}>Total Requests</span>
        <AnimatedNumber
          value={stats.totalRequests}
          format={fmt}
          className={VALUE}
        />
      </Card>
      <Card className={CARD}>
        <span className={LABEL}>Total Input Tokens</span>
        <AnimatedNumber
          value={stats.totalPromptTokens}
          format={fmt}
          snapAfter={TOKEN_SNAP}
          className={`${VALUE} text-primary`}
        />
      </Card>
      <Card className={CARD}>
        <span className={LABEL}>Cached Tokens</span>
        <AnimatedNumber
          value={stats.totalCachedTokens}
          format={fmt}
          snapAfter={TOKEN_SNAP}
          className={`${VALUE} text-info`}
        />
      </Card>
      <Card className={CARD}>
        <span className={LABEL}>Output Tokens</span>
        <AnimatedNumber
          value={stats.totalCompletionTokens}
          format={fmt}
          snapAfter={TOKEN_SNAP}
          className={`${VALUE} text-success`}
        />
      </Card>
      <Card className={CARD}>
        <span className={LABEL}>Token Saver Gain</span>
        <AnimatedNumber
          value={stats.totalRtkTokensSaved || 0}
          format={fmtPlus}
          snapAfter={TOKEN_SNAP}
          className={`${VALUE} text-emerald-500`}
        />
        <span className="text-[10px] text-text-muted">
          {stats.totalPromptTokens > 0 && stats.totalRtkTokensSaved > 0
            ? `${((stats.totalRtkTokensSaved / (stats.totalPromptTokens + stats.totalRtkTokensSaved)) * 100).toFixed(1)}% input saved`
            : "Tokens saved via RTK & OmniRoute"}
        </span>
      </Card>
      <Card className={CARD}>
        <span className={LABEL}>Est. Cost</span>
        <AnimatedNumber
          value={stats.totalCost}
          format={fmtCost}
          snapAfter={COST_SNAP}
          className={`${VALUE} text-warning`}
        />
        <span className="text-[10px] text-text-muted">Estimated, not actual billing</span>
      </Card>
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
