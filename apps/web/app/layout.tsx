import type { Metadata } from 'next';
import { WorkshopAuthProvider } from '@/lib/workshop-auth';
import { ApolloWrapper } from '@/lib/apollo-wrapper';
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
      <body>
        <WorkshopAuthProvider>
          <ApolloWrapper>
            {children}
          </ApolloWrapper>
        </WorkshopAuthProvider>
      </body>
    </html>
  );
}
