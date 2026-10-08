import { redirect } from 'next/navigation';

export default function JudgeLoginRedirect() {
  redirect('/organizer/login?next=/judge/dashboard');
}
