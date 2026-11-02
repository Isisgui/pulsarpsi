/**
 * Testes do js/api.js com um "navegador" falso (fetch e location simulados).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const API_SRC = fs.readFileSync(new URL("../js/api.js", import.meta.url), "utf8");
const CONFIG_SRC = fs.readFileSync(new URL("../js/config.js", import.meta.url), "utf8");
const GOOGLE = "https://script.google.com/macros/s/AKfycbTESTE/exec";

function load({ apiUrl = GOOGLE, host = "usuario.github.io", respond, timeoutMs } = {}) {
  const calls = [];
  const warnings = [];
  const window = {
    PULSAR_CONFIG: { apiUrl, timeoutMs },
    location: { hostname: host },
    console: { warn: (m) => warnings.push(m) },
  };
  const fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return respond(String(url), opts);
  };
  const ctx = vm.createContext({ window, fetch, URL, AbortController, setTimeout, clearTimeout, console: window.console });
  vm.runInContext(API_SRC, ctx);
  return { api: window.PulsarAPI, util: window.PulsarUtil, calls, warnings };
}

const jsonRes = (obj, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(obj) });

describe("js/config.js", () => {
  test("é JavaScript válido e tem os campos esperados", () => {
    const window = {};
    vm.runInContext(CONFIG_SRC, vm.createContext({ window }));
    const c = window.PULSAR_CONFIG;
    assert.equal(typeof c.apiUrl, "string");
    assert.equal(typeof c.daysAhead, "number");
    assert.match(c.whatsapp, /^\d+$/);
    if (c.apiUrl) assert.match(c.apiUrl, /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/, "apiUrl deve terminar em /exec");
  });
});

describe("js/api.js", () => {
  test("busca horários com from/to e devolve o mapa", async () => {
    const { api, calls } = load({ respond: () => jsonRes({ ok: true, slots: { "2026-11-03": ["13:00"] } }) });
    const slots = await api.getAvailability(new Date(2026, 10, 2), new Date(2026, 11, 31));
    assert.equal(JSON.stringify(slots), JSON.stringify({ "2026-11-03": ["13:00"] }));
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, GOOGLE);
    assert.equal(u.searchParams.get("action"), "availability");
    assert.equal(u.searchParams.get("from"), "2026-11-02");
    assert.equal(u.searchParams.get("to"), "2026-12-31");
    assert.equal(calls[0].opts.credentials, "omit");
  });

  test("agendamento vai como text/plain (sem preflight de CORS)", async () => {
    const { api, calls } = load({ respond: () => jsonRes({ ok: true }) });
    await api.book({ date: "2026-11-03", time: "13:00", name: "Ana" });
    const { opts } = calls[0];
    assert.equal(opts.method, "POST");
    assert.equal(opts.headers["Content-Type"], "text/plain;charset=utf-8");
    assert.deepStrictEqual(JSON.parse(opts.body), { action: "book", date: "2026-11-03", time: "13:00", name: "Ana" });
  });

  test("erro do servidor chega com a mensagem e o código", async () => {
    const { api } = load({ respond: () => jsonRes({ ok: false, code: "TAKEN", error: "Esse horário acabou de ser reservado." }) });
    await assert.rejects(api.book({}), (e) => e.code === "TAKEN" && /reservado/.test(e.message));
  });

  test("página HTML do Google (falta autorização/publicação) vira mensagem amigável", async () => {
    const { api, warnings } = load({ respond: () => ({ ok: true, status: 200, text: async () => "<!DOCTYPE html><title>Google Drive</title>" }) });
    await assert.rejects(api.getAvailability(new Date(), new Date()), (e) => e.code === "NOT_JSON" && /WhatsApp/.test(e.message));
    assert.match(warnings[0], /NOT_JSON/);
  });

  test("HTTP 500 e falha de rede", async () => {
    const a = load({ respond: () => jsonRes({}, 500) });
    await assert.rejects(a.api.getAvailability(new Date(), new Date()), (e) => e.code === "HTTP_500");
    const b = load({ respond: () => { throw new TypeError("Failed to fetch"); } });
    await assert.rejects(b.api.getAvailability(new Date(), new Date()), (e) => e.code === "NETWORK");
  });

  test("desiste depois do tempo limite", async () => {
    const { api } = load({
      timeoutMs: 50,
      respond: (url, opts) => new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    });
    await assert.rejects(api.getAvailability(new Date(), new Date()), (e) => e.code === "NETWORK" && e.detail === "tempo esgotado");
  });

  test("apiUrl vazio: não faz requisição e avisa", async () => {
    const { api, calls } = load({ apiUrl: "", respond: () => jsonRes({ ok: true }) });
    assert.equal(api.isConfigured, false);
    await assert.rejects(api.getAvailability(new Date(), new Date()), (e) => e.code === "NOT_CONFIGURED");
    assert.equal(calls.length, 0);
  });

  const refused = {
    "outro domínio": "https://evil.example.com/exec",
    "Google sem https": "http://script.google.com/macros/s/X/exec",
    "URL de teste /dev": "https://script.google.com/macros/s/X/dev",
    "domínio parecido": "https://script.google.com.evil.io/macros/s/X/exec",
    "texto qualquer": "planilha",
    "servidor local num site publicado": "http://localhost:8000/mock/exec",
  };
  for (const [label, apiUrl] of Object.entries(refused)) {
    test(`recusa apiUrl: ${label}`, async () => {
      const { api, calls } = load({ apiUrl, respond: () => jsonRes({ ok: true, slots: {} }) });
      await assert.rejects(api.getAvailability(new Date(), new Date()), (e) => e.code === "BAD_URL" || e.code === "NOT_CONFIGURED");
      assert.equal(calls.length, 0, "nenhum dado pode sair para esse endereço");
    });
  }

  test("aceita servidor local quando o próprio site está rodando local", async () => {
    const { api, calls } = load({ apiUrl: "http://localhost:8000/mock/exec", host: "localhost", respond: () => jsonRes({ ok: true, slots: {} }) });
    await api.getAvailability(new Date(), new Date());
    assert.equal(calls.length, 1);
  });

  test("utilitários de data", () => {
    const { util } = load({ respond: () => jsonRes({ ok: true }) });
    assert.equal(util.dateKey(new Date(2026, 0, 5)), "2026-01-05");
    assert.equal(util.parseKey("2026-01-05").getDate(), 5);
  });
});
