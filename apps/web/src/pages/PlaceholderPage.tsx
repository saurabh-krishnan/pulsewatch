export function PlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {phase && <p className="mt-1 text-sm text-slate-500">Built in {phase}.</p>}
    </div>
  );
}
