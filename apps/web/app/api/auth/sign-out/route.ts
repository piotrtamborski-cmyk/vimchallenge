import { authContext } from '../../../../lib/auth/context.ts';
import { signOut } from '../../../../lib/auth/routes.ts';

export const dynamic = 'force-dynamic';

export const POST = (request: Request) => signOut(request, authContext());
