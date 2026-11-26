import { authContext } from '../../../../lib/auth/context.ts';
import { accountAction } from '../../../../lib/auth/routes.ts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  return accountAction(request, authContext(), (await params).action);
}
