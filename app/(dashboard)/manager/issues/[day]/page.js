'use client';
// Admin Manager → Open issues → one day (components/manager/OpenIssues.js).
import Link from 'next/link';
import { PageHeader, T } from '@/components/automations/ui';
import OpenIssues from '@/components/manager/OpenIssues';

const nice = (day) => { try { return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch { return day; } };

export default function IssuesDayPage({ params }) {
  const day = String(params?.day || '');
  return (
    <div className="space-y-4 max-w-[980px]">
      <Link href="/manager" className="text-[12.5px] font-medium underline-offset-2 hover:underline" style={{ color: T.textSecondary }}>← Admin Manager</Link>
      <PageHeader title={`Open issues — ${nice(day)}`} />
      <OpenIssues day={day} />
    </div>
  );
}
