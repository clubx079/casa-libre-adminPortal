'use client';
// Old address of the new-campaign form: it lives in the New campaign tab of /campaigns now.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewCampaignRedirect() {
  const router = useRouter();
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('mode');
    router.replace(`/campaigns?tab=new${m ? `&mode=${m}` : ''}`);
  }, [router]);
  return null;
}
