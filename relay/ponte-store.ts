// Ponte Local — estado compartilhado do relay (memória do processo).
// O relay guarda comandos a serem executados pelo agente no PC do usuário
// e os resultados devolvidos por ele. Nada de arquivos trafega aqui —
// apenas JSON de metadados/operações.

import fs from "fs";

export interface PonteCommand {
  id: number;
  action: string;
  args?: Record<string, unknown>;
  ts: number;
  channel: "prod" | "test";
}

export interface PonteResult {
  id: number;
  ok: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
  ts: number;
  channel: "prod" | "test";
}

interface PonteState {
  seq: number;
  commands: PonteCommand[]; // histórico completo (agente usa cursor)
  results: PonteResult[]; // histórico (capado)
  claimed: Map<number, number>; // id do comando → timestamp do claim (entrega exclusiva)
  lastSeen: number; // último contato do agente (epoch ms)
  agentInfo: Record<string, unknown> | null; // preenchido pelo "ping"
  startedAt: number;
  totalCommands: number;
  totalResults: number;
}

const g = globalThis as unknown as { __ponteState2?: PonteState };

const MAX_RESULTS = 400;
const MAX_PENDING = 100;

export function ponte(): PonteState {
  if (!g.__ponteState2) {
    g.__ponteState2 = {
      seq: loadSeq(),
      commands: [],
      results: [],
      claimed: new Map(),
      lastSeen: 0,
      agentInfo: null,
      startedAt: Date.now(),
      totalCommands: 0,
      totalResults: 0,
    };
  }
  const s = g.__ponteState2;
  // Defesa contra HMR/estados antigos em memória
  if (!s.claimed) s.claimed = new Map();
  if (!Array.isArray(s.commands)) s.commands = [];
  if (!Array.isArray(s.results)) s.results = [];
  return s;
}

// Tokens fixos desta instância da ponte.
// O AGENT_TOKEN é entregue ao usuário no chat privado; o ADMIN_TOKEN
// é usado apenas por mim (dentro da VM) para injetar comandos.
export const AGENT_TOKEN = "f4f50a789db13e5f40ffd8b0";
// Token exclusivo para agentes de TESTE dentro da VM — nunca entregue ao usuário.
// Comandos do canal "test" só chegam a agentes autenticados com este token.
export const TEST_AGENT_TOKEN = "9f3ce1a7b2d84e60f5a1c8b7-teste";
export const ADMIN_TOKEN = "bb094b43a4be17f1ad09c070112f0514";
export const PONTE_VERSION = "1.1.0";
export const CONNECTED_WINDOW_MS = 15_000;

// Sequência persistida em disco: ids de comando NUNCA voltam atrás,
// mesmo se o dev server reiniciar (evita agente perder comandos por cursor velho).
const SEQ_FILE = "/home/z/my-project/.ponte-seq";

function loadSeq(): number {
  try {
    return parseInt(fs.readFileSync(SEQ_FILE, "utf8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function saveSeq(n: number): void {
  try {
    fs.writeFileSync(SEQ_FILE, String(n));
  } catch {}
}

export type Channel = "prod" | "test";

export function channelForAgent(token: string | null): Channel {
  return token === TEST_AGENT_TOKEN ? "test" : "prod";
}

export function addCommand(
  action: string,
  args?: Record<string, unknown>,
  channel: Channel = "prod"
): PonteCommand {
  const s = ponte();
  const pending = s.commands.filter(
    (c) => c.channel === channel && !s.results.some((r) => r.id === c.id)
  );
  if (pending.length >= MAX_PENDING) {
    throw new Error("Fila de comandos cheia (agente não está respondendo?)");
  }
  s.seq += 1;
  s.totalCommands += 1;
  saveSeq(s.seq);
  const cmd: PonteCommand = { id: s.seq, action, args: args ?? {}, ts: Date.now(), channel };
  s.commands.push(cmd);
  if (s.commands.length > 500) s.commands = s.commands.slice(-500);
  return cmd;
}

export function pollCommands(
  cursor: number,
  channel: Channel
): { commands: PonteCommand[]; nextCursor: number } {
  const s = ponte();
  const now = Date.now();
  const CLAIM_LEASE_MS = 120_000; // se o agente não responder em 2 min, libera de novo
  const mine = s.commands.filter((c) => c.channel === channel);
  const pending = mine.filter((c) => {
    if (c.id <= cursor) return false;
    if (s.results.some((r) => r.id === c.id)) return false;
    const claimedAt = s.claimed.get(c.id);
    if (claimedAt && now - claimedAt < CLAIM_LEASE_MS) return false;
    return true;
  });
  for (const c of pending) s.claimed.set(c.id, now);
  if (s.claimed.size > 500) {
    for (const [id, t] of s.claimed) if (now - t > CLAIM_LEASE_MS) s.claimed.delete(id);
  }
  const maxId = s.commands.length ? s.commands[s.commands.length - 1].id : cursor;
  return { commands: pending, nextCursor: Math.max(maxId, cursor) };
}

export function pushResult(r: PonteResult): void {
  const s = ponte();
  s.totalResults += 1;
  s.results.push(r);
  if (s.results.length > MAX_RESULTS) s.results = s.results.slice(-MAX_RESULTS);
}

export function resultsSince(since: number, channel: Channel): PonteResult[] {
  return ponte()
    .results.filter((r) => r.channel === channel && r.id > since)
    .slice(0, 100);
}

export function markSeen(): void {
  ponte().lastSeen = Date.now();
}

export function isConnected(): boolean {
  return Date.now() - ponte().lastSeen < CONNECTED_WINDOW_MS;
}

export function isAgentAuthorized(token: string | null): boolean {
  return !!token && (token === AGENT_TOKEN || token === TEST_AGENT_TOKEN);
}

export function isAdminAuthorized(token: string | null): boolean {
  return !!token && token === ADMIN_TOKEN;
}
