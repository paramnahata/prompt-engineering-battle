'use client';

import { useEffect, useState } from 'react';

interface UserVM {
  id: string;
  kind: 'admin' | 'volunteer' | 'judge';
  email: string;
  full_name: string;
  active?: boolean;
}

const KIND_LABEL: Record<string, string> = {
  admin: 'Admin',
  volunteer: 'Registration Desk',
  judge: 'Judge',
};

export default function UserManagementClient() {
  const [users, setUsers] = useState<UserVM[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // create form
  const [kind, setKind] = useState<'admin' | 'volunteer' | 'judge'>('volunteer');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      const body = await res.json();
      if (res.ok) setUsers(body.users);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, email, full_name: fullName, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof body.error === 'string' ? body.error : 'Could not create account');
      return;
    }
    setNotice(`Created ${KIND_LABEL[kind]} account for ${email}.`);
    setEmail('');
    setFullName('');
    setPassword('');
    load();
  };

  const resetPassword = async (u: UserVM) => {
    const newPassword = prompt(`New password for ${u.email}:`);
    if (!newPassword || newPassword.length < 6) {
      if (newPassword !== null) alert('Password must be at least 6 characters.');
      return;
    }
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: u.kind, id: u.id, newPassword }),
    });
    if (res.ok) {
      setNotice(`Password updated for ${u.email}.`);
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? 'Failed to update password');
    }
  };

  const removeUser = async (u: UserVM) => {
    if (!confirm(`Remove ${u.email} (${KIND_LABEL[u.kind]})? This can't be undone.`)) return;
    const res = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: u.kind, id: u.id }),
    });
    if (res.ok) {
      setNotice(`Removed ${u.email}.`);
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? 'Failed to remove account');
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Accounts</h1>
      <p className="text-muted text-sm mb-6">
        Create and manage logins for Admin, Registration Desk (volunteer), and Judge portals.
      </p>

      <form onSubmit={createUser} className="peb-card mb-6 flex flex-col gap-3">
        <h2 className="font-medium">Create account</h2>
        <div className="grid grid-cols-2 gap-3">
          <select
            className="bg-surface border border-border rounded-lg p-2"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="volunteer">Registration Desk</option>
            <option value="admin">Admin</option>
            <option value="judge">Judge</option>
          </select>
          <input
            className="bg-surface border border-border rounded-lg p-2"
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
          <input
            className="bg-surface border border-border rounded-lg p-2"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="bg-surface border border-border rounded-lg p-2"
            type="text"
            placeholder="Password (min 6 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-accent-cyan">{notice}</p>}
        <button className="peb-btn-primary self-start">Create</button>
      </form>

      <div className="peb-card">
        <h2 className="font-medium mb-3">Existing accounts</h2>
        {loading ? (
          <p className="text-muted text-sm">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="py-2 pr-2">Name</th>
                <th className="py-2 pr-2">Email</th>
                <th className="py-2 pr-2">Role</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={`${u.kind}-${u.id}`} className="border-b border-border/50">
                  <td className="py-2 pr-2">{u.full_name}</td>
                  <td className="py-2 pr-2">{u.email}</td>
                  <td className="py-2 pr-2">{KIND_LABEL[u.kind]}</td>
                  <td className="py-2 pr-2 text-right space-x-2">
                    <button className="peb-btn-secondary" onClick={() => resetPassword(u)}>
                      Reset password
                    </button>
                    <button
                      className="text-red-400 hover:text-red-300 text-xs"
                      onClick={() => removeUser(u)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
