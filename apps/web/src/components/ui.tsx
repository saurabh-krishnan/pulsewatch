/** Small shared primitives so pages stay readable. */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-slate-900 text-white hover:bg-slate-700',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
  }[variant];

  return (
    <button
      {...props}
      className={`rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 ${className}`}
    />
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-5 ${className}`}>{children}</div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  up: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  down: 'bg-red-50 text-red-700 border-red-200',
  paused: 'bg-slate-100 text-slate-600 border-slate-200',
  unknown: 'bg-amber-50 text-amber-700 border-amber-200',
};

const SEVERITY_STYLES: Record<string, string> = {
  SEV1: 'bg-red-100 text-red-800 border-red-300',
  SEV2: 'bg-orange-50 text-orange-700 border-orange-200',
  SEV3: 'bg-amber-50 text-amber-700 border-amber-200',
  SEV4: 'bg-slate-100 text-slate-600 border-slate-200',
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-semibold ${
        SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.SEV4
      }`}
    >
      {severity}
    </span>
  );
}

const INCIDENT_STATUS_STYLES: Record<string, string> = {
  open: 'bg-red-50 text-red-700 border-red-200',
  acknowledged: 'bg-blue-50 text-blue-700 border-blue-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export function IncidentStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        INCIDENT_STATUS_STYLES[status] ?? INCIDENT_STATUS_STYLES.open
      }`}
    >
      {status}
    </span>
  );
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 ${className}`}
    />
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? STATUS_STYLES.unknown
      }`}
    >
      {status}
    </span>
  );
}
