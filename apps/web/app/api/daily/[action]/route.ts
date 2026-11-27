import { dailyRouteContext } from '../../../../lib/daily/context.ts';
import { dailyAction } from '../../../../lib/daily/routes.ts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  return dailyAction(request, dailyRouteContext(), action);
}
