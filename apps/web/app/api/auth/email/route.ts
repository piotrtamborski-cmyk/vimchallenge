import { authContext } from '../../../../lib/auth/context.ts';
import { requestEmailLink } from '../../../../lib/auth/routes.ts';

export const dynamic = 'force-dynamic';

export const POST = (request: Request) => requestEmailLink(request, authContext());
