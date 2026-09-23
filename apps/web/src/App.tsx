import { lazy, Suspense, type ComponentType } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { RegisterPage } from './pages/RegisterPage';
import { StatusPage } from './pages/StatusPage';

/**
 * Pages load on demand, so each downloads only what it uses. That matters most
 * for the public status page, which is the first thing a stranger opens and
 * has no use for the charting library (dashboard, service detail) or the
 * Markdown renderer (runbooks). Sign-in and the status page stay in the main
 * bundle because they are the entry points.
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

const DashboardPage = page(() => import('./pages/DashboardPage'), 'DashboardPage');
const ServicesPage = page(() => import('./pages/ServicesPage'), 'ServicesPage');
const ServiceDetailPage = page(() => import('./pages/ServiceDetailPage'), 'ServiceDetailPage');
const IncidentsPage = page(() => import('./pages/IncidentsPage'), 'IncidentsPage');
const IncidentDetailPage = page(() => import('./pages/IncidentDetailPage'), 'IncidentDetailPage');
const RunbooksPage = page(() => import('./pages/RunbooksPage'), 'RunbooksPage');
const RunbookDetailPage = page(() => import('./pages/RunbookDetailPage'), 'RunbookDetailPage');
const SearchPage = page(() => import('./pages/SearchPage'), 'SearchPage');

const loading = <div className="p-8 text-sm text-slate-500">Loading…</div>;

export default function App() {
  return (
    <Suspense fallback={loading}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        {/* Public: the status page deliberately needs no login. */}
        <Route path="/status" element={<StatusPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="services/:id" element={<ServiceDetailPage />} />
            <Route path="incidents" element={<IncidentsPage />} />
            <Route path="incidents/:id" element={<IncidentDetailPage />} />
            <Route path="runbooks" element={<RunbooksPage />} />
            <Route path="runbooks/:id" element={<RunbookDetailPage />} />
            <Route path="search" element={<SearchPage />} />
          </Route>
        </Route>

        <Route path="*" element={<PlaceholderPage title="Not found" phase="" />} />
      </Routes>
    </Suspense>
  );
}
