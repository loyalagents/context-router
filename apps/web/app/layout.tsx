import type { Metadata } from 'next';
import { ApolloWrapper } from '@/lib/apollo-wrapper';
import './globals.css';
import LocalSession from '@/components/local/LocalSession';

export const dynamic = 'force-dynamic';

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
      <body>
        {process.env.CONTEXT_ROUTER_WEB_MODE === 'local' ? <LocalSession>{children}</LocalSession> : <ApolloWrapper>{children}</ApolloWrapper>}
      </body>
    </html>
  );
}
