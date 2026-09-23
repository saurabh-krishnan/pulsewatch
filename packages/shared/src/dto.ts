/**
 * Response shapes the API returns and the web app consumes.
 * Dates are ISO strings because that is what survives JSON.
 */
import type {
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
  MonitorStatus,
  UserRole,
} from './types.js';

export interface UserDto {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: UserDto;
}

export interface ServiceDto {
  id: number;
  name: string;
  description: string | null;
  ownerId: number | null;
  ownerName: string | null;
  tags: string[];
  isPublic: boolean;
  createdAt: string;
  monitorCount: number;
}

export interface MonitorDto {
  id: number;
  serviceId: number;
  url: string;
  method: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatus: number;
  failureThreshold: number;
  recoveryThreshold: number;
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  nextCheckAt: string;
  lastCheckedAt: string | null;
}

export interface IncidentEventDto {
  id: number;
  type: string;
  message: string | null;
  createdAt: string;
  /** null means the system did it, not a person. */
  userName: string | null;
}

export interface IncidentDto {
  id: number;
  serviceId: number;
  serviceName: string;
  monitorId: number | null;
  monitorUrl: string | null;
  title: string;
  description: string | null;
  errorType: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  source: IncidentSource;
  tags: string[];
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  /** Present on the detail response only. */
  events?: IncidentEventDto[];
  commits?: IncidentCommitDto[];
}

export interface SimilarIncidentDto {
  id: number;
  title: string;
  serviceId: number;
  serviceName: string;
  errorType: string | null;
  severity: IncidentSeverity;
  openedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  /** 0-100+, higher is a stronger match. */
  score: number;
  /** Why it matched, e.g. ["same fingerprint", "same service"]. */
  reasons: string[];
}

export interface SuggestionDto {
  runbookId: number;
  title: string;
  timesTried: number;
  timesWorked: number;
  /** Laplace-smoothed, 0-1. */
  successRate: number;
}

export interface SearchHitDto {
  id: number;
  title: string;
  serviceName: string | null;
  /** Matching fragment, with <b> marks around the terms. */
  snippet: string;
  rank: number;
  meta: string;
}

export interface SearchResponse {
  query: string;
  /** True when full-text found nothing and trigram matching was used instead. */
  fuzzy: boolean;
  incidents: SearchHitDto[];
  runbooks: SearchHitDto[];
}

export interface IncidentCommitDto {
  id: number;
  kind: 'caused_by' | 'fixed_by';
  repo: string;
  commitSha: string | null;
  prUrl: string | null;
}

export interface ServiceHealthDto {
  serviceId: number;
  serviceName: string;
  status: 'up' | 'down' | 'paused' | 'unknown';
  monitors: number;
}

export interface StatsOverviewDto {
  openIncidents: number;
  acknowledgedIncidents: number;
  resolvedLast30Days: number;
  /** Mean time to resolve, last 30 days. null when nothing has been resolved. */
  mttrSeconds: number | null;
  /** Mean time to acknowledge, last 30 days. */
  mttaSeconds: number | null;
  /** Share of fingerprinted incidents whose error had been seen before. */
  repeatRate: number | null;
  repeatCount: number;
  fingerprintedIncidents: number;
  perService: { serviceId: number; serviceName: string; incidents: number; open: number }[];
  health: ServiceHealthDto[];
}

export interface UptimeDayDto {
  day: string;
  total: number;
  successful: number;
  /** null means no checks were recorded that day. */
  uptime: number | null;
}

export interface PublicServiceDto {
  serviceId: number;
  name: string;
  description: string | null;
  status: 'up' | 'down' | 'unknown';
  uptime90d: number | null;
  history: UptimeDayDto[];
}

export interface PublicStatusDto {
  generatedAt: string;
  days: number;
  services: PublicServiceDto[];
}

export interface IngestResponse {
  incidentId: number;
  /** false means it was deduplicated into an existing open incident. */
  created: boolean;
  occurrences: number;
}

export interface ApiKeyDto {
  id: number;
  serviceId: number;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
  /** Only present on creation; never retrievable again. */
  key?: string;
}

export interface RunbookDto {
  id: number;
  serviceId: number | null;
  serviceName: string | null;
  title: string;
  bodyMd: string;
  version: number;
  updatedAt: string;
  updatedByName: string | null;
}

export interface CheckResultDto {
  id: number;
  checkedAt: string;
  success: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
}
