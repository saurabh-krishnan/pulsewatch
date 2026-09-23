import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { getHealth, getStatsOverview, listIncidents } from '../api/client';
import { Card, IncidentStatusBadge, SeverityBadge, StatusBadge } from '../components/ui';

function humanDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export function DashboardPage() {
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: getStatsOverview,
    refetchInterval: 20_000,
  });

  const { data: open } = useQuery({
    queryKey: ['incidents', { status: 'open' }],
    queryFn: () => listIncidents({}),
    refetchInterval: 20_000,
  });

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 30_000,
    retry: false,
  });

  const active = open?.filter((i) => i.status !== 'resolved') ?? [];

  return (
    <div className="max-w-5xl">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Everything at a glance. Metrics cover the last 30 days.
          </p>
        </div>
        {health && (
          <p className="text-xs text-slate-500">
            API {health.status} · database {health.database}
          </p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric
          label="Open incidents"
          value={String((stats?.openIncidents ?? 0) + (stats?.acknowledgedIncidents ?? 0))}
          hint={`${stats?.acknowledgedIncidents ?? 0} acknowledged`}
        />
        <Metric
          label="MTTR"
          value={humanDuration(stats?.mttrSeconds ?? null)}
          hint="mean time to resolve"
        />
        <Metric
          label="MTTA"
          value={humanDuration(stats?.mttaSeconds ?? null)}
          hint="mean time to acknowledge"
        />
        <Metric
          label="Repeat rate"
          value={stats?.repeatRate === null || stats === undefined ? '—' : `${Math.round(stats.repeatRate * 100)}%`}
          hint={
            stats
              ? `${stats.repeatCount} of ${stats.fingerprintedIncidents} had been seen before`
              : undefined
          }
        />
      </div>

      <h2 className="mt-8 text-sm font-semibold text-slate-700">Service health</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stats?.health.map((h) => (
          <Link
            key={h.serviceId}
            to={`/services/${h.serviceId}`}
            className="rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{h.serviceName}</span>
              <StatusBadge status={h.status} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {h.monitors} monitor{h.monitors === 1 ? '' : 's'}
            </p>
          </Link>
        ))}
        {stats?.health.length === 0 && (
          <Card>
            <p className="text-sm text-slate-500">No services yet.</p>
          </Card>
        )}
      </div>

      <h2 className="mt-8 text-sm font-semibold text-slate-700">Open incidents</h2>
      <Card className="mt-3">
        {active.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing open. Everything is green.</p>
        ) : (
          <ul className="space-y-3">
            {active.map((i) => (
              <li key={i.id} className="flex items-center gap-2">
                <SeverityBadge severity={i.severity} />
                <IncidentStatusBadge status={i.status} />
                <Link to={`/incidents/${i.id}`} className="text-sm font-medium underline">
                  {i.title}
                </Link>
                <span className="text-xs text-slate-500">{i.serviceName}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <h2 className="mt-8 text-sm font-semibold text-slate-700">Incidents per service</h2>
      <Card className="mt-3">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={stats?.perService ?? []}
              margin={{ top: 5, right: 8, bottom: 0, left: -24 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="serviceName" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}
              />
              <Bar dataKey="incidents" fill="#0f172a" radius={[3, 3, 0, 0]} name="incidents" />
              <Bar dataKey="open" fill="#dc2626" radius={[3, 3, 0, 0]} name="still open" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
