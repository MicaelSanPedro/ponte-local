"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  Check,
  Copy,
  Cpu,
  FolderOpen,
  MemoryStick,
  Server,
  ShieldCheck,
  Trash2,
  User,
} from "lucide-react";

interface AgentInfo {
  agente?: string;
  usuario?: string;
  maquina?: string;
  plataforma?: string;
  home?: string;
  node?: string;
  cpus?: string;
  ramTotalGB?: number;
  ramLivreGB?: number;
  escopo?: string;
}

interface Status {
  ok: boolean;
  connected: boolean;
  lastSeenAgoS: number | null;
  agentInfo: AgentInfo | null;
  pending: number;
  totalCommands: number;
  totalResults: number;
  uptimeS: number;
  version: string;
}

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min`;
  return `${s}s`;
}

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch("/api/ponte/status", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          setStatus(d);
          setOrigin(window.location.origin);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const srv = origin || "https://SEU-LINK-DE-PREVIEW";
  const comando = `node agent.js --server ${srv} --token TOKEN_QUE_VOCE_RECEBEU_NO_CHAT --save`;
  const instalacao = [
    "mkdir -p ~/ponte-agent && cd ~/ponte-agent",
    `curl -fso agent.js ${srv}/api/ponte/download`,
    comando,
  ].join("\n");

  const copiar = useCallback(() => {
    navigator.clipboard.writeText(instalacao).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [instalacao]);

  const info = status?.agentInfo ?? null;
  const connected = status?.connected ?? false;

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-neutral-100">
      <header className="w-full max-w-3xl mx-auto px-4 pt-10 pb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Ponte Local</h1>
            <p className="text-neutral-400 mt-1 text-sm sm:text-base">
              O canal entre a VM da sua IA e o seu PC — seus arquivos nunca saem daqui.
            </p>
          </div>
          <span className="text-xs text-neutral-500 font-mono">
            v{status?.version ?? "?"}
          </span>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 space-y-5 pb-10">
        {/* Status da conexão */}
        <section
          aria-label="Status da conexão"
          className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6"
        >
          <div className="flex items-center gap-3">
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full ${
                connected
                  ? "bg-emerald-400 animate-pulse shadow-[0_0_12px_rgba(52,211,153,0.8)]"
                  : "bg-amber-400"
              }`}
              role="img"
              aria-label={connected ? "Conectado" : "Aguardando"}
            />
            <div>
              <p className="text-lg font-semibold">
                {connected ? "SEU COMPUTADOR ESTÁ CONECTADO" : "AGUARDANDO O SEU COMPUTADOR"}
              </p>
              <p className="text-sm text-neutral-400">
                {connected
                  ? `Último contato há ${status?.lastSeenAgoS ?? 0}s — pronto para receber comandos.`
                  : "Rode o agente no seu PC (passo a passo abaixo) e esta luz fica verde."}
              </p>
            </div>
          </div>

          {info && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5 text-sm">
              <div className="flex items-center gap-2 text-neutral-300">
                <User className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden />
                <span className="truncate">
                  {info.usuario}@{info.maquina}
                </span>
              </div>
              <div className="flex items-center gap-2 text-neutral-300">
                <Cpu className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden />
                <span className="truncate">{info.cpus}</span>
              </div>
              <div className="flex items-center gap-2 text-neutral-300">
                <MemoryStick className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden />
                <span>
                  {info.ramTotalGB} GB de RAM ({info.ramLivreGB} GB livres)
                </span>
              </div>
              <div className="flex items-center gap-2 text-neutral-300">
                <Server className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden />
                <span className="truncate">{info.plataforma}</span>
              </div>
              <div className="flex items-center gap-2 text-neutral-300 sm:col-span-2">
                <FolderOpen className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden />
                <span className="truncate">
                  Escopo: <code className="text-xs">{info.home}</code>
                </span>
              </div>
            </dl>
          )}

          <p className="text-xs text-neutral-500 mt-4">
            Comandos na fila: {status?.pending ?? 0} · enviados: {status?.totalCommands ?? 0} ·
            respondidos: {status?.totalResults ?? 0} · ponte no ar há {formatUptime(status?.uptimeS ?? 0)}
          </p>
        </section>

        {/* Como conectar */}
        <section
          aria-label="Como conectar"
          className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6"
        >
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-emerald-400" aria-hidden />
            Como conectar seu PC
          </h2>
          <ol className="list-decimal list-inside space-y-2 mt-4 text-sm text-neutral-300">
            <li>
              Instale o Node.js 18+ se ainda não tem — a sua IA passa o comando
              certo para a sua distro (Arch, Debian/Ubuntu, Fedora, openSUSE…).
            </li>
            <li>
              Cole o bloco abaixo no terminal — ele cria a pasta, baixa o agente direto da ponte
              e já salva a configuração para as próximas vezes:
            </li>
          </ol>
          <div className="mt-4 relative">
            <pre className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 pr-12 text-xs sm:text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {instalacao}
            </pre>
            <button
              onClick={copiar}
              aria-label="Copiar comando"
              className="absolute top-2.5 right-2.5 p-2 rounded-md bg-neutral-800 hover:bg-neutral-700 transition-colors"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-400" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-3">
            O token completo foi enviado no chat — mantenha-o privado. Para parar o agente:
            Ctrl+C. Para religar depois: <code className="text-xs">node agent.js</code>.
          </p>
          <p className="text-xs text-neutral-500 mt-2">
            Modo supervisionado (opcional) — para que eu possa propor comandos de sistema e você
            aprovar cada um com <code className="text-xs">s/N</code> no terminal, religue com:{" "}
            <code className="text-xs">node agent.js --allow-run --save</code>
          </p>
          <p className="text-xs text-neutral-500 mt-2">
            Modo autônomo (opcional) — para eu executar comandos sozinhos, sem perguntar,{" "}
            <code className="text-xs">node agent.js --auto --save</code> (uma trava
            anticatástrofe local continua recusando comandos destrutivos de sistema; a escalada de
            permissão é sempre física, digitada por você).
          </p>
          <p className="text-xs text-neutral-500 mt-2">
            Sem navegador na máquina? O <code className="text-xs">agent.js</code> é um arquivo único e
            autossuficiente — a sua IA pode entregá-lo por outro canal (pendrive, scp, etc.).
          </p>
        </section>

        {/* Garantias de segurança */}
        <section
          aria-label="Garantias de segurança"
          className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6"
        >
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden />
            Regras que o agente NÃO quebra
          </h2>
          <ul className="mt-4 space-y-3 text-sm text-neutral-300">
            <li className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" aria-hidden />
              Escopo travado na sua home — pastas sensíveis (.ssh, .gnupg, .config e afins) são
              inacessíveis.
            </li>
            <li className="flex items-start gap-2">
              <Trash2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" aria-hidden />
              Nada é apagado de verdade: exclusões vão para a lixeira do sistema, com log local e
              desfazer.
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" aria-hidden />
              Sem shell, sem execução de programas: apenas uma lista fixa de operações de arquivo
              (listar, mover, renomear, buscar, organizar…).
            </li>
          </ul>
        </section>
      </main>

      <footer className="w-full max-w-3xl mx-auto px-4 py-6 mt-auto">
        <p className="text-center text-sm text-neutral-500">
          Os arquivos permanecem no seu computador — pela ponte só passa texto: comandos e
          respostas.
        </p>
      </footer>
    </div>
  );
}
