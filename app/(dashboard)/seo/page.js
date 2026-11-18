// The SEO pipeline now lives in Admin Manager → AI SEO → Pipeline (components/seo/SeoPipeline.js).
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function SeoPage() {
  redirect('/manager#seo');
}
