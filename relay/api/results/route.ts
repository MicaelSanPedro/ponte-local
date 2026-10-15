import { NextRequest } from "next/server";
import { Channel, isAdminAuthorized, resultsSince } from "@/lib/ponte-store";

export const dynamic = "force-dynamic";

// GET /api/ponte/results?since=N  (somente admin — header x-ponte-admin)
// Devolve os resultados que o agente postou desde o cursor "since".
export async function GET(req: NextRequest) {
  const token = req.headers.get("x-ponte-admin");
  if (!isAdminAuthorized(token)) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  const url = new URL(req.url);
  const since = Math.max(0, parseInt(url.searchParams.get("since") ?? "0", 10) || 0);
  const channel: Channel = url.searchParams.get("channel") === "test" ? "test" : "prod";
  const results = resultsSince(since, channel);
  const lastId = results.length ? results[results.length - 1].id : since;
  return new Response(JSON.stringify({ ok: true, results, lastId }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
