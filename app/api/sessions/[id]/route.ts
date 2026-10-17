import { assertSameOrigin, errorResponse, json } from '../../../../lib/server/http';
import { getStore } from '../../../../lib/server/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) { try { return json(getStore().get((await context.params).id)); } catch (error) { return errorResponse(error); } }
export async function DELETE(request: Request, context: Context) { try { assertSameOrigin(request); getStore().delete((await context.params).id); return new Response(null, { status: 204 }); } catch (error) { return errorResponse(error); } }
