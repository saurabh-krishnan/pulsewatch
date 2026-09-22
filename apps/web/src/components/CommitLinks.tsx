import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IncidentCommitDto, LinkCommitInput } from '@pulsewatch/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage, linkCommit } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { Button, Card, ErrorBanner, Field, Input, Select } from '../components/ui';

export function CommitLinks({
  incidentId,
  commits,
}: {
  incidentId: number;
  commits: IncidentCommitDto[];
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<LinkCommitInput>({
    kind: 'fixed_by',
    repo: '',
    commitSha: '',
    prUrl: '',
  });

  const link = useMutation({
    mutationFn: () => linkCommit(incidentId, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident', incidentId] });
      setShowForm(false);
      setForm({ kind: 'fixed_by', repo: '', commitSha: '', prUrl: '' });
      setError(null);
    },
    onError: (err) => setError(errorMessage(err, 'Could not link that commit')),
  });

  if (!can('admin', 'engineer') && commits.length === 0) return null;

  return (
    <>
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Code</h2>
        {can('admin', 'engineer') && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
          >
            {showForm ? 'Cancel' : 'Link a commit or PR'}
          </button>
        )}
      </div>

      <Card className="mt-3">
        {commits.length === 0 && !showForm && (
          <p className="text-sm text-slate-500">
            Nothing linked yet. Recording what caused or fixed an incident is what turns it
            into a postmortem.
          </p>
        )}

        {commits.length > 0 && (
          <ul className="space-y-2">
            {commits.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span
                  className={`rounded border px-1.5 py-0.5 text-xs font-medium ${
                    c.kind === 'caused_by'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {c.kind === 'caused_by' ? 'caused by' : 'fixed by'}
                </span>
                <code className="text-xs">{c.repo}</code>
                {c.commitSha && (
                  <code className="rounded bg-slate-100 px-1 text-xs">
                    {c.commitSha.slice(0, 10)}
                  </code>
                )}
                {c.prUrl && (
                  <a
                    href={c.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline"
                  >
                    pull request
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}

        {showForm && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setError(null);
              link.mutate();
            }}
            className="mt-4 space-y-3 border-t border-slate-100 pt-4"
          >
            <ErrorBanner message={error} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Relationship">
                <Select
                  className="mt-1 w-full"
                  value={form.kind}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, kind: e.target.value as LinkCommitInput['kind'] }))
                  }
                >
                  <option value="fixed_by">Fixed by</option>
                  <option value="caused_by">Caused by</option>
                </Select>
              </Field>
              <Field label="Repository">
                <Input
                  value={form.repo}
                  onChange={(e) => setForm((f) => ({ ...f, repo: e.target.value }))}
                  placeholder="acme/payments-api"
                  required
                />
              </Field>
              <Field label="Commit SHA">
                <Input
                  value={form.commitSha ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, commitSha: e.target.value }))}
                  placeholder="9f2c1ab…"
                />
              </Field>
              <Field label="Pull request URL">
                <Input
                  value={form.prUrl ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, prUrl: e.target.value }))}
                  placeholder="https://github.com/acme/payments-api/pull/412"
                />
              </Field>
            </div>
            <Button type="submit" disabled={link.isPending}>
              {link.isPending ? 'Linking…' : 'Link'}
            </Button>
          </form>
        )}
      </Card>
    </>
  );
}
