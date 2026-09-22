import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { RegisterPage } from './pages/RegisterPage';
import { ServiceDetailPage } from './pages/ServiceDetailPage';
import { ServicesPage } from './pages/ServicesPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      {/* Public: the status page deliberately needs no login (Phase 6). */}
      <Route path="/status" element={<PlaceholderPage title="Status page" phase="Phase 6" />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="services" element={<ServicesPage />} />
          <Route path="services/:id" element={<ServiceDetailPage />} />
          <Route path="incidents" element={<PlaceholderPage title="Incidents" phase="Phase 3" />} />
          <Route path="runbooks" element={<PlaceholderPage title="Runbooks" phase="Phase 4" />} />
          <Route path="search" element={<PlaceholderPage title="Search" phase="Phase 5" />} />
        </Route>
      </Route>

      <Route path="*" element={<PlaceholderPage title="Not found" phase="" />} />
    </Routes>
  );
}
