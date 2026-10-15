import { NextRequest } from "next/server";
import { isConnected, ponte, PONTE_VERSION } from "@/lib/ponte-store";

export const dynamic = "force-dynamic";

// GET /api/ponte/status  (público — sem segredos, sem conteúdo de arquivos)
// Alimenta o painel de status. Expõe apenas: conectado ou não,
// informações announceadas pela máquina e contadores. NUNCA tokens,
// NUNCA listagens/conteúdos.
export async function GET(_req: NextRequest) {
  const s = ponte();
  const connected = isConnected();
  return new Response(
    JSON.stringify({
      ok: true,
      connected,
      lastSeenAgoS: s.lastSeen ? Math.round((Date.now() - s.lastSeen) / 1000) : null,
      agentInfo: s.agentInfo,
      pending: s.commands.filter((c) => !s.results.some((r) => r.id === c.id)).length,
      totalCommands: s.totalCommands,
      totalResults: s.totalResults,
      uptimeS: Math.round((Date.now() - s.startedAt) / 1000),
      version: PONTE_VERSION,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    }
  );
}
