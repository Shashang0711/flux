import { z } from 'zod';

export const RelationshipStatus = { ACTIVE: 'ACTIVE', ENDED: 'ENDED' } as const;
export type RelationshipStatus = (typeof RelationshipStatus)[keyof typeof RelationshipStatus];

/** Format of generated fleet codes: FL-00001. */
export function formatFleetCode(sequence: number): string {
  return `FL-${String(sequence).padStart(5, '0')}`;
}

interface Ref {
  id: string;
  code: string;
  name: string;
}

/** A vessel–client relationship (design pack §14), as seen from either side. */
export interface VesselRelationshipDto {
  id: string;
  vessel: Ref;
  client: Ref;
  relationshipType: Ref;
  isPrimary: boolean;
  status: RelationshipStatus;
  startDate: string | null;
  endDate: string | null;
  /** The fleet of this client the vessel currently belongs to, through this relationship. */
  fleet: Ref | null;
  createdAt: string;
}

export interface FleetDto {
  id: string;
  /** Generated, e.g. FL-00001. */
  code: string;
  name: string;
  client: Ref;
  status: 'ACTIVE' | 'INACTIVE';
  /** Vessels currently in the fleet. */
  vessels: (Ref & { relationshipId: string })[];
  createdAt: string;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** "YYYY-MM-DD", or "" / null for no date. */
export const isoDateSchema = z
  .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')])
  .transform((v, ctx) => {
    if (v === '') return null;
    const d = new Date(`${v}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || !d.toISOString().startsWith(v)) {
      ctx.addIssue({ code: 'custom', message: 'Not a valid date' });
      return z.NEVER;
    }
    return v;
  })
  .nullable()
  .optional();

const optionalUuid = z
  .union([z.literal(''), z.uuid()])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const createRelationshipSchema = z.object({
  clientId: z.uuid({ message: 'Choose a client' }),
  relationshipTypeId: z.uuid({ message: 'Choose a relationship type' }),
  isPrimary: z.boolean().default(false),
  startDate: isoDateSchema,
  /** Optionally place the vessel in one of this client's fleets straight away. */
  fleetId: optionalUuid,
});
export type CreateRelationshipRequest = z.input<typeof createRelationshipSchema>;

export const updateRelationshipSchema = z
  .object({ isPrimary: z.boolean(), startDate: isoDateSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const endRelationshipSchema = z.object({ endDate: isoDateSchema });

/** null removes the vessel from its fleet (for this client). */
export const setRelationshipFleetSchema = z.object({ fleetId: z.uuid().nullable() });

export const createFleetSchema = z.object({
  clientId: z.uuid({ message: 'Choose a client' }),
  name: z.string().trim().min(1, 'Fleet name is required').max(200),
});

export const updateFleetSchema = z
  .object({
    name: z.string().trim().min(1, 'Fleet name is required').max(200),
    status: z.enum(['ACTIVE', 'INACTIVE']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const relationshipListQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'ENDED', 'ALL']).default('ACTIVE'),
});
