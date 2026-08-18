import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getEmbedding } from "@/lib/ai/orchestrator";
import { hybridSearch } from "@/lib/vector-search";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SearchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).default(10),
  sourceTypes: z
    .array(z.enum(["document", "knowledge", "experience"]))
    .optional(),
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

  const { query, limit, sourceTypes } = parsed.data;

  const startMs = Date.now();
  const queryEmbedding = await getEmbedding(query);

  const results = await hybridSearch(queryEmbedding, query, {
    organizationId: user.organizationId,
    departmentId: user.departmentId,
    userId: user.id,
    limit,
    sourceTypes,
  });

  return NextResponse.json({
    query,
    results,
    totalResults: results.length,
    latencyMs: Date.now() - startMs,
  });
}
