import { NextResponse } from "next/server";
import { withHandler } from "@/lib/core";
import { getKeywordCatalog } from "@/lib/sdk/keywords";

export const GET = withHandler(async () => {
  const catalog = getKeywordCatalog();
  const grouped: Record<string, typeof catalog> = {};
  for (const kw of catalog) {
    if (!grouped[kw.category]) grouped[kw.category] = [];
    grouped[kw.category].push(kw);
  }
  return NextResponse.json({ data: { keywords: catalog, by_category: grouped, total: catalog.length } });
});
