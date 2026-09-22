import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  INCIDENT_STATUSES,
  SEVERITIES,
  type CreateIncidentInput,
  type IncidentFilters,
} from '@pulsewatch/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createIncident, errorMessage, listIncidents, listServices } from '../api/client';
import { useAuth } from '../auth/useAuth';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  IncidentStatusBadge,
  Input,
  Select,
  SeverityBadge,
} from '../components/ui';

function relative(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function IncidentsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<IncidentFilters>({});
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<CreateIncidentInput>>({ severity: 'SEV3' });

  const { data: incidents, isLoading } = useQuery({
    queryKey: ['incidents', filters],
    queryFn: () => listIncidents(filters),
    refetchInterval: 15_000,
  });

  const { data: services } = useQuery({ queryKey: ['services'], queryFn: listServices });

  const create = useMutation({
    mutationFn: createIncident,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      setShowForm(false);
      setForm({ severity: 'SEV3' });
      setError(null);
    },
    onError: (err) => setError(errorMessage(err, 'Could not create the incident')),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate({
      serviceId: Number(form.serviceId),
      title: form.title ?? '',
      description: form.description ?? '',
      severity: form.severity ?? 'SEV3',
      errorType: form.errorType ?? '',
      tags: [],
    });
  }

  function setFilter(key: keyof IncidentFilters, value: string) {
    setFilters((f) => {
      const next = { ...f };
      if (!value) delete next[key];
      else if (key === 'serviceId') next.serviceId = Number(value);
      else Object.assign(next, { [key]: value });
      return next;
    });
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Incidents</h1>
          <p className="mt-1 text-sm text-slate-500">
            Opened automatically when a monitor goes down, or by hand.
          </p>
        </div>
        {can('admin', 'engineer') && (
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New incident'}
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mt-5">
          <form onSubmit={onSubmit} className="space-y-4">
            <ErrorBanner message={error} />
            <Field label="Service">
              <Select
                className="mt-1 w-full"
                value={form.serviceId ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, serviceId: Number(e.target.value) }))}
                required
              >
                <option value="">Select a service…</option>
                {services?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title">
              <Input
                value={form.title ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Checkout returning 500s for card payments"
                required
              />
            </Field>
            <Field label="Description">
              <Input
                value={form.description ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What is happening?"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Severity">
                <Select
                  className="mt-1 w-full"
                  value={form.severity ?? 'SEV3'}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, severity: e.target.value as CreateIncidentInput['severity'] }))
                  }
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Error type" hint="Optional, e.g. DB_TIMEOUT">
                <Input
                  value={form.errorType ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, errorType: e.target.value }))}
                  placeholder="DB_TIMEOUT"
                />
              </Field>
            </div>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create incident'}
            </Button>
          </form>
        </Card>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Select value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          {INCIDENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          value={filters.serviceId ?? ''}
          onChange={(e) => setFilter('serviceId', e.target.value)}
        >
          <option value="">All services</option>
          {services?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select
          value={filters.severity ?? ''}
          onChange={(e) => setFilter('severity', e.target.value)}
        >
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Input
          className="mt-0 w-56"
          placeholder="Search title or description…"
          value={filters.q ?? ''}
          onChange={(e) => setFilter('q', e.target.value)}
        />
      </div>

      {isLoading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {incidents && incidents.length === 0 && (
        <Card className="mt-6">
          <p className="text-sm text-slate-500">
            No incidents match these filters. Break the demo target to produce one.
          </p>
        </Card>
      )}

      <div className="mt-4 space-y-3">
        {incidents?.map((i) => (
          <Link
            key={i.id}
            to={`/incidents/${i.id}`}
            className="block rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400"
          >
            <div className="flex items-center gap-2">
              <SeverityBadge severity={i.severity} />
              <IncidentStatusBadge status={i.status} />
              <span className="font-medium">{i.title}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              INC-{i.id} · {i.serviceName} · {i.source} · opened {relative(i.openedAt)}
              {i.resolvedAt && ` · resolved ${relative(i.resolvedAt)}`}
              {i.errorType && ` · ${i.errorType}`}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
