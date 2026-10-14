import { NextRequest } from "next/server";
import { channelForAgent, isAgentAuthorized, markSeen, ponte, pushResult } from "@/lib/ponte-store";

export const dynamic = "force-dynamic";

const MAX_BODY = 12_000_000; // 12 MB (resultados podem carregar base64 p/ read_binary)

// POST /api/ponte/result  (agente, header x-ponte-token)
// Corpo: { id, ok, data?, error?, durationMs?, announce? }
// "announce" é enviado junto ao resultado do ping com as infos da máquina.
export async function POST(req: NextRequest) {
  const token = req.headers.get("x-ponte-token");
  if (!isAgentAuthorized(token)) {
    return Response.json(
      { ok: false, error: "Token inválido ou ausente" },
      { status: 401 }
    );
  }
  markSeen();
  const len = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (len > MAX_BODY) {
    return Response.json({ ok: false, error: "Corpo grande demais" }, { status: 413 });
  }
  let body: {
    id?: number;
    ok?: boolean;
    data?: unknown;
    error?: string;
    durationMs?: number;
    announce?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  if (typeof body.id !== "number") {
    return Response.json({ ok: false, error: "Falta o id do comando" }, { status: 400 });
  }
  pushResult({
    id: body.id,
    ok: !!body.ok,
    data: body.data,
    error: body.error,
    durationMs: body.durationMs,
    ts: Date.now(),
    channel: channelForAgent(token),
  });
  if (body.announce && typeof body.announce === "object") {
    ponte().agentInfo = body.announce;
  }
  return Response.json({ ok: true });
}
