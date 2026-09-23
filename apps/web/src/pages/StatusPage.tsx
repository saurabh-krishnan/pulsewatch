import { useQuery } from '@tanstack/react-query';
import type { PublicServiceDto, UptimeDayDto } from '@pulsewatch/shared';
import { getPublicStatus } from '../api/client';

/**
 * Public status page (guide Phase 6 step 3). No login, no navigation into the
 * app, and nothing here exposes monitor URLs, error text or incident detail.
 */

const GOOD = 0.999;
const DEGRADED = 0.95;

function barColour(day: UptimeDayDto): string {
  if (day.uptime === null) return 'bg-slate-200';
  if (day.uptime >= GOOD) return 'bg-emerald-500';
  if (day.uptime >= DEGRADED) return 'bg-amber-400';
  return 'bg-red-500';
}

function dayTitle(day: UptimeDayDto): string {
  if (day.uptime === null) return `${day.day}: no data`;
  return `${day.day}: ${(day.uptime * 100).toFixed(2)}% (${day.successful}/${day.total} checks)`;
}

function StatusPill({ status }: { status: PublicServiceDto['status'] }) {
  const styles = {
    up: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    down: 'bg-red-50 text-red-700 border-red-200',
    unknown: 'bg-slate-100 text-slate-600 border-slate-200',
  }[status];
  const label = { up: 'Operational', down: 'Outage', unknown: 'Unknown' }[status];
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${styles}`}>
      {label}
    </span>
  );
}

export function StatusPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-status'],
    queryFn: getPublicStatus,
    refetchInterval: 60_000,
    retry: false,
  });

  const allUp = data?.services.every((s) => s.status === 'up') ?? false;

  return (
    <div className="min-h-full bg-slate-50 py-12">
      <div className="mx-auto w-full max-w-3xl px-6">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">PulseWatch Status</h1>
            <p className="mt-1 text-sm text-slate-500">
              Uptime for the last {data?.days ?? 90} days.
            </p>
          </div>
          {data && (
            <p className="text-xs text-slate-400">
              Updated {new Date(data.generatedAt).toLocaleTimeString()}
            </p>
          )}
        </header>

        {data && data.services.length > 0 && (
          <div
            className={`mt-6 rounded-lg border p-4 ${
              allUp ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
            }`}
          >
            <p className="text-sm font-medium">
              {allUp ? 'All systems operational' : 'Some systems are affected'}
            </p>
          </div>
        )}

        {isLoading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}
        {isError && (
          <p className="mt-6 text-sm text-red-700">Status is temporarily unavailable.</p>
        )}

        <div className="mt-6 space-y-4">
          {data?.services.map((s) => (
            <section key={s.serviceId} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-medium">{s.name}</h2>
                  {s.description && (
                    <p className="mt-0.5 text-sm text-slate-500">{s.description}</p>
                  )}
                </div>
                <StatusPill status={s.status} />
              </div>

              {/* 90 bars, oldest on the left. */}
              <div className="mt-4 flex gap-[2px]" aria-label={`${s.name} daily uptime`}>
                {s.history.map((d) => (
                  <div
                    key={d.day}
                    title={dayTitle(d)}
                    className={`h-8 flex-1 rounded-[1px] ${barColour(d)}`}
                  />
                ))}
              </div>

              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>{s.history.length} days ago</span>
                <span className="font-medium text-slate-700">
                  {s.uptime90d === null ? 'no data' : `${(s.uptime90d * 100).toFixed(2)}% uptime`}
                </span>
                <span>today</span>
              </div>
            </section>
          ))}
        </div>

        {data && data.services.length === 0 && (
          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">No public services are being monitored yet.</p>
          </div>
        )}

        <footer className="mt-10 flex items-center justify-between text-xs text-slate-400">
          <span>Powered by PulseWatch</span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-emerald-500" /> operational
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-amber-400" /> degraded
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-red-500" /> outage
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-slate-200" /> no data
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
