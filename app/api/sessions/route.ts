import { errorResponse, json, uploadSession } from '../../../lib/server/http';
import { getStore } from '../../../lib/server/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() { try { const store = getStore(); return json({ sessions: store.list(), stats: store.stats() }); } catch (error) { return errorResponse(error); } }
export function POST(request: Request) { return uploadSession(request); }
