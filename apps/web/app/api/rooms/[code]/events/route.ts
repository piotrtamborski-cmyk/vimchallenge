import { roomEvents } from '../../../../../lib/rooms/routes.ts';
import { roomsRouteContext, subscribeRoom } from '../../../../../lib/rooms/server.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return roomEvents(request, roomsRouteContext(), (await params).code, subscribeRoom);
}
