import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const { chatId } = await params;
  const token = process.env.LINQ_API_TOKEN?.trim();
  if (!token) return NextResponse.json({ error: "Missing LINQ_API_TOKEN" }, { status: 503 });

  try {
    const res = await fetch(`https://api.linqapp.com/api/partner/v3/chats/${chatId}/messages`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = (json as { message?: string; error?: { message?: string } })?.message
        ?? (json as { error?: { message?: string } })?.error?.message
        ?? `Linq API error ${res.status}`;
      return NextResponse.json({ error: msg }, { status: res.status });
    }
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch group chat" },
      { status: 500 },
    );
  }
}
