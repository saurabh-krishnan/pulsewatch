import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Runbook rendering. react-markdown does not evaluate raw HTML by default,
 * so a runbook body cannot inject script into the page.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 text-sm text-slate-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mt-4 text-lg font-semibold text-slate-900" {...p} />,
          h2: (p) => <h2 className="mt-4 text-base font-semibold text-slate-900" {...p} />,
          h3: (p) => <h3 className="mt-3 text-sm font-semibold text-slate-900" {...p} />,
          p: (p) => <p className="leading-relaxed" {...p} />,
          ul: (p) => <ul className="list-disc space-y-1 pl-5" {...p} />,
          ol: (p) => <ol className="list-decimal space-y-1 pl-5" {...p} />,
          code: (p) => (
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs" {...p} />
          ),
          pre: (p) => (
            <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100" {...p} />
          ),
          blockquote: (p) => (
            <blockquote className="border-l-4 border-amber-300 bg-amber-50 py-2 pl-3 text-slate-700" {...p} />
          ),
          a: (p) => <a className="underline" target="_blank" rel="noreferrer" {...p} />,
          table: (p) => <table className="w-full border-collapse text-left text-xs" {...p} />,
          th: (p) => <th className="border border-slate-200 bg-slate-50 px-2 py-1" {...p} />,
          td: (p) => <td className="border border-slate-200 px-2 py-1" {...p} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
