import { NextRequest } from "next/server";
import {
  channelForAgent,
  isAgentAuthorized,
  markSeen,
  pollCommands,
  ponte,
  PONTE_VERSION,
} from "@/lib/ponte-store";

export const dynamic = "force-dynamic";

// GET /api/ponte/poll?cursor=N  (agente, header x-ponte-token)
// O agente pergunta: "tem comando novo pra mim?" e o relay responde.
export async function GET(req: NextRequest) {
  const token = req.headers.get("x-ponte-token");
  if (!isAgentAuthorized(token)) {
    return Response.json(
      { ok: false, error: "Token inválido ou ausente" },
      { status: 401 }
    );
  }
  markSeen();
  const url = new URL(req.url);
  const s = ponte();
  const channel = channelForAgent(token);

  // Primeiro poll do agente (sem cursor): pula o histórico antigo —
  // só vai receber comandos emitidos a partir de agora.
  if (!url.searchParams.has("cursor")) {
    const maxId = s.commands.length ? s.commands[s.commands.length - 1].id : 0;
    return new Response(
      JSON.stringify({
        ok: true,
        commands: [],
        nextCursor: maxId,
        fresh: true,
        pollMs: 1500,
        version: PONTE_VERSION,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      }
    );
  }

  const cursor = Math.max(0, parseInt(url.searchParams.get("cursor") ?? "0", 10) || 0);
  const { commands, nextCursor } = pollCommands(cursor, channel);
  return new Response(
    JSON.stringify({ ok: true, commands, nextCursor, pollMs: 1500, version: PONTE_VERSION, channel }),
    {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    }
  );
}
