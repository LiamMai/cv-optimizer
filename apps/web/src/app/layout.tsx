import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import { Navbar } from '@/components/layout/Navbar';
import { AuthInitializer } from '@/components/auth/AuthInitializer';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CVOptimizer – AI-Powered Resume Builder',
  description:
    'Tailor your CV to any job description in minutes. Get ATS scores, keyword analysis, and AI-optimized content.',
  keywords: ['CV builder', 'resume optimizer', 'ATS score', 'job description', 'AI resume'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AuthInitializer />
        <Navbar />
        <main className="min-h-[calc(100vh-57px)]">{children}</main>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#1e293b',
              color: '#f1f5f9',
              borderRadius: '10px',
              fontSize: '14px',
            },
            success: {
              iconTheme: { primary: '#22c55e', secondary: '#f1f5f9' },
            },
            error: {
              iconTheme: { primary: '#ef4444', secondary: '#f1f5f9' },
            },
          }}
        />
      </body>
    </html>
  );
}
