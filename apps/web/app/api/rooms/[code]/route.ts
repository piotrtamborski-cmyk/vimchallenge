import { roomState } from '../../../../lib/rooms/routes.ts';
import { roomsRouteContext } from '../../../../lib/rooms/server.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return roomState(request, roomsRouteContext(), (await params).code);
}
