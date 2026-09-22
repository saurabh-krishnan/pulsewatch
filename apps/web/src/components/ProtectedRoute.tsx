import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Without this, a page refresh would bounce a signed-in user to /login
  // before /auth/me has had a chance to answer.
  if (loading) {
    return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
