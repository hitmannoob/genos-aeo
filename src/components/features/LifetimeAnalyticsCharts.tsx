import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import type { LifetimeBrandAnalytics } from '@/lib/analytics/brandAnalytics';

interface LifetimeAnalyticsChartsProps {
  lifetimeAnalytics: LifetimeBrandAnalytics;
}

export default function LifetimeAnalyticsCharts({ lifetimeAnalytics }: LifetimeAnalyticsChartsProps) {

  // --- Trend Line Data ---
  const trendData = useMemo(() => {
    return (lifetimeAnalytics.trendData || []).map((point) => ({
      date: point.date,
      mentions: point.brandMentions,
      citations: point.citations,
    }));
  }, [lifetimeAnalytics.trendData]);

  // --- Donut Data for Brand Visibility ---
  const donutData = useMemo(() => {
    const visible = Math.round(lifetimeAnalytics.brandVisibilityScore);
    return [
      { name: 'Visible', value: visible },
      { name: 'Not Visible', value: 100 - visible },
    ];
  }, [lifetimeAnalytics.brandVisibilityScore]);

  // --- Provider Bar Data ---
  const barData = useMemo(() => {
    const stats = lifetimeAnalytics.providerStats;
    return [
      {
        provider: 'ChatGPT',
        mentions: stats.chatgpt.brandMentions,
        citations: stats.chatgpt.citations,
      },
      {
        provider: 'Google',
        mentions: stats.google.brandMentions,
        citations: stats.google.citations,
      },
      {
        provider: 'Perplexity',
        mentions: stats.perplexity.brandMentions,
        citations: stats.perplexity.citations,
      },
    ];
  }, [lifetimeAnalytics.providerStats]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* Trend Line Chart */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">Mentions Over Time</h3>
        {trendData.length === 0 ? (
          <div className="text-center text-muted-foreground">No data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="mentions" stroke="#0D9488" name="Mentions" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
        {trendData.length > 0 && trendData.length < 3 && (
          <div className="text-xs text-muted-foreground mt-2 text-center">
            Not enough data yet! We usually need 2-3 data points to show a clear line chart. More data will be available after next analysis.
          </div>
        )}
      </div>

      {/* Donut Chart for Brand Visibility */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6 flex flex-col items-center justify-center">
        <h3 className="text-lg font-semibold mb-4">Brand Visibility</h3>
        <ResponsiveContainer width={220} height={220}>
          <PieChart>
            <Pie
              data={donutData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              fill="#8884d8"
              labelLine={false}
            >
              {donutData.map((entry, idx) => (
                <Cell key={`cell-${idx}`} fill={idx === 0 ? '#0D9488' : '#E5E7EB'} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div className="mt-4 text-center">
          <span className="text-2xl font-bold text-primary">{donutData[0].value}%</span>
          <span className="ml-2 text-muted-foreground">Visible</span>
        </div>
      </div>

      {/* Provider Comparison Bar Chart (full width) */}
      <div className="md:col-span-2 bg-card rounded-xl border border-border shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">Provider Comparison</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={barData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="provider" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="mentions" fill="#0D9488" name="Mentions" />
            <Bar dataKey="citations" fill="#764F94" name="Citations" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
