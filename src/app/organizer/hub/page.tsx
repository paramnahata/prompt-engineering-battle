import { redirect } from 'next/navigation';
import { homeForRole, requirePageRole } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** Old landing URL: send each organizer to their own home. */
export default async function OrganizerHubPage() {
  const session = await requirePageRole(['admin', 'volunteer', 'judge'], '/organizer/hub');
  redirect(homeForRole(session.role));
}
