"use client";

import {
  PassFailTrendChart,
  TestTypeDonut,
  PassRateChart,
  FlakyTestsBar,
  DurationTrendChart,
  PriorityBar,
} from "@/components/charts/dashboard-charts";

interface DashboardChartsProps {
  trendData: Array<{ date: string; passed: number; failed: number; healed: number }>;
  typeData: Array<{ name: string; value: number; color: string }>;
  passRateData: Array<{ date: string; rate: number }>;
  priorityData: Array<{ priority: string; count: number }>;
}

export function DashboardCharts({ trendData, typeData, passRateData, priorityData }: DashboardChartsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <PassFailTrendChart data={trendData} />
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <TestTypeDonut data={typeData} />
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <PassRateChart data={passRateData} />
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <PriorityBar data={priorityData} />
      </div>
    </div>
  );
}
