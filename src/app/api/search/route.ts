import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { hybridSearch } from "@/lib/rag/search";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SearchSchema = z.object({
  query: z.string().min(1).max(500),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.SEARCH_USE)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ error: "کاربر به سازمانی تعلق ندارد" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "درخواست نامعتبر" }, { status: 400 });
  }

  const parsed = SearchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "پارامترهای جستجو نامعتبر است" }, { status: 400 });
  }

  const { query } = parsed.data;

  const startMs = Date.now();
  const chunks = await hybridSearch(user.organizationId, query);

  const results = chunks.map((chunk) => ({
    id: chunk.id,
    sourceId: chunk.sourceId,
    sourceType: chunk.sourceType,
    title: chunk.sourceTitle,
    content: chunk.content,
    pageNumber: chunk.page,
    section: chunk.section,
    relevanceScore: chunk.fusedScore,
    excerpt: chunk.content.slice(0, 300),
  }));

  return NextResponse.json({
    query,
    results,
    totalResults: results.length,
    latencyMs: Date.now() - startMs,
  });
}
