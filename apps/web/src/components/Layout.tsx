import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/services', label: 'Services' },
  { to: '/incidents', label: 'Incidents' },
  { to: '/runbooks', label: 'Runbooks' },
  { to: '/search', label: 'Search' },
  { to: '/status', label: 'Status page' },
];

export function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-full bg-slate-50 text-slate-900">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="px-5 py-5">
          <span className="text-lg font-semibold tracking-tight">PulseWatch</span>
          <p className="text-xs text-slate-500">uptime + incident memory</p>
        </div>

        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {user && (
          <div className="mt-auto border-t border-slate-200 px-5 py-4">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="text-xs text-slate-500">{user.role}</p>
            <button
              onClick={() => {
                signOut();
                navigate('/login', { replace: true });
              }}
              className="mt-2 text-xs font-medium text-slate-600 underline hover:text-slate-900"
            >
              Sign out
            </button>
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
