import axios from 'axios';

/** Requests go to /api and Vite proxies them to the API server in development. */
export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  database: 'up' | 'down';
  timestamp: string;
}

export async function getHealth(): Promise<HealthResponse> {
  const { data } = await api.get<HealthResponse>('/health');
  return data;
}
