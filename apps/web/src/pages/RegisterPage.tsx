import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage, register } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { Button, ErrorBanner, Field, Input } from '../components/ui';

export function RegisterPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      signIn(await register({ name, email, password }));
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Could not create the account'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Create an account</h1>
          <p className="mt-1 text-sm text-slate-500">
            The first account becomes admin; later ones are engineers.
          </p>
        </div>

        <ErrorBanner message={error} />

        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </Field>

        <Field label="Password" hint="At least 8 characters.">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Creating…' : 'Create account'}
        </Button>

        <p className="text-center text-sm text-slate-500">
          Already have one?{' '}
          <Link to="/login" className="font-medium text-slate-900 underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
