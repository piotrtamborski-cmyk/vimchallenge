import { createRoom } from '../../../lib/rooms/routes.ts';
import { roomsRouteContext } from '../../../lib/rooms/server.ts';

export const dynamic = 'force-dynamic';

export const POST = (request: Request) => createRoom(request, roomsRouteContext());
