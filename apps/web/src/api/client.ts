import axios, { AxiosError } from 'axios';
import type {
  AuthResponse,
  CheckResultDto,
  CreateMonitorInput,
  CreateServiceInput,
  LoginInput,
  MonitorDto,
  RegisterInput,
  ServiceDto,
  UpdateMonitorInput,
  UserDto,
} from '@pulsewatch/shared';

const TOKEN_KEY = 'pulsewatch.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing can refuse storage; the session still works in memory.
  }
}

/** Requests go to /api and Vite proxies them to the API server in development. */
export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Pulls the API's `{ error: { code, message } }` out of an axios failure. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof AxiosError) {
    const body = err.response?.data as
      | { error?: { message?: string; details?: { path: string; message: string }[] } }
      | undefined;
    const details = body?.error?.details;
    if (details?.length) return details.map((d) => `${d.path}: ${d.message}`).join(', ');
    if (body?.error?.message) return body.error.message;
    if (!err.response) return 'Cannot reach the API. Is it running on port 4000?';
  }
  return fallback;
}

// ---------- health ----------

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  database: 'up' | 'down';
  timestamp: string;
}

export async function getHealth(): Promise<HealthResponse> {
  const { data } = await api.get<HealthResponse>('/health', {
    // 503 means "API is up, database is down". That is an answer, not a failure,
    // so let it through and report it rather than showing "API unreachable".
    validateStatus: (s) => s === 200 || s === 503,
  });
  return data;
}

// ---------- auth ----------

export async function login(input: LoginInput): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/login', input);
  return data;
}

export async function register(input: RegisterInput): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/register', input);
  return data;
}

export async function getMe(): Promise<UserDto> {
  const { data } = await api.get<UserDto>('/auth/me');
  return data;
}

// ---------- services ----------

export async function listServices(): Promise<ServiceDto[]> {
  const { data } = await api.get<ServiceDto[]>('/services');
  return data;
}

export async function getService(id: number): Promise<ServiceDto> {
  const { data } = await api.get<ServiceDto>(`/services/${id}`);
  return data;
}

export async function createService(input: CreateServiceInput): Promise<ServiceDto> {
  const { data } = await api.post<ServiceDto>('/services', input);
  return data;
}

export async function deleteService(id: number): Promise<void> {
  await api.delete(`/services/${id}`);
}

// ---------- monitors ----------

export async function listMonitors(serviceId: number): Promise<MonitorDto[]> {
  const { data } = await api.get<MonitorDto[]>(`/services/${serviceId}/monitors`);
  return data;
}

export async function createMonitor(
  serviceId: number,
  input: CreateMonitorInput,
): Promise<MonitorDto> {
  const { data } = await api.post<MonitorDto>(`/services/${serviceId}/monitors`, input);
  return data;
}

export async function updateMonitor(id: number, input: UpdateMonitorInput): Promise<MonitorDto> {
  const { data } = await api.patch<MonitorDto>(`/monitors/${id}`, input);
  return data;
}

export async function deleteMonitor(id: number): Promise<void> {
  await api.delete(`/monitors/${id}`);
}

export async function listResults(monitorId: number): Promise<CheckResultDto[]> {
  const { data } = await api.get<CheckResultDto[]>(`/monitors/${monitorId}/results`);
  return data;
}
