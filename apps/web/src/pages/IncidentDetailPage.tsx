import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SEVERITIES, type IncidentEventDto } from '@pulsewatch/shared';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  acknowledgeIncident,
  commentOnIncident,
  errorMessage,
  getIncident,
  listRunbooks,
  resolveIncident,
  updateIncident,
} from '../api/client';
import { useAuth } from '../auth/useAuth';
import { CommitLinks } from '../components/CommitLinks';
import { SeenBefore } from '../components/SeenBefore';
import {
  Button,
  Card,
  ErrorBanner,
  IncidentStatusBadge,
  Input,
  Select,
  SeverityBadge,
} from '../components/ui';

const EVENT_LABELS: Record<string, string> = {
  opened: 'Opened',
  alert_sent: 'Alert sent',
  acknowledged: 'Acknowledged',
  comment: 'Comment',
  runbook_used: 'Runbook used',
  severity_changed: 'Severity changed',
  commit_linked: 'Commit linked',
  resolved: 'Resolved',
};

function TimelineEntry({ event }: { event: IncidentEventDto }) {
  const time = new Date(event.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <li className="relative pl-6">
      <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-slate-400" />
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs text-slate-500">{time}</span>
        <span className="text-sm font-medium">{EVENT_LABELS[event.type] ?? event.type}</span>
        <span className="text-xs text-slate-500">
          {event.userName ? `by ${event.userName}` : 'by system'}
        </span>
      </div>
      {event.message && <p className="mt-0.5 text-sm text-slate-600">{event.message}</p>}
    </li>
  );
}

