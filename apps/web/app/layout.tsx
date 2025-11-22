import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Context Router',
  description: 'Context Router Application',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
