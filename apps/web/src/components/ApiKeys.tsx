import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createApiKey, errorMessage, listApiKeys, revokeApiKey } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { Button, Card, ErrorBanner } from './ui';

export function ApiKeys({ serviceId }: { serviceId: number }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: keys } = useQuery({
    queryKey: ['api-keys', serviceId],
    queryFn: () => listApiKeys(serviceId),
    enabled: can('admin'),
  });

  const create = useMutation({
    mutationFn: () => createApiKey(serviceId),
    onSuccess: (k) => {
      setFreshKey(k.key ?? null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['api-keys', serviceId] });
    },
    onError: (err) => setError(errorMessage(err, 'Could not create a key')),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => revokeApiKey(serviceId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys', serviceId] }),
    onError: (err) => setError(errorMessage(err, 'Could not revoke that key')),
  });

  // Keys are an admin concern; engineers and viewers never see this section.
  if (!can('admin')) return null;

  return (
    <>
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">API keys</h2>
        <Button variant="secondary" onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'New key'}
        </Button>
      </div>

      <Card className="mt-3">
        <p className="text-sm text-slate-500">
          For applications reporting their own errors to <code>POST /api/ingest/errors</code>.
          Keys are stored hashed, so a leaked database contains no working credentials.
        </p>

        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>

        {freshKey && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-900">
              Copy this now — it is never shown again.
            </p>
            <code className="mt-1 block break-all text-xs">{freshKey}</code>
            <button
              onClick={() => setFreshKey(null)}
              className="mt-2 text-xs underline"
              type="button"
            >
              Done
            </button>
          </div>
        )}

        {keys && keys.length > 0 && (
          <ul className="mt-4 space-y-2">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <code className="text-xs">{k.prefix}…</code>
                  <span className="ml-2 text-xs text-slate-500">
                    created {new Date(k.createdAt).toLocaleDateString()}
                    {k.revokedAt && ' · revoked'}
                  </span>
                </span>
                {!k.revokedAt && (
                  <button
                    onClick={() => revoke.mutate(k.id)}
                    className="text-xs text-red-700 underline"
                    type="button"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {keys && keys.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">No keys yet.</p>
        )}
      </Card>
    </>
  );
}
