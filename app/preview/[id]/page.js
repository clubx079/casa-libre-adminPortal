import { redirect } from 'next/navigation';
import { activeCountry } from '@/lib/adminCountry';
import { getSession } from '@/lib/auth';
import { listingUrl } from '@/lib/buyerSite';

export const dynamic = 'force-dynamic';

// Old in-admin preview page: every "View" now opens the listing on the public buyer site
// of the active country (casa-libre.com.py/propiedad/<id>, …). Kept as a redirect so any
// link still pointing here goes straight there.
export default function PreviewPage({ params }) {
  if (!getSession()) redirect('/login');
  redirect(listingUrl(activeCountry(), encodeURIComponent(params.id)));
}
