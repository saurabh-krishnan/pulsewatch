import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage, getRunbook, updateRunbook } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { Markdown } from '../components/Markdown';
import { Button, Card, ErrorBanner, Field, Input } from '../components/ui';

export function RunbookDetailPage() {
  const { id } = useParams();
  const runbookId = Number(id);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: runbook, isLoading } = useQuery({
    queryKey: ['runbook', runbookId],
    queryFn: () => getRunbook(runbookId),
    enabled: Number.isInteger(runbookId),
  });

  useEffect(() => {
    if (runbook) {
      setTitle(runbook.title);
      setBodyMd(runbook.bodyMd);
    }
  }, [runbook]);

  const save = useMutation({
    mutationFn: () => updateRunbook(runbookId, { title, bodyMd }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runbook', runbookId] });
      queryClient.invalidateQueries({ queryKey: ['runbooks'] });
      setEditing(false);
      setError(null);
    },
    onError: (err) => setError(errorMessage(err, 'Could not save the runbook')),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!runbook) return <p className="text-sm text-slate-500">Runbook not found.</p>;

  return (
    <div className="max-w-3xl">
      <Link to="/runbooks" className="text-sm text-slate-500 hover:underline">
        ← Runbooks
      </Link>

      <div className="mt-2 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{runbook.title}</h1>
          <p className="mt-1 text-xs text-slate-500">
            {runbook.serviceName ? (
              <Link to={`/services/${runbook.serviceId}`} className="underline">
                {runbook.serviceName}
              </Link>
            ) : (
              'General'
            )}{' '}
            · v{runbook.version} · updated {new Date(runbook.updatedAt).toLocaleString()}
            {runbook.updatedByName && ` by ${runbook.updatedByName}`}
          </p>
        </div>
        {can('admin', 'engineer') && (
          <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Cancel' : 'Edit'}
          </Button>
        )}
      </div>

      <div className="mt-4">
        <ErrorBanner message={error} />
      </div>

      {editing ? (
        <Card className="mt-4">
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              save.mutate();
            }}
            className="space-y-4"
          >
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </Field>
            <Field label="Body" hint="Markdown. Saving bumps the version.">
              <textarea
                value={bodyMd}
                onChange={(e) => setBodyMd(e.target.value)}
                rows={20}
                required
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-slate-900"
              />
            </Field>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </form>
        </Card>
      ) : (
        <Card className="mt-4">
          <Markdown>{runbook.bodyMd}</Markdown>
        </Card>
      )}
    </div>
  );
}
