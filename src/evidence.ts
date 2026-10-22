import { z } from 'zod';

// Validate required interpretation context, then return the original JSON.
// Never strip source-specific fields or turn date-only values into timestamps.
const record = z.looseObject({
  id: z.string(), sourceId: z.string(), authority: z.string(), list: z.string(),
  sourceUrl: z.string(), entityType: z.enum(['person', 'organization', 'vessel', 'aircraft', 'other']),
  names: z.array(z.looseObject({ value: z.string(), kind: z.enum(['primary', 'alias']) })),
  identifiers: z.array(z.looseObject({ type: z.string(), value: z.string() })),
  birthDates: z.array(z.looseObject({ value: z.string(), precision: z.enum(['day', 'month', 'year', 'range', 'unknown']), original: z.string() })),
  addresses: z.array(z.looseObject({})), nationalities: z.array(z.string()),
  designations: z.array(z.looseObject({ category: z.enum(['financial_sanctions', 'export_control', 'debarment', 'other']), programs: z.array(z.string()), legalReferences: z.array(z.string()) })),
  extensions: z.record(z.string(), z.unknown()),
});

export const evidenceSchema = z.looseObject({
  format: z.literal('sanctionskit-evidence@1'),
  result: z.looseObject({
    id: z.uuid(), environment: z.enum(['sandbox', 'production']),
    status: z.enum(['potential_match', 'no_match']), createdAt: z.iso.datetime({ offset: true }),
    matches: z.array(z.looseObject({
      record, score: z.number().min(0).max(100), conflicts: z.array(z.string()),
      evidence: z.array(z.looseObject({ field: z.string(), queryValue: z.string(), sourceValue: z.string(), method: z.string(), contribution: z.number(), explanation: z.string() })),
    })),
    coverage: z.array(z.looseObject({ sourceId: z.string(), version: z.string(), retrievedAt: z.iso.datetime({ offset: true }), fresh: z.boolean() })),
    versions: z.looseObject({ dataset: z.string(), matchingEngine: z.string(), policy: z.string() }),
    disclaimer: z.string().min(1),
  }),
  retention: z.enum(['standard', 'minimal']), expires_at: z.iso.datetime({ offset: true }).nullable(),
  subject: z.looseObject({}).nullable(), reference: z.string().nullable(), request: z.looseObject({}).nullable(),
  retainedInputs: z.boolean(), replayLimit: z.string().nullable(),
});

export type RetainedEvidence = z.infer<typeof evidenceSchema>;

export function validEvidence(value: unknown, id: string, environment: 'sandbox' | 'production'): value is RetainedEvidence {
  const parsed = evidenceSchema.safeParse(value);
  if (!parsed.success) return false;
  const evidence = parsed.data;
  const result = evidence.result;
  if (result.id !== id || result.environment !== environment) return false;
  if ((result.status === 'no_match') !== (result.matches.length === 0)) return false;
  if (evidence.retainedInputs !== (evidence.subject !== null && evidence.request !== null)) return false;
  if (evidence.retention === 'minimal' && (evidence.retainedInputs || evidence.subject !== null || evidence.request !== null || evidence.reference !== null || !evidence.replayLimit)) return false;
  return true;
}
