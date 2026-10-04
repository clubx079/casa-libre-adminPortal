// The Contacts page moved into UTM Links → "WhatsApp contacts". Old links land there.
import { redirect } from 'next/navigation';

export default function ContactsPage() {
  redirect('/utm-links?tab=contacts');
}
