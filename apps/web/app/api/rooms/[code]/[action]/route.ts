import { roomAction } from '../../../../../lib/rooms/routes.ts';
import { roomsRouteContext } from '../../../../../lib/rooms/server.ts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ code: string; action: string }> }) {
  const { code, action } = await params;
  return roomAction(request, roomsRouteContext(), code, action);
}
