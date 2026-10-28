import { z } from 'zod';
import { idSchema, isoTimestampSchema } from './common';

/** Domains per project. A guard against a runaway import, not a plan limit. */
export const MAX_DOMAINS_PER_PROJECT = 50;

/**
 * What the user typed. Shape only: main normalizes it (case, trailing dot, internationalized names) and rejects
 * anything that is not a plain domain name, because that decides what the app will resolve and connect to.
 */
export const domainHostnameInputSchema = z.string().trim().min(1, 'the domain name is required').max(300);

const notesSchema = z.string().trim().max(500);

/** Whether the domain resolves and answers; a 500 is an operational problem, not a connection one. */
export const domainConnectionSchema = z.enum(['connected', 'unreachable', 'unknown']);
export const domainOperationalSchema = z.enum(['healthy', 'degraded', 'failing', 'unknown']);
export const detectedProxySchema = z.enum(['cloudflare', 'cloudfront', 'alb']);

export const domainSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  environmentId: idSchema.nullable(),
  environmentName: z.string().nullable(),
  repositoryId: idSchema.nullable(),
  repositoryName: z.string().nullable(),
  /** The server that serves it; null for a domain that is not on a server of this project (a CDN, a static site). */
  sshHostId: idSchema.nullable(),
  sshHostName: z.string().nullable(),
  hostname: z.string(),
  notes: z.string(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema
});

/**
 * What each kind of check says about the domain, so a list can show one dot per kind without loading the checks.
 * null = there is no such check, or it is switched off.
 */
export const domainCheckStatesSchema = z.object({
  dns: domainOperationalSchema.nullable(),
  tls: domainOperationalSchema.nullable(),
  http: domainOperationalSchema.nullable()
});

/** A domain with the two signals the list shows. They stay "unknown" until its checks have results. */
export const domainSummarySchema = domainSchema.extend({
  connection: domainConnectionSchema,
  operational: domainOperationalSchema,
  checkStates: domainCheckStatesSchema,
  certDaysLeft: z.number().int().nullable(),
  latencyMs: z.number().nullable(),
  proxy: detectedProxySchema.nullable(),
  lastCheckedAt: isoTimestampSchema.nullable()
});

export const listDomainsInputSchema = z.object({ projectId: idSchema });

export const createDomainInputSchema = z.object({
  projectId: idSchema,
  hostname: domainHostnameInputSchema,
  environmentId: idSchema.nullable(),
  repositoryId: idSchema.nullable(),
  sshHostId: idSchema.nullable(),
  notes: notesSchema,
  /** Adds the recommended DNS, certificate and HTTPS checks along with the domain. */
  withDefaultChecks: z.boolean()
});

/** `checksCreated` is false when the recommended checks would have gone over the limit of active checks. */
export const createDomainResultSchema = z.object({ domain: domainSummarySchema, checksCreated: z.boolean() });

export const updateDomainInputSchema = z.object({
  id: idSchema,
  hostname: domainHostnameInputSchema.optional(),
  environmentId: idSchema.nullable().optional(),
  repositoryId: idSchema.nullable().optional(),
  sshHostId: idSchema.nullable().optional(),
  notes: notesSchema.optional()
});

/** Deleting a domain also deletes its checks and their history. */
export const deleteDomainInputSchema = z.object({ id: idSchema, confirmed: z.literal(true) });

// ── Checks ─────────────────────────────────────────────────────────────────
//
// What each kind of check is told. The host is never part of it: a check always looks at the hostname of the
// domain it belongs to, so there is nowhere to type an address to scan.

/** 'warn' is a certificate that is close to expiring; everything else is a plain pass or fail. */
export const checkStatusSchema = z.enum(['ok', 'warn', 'fail']);

export const DNS_RESOLVERS = ['system', '1.1.1.1', '8.8.8.8'] as const;
export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'] as const;

export const dnsCheckConfigSchema = z
  .object({
    resolver: z.enum(DNS_RESOLVERS),
    recordTypes: z.array(z.enum(DNS_RECORD_TYPES)).min(1).max(DNS_RECORD_TYPES.length),
    /** What the records should be. Anything else is reported as drift. */
    expected: z
      .object({
        addresses: z.array(z.union([z.ipv4(), z.ipv6()])).min(1).max(20).optional(),
        /** `exact`: the same set. `includes`: all of these are present, extra ones are fine (round-robin). */
        addressesMode: z.enum(['exact', 'includes']).optional(),
        cname: z.string().trim().toLowerCase().min(1).max(253).optional()
      })
      .optional()
  })
  .superRefine((config, context) => {
    const types = new Set(config.recordTypes);
    if (types.size !== config.recordTypes.length) {
      context.addIssue({ code: 'custom', path: ['recordTypes'], message: 'a record type is repeated' });
    }
    if (config.expected?.addresses !== undefined && !types.has('A') && !types.has('AAAA')) {
      context.addIssue({ code: 'custom', path: ['expected', 'addresses'], message: 'expected addresses need the A or AAAA record type' });
    }
    if (config.expected?.cname !== undefined && !types.has('CNAME')) {
      context.addIssue({ code: 'custom', path: ['expected', 'cname'], message: 'an expected CNAME needs the CNAME record type' });
    }
  });

export const tlsCheckConfigSchema = z.object({ port: z.number().int().min(1).max(65535) });

