"use client";

import React, { useMemo, useRef, useState } from "react";

/* ============================================================================
   Shared types (structural — match the shapes already used in page.tsx)
   ============================================================================ */

interface ChartTransaction {
  date: string;
  amount: number;
  category: string;
  transaction_type: string;
}

interface ChartDebt {
  person: string;
  type: string;
  amount: number;
  paid_amount: number;
  remaining_amount?: number;
  is_settled: boolean;
}

interface ChartGearItem {
  title: string;
  cost: number;
  saved_amount: number;
  is_paid: boolean;
  kind: string;
}

/* ============================================================================
   Palette — validated against this app's actual card surface (#EFECE5).
   Categorical slots (identity: expense category, debt person) come from the
   dataviz skill's default 8-hue order, run through validate_palette.js against
   this exact surface (all hard checks pass; contrast WARN on 4 slots is why
   every bar below carries a direct value label — that's the required relief).
   Paid/remaining, income/expense, and business/personal reuse colors already
   established elsewhere in this app's UI rather than inventing new ones.
   ============================================================================ */
const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const FOLD_OTHER = "#9a978d"; // 9th+ category folds here, per the series-count ladder

const INK = "#1C1B17";
const INK_MUTED = "#8E8A80";
const GRID = "#D6D2C8";
const SURFACE = "#EFECE5";

const COLOR_INCOME = "#16A34A";   // matches existing income/positive convention
const COLOR_EXPENSE = "#DC2626";  // matches existing expense/negative convention
const COLOR_PAID = "#16A34A";     // matches existing "Paid & Owned" badge convention
const COLOR_REMAINING = "#D6D2C8"; // neutral track, not yet resolved
const COLOR_BUSINESS = "#D97706"; // matches existing Business Equipment Kit accent
const COLOR_PERSONAL = "#7C3AED"; // matches existing Personal Wishlist accent

function fmtRs(n: number): string {
  const rounded = Math.round(n);
  return `Rs ${Math.abs(rounded).toLocaleString()}`;
}

