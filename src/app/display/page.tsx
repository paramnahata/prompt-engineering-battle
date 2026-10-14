import { requirePageRole } from '@/lib/auth/session';
import DisplayScreen from '@/components/display/DisplayScreen';

export const dynamic = 'force-dynamic';

/** Projector screen. Shows the access code, so it requires an organizer session. */
export default async function DisplayPage() {
  await requirePageRole(['admin', 'volunteer', 'judge'], '/display');
  return <DisplayScreen />;
}
