import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MONITOR_DEFAULTS, type CreateMonitorInput } from '@pulsewatch/shared';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  createMonitor,
  errorMessage,
  getService,
  listMonitors,
  updateMonitor,
} from '../api/client';
import { useAuth } from '../auth/useAuth';
import { ApiKeys } from '../components/ApiKeys';
import { ResponseTimeChart } from '../components/ResponseTimeChart';
import { Button, Card, ErrorBanner, Field, Input, StatusBadge } from '../components/ui';

export function ServiceDetailPage() {
  const { id } = useParams();
  const serviceId = Number(id);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateMonitorInput>(MONITOR_DEFAULTS);
  const [error, setError] = useState<string | null>(null);

  const { data: service, isLoading } = useQuery({
    queryKey: ['service', serviceId],
    queryFn: () => getService(serviceId),
    enabled: Number.isInteger(serviceId),
  });

  const { data: monitors } = useQuery({
    queryKey: ['monitors', serviceId],
    queryFn: () => listMonitors(serviceId),
    enabled: Number.isInteger(serviceId),
    // The worker changes status behind the scenes, so poll for it.
    refetchInterval: 10_000,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['monitors', serviceId] });
    queryClient.invalidateQueries({ queryKey: ['service', serviceId] });
    queryClient.invalidateQueries({ queryKey: ['services'] });
  }

  const create = useMutation({
    mutationFn: (input: CreateMonitorInput) => createMonitor(serviceId, input),
    onSuccess: () => {
      refresh();
      setShowForm(false);
      setForm(MONITOR_DEFAULTS);
      setError(null);
    },
    onError: (err) => setError(errorMessage(err, 'Could not create the monitor')),
  });

  const toggle = useMutation({
    mutationFn: ({ monitorId, paused }: { monitorId: number; paused: boolean }) =>
      // 'unknown' is how the API expresses "resume": the worker decides up/down.
      updateMonitor(monitorId, { status: paused ? 'unknown' : 'paused' }),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err, 'Could not update the monitor')),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate(form);
  }

  function set<K extends keyof CreateMonitorInput>(key: K, value: CreateMonitorInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!service) return <p className="text-sm text-slate-500">Service not found.</p>;

  return (
    <div className="max-w-4xl">
      <Link to="/services" className="text-sm text-slate-500 hover:underline">
        ← Services
      </Link>

      <div className="mt-2 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{service.name}</h1>
          {service.description && (
            <p className="mt-1 text-sm text-slate-600">{service.description}</p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Owner: {service.ownerName ?? 'unassigned'} ·{' '}
            {service.isPublic ? 'shown on status page' : 'private'}
          </p>
        </div>
        {can('admin') && (
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'Add monitor'}
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mt-5">
          <form onSubmit={onSubmit} className="space-y-4">
            <ErrorBanner message={error} />
            <Field label="URL" hint="The endpoint to check, e.g. http://localhost:4100/health">
              <Input
                type="url"
                value={form.url}
                onChange={(e) => set('url', e.target.value)}
                placeholder="http://localhost:4100/health"
                required
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Interval (seconds)" hint="Minimum 30.">
                <Input
                  type="number"
                  min={30}
                  value={form.intervalSeconds}
                  onChange={(e) => set('intervalSeconds', Number(e.target.value))}
                />
              </Field>
              <Field label="Timeout (ms)">
                <Input
                  type="number"
                  min={100}
                  value={form.timeoutMs}
                  onChange={(e) => set('timeoutMs', Number(e.target.value))}
                />
              </Field>
              <Field label="Expected status">
                <Input
                  type="number"
                  value={form.expectedStatus}
                  onChange={(e) => set('expectedStatus', Number(e.target.value))}
                />
              </Field>
              <Field label="Failure threshold" hint="Consecutive failures before DOWN.">
                <Input
                  type="number"
                  min={1}
                  value={form.failureThreshold}
                  onChange={(e) => set('failureThreshold', Number(e.target.value))}
                />
              </Field>
              <Field label="Recovery threshold" hint="Consecutive successes before UP.">
                <Input
                  type="number"
                  min={1}
                  value={form.recoveryThreshold}
                  onChange={(e) => set('recoveryThreshold', Number(e.target.value))}
                />
              </Field>
            </div>

            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add monitor'}
            </Button>
          </form>
        </Card>
      )}

      <ApiKeys serviceId={serviceId} />

      <h2 className="mt-8 text-sm font-semibold text-slate-700">Monitors</h2>
      {!showForm && <ErrorBanner message={error} />}

      {monitors && monitors.length === 0 && (
        <Card className="mt-3">
          <p className="text-sm text-slate-500">
            No monitors yet. Checks begin once the worker runs (Phase 2).
          </p>
        </Card>
      )}

      <div className="mt-3 space-y-3">
        {monitors?.map((m) => (
          <Card key={m.id}>
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusBadge status={m.status} />
                  <code className="truncate text-sm">{m.url}</code>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {m.method} · every {m.intervalSeconds}s · timeout {m.timeoutMs}ms · expect{' '}
                  {m.expectedStatus} · down after {m.failureThreshold} · up after{' '}
                  {m.recoveryThreshold}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {m.lastCheckedAt
                    ? `Last checked ${new Date(m.lastCheckedAt).toLocaleString()}`
                    : 'Never checked yet'}
                </p>
              </div>
              {can('admin') && (
                <Button
                  variant="secondary"
                  disabled={toggle.isPending}
                  onClick={() =>
                    toggle.mutate({ monitorId: m.id, paused: m.status === 'paused' })
                  }
                >
                  {m.status === 'paused' ? 'Resume' : 'Pause'}
                </Button>
              )}
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4">
              <ResponseTimeChart monitorId={m.id} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
