import './globals.css';

export const metadata = {
  title: 'Casa Libre — Admin',
  description: 'Casa Libre admin portal',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
