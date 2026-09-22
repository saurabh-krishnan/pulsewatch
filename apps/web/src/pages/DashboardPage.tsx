import { useQuery } from '@tanstack/react-query';
import { getHealth } from '../api/client';

export function DashboardPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 15_000,
    retry: false,
  });

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">
        Service health grid, open incidents, MTTR and repeat rate land here in Phase 6.
      </p>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-700">API connection</h2>
        {isLoading && <p className="mt-2 text-sm text-slate-500">checking…</p>}
        {isError && (
          <p className="mt-2 text-sm text-[--color-down]">
            Cannot reach the API. Is <code>npm run dev:api</code> running on port 4000?
          </p>
        )}
        {data && (
          <>
            <dl className="mt-3 grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-slate-500">API</dt>
                <dd className="font-medium">{data.status}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Database</dt>
                <dd className="font-medium">{data.database}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Uptime</dt>
                <dd className="font-medium">{data.uptimeSeconds}s</dd>
              </div>
            </dl>
            {data.database === 'down' && (
              <p className="mt-3 text-sm text-slate-500">
                The API is running but cannot reach Postgres. Start it with{' '}
                <code>npm run db:up</code>.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
