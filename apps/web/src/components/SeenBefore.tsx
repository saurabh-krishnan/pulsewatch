import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listSimilarIncidents, listSuggestions } from '../api/client';
import { Card, SeverityBadge } from './ui';

function ago(iso: string | null) {
  if (!iso) return 'unresolved';
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * The feature the whole project exists for: past incidents that match this one,
 * each with the reason it matched, and the runbooks that actually fixed them.
 */
export function SeenBefore({ incidentId }: { incidentId: number }) {
  const { data: similar, isLoading } = useQuery({
    queryKey: ['similar', incidentId],
    queryFn: () => listSimilarIncidents(incidentId),
  });

  const { data: suggestions } = useQuery({
    queryKey: ['suggestions', incidentId],
    queryFn: () => listSuggestions(incidentId),
  });

  if (isLoading) return null;
  if (!similar || similar.length === 0) {
    return (
      <>
        <h2 className="mt-8 text-sm font-semibold text-slate-700">Seen before</h2>
        <Card className="mt-3">
          <p className="text-sm text-slate-500">
            No matching past incidents. This looks like a new problem.
          </p>
        </Card>
      </>
    );
  }

  const exact = similar.filter((s) => s.reasons.includes('same fingerprint')).length;

  return (
    <>
      <h2 className="mt-8 text-sm font-semibold text-slate-700">Seen before</h2>

      <Card className="mt-3 border-amber-200 bg-amber-50/40">
        <p className="text-sm font-medium text-slate-800">
          {exact > 0
            ? `Seen ${exact} time${exact === 1 ? '' : 's'} before with the exact same error signature.`
            : `${similar.length} past incident${similar.length === 1 ? '' : 's'} look similar.`}
        </p>

        {suggestions && suggestions.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Suggested fixes
            </p>
            <ul className="mt-2 space-y-2">
              {suggestions.map((s) => (
                <li key={s.runbookId} className="flex items-center justify-between gap-3">
                  <Link
                    to={`/runbooks/${s.runbookId}`}
                    className="text-sm font-medium underline decoration-slate-300"
                  >
                    {s.title}
                  </Link>
                  <span className="shrink-0 text-xs text-slate-600">
                    <span className="font-semibold">{Math.round(s.successRate * 100)}%</span> · fixed{' '}
                    {s.timesWorked} of {s.timesTried}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Success rates are Laplace-smoothed, so one lucky fix does not outrank a proven one.
            </p>
          </div>
        )}

        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Matching incidents
          </p>
          <ul className="mt-2 space-y-3">
            {similar.map((s) => (
              <li key={s.id} className="border-t border-amber-200/60 pt-3 first:border-0 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/incidents/${s.id}`} className="text-sm font-medium underline">
                      INC-{s.id} {s.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {s.serviceName} · resolved {ago(s.resolvedAt)} · {s.reasons.join(' · ')}
                    </p>
                    {s.resolutionNote && (
                      <p className="mt-1 text-xs text-slate-600">&ldquo;{s.resolutionNote}&rdquo;</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <SeverityBadge severity={s.severity} />
                    <span
                      className="rounded bg-slate-900 px-1.5 py-0.5 text-xs font-semibold text-white"
                      title="Match score: fingerprint 50, text similarity up to 25, service 15, error type 10, tag 5, recency 5"
                    >
                      {s.score}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </>
  );
}
