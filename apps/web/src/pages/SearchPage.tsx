import { useQuery } from '@tanstack/react-query';
import type { SearchHitDto } from '@pulsewatch/shared';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { search } from '../api/client';
import { Button, Card, Input } from '../components/ui';

/**
 * ts_headline marks matches with <b>. The API is the only source of this
 * string and Postgres escapes the surrounding content, but rendering it as
 * HTML would still be a habit worth not forming — so the markers are parsed
 * and turned into real elements instead.
 */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(<b>.*?<\/b>)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('<b>') ? (
          <mark key={i} className="rounded bg-amber-200 px-0.5">
            {part.slice(3, -4)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Hit({ hit, to }: { hit: SearchHitDto; to: string }) {
  return (
    <li className="border-t border-slate-100 py-3 first:border-0">
      <Link to={to} className="text-sm font-medium underline decoration-slate-300">
        {hit.title}
      </Link>
      <p className="mt-1 text-xs text-slate-500">{hit.meta}</p>
      <p className="mt-1 text-sm text-slate-600">
        <Highlighted text={hit.snippet} />
      </p>
    </li>
  );
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);

  const { data, isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => search(q),
    enabled: q.trim().length >= 2,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setParams(input.trim() ? { q: input.trim() } : {});
  }

  const total = (data?.incidents.length ?? 0) + (data?.runbooks.length ?? 0);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      <p className="mt-1 text-sm text-slate-500">
        Full-text across incidents and runbooks, including resolution notes.
      </p>

      <form onSubmit={onSubmit} className="mt-5 flex gap-2">
        <Input
          className="mt-0"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="connection pool, timeout, redis…"
          autoFocus
        />
        <Button type="submit">Search</Button>
      </form>

      {q.length >= 2 && (
        <p className="mt-4 text-xs text-slate-500">
          {isFetching ? 'Searching…' : `${total} result${total === 1 ? '' : 's'} for “${q}”`}
          {data?.fuzzy && ' · no exact matches, showing similar titles'}
        </p>
      )}

      {data && data.incidents.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-slate-700">
            Incidents ({data.incidents.length})
          </h2>
          <Card className="mt-2 py-0">
            <ul>
              {data.incidents.map((h) => (
                <Hit key={h.id} hit={h} to={`/incidents/${h.id}`} />
              ))}
            </ul>
          </Card>
        </>
      )}

      {data && data.runbooks.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-slate-700">
            Runbooks ({data.runbooks.length})
          </h2>
          <Card className="mt-2 py-0">
            <ul>
              {data.runbooks.map((h) => (
                <Hit key={h.id} hit={h} to={`/runbooks/${h.id}`} />
              ))}
            </ul>
          </Card>
        </>
      )}

      {data && total === 0 && !isFetching && (
        <Card className="mt-6">
          <p className="text-sm text-slate-500">Nothing matched “{q}”.</p>
        </Card>
      )}
    </div>
  );
}
