"use client";

import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

const COLORS = {
  passed: "#34D399",   // emerald-400
  failed: "#F87171",   // red-400
  healed: "#FBBF24",   // amber-400
  skipped: "#6B7280",  // gray-500
  indigo: "#818CF8",   // indigo-400
  purple: "#A78BFA",   // purple-400
  teal: "#2DD4BF",     // teal-400
  blue: "#60A5FA",     // blue-400
};

const CHART_THEME = {
  bg: "transparent",
  grid: "#1F2937",
  text: "#9CA3AF",
  tooltip_bg: "#111827",
  tooltip_border: "#374151",
};

// Custom tooltip
function CustomTooltip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !payload) return null;
  return (
    <div style={{ background: CHART_THEME.tooltip_bg, border: `1px solid ${CHART_THEME.tooltip_border}`, borderRadius: 8, padding: "8px 12px" }}>
      <p style={{ color: "#fff", fontSize: 12, margin: 0, marginBottom: 4 }}>{label}</p>
      {payload.map((p: Record<string, unknown>, i: number) => (
        <p key={i} style={{ color: p.color, fontSize: 11, margin: 0 }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

// ===== 1. Pass/Fail Trend (last 7 days) =====
export function PassFailTrendChart({ data }: { data: Array<{ date: string; passed: number; failed: number; healed: number }> }) {
  if (!data || data.length === 0) return <EmptyChart label="No run data yet" />;

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-400 mb-3">Pass/fail trend (7 days)</h3>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis dataKey="date" tick={{ fill: CHART_THEME.text, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: CHART_THEME.text, fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="passed" stackId="1" stroke={COLORS.passed} fill={COLORS.passed} fillOpacity={0.3} />
          <Area type="monotone" dataKey="healed" stackId="1" stroke={COLORS.healed} fill={COLORS.healed} fillOpacity={0.3} />
          <Area type="monotone" dataKey="failed" stackId="1" stroke={COLORS.failed} fill={COLORS.failed} fillOpacity={0.3} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ===== 2. Test Type Distribution (Donut) =====
export function TestTypeDonut({ data }: { data: Array<{ name: string; value: number; color: string }> }) {
  if (!data || data.length === 0) return <EmptyChart label="No tests yet" />;

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-400 mb-3">Test distribution</h3>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-3 mt-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: d.color }} />
            <span className="text-[10px] text-gray-400">{d.name} ({d.value})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== 3. Pass Rate Over Time =====
export function PassRateChart({ data }: { data: Array<{ date: string; rate: number }> }) {
  if (!data || data.length === 0) return <EmptyChart label="No run history" />;

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-400 mb-3">Pass rate trend</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis dataKey="date" tick={{ fill: CHART_THEME.text, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fill: CHART_THEME.text, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={<CustomTooltip />} />
          <Line type="monotone" dataKey="rate" stroke={COLORS.indigo} strokeWidth={2} dot={{ fill: COLORS.indigo, r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ===== 4. Top Flaky Tests (bar) =====
export function FlakyTestsBar({ data }: { data: Array<{ name: string; flaky_rate: number }> }) {
  if (!data || data.length === 0) return <EmptyChart label="No flaky tests detected" />;

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-400 mb-3">Top flaky tests</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis type="number" domain={[0, 100]} tick={{ fill: CHART_THEME.text, fontSize: 10 }} axisLine={false} tickFormatter={(v) => `${v}%`} />
          <YAxis type="category" dataKey="name" tick={{ fill: CHART_THEME.text, fontSize: 9 }} axisLine={false} tickLine={false} width={120} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="flaky_rate" fill={COLORS.healed} radius={[0, 4, 4, 0]} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ===== 5. Execution Duration Trend =====
export function DurationTrendChart({ data }: { data: Array<{ date: string; avg_ms: number }> }) {
  if (!data || data.length === 0) return <EmptyChart label="No duration data" />;

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-400 mb-3">Avg execution time</h3>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis dataKey="date" tick={{ fill: CHART_THEME.text, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: CHART_THEME.text, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(1)}s`} />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="avg_ms" stroke={COLORS.teal} fill={COLORS.teal} fillOpacity={0.15} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ===== 6. Priority Distribution (horizontal bar) =====
export function PriorityBar({ data }: { data: Array<{ priority: string; count: number }> }) {
  if (!data || data.length === 0) return <EmptyChart label="No tests yet" />;

  const priorityColors: Record<string, string> = {
    critical: "#EF4444", high: "#F59E0B", medium: "#3B82F6", low: "#6B7280",
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-400 mb-3">Tests by priority</h3>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} layout="vertical">
          <XAxis type="number" tick={{ fill: CHART_THEME.text, fontSize: 10 }} axisLine={false} />
          <YAxis type="category" dataKey="priority" tick={{ fill: CHART_THEME.text, fontSize: 10 }} axisLine={false} tickLine={false} width={70} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20}>
            {data.map((entry, i) => (
              <Cell key={i} fill={priorityColors[entry.priority] || "#6B7280"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ===== 7. API Response Time Distribution =====
export function ApiResponseTimeChart({ data }: { data: Array<{ endpoint: string; avg_ms: number; p95_ms: number }> }) {
  if (!data || data.length === 0) return <EmptyChart label="No API test data" />;

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-400 mb-3">API response times</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis dataKey="endpoint" tick={{ fill: CHART_THEME.text, fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: CHART_THEME.text, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}ms`} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="avg_ms" name="Avg" fill={COLORS.blue} radius={[4, 4, 0, 0]} barSize={16} />
          <Bar dataKey="p95_ms" name="P95" fill={COLORS.purple} radius={[4, 4, 0, 0]} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Empty state
function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-[220px] text-xs text-gray-600">{label}</div>
  );
}
