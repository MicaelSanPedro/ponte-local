#!/usr/bin/env node
/*
 * Ponte Local — Agente v1.3.0 (Windows + Linux)
 * Roda no SEU computador e executa, sob comando do relay, uma lista FIXA de
 * operações de arquivo. Sem shell, sem execução de programas, sem rede além
 * do próprio relay.
 *
 *   node agent.js --server https://SEU-LINK --token SEU_TOKEN --save
 *
 * Garantias:
 *  - Escopo: somente a sua home (pastas sensíveis bloqueadas)
 *  - Exclusões vão para a lixeira XDG do sistema (recuperáveis)
 *  - Tudo é registrado em ponte-log.jsonl (com desfazer)
 *  - Zero dependências: apenas Node.js puro
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const { execFile, exec } = require("child_process");

const VERSION = "1.3.0";
const REQUEST_TIMEOUT_MS = 15000;
const SCRIPT_DIR = __dirname;
const CONFIG_FILE = path.join(SCRIPT_DIR, "ponte.config.json");
const LOG_FILE = path.join(SCRIPT_DIR, "ponte-log.jsonl");

let cfg = null; // preenchido no main()

// ---------------------------------------------------------------- utilidades
function stamp() {
  return new Date().toISOString();
}
function log(msg) {
  console.log("[" + stamp().slice(11, 19) + "] " + msg);
}
function fail(msg) {
  console.error("\n[x] " + msg + "\n");
  process.exit(1);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function audit(entry) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(Object.assign({ ts: stamp() }, entry)) + "\n");
  } catch (_) {
    /* o log nunca deve derrubar o agente */
  }
}

// ---------------------------------------------------------------- config
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function loadConfig(cli) {
  let c = {};
  try {
    c = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (_) {}
  if (cli.server) c.server = cli.server;
  if (cli.token) c.token = cli.token;
  if (cli.home) c.home = cli.home;
  if (!c.server)
    fail(
      "Falta o servidor. Rode:\n" +
        "  node agent.js --server https://SEU-LINK-DE-PREVIEW --token SEU_TOKEN --save\n" +
        "(link e token estão no chat)"
    );
  if (!c.token)
    fail("Falta o token. Pegue-o no chat e rode de novo com --token SEU_TOKEN --save");
  if (!/^https?:\/\//i.test(c.server)) c.server = "https://" + c.server;
  c.server = String(c.server).replace(/\/+$/, "");
  c.home = c.home ? path.resolve(String(c.home)) : os.homedir();
  // Modo supervisionado: run_command só funciona se ativado explicitamente.
  if (cli["allow-run"]) c.run = true;
  // Modo autônomo (--auto): run_command SEM confirmação (implica --allow-run).
  // A escalada de permissão é sempre FÍSICA — digitada por você no terminal.
  if (cli.auto) {
    c.run = true;
    c.auto = true;
  }
  return c;
}

function saveConfig(c) {
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify(
      { server: c.server, token: c.token, home: c.home, run: !!c.run, auto: !!c.auto },
      null,
      2
    )
  );
}

// ---------------------------------------------------------------- HTTP
function apiCall(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(cfg.server + urlPath);
    } catch (e) {
      return reject(new Error("URL inválida: " + cfg.server + urlPath));
    }
    const lib = u.protocol === "https:" ? https : http;
    const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        timeout: REQUEST_TIMEOUT_MS,
        headers: Object.assign(
          { "x-ponte-token": cfg.token },
          payload
            ? { "content-type": "application/json", "content-length": payload.length }
            : {}
        ),
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > 3 * 1024 * 1024) {
            req.destroy();
            reject(new Error("Resposta grande demais"));
          } else chunks.push(c);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(text));
          } catch (_) {
            reject(new Error("Resposta não é JSON (HTTP " + res.statusCode + ")"));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------- escopo
const BLOCKED_DIRS = new Set([
  ".ssh", ".gnupg", ".config", ".password-store", ".aws", ".kube",
  ".ponte-agent", "ponte-agent",
]);

function assertAllowed(p) {
  const rp = path.resolve(String(p));
  const home = path.resolve(cfg.home);
  if (rp !== home && !rp.startsWith(home + path.sep)) {
    throw new Error("Fora do escopo: só opero dentro de " + home);
  }
  const rel = path.relative(home, rp);
  const parts = rel.split(path.sep).filter(Boolean);
  for (const part of parts) {
    if (BLOCKED_DIRS.has(part)) throw new Error("Pasta protegida no caminho: " + part);
  }
  return rp;
}

const SKIP_WALK = new Set([
  "node_modules", ".git", ".cache", "cache", ".thumbnails", "Trash",
  ".steam", ".var", "snap", "__pycache__", ".cargo", ".rustup", ".npm",
  "Cache", "Code Cache",
]);

function walk(rootRp, opts, cb) {
  const t0 = Date.now();
  const queue = [{ p: rootRp, depth: 0 }];
  let visited = 0;
  while (queue.length) {
    const { p, depth } = queue.shift();
    if (depth > (opts.maxDepth || 10)) return visited;
    if (opts.timeCapMs && visited % 400 === 0 && Date.now() - t0 > opts.timeCapMs) return visited;
    let entries;
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const ent of entries) {
      visited++;
      if (visited > (opts.maxEntries || 80000)) return visited;
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_WALK.has(ent.name) && !BLOCKED_DIRS.has(ent.name))
          queue.push({ p: full, depth: depth + 1 });
        continue;
      }
      if (ent.isFile()) cb(full);
    }
  }
  return visited;
}

