import { redirect } from 'next/navigation';

export default function AdminLoginRedirect() {
  redirect('/organizer/login?next=/admin/dashboard');
}
