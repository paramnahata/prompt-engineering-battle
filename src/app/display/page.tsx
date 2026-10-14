import { requirePageRole } from '@/lib/auth/session';
import DisplayScreen from '@/components/display/DisplayScreen';

export const dynamic = 'force-dynamic';

/** Projector screen. Opened by an organizer on the hall laptop (organizer session required). */
export default async function DisplayPage() {
  await requirePageRole(['admin', 'volunteer', 'judge'], '/display');
  return <DisplayScreen />;
}