function looksBinary(rp) {
  const fd = fs.openSync(rp, "r");
  try {
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  for (let i = 2; i < 10000; i++) {
    const cand = path.join(dir, base + "." + i + ext);
    if (!fs.existsSync(cand)) return cand;
  }
  throw new Error("Sem nome livre para " + p);
}

function fmtMB(n) {
  return +(n / 1048576).toFixed(1) + " MB";
}

// ------------------------------------------------- trava anticatástrofe
// No modo autônomo os comandos rodam SEM confirmação — mas os padrões abaixo
// são recusados sempre: destroem o sistema de uma vez e não têm desfazer.
// No modo supervisionado não se aplica (quem decide é o humano, com o aviso).
const ALVO_SISTEMA = /^(~\/?|\$HOME\/?|\/\*?|\/home\/?|\/home\/\*|\/boot(\/.*)?|\/etc(\/.*)?|\/usr(\/.*)?|\/var(\/.*)?|\/lib(\/.*)?|\/opt(\/.*)?|\/mnt(\/.*)?|\/media(\/.*)?|\*)$/;

// Alvos catastróficos no Windows (raiz de drive, pastas do sistema, home).
const ALVO_SISTEMA_WIN = /^(?:[a-z]:\\?|[a-z]:\\windows(?:\\.*)?|[a-z]:\\program files(?: \(x86\))?(?:\\.*)?|\$home|~\/?|%systemroot%)$/i;

function dangerCheck(cmdline) {
  // fork bomb clássico: :(){ :|:& };:
  if (/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?/.test(cmdline)) return "fork bomb";
  // formatar / apagar assinaturas de filesystem
  if (/\bmkfs(\.[a-z0-9]+)?\b/i.test(cmdline)) return "mkfs (formatar filesystem)";
  if (/\bwipefs\b/i.test(cmdline)) return "wipefs";
  // escrever direto em dispositivo de bloco
  if (/\bdd\b[^|;&]*\bof\s*=\s*\/dev\/(sd|nvme|mmcblk|hd|vd|loop)/i.test(cmdline))
    return "dd escrevendo em dispositivo";
  if (/\bshred\b[^|;&]*\/dev\/(sd|nvme|mmcblk|hd|vd)/i.test(cmdline))
    return "shred em dispositivo";
  if (/(^|[^a-z0-9])>\s*\/dev\/(sd|nvme|mmcblk|hd|vd)/i.test(cmdline))
    return "escrita direta em dispositivo";
  // rm recursivo em alvo de sistema inteiro (divide por ; | && e nova linha)
  const segmentos = cmdline.split(/\n|;|\|\||\|/);
  for (const seg of segmentos) {
    const m = seg.trim().match(/^(?:sudo\s+)?rm\s+((?:-{1,2}[a-zA-Z]+\s+)*)(.*)$/);
    if (!m) continue;
    if (!/-[a-z]*r/i.test(m[1])) continue; // só interessa rm recursivo
    for (const alvo of m[2].trim().split(/\s+/)) {
      if (!alvo || alvo.startsWith("-")) continue;
      if (ALVO_SISTEMA.test(alvo.replace(/["']/g, "")))
        return "rm recursivo em alvo de sistema (" + alvo + ")";
    }
  }
  // ---- Windows (cmd.exe / PowerShell): catástrofes equivalentes ----
  if (/\bformat\s+[a-z]:/i.test(cmdline)) return "format (formatar volume)";
  if (/\bdiskpart\b/i.test(cmdline)) return "diskpart (gerenciamento de disco)";
  if (/\bvssadmin\b[^|;&]*delete\s+shadows/i.test(cmdline))
    return "vssadmin delete shadows (apagar backups de sombra)";
  if (/\bcipher\b\s+\/w/i.test(cmdline)) return "cipher /w (apagamento seguro do disco)";
  // Alvo do Windows é catastrófico se (após tirar aspas e wildcards finais)
  // é raiz de drive, pasta do sistema ou home. Testa tokens isolados E pares
  // adjacentes — senão "C:\Program Files\app" quebra em "C:\Program"+"Files\app".
  const catWin = (alvo) => {
    let a = alvo.replace(/["']/g, "").trim();
    a = a.replace(/\\?\*(?:\.\*)?$/, "").trim(); // C:\*.* → C:\ ; C:\* → C:\
    if (!a) return false;
    return ALVO_SISTEMA_WIN.test(a);
  };
  const acharAlvo = (resto, ehFlag) => {
    const toks = resto.trim().split(/\s+/);
    for (let i = 0; i < toks.length; i++) {
      if (!toks[i] || ehFlag(toks[i])) continue;
      if (catWin(toks[i])) return toks[i];
      if (i + 1 < toks.length && !ehFlag(toks[i + 1]) && catWin(toks[i] + " " + toks[i + 1]))
        return toks[i] + " " + toks[i + 1];
    }
    return null;
  };
  for (const seg of cmdline.split(/\n|;|\|\||\|/)) {
    const s = seg.trim();
    const mRd = s.match(/^(?:rd|rmdir)\s+((?:\/[a-z]+\s+)*)(.+)$/i);
    if (mRd && /\/s/i.test(mRd[1])) {
      const alvo = acharAlvo(mRd[2], (t) => t.startsWith("/"));
      if (alvo) return "rd recursivo em alvo de sistema (" + alvo + ")";
    }
    const mDel = s.match(/^del\s+((?:\/[a-z]+\s+)*)(.+)$/i);
    if (mDel && /\/s/i.test(mDel[1])) {
      const alvo = acharAlvo(mDel[2], (t) => t.startsWith("/"));
      if (alvo) return "del /s em alvo de sistema (" + alvo + ")";
    }
    if (/\bremove-item\b/i.test(s) && /-recurse/i.test(s)) {
      const depois = s.replace(/^[\s\S]*?\bremove-item\b\s*/i, "");
      const alvo = acharAlvo(depois, (t) => t.startsWith("-"));
      if (alvo) return "Remove-Item recursivo em alvo de sistema (" + alvo + ")";
    }
  }
  return null;
}

function executarComando(cmdline, cwd, timeoutMin) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const fim = (err, stdout, stderr) => {
      resolve({
        code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        mortoPorTimeout: !!(err && err.killed),
        ms: Date.now() - t0,
      });
    };
    const opts = {
      cwd,
      timeout: timeoutMin * 60000,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
      windowsHide: true,
    };
    if (process.platform === "win32") {
      // Windows: exec usa o ComSpec (cmd.exe), exatamente como o Node faz
      // nativamente. stdin não pode ser "inherit" em exec — e o cmd não
      // precisa dele (prompt interativo de sudo é coisa de Linux).
      exec(cmdline, opts, fim);
    } else {
      // Linux/macOS: bash explícito, stdin herdado (sudo -S precisa).
      execFile("/bin/bash", ["-c", cmdline], { ...opts, stdio: ["inherit", "pipe", "pipe"] }, fim);
    }
  });
}

const corta150k = (s) => (s.length > 150000 ? s.slice(0, 150000) + "\n…[saída cortada]" : s);

// Pergunta s/N no terminal local, com tempo limite (para AUTO-REJEITAR).
// Sem TTY (agente rodando em background), a resposta nunca chega e o
// comando é rejeitado — supervisão não pode ser burlada.
function askYesNo(timeoutS) {
  return new Promise((resolve) => {
    let done = false;
    const onData = (buf) => {
      const t = buf.toString().trim().toLowerCase();
      cleanup();
      if (!done) {
        done = true;
        resolve(t);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      if (!done) {
        done = true;
        console.log("\n(sem resposta em " + timeoutS + "s — tratado como NÃO)");
        resolve("n");
      }
    }, timeoutS * 1000);
    function cleanup() {
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
    }
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

// Hash rápido (md5) para detecção de duplicados.
// Até 100 MB: hash completo em blocos. Acima disso: começo + fim (8 MB cada).
function hashFile(f, size) {
  const crypto = require("crypto");
  const h = crypto.createHash("md5");
  const fd = fs.openSync(f, "r");
  try {
    const CHUNK = 4 * 1024 * 1024;
    if (size <= 100 * 1024 * 1024) {
      const buf = Buffer.alloc(CHUNK);
      let off = 0;
      while (off < size) {
        const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - off), off);
        if (n <= 0) break;
        h.update(buf.subarray(0, n));
        off += n;
      }
    } else {
      const head = Buffer.alloc(8 * 1024 * 1024);
      const n1 = fs.readSync(fd, head, 0, head.length, 0);
      h.update(head.subarray(0, n1));
      const tail = Buffer.alloc(8 * 1024 * 1024);
      const n2 = fs.readSync(fd, tail, 0, tail.length, Math.max(0, size - tail.length));
      h.update(tail.subarray(0, n2));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

function moveItem(fromRp, toRp) {
  const dest = fs.existsSync(toRp) ? uniquePath(toRp) : toRp;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(fromRp, dest);
  } catch (e) {
    if (e.code === "EXDEV") {
      fs.copyFileSync(fromRp, dest);
      fs.unlinkSync(fromRp);
    } else throw e;
  }
  return dest;
}

// ---------------------------------------------------------------- lixeira XDG
function trashDirs() {
  const base = path.join(path.resolve(cfg.home), ".local", "share", "Trash");
  return { files: path.join(base, "files"), info: path.join(base, "info") };
}

function trashMove(rp) {
  const t = trashDirs();
  fs.mkdirSync(t.files, { recursive: true });
  fs.mkdirSync(t.info, { recursive: true });
  const target = uniquePath(path.join(t.files, path.basename(rp)));
  fs.renameSync(rp, target);
  const trashName = path.basename(target);
  fs.writeFileSync(
    path.join(t.info, trashName + ".trashinfo"),
    "[Trash Info]\nPath=" + encodeURI(rp) + "\nDeletionDate=" +
      new Date().toISOString().replace(/\..+/, "") + "\n",
    "utf8"
  );
  return { trashName, trashPath: target };
}

function restoreFromTrash(trashName) {
  const t = trashDirs();
  const infoFile = path.join(t.info, trashName + ".trashinfo");
  const trashPath = path.join(t.files, trashName);
  if (!fs.existsSync(infoFile) || !fs.existsSync(trashPath))
    throw new Error("Item não encontrado na lixeira: " + trashName);
  const raw = fs.readFileSync(infoFile, "utf8");
  const m = raw.match(/^Path=(.+)$/m);
  if (!m) throw new Error("Registro da lixeira corrompido: " + trashName);
  const orig = decodeURI(m[1]);
  assertAllowed(orig); // o destino precisa continuar dentro do escopo
  fs.mkdirSync(path.dirname(orig), { recursive: true });
  const dest = uniquePath(orig);
  fs.renameSync(trashPath, dest);
  try {
    fs.unlinkSync(infoFile);
  } catch (_) {}
  return dest;
}

// ---------------------------------------------------------------- grupos
const GROUPS = [
  ["Imagens", ["jpg", "jpeg", "png", "gif", "webp", "svg", "heic", "heif", "avif", "bmp", "tiff", "ico"]],
  ["Documentos", ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "txt", "md", "csv", "epub", "mobi", "rtf", "tex"]],
  ["Vídeos", ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "ts"]],
  ["Áudios", ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "wma"]],
  ["Compactados", ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "tgz"]],
  ["Instaladores", ["deb", "rpm", "appimage", "exe", "msi", "iso"]],
  ["Código", ["js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "sh", "c", "cpp", "h", "hpp", "java", "rs", "go", "rb", "php", "html", "css", "scss", "json", "yml", "yaml", "toml", "sql", "lua"]],
  ["Fontes", ["ttf", "otf", "woff", "woff2"]],
];
const EXT_TO_GROUP = {};
for (const [label, exts] of GROUPS) for (const e of exts) EXT_TO_GROUP[e] = label;

// ---------------------------------------------------------------- ações (whitelist fixa)
const ACTIONS = {
  ping: async () => {
    const cpus = os.cpus();
    return {
      agente: "ponte-agent/" + VERSION,
      modo: !cfg.run
        ? "arquivos apenas (run_command desligado)"
        : cfg.auto
          ? "autônomo (run_command SEM confirmação · trava anticatástrofe ativa)"
          : "supervisionado (run_command ATIVO)",
      usuario: os.userInfo().username,
      maquina: os.hostname(),
      plataforma: os.platform() + " " + os.arch() + " · " + os.release(),
      home: cfg.home,
      node: process.version,
      cpus: cpus.length + "x " + (cpus[0] ? cpus[0].model.trim().split("@")[0].trim().slice(0, 40) : "?"),
      ramTotalGB: +(os.totalmem() / 2 ** 30).toFixed(2),
      ramLivreGB: +(os.freemem() / 2 ** 30).toFixed(1),
      escopo: "somente " + cfg.home + " (pastas sensíveis bloqueadas)",
    };
  },

  list: async (args) => {
    const rp = assertAllowed(args.path || cfg.home);
    if (!fs.statSync(rp).isDirectory()) throw new Error("Não é uma pasta: " + rp);
    const total = fs.readdirSync(rp).length;
    const names = fs.readdirSync(rp).filter((n) => !BLOCKED_DIRS.has(n)).slice(0, 4000);
    const all = [];
    for (const name of names) {
      let s;
      try {
        s = fs.statSync(path.join(rp, name));
      } catch (_) {
        continue;
      }
      all.push({ nome: name, pasta: s.isDirectory(), bytes: s.size, mtime: s.mtime.toISOString() });
    }
    all.sort((a, b) => (a.pasta !== b.pasta ? (a.pasta ? -1 : 1) : a.nome.localeCompare(b.nome, "pt-BR")));
    const offset = Math.max(0, args.offset | 0);
    const limit = Math.min(2000, Math.max(1, args.limit || 400));
    const entries = all.slice(offset, offset + limit);
    return { path: rp, total, visiveis: entries.length, entradas: entries };
  },

  read_text: async (args) => {
    if (!args.path) throw new Error("Falta o caminho");
    const rp = assertAllowed(args.path);
    const s = fs.statSync(rp);
    if (!s.isFile()) throw new Error("Não é um arquivo");
    if (s.size > 5 * 1024 * 1024) throw new Error("Arquivo grande demais (limite 5 MB)");
    if (looksBinary(rp)) throw new Error("Parece binário — só leio texto");
    const maxBytes = Math.min(300000, args.maxBytes || 200000);
    const fd = fs.openSync(rp, "r");
    const buf = Buffer.alloc(Math.min(maxBytes, s.size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return { path: rp, bytes: s.size, truncado: s.size > buf.length, conteudo: buf.toString("utf8") };
  },

  write_text: async (args) => {
    if (!args.path) throw new Error("Falta o caminho");
    const rp = assertAllowed(args.path);
    const content = String(args.content == null ? "" : args.content);
    if (content.length > 1024 * 1024) throw new Error("Conteúdo maior que 1 MB");
    const existed = fs.existsSync(rp);
    if (existed && !args.overwrite)
      throw new Error("Já existe. Se quiser substituir, mande overwrite:true (o antigo vai pra lixeira)");
    fs.mkdirSync(path.dirname(rp), { recursive: true });
    if (existed) {
      const { trashName } = trashMove(rp);
      audit({ action: "write_text", resumo: "substituiu " + rp, undo: { kind: "trash", trashName } });
    } else {
      audit({ action: "write_text", resumo: "criou " + rp, undo: { kind: "create", path: rp } });
    }
    fs.writeFileSync(rp, content, "utf8");
    return { path: rp, bytes: Buffer.byteLength(content), substituiu: existed };
  },

  search: async (args) => {
    const rp = assertAllowed(args.path || cfg.home);
    const query = String(args.query == null ? "" : args.query).toLowerCase();
    if (!query) throw new Error("Busca vazia");
    const mode = args.mode === "content" ? "content" : "name";
    const max = Math.min(500, args.max || (mode === "name" ? 300 : 200));
    const hits = [];
    let scanned = 0;
    walk(rp, { timeCapMs: 20000, maxDepth: 12 }, (full) => {
      scanned++;
      if (hits.length >= max) return;
      let s;
      try {
        s = fs.statSync(full);
      } catch (_) {
        return;
      }
      if (mode === "name") {
        if (full.toLowerCase().includes(query)) hits.push({ path: full, bytes: s.size });
      } else {
        if (s.size > 2 * 1024 * 1024 || s.size === 0) return;
        if (looksBinary(full)) return;
        let text;
        try {
          text = fs.readFileSync(full, "utf8");
        } catch (_) {
          return;
        }
        const lines = text.split("\n");
        for (let i = 0; i < lines.length && hits.length < max; i++) {
          if (lines[i].toLowerCase().includes(query))
            hits.push({ path: full, linha: i + 1, trecho: lines[i].trim().slice(0, 200) });
        }
      }
    });
    return { modo: mode, busca: args.query, escaneados: scanned, encontrados: hits.length, resultados: hits };
  },

  mkdir: async (args) => {
    if (!args.path) throw new Error("Falta o caminho");
    const rp = assertAllowed(args.path);
    fs.mkdirSync(rp, { recursive: true });
    audit({ action: "mkdir", resumo: rp });
    return { path: rp };
  },

  move: async (args) => {
    if (!args.from || !args.to) throw new Error("Falta origem/destino");
    const from = assertAllowed(args.from);
    const to = assertAllowed(args.to);
    if (!fs.existsSync(from)) throw new Error("Origem não existe: " + from);
    const dest = moveItem(from, to);
    audit({ action: "move", resumo: from + " → " + dest, undo: { kind: "move", from, to: dest } });
    return { de: from, para: dest };
  },

  rename: async (args) => {
    if (!args.path || !args.newName) throw new Error("Falta caminho/nome");
    const rp = assertAllowed(args.path);
    const newName = String(args.newName);
    if (newName.includes("/") || newName.includes("\\") || newName === "." || newName === "..")
      throw new Error("Nome inválido");
    const to = path.join(path.dirname(rp), newName);
    const dest = moveItem(rp, to);
    audit({ action: "rename", resumo: rp + " → " + dest, undo: { kind: "move", from: rp, to: dest } });
    return { de: rp, para: dest };
  },

  "delete": async (args) => {
    const paths = Array.isArray(args.paths) ? args.paths : args.path ? [args.path] : [];
    if (!paths.length) throw new Error("Nada para apagar");
    const home = path.resolve(cfg.home);
    const feitos = [];
    for (const p of paths) {
      const rp = assertAllowed(p);
      if (rp === home) throw new Error("Não apago a home inteira");
      if (!fs.existsSync(rp)) {
        feitos.push({ path: rp, erro: "não existe" });
        continue;
      }
      const { trashName } = trashMove(rp);
      audit({ action: "delete", resumo: rp + " → lixeira", undo: { kind: "trash", trashName } });
      feitos.push({ path: rp, lixeira: trashName });
    }
    return { itens: feitos, nota: "tudo foi para a lixeira do agente — recuperável (restore/undo_last)" };
  },

  restore: async (args) => {
    if (!args.trashName) throw new Error("Falta o trashName");
    const dest = restoreFromTrash(String(args.trashName));
    audit({ action: "restore", resumo: "restaurou " + dest });
    return { restaurado: dest };
  },

  organize_plan: async (args) => {
    if (!args.path) throw new Error("Falta o caminho");
    const rp = assertAllowed(args.path);
    if (!fs.statSync(rp).isDirectory()) throw new Error("Não é uma pasta");
    const labels = new Set(GROUPS.map((g) => g[0]));
    const plan = [];
    for (const ent of fs.readdirSync(rp, { withFileTypes: true })) {
      if (!ent.isFile() || ent.name.startsWith(".") || labels.has(ent.name)) continue;
      const parts = ent.name.toLowerCase().split(".");
      const group = EXT_TO_GROUP[parts[parts.length - 1]] || "Outros";
      plan.push({ de: path.join(rp, ent.name), para: path.join(rp, group, ent.name), grupo: group });
      if (plan.length >= 3000) break;
    }
    const porGrupo = {};
    for (const item of plan) porGrupo[item.grupo] = (porGrupo[item.grupo] || 0) + 1;
    return { pasta: rp, total: plan.length, porGrupo, plano: plan };
  },

  apply_plan: async (args) => {
    const plan = Array.isArray(args.plan) ? args.plan : [];
    if (!plan.length) throw new Error("Plano vazio");
    const movidos = [];
    const erros = [];
    const moves = [];
    for (const item of plan) {
      try {
        const from = assertAllowed(item.de);
        const to = assertAllowed(item.para);
        if (from === to || !fs.existsSync(from)) continue;
        const dest = moveItem(from, to);
        moves.push({ from, to: dest });
        movidos.push(dest);
      } catch (e) {
        erros.push({ de: item.de, erro: e.message });
      }
    }
    audit({
      action: "apply_plan",
      resumo: movidos.length + " arquivo(s) movido(s)",
      undo: moves.length ? { kind: "batch", moves } : null,
    });
    return {
      movidos: movidos.length,
      erros: erros.length,
      detalhes: movidos.slice(0, 200),
      listaErros: erros.slice(0, 50),
    };
  },

  undo_last: async () => {
    if (!fs.existsSync(LOG_FILE)) throw new Error("Log vazio — nada para desfazer");
    const lines = fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").reverse();
    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (_) {
        continue;
      }
      const u = entry.undo;
      if (!u) continue;
      if (u.kind === "move") {
        if (!fs.existsSync(u.to)) throw new Error("Item não está mais em " + u.to);
        const dest = moveItem(u.to, u.from);
        audit({ action: "undo", resumo: "reverteu: " + entry.resumo });
        return { revertido: entry.action, para: dest };
      }
      if (u.kind === "batch") {
        let n = 0;
        const detalhes = [];
        for (const m of u.moves.slice().reverse()) {
          if (fs.existsSync(m.to)) {
            detalhes.push(moveItem(m.to, m.from));
            n++;
          }
        }
        audit({ action: "undo", resumo: "reverteu lote (" + n + " itens)" });
        return { revertido: entry.action, itens: n, detalhes: detalhes.slice(0, 50) };
      }
      if (u.kind === "trash") {
        const dest = restoreFromTrash(u.trashName);
        audit({ action: "undo", resumo: "restaurou da lixeira: " + dest });
        return { revertido: entry.action, restaurado: dest };
      }
      if (u.kind === "create" && fs.existsSync(u.path)) {
        const { trashName } = trashMove(u.path);
        audit({ action: "undo", resumo: "removeu arquivo criado: " + u.path });
        return { revertido: entry.action, lixeira: trashName };
      }
    }
    throw new Error("Nenhuma ação reversível encontrada no log");
  },

  free_space: async () => {
    if (typeof fs.statfs !== "function")
      throw new Error("Esta versão do Node não tem fs.statfs — rode 'df -h' no terminal");
    return new Promise((resolve, reject) => {
      fs.statfs(path.resolve(cfg.home), (err, st) => {
        if (err) return reject(err);
        const total = st.blocks * st.bsize;
        const livre = st.bavail * st.bsize;
        resolve({
          totalGB: +(total / 2 ** 30).toFixed(1),
          livreGB: +(livre / 2 ** 30).toFixed(1),
          usoPercentual: Math.round((100 * (total - livre)) / total),
        });
      });
    });
  },

  tree: async (args) => {
    const rp = assertAllowed(args.path || cfg.home);
    const maxDepth = Math.min(4, Number(args.depth) || 2);
    const maxEntries = Math.min(3000, Number(args.maxEntries) || 800);
    let count = 0;
    function build(dir, d) {
      if (d > maxDepth || count >= maxEntries) return null;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return null;
      }
      entries.sort((a, b) =>
        a.isDirectory() !== b.isDirectory()
          ? a.isDirectory() ? -1 : 1
          : a.name.localeCompare(b.name, "pt-BR")
      );
      const nodes = [];
      for (const ent of entries) {
        if (count >= maxEntries) break;
        if (BLOCKED_DIRS.has(ent.name) || SKIP_WALK.has(ent.name)) continue;
        count++;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          nodes.push({ nome: ent.name, pasta: true, filhos: build(full, d + 1) });
        } else {
          let s = null;
          try { s = fs.statSync(full); } catch (_) {}
          nodes.push({ nome: ent.name, bytes: s ? s.size : null });
        }
      }
      return nodes;
    }
    return { path: rp, arvore: build(rp, 1), limite: count >= maxEntries ? "cortado no maxEntries" : null };
  },

  disk_usage: async (args) => {
    const rp = assertAllowed(args.path || cfg.home);
    const maxDepth = Math.min(4, Number(args.depth) || 2);
    const t0 = Date.now();
    const sizes = new Map();
    walk(rp, { timeCapMs: 120000, maxDepth: 12 }, (full) => {
      let s;
      try { s = fs.statSync(full); } catch (_) { return; }
      if (!s.isFile()) return;
      let d = path.dirname(full);
      while (true) {
        const rel = path.relative(rp, d);
        const depthNow = rel === "" ? 0 : rel.split(path.sep).length;
        if (depthNow <= maxDepth) sizes.set(d, (sizes.get(d) || 0) + s.size);
        if (d === rp) break;
        d = path.dirname(d);
      }
    });
    const top = [...sizes.entries()]
      .map(([p, bytes]) => ({ pasta: p, mb: +(bytes / 1048576).toFixed(1) }))
      .sort((a, b) => b.mb - a.mb)
      .slice(0, 30);
    return {
      path: rp,
      totalMB: +((sizes.get(rp) || 0) / 1048576).toFixed(1),
      topPastas: top,
      ms: Date.now() - t0,
      nota: "aproximado — ignora links simbólicos",
    };
  },

  duplicates: async (args) => {
    const rp = assertAllowed(args.path || cfg.home);
    const minSize = Math.max(1, Number(args.minSizeBytes) || 1024);
    const bySize = new Map();
    let escaneados = 0;
    walk(rp, { timeCapMs: 60000, maxDepth: 14 }, (full) => {
      escaneados++;
      let s;
      try { s = fs.statSync(full); } catch (_) { return; }
      if (!s.isFile() || s.size < minSize) return;
      if (!bySize.has(s.size)) bySize.set(s.size, []);
      bySize.get(s.size).push(full);
    });
    let hasheados = 0;
    const grupos = [];
    for (const [size, files] of bySize) {
      if (files.length < 2) continue;
      if (grupos.length >= 200 || hasheados > 20000) break;
      const byHash = new Map();
      for (const f of files) {
        try {
          hasheados++;
          const h = hashFile(f, size);
          if (!byHash.has(h)) byHash.set(h, []);
          byHash.get(h).push(f);
        } catch (_) {}
      }
      for (const fs2 of byHash.values()) {
        if (fs2.length >= 2) grupos.push({ bytes: size, arquivos: fs2 });
      }
    }
    grupos.sort((a, b) => b.bytes * b.arquivos.length - a.bytes * a.arquivos.length);
    const gasto = grupos.reduce((acc, g) => acc + g.bytes * (g.arquivos.length - 1), 0);
    return {
      pasta: rp,
      escaneados,
      hasheados,
      grupos: grupos.length,
      espacoRecuperavelMB: +(gasto / 1048576).toFixed(1),
      duplicados: grupos.slice(0, 100),
      nota: "eu não apago nada por conta própria — você escolhe o que fazer com cada grupo",
    };
  },

  read_binary: async (args) => {
    if (!args.path) throw new Error("Falta o caminho");
    const rp = assertAllowed(args.path);
    const s = fs.statSync(rp);
    if (!s.isFile()) throw new Error("Não é um arquivo");
    const maxBytes = Math.min(8 * 1024 * 1024, args.maxBytes || 8 * 1024 * 1024);
    if (s.size > maxBytes)
      throw new Error(
        "Arquivo tem " + fmtMB(s.size) + " — o limite da ponte é " + fmtMB(maxBytes)
      );
    return { path: rp, bytes: s.size, base64: fs.readFileSync(rp).toString("base64") };
  },

  write_binary: async (args) => {
    if (!args.path) throw new Error("Falta o caminho");
    const rp = assertAllowed(args.path);
    const b64 = String(args.base64 == null ? "" : args.base64).replace(/\s+/g, "");
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) throw new Error("Conteúdo vazio ou base64 inválido");
    if (buf.length > 8 * 1024 * 1024)
      throw new Error("Maior que 8 MB — a ponte não é pra transferência pesada");
    const existed = fs.existsSync(rp);
    if (existed && !args.overwrite)
      throw new Error("Já existe. Sobrescrever exige overwrite:true (o antigo vai pra lixeira)");
    fs.mkdirSync(path.dirname(rp), { recursive: true });
    if (existed) {
      const { trashName } = trashMove(rp);
      audit({ action: "write_binary", resumo: "substituiu " + rp, undo: { kind: "trash", trashName } });
    } else {
      audit({
        action: "write_binary",
        resumo: "criou " + rp + " (" + fmtMB(buf.length) + ")",
        undo: { kind: "create", path: rp },
      });
    }
    fs.writeFileSync(rp, buf);
    return { path: rp, bytes: buf.length, substituiu: existed };
  },

  run_command: async (args) => {
    if (!cfg.run)
      throw new Error(
        "run_command DESLIGADO. No terminal do agente: Ctrl+C e religue com node agent.js --auto --save (autônomo) ou node agent.js --allow-run --save (supervisionado)"
      );
    const cmdline = String(args.command == null ? "" : args.command).trim();
    if (!cmdline) throw new Error("Comando vazio");
    if (cmdline.length > 4000) throw new Error("Comando grande demais (limite 4000 caracteres)");
    const cwd = args.cwd ? path.resolve(String(args.cwd)) : cfg.home;
    const timeoutMin = Math.min(30, Number(args.timeoutMin) || 3);

    // ---- modo autônomo: executa direto, exceto padrões catastróficos
    if (cfg.auto) {
      const perigo = dangerCheck(cmdline);
      if (perigo) {
        audit({ action: "run_command", resumo: "AUTO-BLOQUEADO (" + perigo + "): " + cmdline.slice(0, 200) });
        throw new Error(
          "AUTO-BLOQUEADO pela trava anticatástrofe (" +
            perigo +
            "). Se for isso mesmo que você quer, religue em modo supervisionado e aprove com s/N."
        );
      }
      console.log("");
      console.log("  [AUTO] $ " + cmdline.replace(/\s*\n\s*/g, " && "));
      const out = await executarComando(cmdline, cwd, timeoutMin);
      audit({ action: "run_command", modo: "auto", resumo: cmdline.slice(0, 200), exitCode: out.code, ms: out.ms });
      return {
        comando: cmdline,
        cwd,
        exitCode: out.code,
        mortoPorTimeout: out.mortoPorTimeout,
        ms: out.ms,
        stdout: corta150k(out.stdout),
        stderr: corta150k(out.stderr),
      };
    }

    // ---- modo supervisionado: caixa + confirmação física s/N
    console.log("");
    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║  PEDIDO DE COMANDO — MODO SUPERVISIONADO              ║");
    console.log("╚═══════════════════════════════════════════════════════╝");
    console.log("  Diretório: " + cwd);
    console.log("  Timeout  : " + timeoutMin + " min");
    console.log("  ┌── comando proposto pela IA ──────────────");
    for (const linha of cmdline.split("\n")) console.log("  │ " + linha);
    console.log("  └───────────────────────────────────────");
    const resposta = await askYesNo(60);
    if (!["s", "sim", "y", "yes"].includes(resposta)) {
      audit({ action: "run_command", resumo: "REJEITADO: " + cmdline.slice(0, 200) });
      throw new Error("Você rejeitou o comando no terminal (resposta: " + (resposta || "vazia") + ")");
    }
    const out = await executarComando(cmdline, cwd, timeoutMin);
    audit({ action: "run_command", resumo: cmdline.slice(0, 200), exitCode: out.code, ms: out.ms });
    return {
      comando: cmdline,
      cwd,
      exitCode: out.code,
      mortoPorTimeout: out.mortoPorTimeout,
      ms: out.ms,
      stdout: corta150k(out.stdout),
      stderr: corta150k(out.stderr),
    };
  },
};

// ---------------------------------------------------------------- loop principal
let cursor = null; // null = primeiro poll (pula histórico antigo)
let connectedOnce = false;

async function processCommand(c) {
  const t0 = Date.now();
  const fn = ACTIONS[c.action];
  let payload;
  if (!fn) {
    payload = {
      id: c.id,
      ok: false,
      error: "Ação desconhecida: " + c.action + " (fora da lista fixa permitida)",
    };
  } else {
    try {
      const data = await fn(c.args || {});
      payload = { id: c.id, ok: true, data, durationMs: Date.now() - t0 };
      if (c.action === "ping") payload.announce = data;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      audit({ action: c.action, ok: false, erro: msg });
      payload = { id: c.id, ok: false, error: msg, durationMs: Date.now() - t0 };
    }
  }
  let json = JSON.stringify(payload);
  if (json.length > 10500000) {
    payload = {
      id: c.id,
      ok: payload.ok,
      error: "Resultado grande demais (" + Math.round(json.length / 1000) + " KB) — refine o comando",
    };
  }
  await apiCall("POST", "/api/ponte/result", payload);
  const estado = payload.ok ? "ok" : "ERRO: " + payload.error;
  log("Comando #" + c.id + " (" + c.action + ") → " + estado);
}

async function main() {
  cfg = loadConfig(parseArgs(process.argv.slice(2)));
  const cli = parseArgs(process.argv.slice(2));
  if (cli.save) saveConfig(cfg);

  console.log("──────────────────────────────────────────────");
  console.log("  Ponte Local — agente v" + VERSION);
  console.log("  Servidor : " + cfg.server);
  console.log(
    "  Modo     : " +
      (!cfg.run
        ? "arquivos apenas"
        : cfg.auto
          ? "autônomo (run_command sem confirmação)"
          : "supervisionado (s/N)")
  );
  console.log("  Escopo   : somente " + cfg.home);
  console.log("  Proteções: pastas sensíveis bloqueadas · exclusões vão para");
  console.log(
    "             a lixeira · " +
      (cfg.run ? (cfg.auto ? "trava anticatástrofe" : "run_command com s/N") : "sem shell/execução")
  );
  console.log("──────────────────────────────────────────────");

  process.on("SIGINT", () => {
    console.log("\nPonte encerrada. Até já!");
    process.exit(0);
  });

  while (true) {
    try {
      const q = cursor === null ? "/api/ponte/poll" : "/api/ponte/poll?cursor=" + cursor;
      const res = await apiCall("GET", q, null);
      if (!res.ok) throw new Error(res.error || "relay recusou o poll");
      cursor = res.nextCursor != null ? res.nextCursor : cursor || 0;
      for (const c of res.commands || []) await processCommand(c);
      if (!connectedOnce) {
        log("Conectado à ponte. Deixe esta janela aberta — é por aqui que eu trabalho.");
        connectedOnce = true;
      }
      await sleep(res.pollMs || 1500);
    } catch (e) {
      if (connectedOnce) {
        log("Conexão caiu (" + e.message + "). Tentando de novo em 5s...");
        connectedOnce = false;
      }
      await sleep(5000);
    }
  }
}

if (require.main === module) main().catch((e) => fail(e.message));
// Exporta apenas para testes automatizados (nada roda quando requerido).
module.exports = { dangerCheck, ALVO_SISTEMA, VERSION };