function duration(from: string, to: string | null) {
  const ms = new Date(to ?? Date.now()).getTime() - new Date(from).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function IncidentDetailPage() {
  const { id } = useParams();
  const incidentId = Number(id);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [note, setNote] = useState('');
  const [showResolve, setShowResolve] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** runbookId -> worked. `undefined` means it was not tried at all. */
  const [runbookOutcomes, setRunbookOutcomes] = useState<Record<number, boolean | null | undefined>>(
    {},
  );

  const { data: incident, isLoading } = useQuery({
    queryKey: ['incident', incidentId],
    queryFn: () => getIncident(incidentId),
    enabled: Number.isInteger(incidentId),
    refetchInterval: 15_000,
  });

  const { data: runbooks } = useQuery({
    queryKey: ['runbooks', incident?.serviceId],
    queryFn: () => listRunbooks(incident!.serviceId),
    enabled: !!incident,
  });

  function setOutcome(runbookId: number, worked: boolean | null | undefined) {
    setRunbookOutcomes((o) => ({ ...o, [runbookId]: worked }));
  }

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['incident', incidentId] });
    queryClient.invalidateQueries({ queryKey: ['incidents'] });
  }

  const onError = (err: unknown) => setError(errorMessage(err, 'That action failed'));

  const ack = useMutation({
    mutationFn: () => acknowledgeIncident(incidentId),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError,
  });

  const resolve = useMutation({
    mutationFn: () =>
      resolveIncident(incidentId, {
        note,
        // Only send the ones actually touched; "not tried" is not a data point.
        runbooks: Object.entries(runbookOutcomes)
          .filter(([, worked]) => worked !== undefined)
          .map(([runbookId, worked]) => ({
            runbookId: Number(runbookId),
            worked: worked as boolean | null,
          })),
      }),
    onSuccess: () => {
      setError(null);
      setNote('');
      setRunbookOutcomes({});
      setShowResolve(false);
      refresh();
    },
    onError,
  });

  const addComment = useMutation({
    mutationFn: () => commentOnIncident(incidentId, comment),
    onSuccess: () => {
      setError(null);
      setComment('');
      refresh();
    },
    onError,
  });

  const changeSeverity = useMutation({
    mutationFn: (severity: (typeof SEVERITIES)[number]) => updateIncident(incidentId, { severity }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError,
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!incident) return <p className="text-sm text-slate-500">Incident not found.</p>;

  const canAct = can('admin', 'engineer') && incident.status !== 'resolved';

  return (
    <div className="max-w-3xl">
      <Link to="/incidents" className="text-sm text-slate-500 hover:underline">
        ← Incidents
      </Link>

      <div className="mt-2 flex items-center gap-2">
        <SeverityBadge severity={incident.severity} />
        <IncidentStatusBadge status={incident.status} />
        <span className="text-xs text-slate-500">INC-{incident.id}</span>
      </div>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{incident.title}</h1>

      <p className="mt-1 text-sm text-slate-500">
        <Link to={`/services/${incident.serviceId}`} className="underline">
          {incident.serviceName}
        </Link>{' '}
        · detected by {incident.source} · open for {duration(incident.openedAt, incident.resolvedAt)}
        {incident.errorType && ` · ${incident.errorType}`}
      </p>

      {incident.description && (
        <Card className="mt-4">
          <p className="whitespace-pre-wrap text-sm text-slate-700">{incident.description}</p>
          {incident.monitorUrl && (
            <p className="mt-2 text-xs text-slate-500">
              Monitor: <code>{incident.monitorUrl}</code>
            </p>
          )}
        </Card>
      )}

      <div className="mt-4">
        <ErrorBanner message={error} />
      </div>

      {can('admin', 'engineer') && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {incident.status === 'open' && (
            <Button onClick={() => ack.mutate()} disabled={ack.isPending}>
              {ack.isPending ? 'Acknowledging…' : 'Acknowledge'}
            </Button>
          )}
          {canAct && (
            <Button variant="secondary" onClick={() => setShowResolve((v) => !v)}>
              {showResolve ? 'Cancel' : 'Resolve'}
            </Button>
          )}
          {canAct && (
            <Select
              value={incident.severity}
              onChange={(e) =>
                changeSeverity.mutate(e.target.value as (typeof SEVERITIES)[number])
              }
              disabled={changeSeverity.isPending}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}

      {showResolve && canAct && (
        <Card className="mt-4">
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              resolve.mutate();
            }}
            className="space-y-4"
          >
            <label className="block text-sm font-medium text-slate-700">
              What fixed it?
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Restarted the DB connection pool"
              />
            </label>

            <div>
              <p className="text-sm font-medium text-slate-700">
                Which runbooks did you try, and did they work?
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                This is what ranks suggestions for the next incident, so it is worth a moment.
              </p>
              <ul className="mt-2 space-y-2">
                {runbooks?.map((r) => {
                  const state = runbookOutcomes[r.id];
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm">{r.title}</span>
                      <div className="flex shrink-0 gap-1">
                        {(
                          [
                            ['not tried', undefined],
                            ['tried', null],
                            ['worked', true],
                            ['did not', false],
                          ] as const
                        ).map(([label, value]) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setOutcome(r.id, value)}
                            className={`rounded border px-2 py-1 text-xs transition-colors ${
                              state === value
                                ? 'border-slate-900 bg-slate-900 text-white'
                                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
                {runbooks?.length === 0 && (
                  <li className="text-xs text-slate-500">
                    No runbooks for this service yet. Write one and it becomes suggestible.
                  </li>
                )}
              </ul>
            </div>

            <Button type="submit" disabled={resolve.isPending}>
              {resolve.isPending ? 'Resolving…' : 'Mark resolved'}
            </Button>
          </form>
        </Card>
      )}

      <SeenBefore incidentId={incidentId} />

      <CommitLinks incidentId={incidentId} commits={incident.commits ?? []} />

      <h2 className="mt-8 text-sm font-semibold text-slate-700">Timeline</h2>
      <Card className="mt-3">
        <ol className="space-y-4 border-l border-slate-200 pl-2">
          {incident.events?.map((e) => <TimelineEntry key={e.id} event={e} />)}
        </ol>

        {can('admin', 'engineer') && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (comment.trim()) addComment.mutate();
            }}
            className="mt-5 flex gap-2 border-t border-slate-100 pt-4"
          >
            <Input
              className="mt-0"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment…"
            />
            <Button type="submit" variant="secondary" disabled={addComment.isPending}>
              Comment
            </Button>
          </form>
        )}
      </Card>

      {incident.resolutionNote && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-slate-700">Resolution</h2>
          <Card className="mt-3">
            <p className="text-sm text-slate-700">{incident.resolutionNote}</p>
          </Card>
        </>
      )}
    </div>
  );
}
