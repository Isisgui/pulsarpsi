#!/usr/bin/env node
/**
 * Servidor local do site.
 *
 *   npm run dev        -> http://localhost:8000 usando a planilha de verdade (apiUrl do js/config.js)
 *   npm run dev:mock   -> mesma coisa, mas com uma planilha simulada na memória (sem Google)
 *
 * Opções: --port 8000  --mock
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGas } from "./lib/gas-mock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK_PATH = "/mock/exec";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

// Pastas que existem no repositório mas não fazem parte do site.
const PRIVATE = /^\/(node_modules|scripts|tests|apps-script|\.git)(\/|$)|\/\./;

export function startServer({ port = 8000, mock = false, latencyMs = 0, gasOptions = {} } = {}) {
  const gas = mock ? createGas(gasOptions) : null;
  if (gas) gas.run("setup");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (gas && url.pathname === MOCK_PATH) {
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      const headers = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" };
      if (req.method === "GET") {
        res.writeHead(200, headers).end(JSON.stringify(gas.get(Object.fromEntries(url.searchParams))));
        return;
      }
      if (req.method === "POST") {
        let body = "";
        req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
        req.on("end", () => res.writeHead(200, headers).end(JSON.stringify(gas.post(body))));
        return;
      }
      res.writeHead(405).end();
      return;
    }

    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    if (PRIVATE.test(rel)) return res.writeHead(404).end("Not found");
    const file = path.join(ROOT, path.normalize(rel));
    if (!file.startsWith(ROOT + path.sep)) return res.writeHead(403).end();

    fs.readFile(file, (err, buf) => {
      if (err) return res.writeHead(404).end("Not found");
      if (gas && rel === "/js/config.js") {
        // No modo simulado, aponta a agenda para a planilha na memória.
        const local = `http://${req.headers.host}${MOCK_PATH}`;
        buf = Buffer.from(buf.toString("utf8").replace(/apiUrl:\s*"[^"]*"/, `apiUrl: "${local}"`));
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(buf);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const actual = server.address().port;
      resolve({ server, gas, url: `http://localhost:${actual}/`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const mock = args.includes("--mock");
  const i = args.indexOf("--port");
  const port = i >= 0 ? Number(args[i + 1]) : Number(process.env.PORT || 8000);
  const { url } = await startServer({ port, mock, latencyMs: mock ? 400 : 0 });
  console.log(`\n  Pulsar rodando em ${url}`);
  console.log(mock
    ? "  Modo simulado: planilha na memória (some ao fechar). Nada vai para o Google.\n"
    : "  Usando a planilha de verdade (apiUrl do js/config.js).\n");
}
