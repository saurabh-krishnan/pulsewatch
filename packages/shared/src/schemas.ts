/**
 * Zod schemas shared by the API (request validation) and the web app (form
 * validation). One definition, so the two can never drift apart.
 */
import { z } from 'zod';

export const ROLES = ['admin', 'engineer', 'viewer'] as const;
export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const MONITOR_STATUSES = ['unknown', 'up', 'down', 'paused'] as const;

// ---------- auth ----------

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

// ---------- services ----------

/** Service names are used like identifiers (e.g. 'payments-api'), so keep them tame. */
export const createServiceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-_]*$/, 'Use lowercase letters, numbers, dashes and underscores'),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  isPublic: z.boolean().default(true),
});

export const updateServiceSchema = createServiceSchema.partial();

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

// ---------- monitors ----------

export const createMonitorSchema = z.object({
  url: z.string().trim().url('Enter a full URL including http:// or https://'),
  method: z.enum(HTTP_METHODS).default('GET'),
  // The database CHECK constraint enforces >= 30 too; catching it here gives a
  // readable message instead of a Postgres error.
  intervalSeconds: z.coerce.number().int().min(30, 'Minimum interval is 30 seconds').max(86_400),
  timeoutMs: z.coerce.number().int().min(100).max(60_000),
  expectedStatus: z.coerce.number().int().min(100).max(599),
  failureThreshold: z.coerce.number().int().min(1).max(10),
  recoveryThreshold: z.coerce.number().int().min(1).max(10),
});

export const updateMonitorSchema = createMonitorSchema.partial().extend({
  status: z.enum(MONITOR_STATUSES).optional(),
});

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;

// ---------- incidents ----------

export const SEVERITIES = ['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const;
export const INCIDENT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;

export const SEVERITY_LABELS: Record<(typeof SEVERITIES)[number], string> = {
  SEV1: 'SEV1 · critical, customers affected',
  SEV2: 'SEV2 · major, degraded service',
  SEV3: 'SEV3 · minor, contained',
  SEV4: 'SEV4 · cosmetic or informational',
};

export const createIncidentSchema = z.object({
  serviceId: z.coerce.number().int().positive(),
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().trim().max(5000).optional().or(z.literal('')),
  severity: z.enum(SEVERITIES).default('SEV3'),
  errorType: z.string().trim().max(40).optional().or(z.literal('')),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});

export const resolveIncidentSchema = z.object({
  note: z.string().trim().max(5000).optional().or(z.literal('')),
  /**
   * Which runbooks were tried, and which one worked. This is what feeds the
   * success rates that rank suggestions for the next incident, so it is the
   * single most valuable thing an engineer records here.
   */
  runbooks: z
    .array(
      z.object({
        runbookId: z.coerce.number().int().positive(),
        // null = tried, outcome unknown
        worked: z.boolean().nullable().default(null),
      }),
    )
    .max(20)
    .default([]),
});

// ---------- runbooks ----------

export const createRunbookSchema = z.object({
  // null or omitted means a general runbook that applies to every service.
  serviceId: z.coerce.number().int().positive().nullable().optional(),
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  bodyMd: z.string().trim().min(1, 'A runbook needs a body').max(50_000),
});

export const updateRunbookSchema = createRunbookSchema.partial();

export type CreateRunbookInput = z.infer<typeof createRunbookSchema>;
export type UpdateRunbookInput = z.infer<typeof updateRunbookSchema>;

export const commentSchema = z.object({
  message: z.string().trim().min(1, 'Comment cannot be empty').max(5000),
});

export const updateIncidentSchema = z.object({
  severity: z.enum(SEVERITIES).optional(),
});

export const incidentFiltersSchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  serviceId: z.coerce.number().int().positive().optional(),
  severity: z.enum(SEVERITIES).optional(),
  q: z.string().trim().max(200).optional(),
});

export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;
export type ResolveIncidentInput = z.infer<typeof resolveIncidentSchema>;
export type CommentInput = z.infer<typeof commentSchema>;
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;
export type IncidentFilters = z.infer<typeof incidentFiltersSchema>;

export const MONITOR_DEFAULTS: CreateMonitorInput = {
  url: '',
  method: 'GET',
  intervalSeconds: 60,
  timeoutMs: 5000,
  expectedStatus: 200,
  failureThreshold: 3,
  recoveryThreshold: 2,
};
