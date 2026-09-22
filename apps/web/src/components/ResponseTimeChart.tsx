import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { listResults } from '../api/client';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ResponseTimeChart({ monitorId }: { monitorId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['results', monitorId],
    queryFn: () => listResults(monitorId),
    // The worker writes on its own schedule, so poll rather than wait for a click.
    refetchInterval: 15_000,
  });

  if (isLoading) return <p className="text-xs text-slate-500">Loading checks…</p>;
  if (!data || data.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No checks recorded yet. Start the worker with <code>npm run dev:worker</code>.
      </p>
    );
  }

  // The API returns newest first; a chart reads left to right.
  const points = [...data].reverse().map((r) => ({
    time: formatTime(r.checkedAt),
    responseTimeMs: r.responseTimeMs,
    success: r.success,
  }));

  const failures = data.filter((r) => !r.success).length;
  const successRate = Math.round(((data.length - failures) / data.length) * 100);
  const avg = Math.round(
    data.reduce((sum, r) => sum + (r.responseTimeMs ?? 0), 0) / Math.max(data.length, 1),
  );

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        Last {data.length} checks · {successRate}% successful · avg {avg}ms
        {failures > 0 && <span className="text-red-600"> · {failures} failed</span>}
      </p>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 5, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={24} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit="ms" width={56} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}
              formatter={(value: number) => [`${value}ms`, 'response time']}
            />
            <Line
              type="monotone"
              dataKey="responseTimeMs"
              stroke="#0f172a"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
