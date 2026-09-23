/**
 * Postmortem template built from the incident timeline (guide 7.7).
 *
 * A pure function: it takes an already-loaded incident and returns Markdown.
 * Everything factual is filled in from what actually happened; everything that
 * needs human judgement is left as an explicit blank, because a template that
 * guesses at root cause is worse than one that asks.
 */
export interface PostmortemEvent {
  type: string;
  message: string | null;
  createdAt: string;
  userName: string | null;
}

export interface PostmortemInput {
  id: number;
  title: string;
  serviceName: string;
  severity: string;
  source: string;
  errorType: string | null;
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  events: PostmortemEvent[];
  commits: { kind: string; repo: string; commitSha: string | null; prUrl: string | null }[];
  /** How many past incidents shared this fingerprint. */
  seenBefore: number;
}

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

function hhmm(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

export function formatDuration(fromIso: string, toIso: string | null): string {
  if (!toIso) return 'ongoing';
  const mins = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000);
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export function buildPostmortem(i: PostmortemInput): string {
  const lines: string[] = [];

  lines.push(`# Postmortem: INC-${i.id} ${i.title}`);
  lines.push('');
  lines.push(
    `**Severity:** ${i.severity} · **Duration:** ${formatDuration(i.openedAt, i.resolvedAt)} · ` +
      `**Detected by:** ${i.source}` +
      (i.errorType ? ` · **Error type:** ${i.errorType}` : ''),
  );
  lines.push('');
  lines.push(`**Service:** ${i.serviceName}`);
  lines.push(`**Opened:** ${new Date(i.openedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  if (i.acknowledgedAt) {
    lines.push(`**Time to acknowledge:** ${formatDuration(i.openedAt, i.acknowledgedAt)}`);
  }
  if (i.seenBefore > 1) {
    lines.push('');
    lines.push(
      `> This error signature has been seen **${i.seenBefore} times**. ` +
        'Consider whether the underlying cause is being treated or only the symptom.',
    );
  }

  lines.push('');
  lines.push('## Timeline');
  lines.push('');
  if (i.events.length === 0) {
    lines.push('_No timeline events recorded._');
  } else {
    for (const e of i.events) {
      const who = e.userName ? ` (${e.userName})` : '';
      const label = EVENT_LABELS[e.type] ?? e.type;
      const detail = e.message ? `: ${e.message.replace(/\n/g, ' ')}` : '';
      lines.push(`- ${hhmm(e.createdAt)} ${label}${who}${detail}`);
    }
  }

  if (i.commits.length > 0) {
    lines.push('');
    lines.push('## Code');
    lines.push('');
    for (const c of i.commits) {
      const label = c.kind === 'caused_by' ? 'Caused by' : 'Fixed by';
      const ref = c.commitSha ? `\`${c.repo}@${c.commitSha.slice(0, 10)}\`` : `\`${c.repo}\``;
      lines.push(`- ${label}: ${ref}${c.prUrl ? ` — ${c.prUrl}` : ''}`);
    }
  }

  lines.push('');
  lines.push('## Root cause');
  lines.push('');
  lines.push('_(fill in)_');

  lines.push('');
  lines.push('## Resolution');
  lines.push('');
  lines.push(i.resolutionNote ? i.resolutionNote : '_(fill in)_');

  lines.push('');
  lines.push('## What went well / what went badly');
  lines.push('');
  lines.push('_(fill in)_');

  lines.push('');
  lines.push('## Action items');
  lines.push('');
  lines.push('- [ ] _(fill in)_');
  lines.push('');

  return lines.join('\n');
}
