import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="services" element={<PlaceholderPage title="Services" phase="Phase 1" />} />
        <Route path="incidents" element={<PlaceholderPage title="Incidents" phase="Phase 3" />} />
        <Route path="runbooks" element={<PlaceholderPage title="Runbooks" phase="Phase 4" />} />
        <Route path="search" element={<PlaceholderPage title="Search" phase="Phase 5" />} />
      </Route>
      <Route path="/status" element={<PlaceholderPage title="Status page" phase="Phase 6" />} />
      <Route path="*" element={<PlaceholderPage title="Not found" phase="" />} />
    </Routes>
  );
}
