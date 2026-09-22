import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createService, errorMessage, listServices } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { Button, Card, ErrorBanner, Field, Input } from '../components/ui';

export function ServicesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: services, isLoading } = useQuery({
    queryKey: ['services'],
    queryFn: listServices,
  });

  const create = useMutation({
    mutationFn: createService,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      setShowForm(false);
      setName('');
      setDescription('');
      setTags('');
      setError(null);
    },
    onError: (err) => setError(errorMessage(err, 'Could not create the service')),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate({
      name,
      description,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      isPublic: true,
    });
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
          <p className="mt-1 text-sm text-slate-500">
            Each service groups the monitors, incidents and runbooks that belong to it.
          </p>
        </div>
        {can('admin') && (
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New service'}
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mt-5">
          <form onSubmit={onSubmit} className="space-y-4">
            <ErrorBanner message={error} />
            <Field label="Name" hint="Lowercase letters, numbers, dashes — e.g. payments-api">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="payments-api"
                required
              />
            </Field>
            <Field label="Description">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this service do?"
              />
            </Field>
            <Field label="Tags" hint="Comma separated.">
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="critical, payments"
              />
            </Field>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create service'}
            </Button>
          </form>
        </Card>
      )}

      {isLoading && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {services && services.length === 0 && (
        <Card className="mt-6">
          <p className="text-sm text-slate-500">
            No services yet.{' '}
            {can('admin')
              ? 'Create one to get started.'
              : 'An admin needs to create the first one.'}
          </p>
        </Card>
      )}

      <div className="mt-6 space-y-3">
        {services?.map((s) => (
          <Link
            key={s.id}
            to={`/services/${s.id}`}
            className="block rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-slate-500">
                {s.monitorCount} monitor{s.monitorCount === 1 ? '' : 's'}
              </span>
            </div>
            {s.description && <p className="mt-1 text-sm text-slate-600">{s.description}</p>}
            {s.tags.length > 0 && (
              <div className="mt-2 flex gap-1">
                {s.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
