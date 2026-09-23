import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getPostmortem } from '../api/client';
import { Button, Card } from './ui';

export function Postmortem({ incidentId }: { incidentId: number }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['postmortem', incidentId],
    queryFn: () => getPostmortem(incidentId),
    enabled: open,
  });

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the textarea below is still selectable.
      setCopied(false);
    }
  }

  return (
    <>
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Postmortem</h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
        >
          {open ? 'Hide' : 'Generate from timeline'}
        </button>
      </div>

      {open && (
        <Card className="mt-3">
          {isLoading && <p className="text-sm text-slate-500">Building…</p>}
          {data && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  Filled in from the timeline. Judgement calls are left blank on purpose.
                </p>
                <Button variant="secondary" onClick={copy}>
                  {copied ? 'Copied' : 'Copy Markdown'}
                </Button>
              </div>
              <textarea
                readOnly
                value={data}
                rows={20}
                className="mt-3 w-full rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs"
              />
            </>
          )}
        </Card>
      )}
    </>
  );
}
