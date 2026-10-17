import { saveReview } from '../../../../../lib/server/http';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) { return saveReview(request, (await context.params).id); }