function fmtDateShort(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

/* ============================================================================
   Tooltip — a single shared floating tooltip, positioned relative to a chart's
   wrapper div. Enhances only: every value it shows also sits in a direct label
   or the axis, so nothing is hover-gated.
   ============================================================================ */
interface TooltipState {
  x: number;
  y: number;
  lines: { label: string; value: string; swatch?: string }[];
}

function ChartTooltip({ tooltip }: { tooltip: TooltipState | null }) {
  if (!tooltip) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-lg bg-[#1C1B17] px-2.5 py-2 text-[10.5px] shadow-lg"
      style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-50%, -100%)" }}
    >
      {tooltip.lines.map((l, i) => (
        <div key={i} className="flex items-center justify-between gap-3 whitespace-nowrap">
          <span className="flex items-center gap-1.5 text-[#D6D2C8]">
            {l.swatch && <span className="inline-block w-2 h-0.5 rounded-full" style={{ backgroundColor: l.swatch }} />}
            {l.label}
          </span>
          <span className="font-mono font-bold text-white">{l.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
   1. Daily Net Cash Flow — diverging bar chart, last 30 days.
   Positive (income > expense that day) grows up in green; negative grows down
   in red. Transfers are excluded — they move money between your own accounts
   and net to zero, they aren't real inflow/outflow.
   ============================================================================ */
export function DailyCashFlowChart({ transactions }: { transactions: ChartTransaction[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byDate = new Map<string, { income: number; expense: number }>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      byDate.set(d.toISOString().split("T")[0], { income: 0, expense: 0 });
    }
    for (const t of transactions) {
      const bucket = byDate.get(t.date);
      if (!bucket) continue;
      if (t.transaction_type === "income") bucket.income += t.amount;
      else if (t.transaction_type === "expense") bucket.expense += t.amount;
    }
    return Array.from(byDate.entries()).map(([date, v]) => ({
      date,
      income: v.income,
      expense: v.expense,
      net: v.income - v.expense,
    }));
  }, [transactions]);

  const maxAbs = Math.max(1, ...days.map((d) => Math.abs(d.net)));
  const W = 720, H = 200, padL = 46, padR = 12, padT = 12, padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const midY = padT + plotH / 2;
  const barW = Math.min(16, (plotW / days.length) * 0.6);
  const step = plotW / days.length;
  const scale = (plotH / 2) / maxAbs;

  const hasAnyData = days.some((d) => d.income > 0 || d.expense > 0);

  return (
    <div className="warm-card p-5 rounded-2xl space-y-3">
      <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
        <h3 className="text-sm font-bold text-[#1C1B17]">Daily Net Cash Flow</h3>
        <div className="flex items-center gap-3 text-[10.5px] text-[#6B6860]">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLOR_INCOME }} />Net inflow</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLOR_EXPENSE }} />Net outflow</span>
        </div>
      </div>

      {!hasAnyData ? (
        <p className="text-xs text-[#8E8A80] py-8 text-center">No transactions in the last 30 days yet.</p>
      ) : (
        <div ref={wrapRef} className="relative overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Net income minus expense per day over the last 30 days" className="w-full" style={{ minWidth: 560 }}>
            {/* y-axis ticks: 0 and the rounded max */}
            <text x={padL - 8} y={midY + 3} textAnchor="end" fontSize="9" fill={INK_MUTED} fontFamily="monospace">0</text>
            <line x1={padL} y1={midY} x2={W - padR} y2={midY} stroke={GRID} strokeWidth="1.5" />

            {days.map((d, i) => {
              const x = padL + i * step + (step - barW) / 2;
              const isPos = d.net >= 0;
              const barH = Math.abs(d.net) * scale;
              const y = isPos ? midY - barH : midY;
              const color = isPos ? COLOR_INCOME : COLOR_EXPENSE;
              const showLabel = i === days.length - 1 || d.date === days.reduce((a, b) => (Math.abs(b.net) > Math.abs(a.net) ? b : a)).date;
              return (
                <g key={d.date}>
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(barH, d.net === 0 ? 1.5 : 0)}
                    rx={3}
                    fill={d.net === 0 ? GRID : color}
                    opacity={tooltip && tooltip.lines[0]?.label !== fmtDateShort(d.date) ? 0.55 : 1}
                    onMouseEnter={(e) => {
                      const rect = wrapRef.current?.getBoundingClientRect();
                      const evtRect = (e.target as SVGRectElement).getBoundingClientRect();
                      if (!rect) return;
                      setTooltip({
                        x: evtRect.left - rect.left + evtRect.width / 2,
                        y: evtRect.top - rect.top - 6,
                        lines: [
                          { label: fmtDateShort(d.date), value: "" },
                          { label: "Income", value: fmtRs(d.income), swatch: COLOR_INCOME },
                          { label: "Expense", value: fmtRs(d.expense), swatch: COLOR_EXPENSE },
                          { label: "Net", value: (d.net >= 0 ? "+" : "-") + fmtRs(d.net) },
                        ],
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{ cursor: "pointer" }}
                  />
                  {showLabel && d.net !== 0 && (
                    <text
                      x={x + barW / 2}
                      y={isPos ? y - 4 : y + barH + 11}
                      textAnchor="middle"
                      fontSize="9"
                      fontWeight="700"
                      fontFamily="monospace"
                      fill={INK}
                    >
                      {(isPos ? "+" : "-") + fmtRs(d.net)}
                    </text>
                  )}
                  {(i % 5 === 0 || i === days.length - 1) && (
                    <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize="8.5" fill={INK_MUTED} fontFamily="monospace">
                      {fmtDateShort(d.date)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <ChartTooltip tooltip={tooltip} />
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   2. Expense Breakdown by Category — horizontal bar, magnitude comparison.
   Categorical hue assigned by a FIXED alphabetical order of categories seen
   (never by current rank), so a category keeps its color even as totals shift.
   ============================================================================ */
export function CategoryBreakdownChart({ transactions }: { transactions: ChartTransaction[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const { rows, colorOf } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of transactions) {
      if (t.transaction_type !== "expense") continue;
      totals.set(t.category, (totals.get(t.category) || 0) + t.amount);
    }
    // Fixed order = alphabetical, independent of magnitude, so color never follows rank.
    const alphaOrder = Array.from(totals.keys()).sort((a, b) => a.localeCompare(b));
    const colorMap = new Map<string, string>();
    alphaOrder.forEach((cat, i) => colorMap.set(cat, i < CATEGORICAL.length ? CATEGORICAL[i] : FOLD_OTHER));

    const sorted = Array.from(totals.entries())
      .map(([category, amount]) => ({ category, amount, color: colorMap.get(category) || FOLD_OTHER }))
      .sort((a, b) => b.amount - a.amount);

    return { rows: sorted, colorOf: colorMap };
  }, [transactions]);

  const max = Math.max(1, ...rows.map((r) => r.amount));
  const rowH = 28;
  const W = 560;
  const labelW = 110;
  const barMaxW = W - labelW - 90;

  return (
    <div className="warm-card p-5 rounded-2xl space-y-3">
      <div className="border-b border-[#D6D2C8] pb-3">
        <h3 className="text-sm font-bold text-[#1C1B17]">Where Your Money Goes</h3>
        <span className="text-[10.5px] text-[#8E8A80]">by category, all-time</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-[#8E8A80] py-8 text-center">No expenses logged yet.</p>
      ) : (
        <div ref={wrapRef} className="relative">
          <svg viewBox={`0 0 ${W} ${rows.length * rowH + 8}`} role="img" aria-label="Total expenses grouped by category" className="w-full">
            {rows.map((r, i) => {
              const w = (r.amount / max) * barMaxW;
              const y = i * rowH + 4;
              return (
                <g key={r.category}>
                  <text x={labelW - 8} y={y + rowH / 2 - 6} textAnchor="end" fontSize="10.5" fill={INK} fontWeight="600">
                    {r.category}
                  </text>
                  <rect
                    x={labelW}
                    y={y}
                    width={Math.max(w, 3)}
                    height={18}
                    rx={4}
                    fill={r.color}
                    onMouseEnter={(e) => {
                      const rect = wrapRef.current?.getBoundingClientRect();
                      const evtRect = (e.target as SVGRectElement).getBoundingClientRect();
                      if (!rect) return;
                      setTooltip({
                        x: evtRect.left - rect.left + evtRect.width / 2,
                        y: evtRect.top - rect.top - 6,
                        lines: [{ label: r.category, value: fmtRs(r.amount) }],
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{ cursor: "pointer" }}
                  />
                  <text x={labelW + w + 6} y={y + rowH / 2 - 6 + 4} fontSize="9.5" fontFamily="monospace" fontWeight="700" fill={INK}>
                    {fmtRs(r.amount)}
                  </text>
                </g>
              );
            })}
          </svg>
          <ChartTooltip tooltip={tooltip} />
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   3. Debt Progress — stacked horizontal bar per person: paid (green) vs
   remaining (neutral track). Split into "I Owe" and "Owed To Me" groups.
   ============================================================================ */
function DebtBarGroup({ title, items, accentColor }: { title: string; items: ChartDebt[]; accentColor: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const active = items.filter((d) => !d.is_settled);
  const max = Math.max(1, ...active.map((d) => d.amount));
  const rowH = 32;
  const W = 340;
  const labelW = 78;
  const valueLabelW = 84; // reserved so the value label never clips on the largest bar
  const barMaxW = W - labelW - valueLabelW;

  if (active.length === 0) {
    return (
      <div className="flex-1 min-w-[260px]">
        <p className="text-[11px] font-bold text-[#6B6860] mb-2">{title}</p>
        <p className="text-xs text-[#8E8A80] py-4 text-center border border-dashed border-[#D6D2C8] rounded-lg">All settled</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-[260px]">
      <p className="text-[11px] font-bold text-[#6B6860] mb-2">{title}</p>
      <div ref={wrapRef} className="relative">
        <svg viewBox={`0 0 ${W} ${active.length * rowH + 4}`} role="img" aria-label={`${title}: paid versus remaining per person`} className="w-full">
          {active.map((d, i) => {
            const remaining = d.remaining_amount ?? Math.max(0, d.amount - d.paid_amount);
            const paidW = (d.paid_amount / max) * barMaxW;
            const remW = (remaining / max) * barMaxW;
            const y = i * rowH + 4;
            return (
              <g key={d.person + i}>
                <text x={labelW - 8} y={y + 13} textAnchor="end" fontSize="10" fill={INK} fontWeight="600">
                  {d.person}
                </text>
                {d.paid_amount > 0 && (
                  <rect
                    x={labelW}
                    y={y}
                    width={Math.max(paidW, 2)}
                    height={18}
                    rx={3}
                    fill={COLOR_PAID}
                    onMouseEnter={(e) => {
                      const rect = wrapRef.current?.getBoundingClientRect();
                      const evtRect = (e.target as SVGRectElement).getBoundingClientRect();
                      if (!rect) return;
                      setTooltip({ x: evtRect.left - rect.left + evtRect.width / 2, y: evtRect.top - rect.top - 6, lines: [{ label: `${d.person} — paid`, value: fmtRs(d.paid_amount) }] });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                )}
                <rect
                  x={labelW + paidW + (d.paid_amount > 0 ? 2 : 0)}
                  y={y}
                  width={Math.max(remW, 2)}
                  height={18}
                  rx={3}
                  fill={COLOR_REMAINING}
                  onMouseEnter={(e) => {
                    const rect = wrapRef.current?.getBoundingClientRect();
                    const evtRect = (e.target as SVGRectElement).getBoundingClientRect();
                    if (!rect) return;
                    setTooltip({ x: evtRect.left - rect.left + evtRect.width / 2, y: evtRect.top - rect.top - 6, lines: [{ label: `${d.person} — remaining`, value: fmtRs(remaining) }] });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
                <text x={labelW + paidW + remW + 10} y={y + 13} fontSize="9" fontFamily="monospace" fontWeight="700" fill={accentColor}>
                  {fmtRs(remaining)}
                </text>
              </g>
            );
          })}
        </svg>
        <ChartTooltip tooltip={tooltip} />
      </div>
    </div>
  );
}

export function DebtProgressChart({ debts }: { debts: ChartDebt[] }) {
  const iOwe = debts.filter((d) => d.type === "i_owe");
  const lent = debts.filter((d) => d.type === "lent");

  return (
    <div className="warm-card p-5 rounded-2xl space-y-3">
      <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
        <h3 className="text-sm font-bold text-[#1C1B17]">Debt Progress</h3>
        <div className="flex items-center gap-3 text-[10.5px] text-[#6B6860]">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLOR_PAID }} />Paid</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLOR_REMAINING }} />Remaining</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-6">
        <DebtBarGroup title="I Owe" items={iOwe} accentColor="#DC2626" />
        <DebtBarGroup title="Owed To Me" items={lent} accentColor="#16A34A" />
      </div>
    </div>
  );
}

/* ============================================================================
   4. Savings Goals Progress — gear + personal wishlist, unpaid items only,
   sorted by % complete (closest-to-done first). Fill color = business/personal,
   matching each item's own tab so the chart reads as an extension of it.
   ============================================================================ */
export function SavingsGoalsChart({ gearItems }: { gearItems: ChartGearItem[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const rows = useMemo(() => {
    return gearItems
      .filter((g) => !g.is_paid && g.cost > 0)
      .map((g) => ({ ...g, pct: Math.min(100, (g.saved_amount / g.cost) * 100) }))
      .sort((a, b) => b.pct - a.pct);
  }, [gearItems]);

  const rowH = 34;
  const W = 640;
  const labelW = 150;
  const barMaxW = W - labelW - 60;

  return (
    <div className="warm-card p-5 rounded-2xl space-y-3">
      <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
        <h3 className="text-sm font-bold text-[#1C1B17]">Savings Goals Progress</h3>
        <div className="flex items-center gap-3 text-[10.5px] text-[#6B6860]">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLOR_BUSINESS }} />Business</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLOR_PERSONAL }} />Personal</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-[#8E8A80] py-8 text-center">Everything on your wishlists is already paid off.</p>
      ) : (
        <div ref={wrapRef} className="relative">
          <svg viewBox={`0 0 ${W} ${rows.length * rowH + 4}`} role="img" aria-label="Savings progress toward each unpaid wishlist item" className="w-full">
            {rows.map((r, i) => {
              const y = i * rowH + 4;
              const color = r.kind === "personal" ? COLOR_PERSONAL : COLOR_BUSINESS;
              const fillW = (r.pct / 100) * barMaxW;
              return (
                <g key={r.title}>
                  <text x={labelW - 8} y={y + 13} textAnchor="end" fontSize="10" fill={INK} fontWeight="600">
                    {r.title.length > 20 ? r.title.slice(0, 19) + "…" : r.title}
                  </text>
                  <rect x={labelW} y={y} width={barMaxW} height={16} rx={4} fill={COLOR_REMAINING} opacity={0.5} />
                  <rect
                    x={labelW}
                    y={y}
                    width={Math.max(fillW, r.pct > 0 ? 3 : 0)}
                    height={16}
                    rx={4}
                    fill={color}
                    onMouseEnter={(e) => {
                      const rect = wrapRef.current?.getBoundingClientRect();
                      const evtRect = (e.target as SVGRectElement).getBoundingClientRect();
                      if (!rect) return;
                      setTooltip({
                        x: evtRect.left - rect.left + Math.max(evtRect.width, 20) / 2,
                        y: evtRect.top - rect.top - 6,
                        lines: [
                          { label: r.title, value: `${Math.round(r.pct)}%` },
                          { label: "Saved", value: fmtRs(r.saved_amount) },
                          { label: "Cost", value: fmtRs(r.cost) },
                        ],
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{ cursor: "pointer" }}
                  />
                  <text x={labelW + barMaxW + 8} y={y + 12} fontSize="9.5" fontFamily="monospace" fontWeight="700" fill={INK}>
                    {Math.round(r.pct)}%
                  </text>
                </g>
              );
            })}
          </svg>
          <ChartTooltip tooltip={tooltip} />
        </div>
      )}
    </div>
  );
}