export const httpCheckConfigSchema = z
  .object({
    scheme: z.enum(['https', 'http']),
    /** Starts with a slash; no spaces and no fragment. The host comes from the domain. */
    path: z
      .string()
      .max(500)
      .regex(/^\/[^\s#]*$/, 'must start with / and contain no spaces or #'),
    method: z.enum(['GET', 'HEAD']),
    expectedStatus: z
      .object({ min: z.number().int().min(100).max(599), max: z.number().int().min(100).max(599) })
      .refine((range) => range.min <= range.max, 'the first status cannot be higher than the last'),
    /** Looked for in the first 64 KB of the page. Only the answer, found or not, is ever kept. */
    expectText: z.string().min(1).max(200).optional()
  })
  .superRefine((config, context) => {
    if (config.expectText !== undefined && config.method !== 'GET') {
      context.addIssue({ code: 'custom', path: ['expectText'], message: 'looking for text needs the GET method' });
    }
  });

// ── Checks: stored, listed and run ─────────────────────────────────────────

export const CHECK_KINDS = ['dns', 'tls', 'http'] as const;
export const checkKindSchema = z.enum(CHECK_KINDS);

export const CHECK_MIN_INTERVAL_SECONDS = 30;
export const CHECK_MAX_INTERVAL_SECONDS = 86_400;
/** Checks that run on their own, per project. Switched-off checks do not count. */
export const MAX_ACTIVE_CHECKS_PER_PROJECT = 20;

const intervalSchema = z.number().int().min(CHECK_MIN_INTERVAL_SECONDS).max(CHECK_MAX_INTERVAL_SECONDS);

export const checkConfigSchema = z.union([dnsCheckConfigSchema, tlsCheckConfigSchema, httpCheckConfigSchema]);

export const checkResultSchema = z.object({
  id: idSchema,
  checkId: idSchema,
  ts: isoTimestampSchema,
  status: checkStatusSchema,
  latencyMs: z.number().nullable(),
  summary: z.string(),
  /** Plain data for the detail view; its shape depends on the kind of check. */
  detail: z.record(z.string(), z.unknown())
});

export const checkSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  domainId: idSchema,
  kind: checkKindSchema,
  /** What the check looks at, built in main from the domain: shown, never edited. */
  target: z.string(),
  config: checkConfigSchema,
  intervalSeconds: intervalSchema,
  enabled: z.boolean(),
  lastResult: checkResultSchema.nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema
});

export const listChecksInputSchema = z.object({ domainId: idSchema });

const newCheckShape = { domainId: idSchema, intervalSeconds: intervalSchema, enabled: z.boolean() };
export const createCheckInputSchema = z.discriminatedUnion('kind', [
  z.object({ ...newCheckShape, kind: z.literal('dns'), config: dnsCheckConfigSchema }),
  z.object({ ...newCheckShape, kind: z.literal('tls'), config: tlsCheckConfigSchema }),
  z.object({ ...newCheckShape, kind: z.literal('http'), config: httpCheckConfigSchema })
]);

/** The kind of a check never changes; a `config` of another kind is refused in main. */
export const updateCheckInputSchema = z.object({
  id: idSchema,
  intervalSeconds: intervalSchema.optional(),
  enabled: z.boolean().optional(),
  config: checkConfigSchema.optional()
});

export const checkIdInputSchema = z.object({ id: idSchema });

/** Deleting a check also deletes its history. */
export const deleteCheckInputSchema = z.object({ id: idSchema, confirmed: z.literal(true) });

export const checkResultsInputSchema = z.object({
  checkId: idSchema,
  limit: z.number().int().min(1).max(200).optional()
});

/** Pushed to the page each time a check finishes, so the lists can follow along without polling. */
export const checkFinishedEventSchema = z.object({
  projectId: idSchema,
  domainId: idSchema,
  checkId: idSchema,
  result: checkResultSchema
});

export type Domain = z.infer<typeof domainSchema>;
export type CheckKind = z.infer<typeof checkKindSchema>;
export type CheckConfig = z.infer<typeof checkConfigSchema>;
export type CheckResult = z.infer<typeof checkResultSchema>;
export type Check = z.infer<typeof checkSchema>;
export type ListChecksInput = z.infer<typeof listChecksInputSchema>;
export type CreateCheckInput = z.infer<typeof createCheckInputSchema>;
export type UpdateCheckInput = z.infer<typeof updateCheckInputSchema>;
export type CheckIdInput = z.infer<typeof checkIdInputSchema>;
export type DeleteCheckInput = z.infer<typeof deleteCheckInputSchema>;
export type CheckResultsInput = z.infer<typeof checkResultsInputSchema>;
export type CheckFinishedEvent = z.infer<typeof checkFinishedEventSchema>;
export type CreateDomainResult = z.infer<typeof createDomainResultSchema>;
export type CheckStatus = z.infer<typeof checkStatusSchema>;
export type DnsCheckConfig = z.infer<typeof dnsCheckConfigSchema>;
export type TlsCheckConfig = z.infer<typeof tlsCheckConfigSchema>;
export type HttpCheckConfig = z.infer<typeof httpCheckConfigSchema>;
export type DomainSummary = z.infer<typeof domainSummarySchema>;
export type DomainCheckStates = z.infer<typeof domainCheckStatesSchema>;
export type DomainConnection = z.infer<typeof domainConnectionSchema>;
export type DomainOperational = z.infer<typeof domainOperationalSchema>;
export type DetectedProxy = z.infer<typeof detectedProxySchema>;
export type ListDomainsInput = z.infer<typeof listDomainsInputSchema>;
export type CreateDomainInput = z.infer<typeof createDomainInputSchema>;
export type UpdateDomainInput = z.infer<typeof updateDomainInputSchema>;
export type DeleteDomainInput = z.infer<typeof deleteDomainInputSchema>;
