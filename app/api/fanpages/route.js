import { NextResponse } from 'next/server';
import { listPages } from '@/lib/fanpages';

export const dynamic = 'force-dynamic';

/** GET /api/fanpages: the five pages (no tokens), gated by middleware. */
export async function GET() {
  try {
    const pages = await listPages();
    return NextResponse.json({ pages });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
