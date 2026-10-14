import { z } from 'zod';

/** Official team size: 1 or 2 members. Each member keeps their own contact details. */
const memberSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(254).email().or(z.literal('')).optional(),
  phone: z.string().trim().max(20).regex(/^[+\d\s()-]*$/, 'digits only').optional(),
  gender: z.string().trim().max(20).optional(),
  college: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  branch: z.string().trim().max(80).optional(),
  study_year: z.string().trim().max(20).optional(),
});
export const entryPayloadSchema = z.object({
  team_name: z.string().trim().max(120).optional(),
  members: z.array(memberSchema).min(1, 'A team has at least 1 member').max(2, 'A team has at most 2 members'),
  /** Manual add only: register even if a member's email/phone already exists (after the desk has checked). */
  allow_duplicate: z.boolean().optional(),
});

