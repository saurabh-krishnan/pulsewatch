import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage, login } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { Button, ErrorBanner, Field, Input } from '../components/ui';

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('admin@pulsewatch.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      signIn(await login({ email, password }));
      // Return the user to wherever they were headed before the redirect.
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Could not sign in'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sign in to PulseWatch</h1>
          <p className="mt-1 text-sm text-slate-500">uptime + incident memory</p>
        </div>

        <ErrorBanner message={error} />

        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </Field>

        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>

        <p className="text-center text-sm text-slate-500">
          No account?{' '}
          <Link to="/register" className="font-medium text-slate-900 underline">
            Create one
          </Link>
        </p>

        <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
          Seeded demo accounts: <code>admin@</code>, <code>engineer@</code>, <code>viewer@</code>
          <wbr />
          <code>pulsewatch.local</code> — password <code>pulsewatch123</code>
        </p>
      </form>
    </div>
  );
}
