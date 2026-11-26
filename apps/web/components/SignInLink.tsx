'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

/** "Sign in", coming back to the page it was clicked on (the layout stays while pages change). */
export function SignInLink({ className, children = 'Sign in' }: { className?: string; children?: React.ReactNode }) {
  const path = usePathname();
  const search = useSearchParams().toString();
  const here = path + (search ? `?${search}` : '');
  const href = path === '/' || path.startsWith('/sign-in') ? '/sign-in' : `/sign-in?next=${encodeURIComponent(here)}`;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
