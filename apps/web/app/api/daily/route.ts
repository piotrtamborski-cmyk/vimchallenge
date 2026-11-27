import { dailyRouteContext } from '../../../lib/daily/context.ts';
import { dailyState } from '../../../lib/daily/routes.ts';

export const dynamic = 'force-dynamic';

export const GET = (request: Request) => dailyState(request, dailyRouteContext());
