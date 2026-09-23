import axios, { AxiosError } from 'axios';
import type {
  ApiKeyDto,
  AuthResponse,
  CheckResultDto,
  IncidentCommitDto,
  LinkCommitInput,
  PublicStatusDto,
  SearchResponse,
  StatsOverviewDto,
  CreateIncidentInput,
  CreateMonitorInput,
  CreateRunbookInput,
  CreateServiceInput,
  IncidentDto,
  IncidentFilters,
  LoginInput,
  MonitorDto,
  RegisterInput,
  ResolveIncidentInput,
  RunbookDto,
  ServiceDto,
  SimilarIncidentDto,
  SuggestionDto,
  UpdateIncidentInput,
  UpdateMonitorInput,
  UpdateRunbookInput,
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

/**
 * Tokens expire after an hour on purpose. When one does mid-session, every
 * request starts failing with 401; rather than leave the user staring at
 * errors, drop the dead token and send them to sign in again. The /auth/
 * routes are excluded because a 401 there means "wrong password", which the
 * login form handles itself.
 */
api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      error instanceof AxiosError &&
      error.response?.status === 401 &&
      getToken() &&
      !error.config?.url?.startsWith('/auth/')
    ) {
      setToken(null);
      const here = window.location.pathname + window.location.search;
      window.location.assign(`/login?next=${encodeURIComponent(here)}`);
    }
    return Promise.reject(error);
  },
);

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

// ---------- incidents ----------

export async function listIncidents(filters: IncidentFilters = {}): Promise<IncidentDto[]> {
  const { data } = await api.get<IncidentDto[]>('/incidents', { params: filters });
  return data;
}

export async function getIncident(id: number): Promise<IncidentDto> {
  const { data } = await api.get<IncidentDto>(`/incidents/${id}`);
  return data;
}

export async function createIncident(input: CreateIncidentInput): Promise<IncidentDto> {
  const { data } = await api.post<IncidentDto>('/incidents', input);
  return data;
}

export async function acknowledgeIncident(id: number): Promise<IncidentDto> {
  const { data } = await api.post<IncidentDto>(`/incidents/${id}/acknowledge`);
  return data;
}

export async function resolveIncident(
  id: number,
  input: ResolveIncidentInput,
): Promise<IncidentDto> {
  const { data } = await api.post<IncidentDto>(`/incidents/${id}/resolve`, input);
  return data;
}

export async function commentOnIncident(id: number, message: string): Promise<void> {
  await api.post(`/incidents/${id}/comments`, { message });
}

export async function updateIncident(
  id: number,
  input: UpdateIncidentInput,
): Promise<IncidentDto> {
  const { data } = await api.patch<IncidentDto>(`/incidents/${id}`, input);
  return data;
}

// ---------- incident memory ----------

export async function listSimilarIncidents(id: number): Promise<SimilarIncidentDto[]> {
  const { data } = await api.get<SimilarIncidentDto[]>(`/incidents/${id}/similar`);
  return data;
}

export async function listSuggestions(id: number): Promise<SuggestionDto[]> {
  const { data } = await api.get<SuggestionDto[]>(`/incidents/${id}/suggestions`);
  return data;
}

// ---------- stats, status page, postmortem ----------

export async function getStatsOverview(): Promise<StatsOverviewDto> {
  const { data } = await api.get<StatsOverviewDto>('/stats/overview');
  return data;
}

/** Public: deliberately does not send the auth header path through login. */
export async function getPublicStatus(): Promise<PublicStatusDto> {
  const { data } = await api.get<PublicStatusDto>('/public/status');
  return data;
}

export async function getPostmortem(incidentId: number): Promise<string> {
  const { data } = await api.get<string>(`/incidents/${incidentId}/postmortem`, {
    // The endpoint returns Markdown, not JSON.
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  return data;
}

// ---------- search ----------

export async function search(q: string): Promise<SearchResponse> {
  const { data } = await api.get<SearchResponse>('/search', { params: { q } });
  return data;
}

// ---------- git links ----------

export async function linkCommit(
  incidentId: number,
  input: LinkCommitInput,
): Promise<IncidentCommitDto> {
  const { data } = await api.post<IncidentCommitDto>(`/incidents/${incidentId}/commits`, input);
  return data;
}

// ---------- api keys ----------

export async function listApiKeys(serviceId: number): Promise<ApiKeyDto[]> {
  const { data } = await api.get<ApiKeyDto[]>(`/services/${serviceId}/api-keys`);
  return data;
}

export async function createApiKey(serviceId: number): Promise<ApiKeyDto> {
  const { data } = await api.post<ApiKeyDto>(`/services/${serviceId}/api-keys`);
  return data;
}

export async function revokeApiKey(serviceId: number, id: number): Promise<void> {
  await api.delete(`/services/${serviceId}/api-keys/${id}`);
}

// ---------- runbooks ----------

export async function listRunbooks(serviceId?: number): Promise<RunbookDto[]> {
  const { data } = await api.get<RunbookDto[]>('/runbooks', {
    params: serviceId ? { serviceId } : undefined,
  });
  return data;
}

export async function getRunbook(id: number): Promise<RunbookDto> {
  const { data } = await api.get<RunbookDto>(`/runbooks/${id}`);
  return data;
}

export async function createRunbook(input: CreateRunbookInput): Promise<RunbookDto> {
  const { data } = await api.post<RunbookDto>('/runbooks', input);
  return data;
}

export async function updateRunbook(
  id: number,
  input: UpdateRunbookInput,
): Promise<RunbookDto> {
  const { data } = await api.patch<RunbookDto>(`/runbooks/${id}`, input);
  return data;
}
