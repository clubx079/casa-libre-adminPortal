import './globals.css';

export const metadata = {
  title: 'Casa Libre — Admin',
  description: 'Casa Libre admin portal',
  // Never indexed (admin.casa-libre.com). Belt and braces with the X-Robots-Tag
  // header in next.config.js.
  robots: { index: false, follow: false, noarchive: true, nosnippet: true, googleBot: { index: false, follow: false } },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
