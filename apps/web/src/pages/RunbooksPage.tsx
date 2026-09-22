import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createRunbook, errorMessage, listRunbooks, listServices } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { Button, Card, ErrorBanner, Field, Input, Select } from '../components/ui';

const TEMPLATE = `# What this fixes

Describe the symptom that should send someone here.

## Check first
-

## Steps
1.
2.

## If it does not help
Who to escalate to.
`;

export function RunbooksPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [bodyMd, setBodyMd] = useState(TEMPLATE);
  const [error, setError] = useState<string | null>(null);

  const { data: runbooks, isLoading } = useQuery({ queryKey: ['runbooks'], queryFn: () => listRunbooks() });
  const { data: services } = useQuery({ queryKey: ['services'], queryFn: listServices });

  const create = useMutation({
    mutationFn: createRunbook,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runbooks'] });
      setShowForm(false);
      setTitle('');
      setServiceId('');
      setBodyMd(TEMPLATE);
      setError(null);
    },
    onError: (err) => setError(errorMessage(err, 'Could not create the runbook')),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate({ title, bodyMd, serviceId: serviceId ? Number(serviceId) : null });
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Runbooks</h1>
          <p className="mt-1 text-sm text-slate-500">
            Written once, then ranked automatically by how often they actually fix things.
          </p>
        </div>
        {can('admin', 'engineer') && (
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New runbook'}
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mt-5">
          <form onSubmit={onSubmit} className="space-y-4">
            <ErrorBanner message={error} />
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Restart DB connection pool"
                required
              />
            </Field>
            <Field label="Service" hint="Leave blank for a runbook that applies everywhere.">
              <Select
                className="mt-1 w-full"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
              >
                <option value="">General (all services)</option>
                {services?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Body" hint="Markdown.">
              <textarea
                value={bodyMd}
                onChange={(e) => setBodyMd(e.target.value)}
                rows={14}
                required
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-slate-900"
              />
            </Field>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create runbook'}
            </Button>
          </form>
        </Card>
      )}

      {isLoading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {runbooks && runbooks.length === 0 && (
        <Card className="mt-6">
          <p className="text-sm text-slate-500">No runbooks yet.</p>
        </Card>
      )}

      <div className="mt-6 space-y-3">
        {runbooks?.map((r) => (
          <Link
            key={r.id}
            to={`/runbooks/${r.id}`}
            className="block rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{r.title}</span>
              <span className="text-xs text-slate-500">v{r.version}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {r.serviceName ?? 'General'} · updated {new Date(r.updatedAt).toLocaleDateString()}
              {r.updatedByName && ` by ${r.updatedByName}`}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
