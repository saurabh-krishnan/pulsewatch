import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { Card } from './ui';

type Mode = 'healthy' | 'slow' | 'failing';

const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: 'healthy', label: 'Healthy', hint: 'answers 200' },
  { mode: 'slow', label: 'Slow', hint: 'answers after 8s, so it times out' },
  { mode: 'failing', label: 'Failing', hint: 'answers 503' },
];

/**
 * For the live demo: break the demo target on purpose and watch PulseWatch
 * notice. Admin only, and hidden entirely unless the server has demo controls
 * enabled (the endpoint 404s otherwise).
 */
export function DemoControls() {
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const { data, isError } = useQuery({
    queryKey: ['demo-mode'],
    queryFn: async () => (await api.get<{ mode: Mode }>('/demo')).data,
    enabled: can('admin'),
    retry: false,
    refetchInterval: 15_000,
  });

  const setMode = useMutation({
    mutationFn: async (mode: Mode) => (await api.post<{ mode: Mode }>('/demo/mode', { mode })).data,
    onSuccess: (d) => queryClient.setQueryData(['demo-mode'], d),
  });

  if (!can('admin') || isError || !data) return null;

  return (
    <Card className="mt-6 border-dashed">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Demo target</p>
          <p className="text-xs text-slate-500">
            Break it on purpose. The payments-api monitor checks every 30s and goes down
            after two failures, so an incident opens about a minute later.
          </p>
        </div>
        <div className="flex gap-1">
          {MODES.map((m) => (
            <button
              key={m.mode}
              title={m.hint}
              disabled={setMode.isPending}
              onClick={() => setMode.mutate(m.mode)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                data.mode === m.mode
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {setMode.isError && (
        <p className="mt-2 text-xs text-red-700">{errorMessage(setMode.error)}</p>
      )}
    </Card>
  );
}
