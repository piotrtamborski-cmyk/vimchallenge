import { authContext } from '../../../../../lib/auth/context.ts';
import { verifyEmailLink } from '../../../../../lib/auth/routes.ts';

export const dynamic = 'force-dynamic';

export const POST = (request: Request) => verifyEmailLink(request, authContext());
