import { NextRequest } from "next/server";
import { addCommand, isAdminAuthorized } from "@/lib/ponte-store";

const MAX_BODY = 12_000_000; // 12 MB (comandos podem carregar base64 p/ write_binary)

export const dynamic = "force-dynamic";

// POST /api/ponte/cmd  (somente admin — header x-ponte-admin)
// Corpo: { action: string, args?: object }
// Injeta um comando na fila que o agente vai buscar no próximo poll.
export async function POST(req: NextRequest) {
  const token = req.headers.get("x-ponte-admin");
  if (!isAdminAuthorized(token)) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  let body: { action?: string; args?: Record<string, unknown>; channel?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  if (!body.action || typeof body.action !== "string") {
    return Response.json({ ok: false, error: "Falta a ação" }, { status: 400 });
  }
  const channel = body.channel === "test" ? "test" : "prod";
  try {
    const cmd = addCommand(body.action, body.args, channel);
    return Response.json({ ok: true, id: cmd.id, channel });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Erro ao enfileirar" },
      { status: 429 }
    );
  }
}
