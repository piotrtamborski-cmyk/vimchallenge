import { authContext } from '../../../../../lib/auth/context.ts';
import { startOAuth } from '../../../../../lib/auth/routes.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  return startOAuth(request, authContext(), (await params).provider);
}
