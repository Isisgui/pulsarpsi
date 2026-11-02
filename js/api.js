/**
 * Camada de dados da agenda — App da Web do Google Apps Script (apps-script/Code.gs).
 *
 * Expõe `window.PulsarAPI`:
 *   getAvailability(from, to) -> Promise<{ "AAAA-MM-DD": ["09:00", ...] }>
 *   book(booking)             -> Promise<{ ok: true }>   (rejeita com Error)
 *   health()                  -> Promise<objeto de diagnóstico>
 *
 * Erros têm `.code` (ex.: NOT_CONFIGURED, NETWORK, NOT_JSON, TAKEN) e uma
 * mensagem pronta para mostrar a quem está agendando.
 */
(function () {
  "use strict";

  const cfg = window.PULSAR_CONFIG || {};
  const TIMEOUT_MS = cfg.timeoutMs || 20000;

  const pad = (n) => String(n).padStart(2, "0");
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  window.PulsarUtil = { pad, dateKey, parseKey };

  const MSG = {
    unavailable: "A agenda online está indisponível no momento. Fale comigo pelo WhatsApp, por favor.",
    network: "Não foi possível falar com a agenda agora. Verifique sua internet e tente novamente.",
    generic: "Algo deu errado. Tente novamente.",
  };

  function fail(code, message, detail) {
    const err = new Error(message);
    err.code = code;
    if (detail) err.detail = detail;
    // Pista para quem está configurando (aparece no console do navegador).
    if (window.console && code !== "TAKEN" && code !== "INVALID") {
      console.warn(`[Pulsar] agenda: ${code}${detail ? " — " + detail : ""}`);
    }
    return err;
  }

  const isLocal = (host) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";

  /** Só aceita o Apps Script do Google (ou um servidor local, se o próprio site estiver local). */
  function endpoint() {
    const raw = String(cfg.apiUrl || "").trim();
    if (!raw) throw fail("NOT_CONFIGURED", MSG.unavailable, "apiUrl vazio em js/config.js");
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw fail("BAD_URL", MSG.unavailable, "apiUrl inválida em js/config.js");
    }
    const google = url.protocol === "https:" && url.hostname === "script.google.com" && /\/exec$/.test(url.pathname);
    const local = isLocal(url.hostname) && isLocal(window.location.hostname);
    if (!google && !local) throw fail("BAD_URL", MSG.unavailable, "apiUrl precisa ser https://script.google.com/macros/s/…/exec");
    return url;
  }

  async function request(url, options) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { ...options, signal: ctrl.signal, credentials: "omit", redirect: "follow", cache: "no-store" });
    } catch (e) {
      throw fail("NETWORK", MSG.network, e && e.name === "AbortError" ? "tempo esgotado" : String(e));
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw fail("HTTP_" + res.status, MSG.network, `HTTP ${res.status}`);

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // O Google devolve uma página HTML quando o App da Web não está autorizado
      // ou não está publicado para "Qualquer pessoa".
      throw fail("NOT_JSON", MSG.unavailable, "o Apps Script respondeu com HTML — rode `npm run check`");
    }
    if (!data || typeof data !== "object") throw fail("NOT_JSON", MSG.unavailable, "resposta vazia");
    if (!data.ok) throw fail(data.code || "ERROR", data.error || MSG.generic, data.code);
    return data;
  }

  window.PulsarAPI = {
    isConfigured: Boolean(String(cfg.apiUrl || "").trim()),

    async getAvailability(from, to) {
      const url = endpoint();
      url.searchParams.set("action", "availability");
      url.searchParams.set("from", dateKey(from));
      url.searchParams.set("to", dateKey(to));
      const data = await request(url, { method: "GET" });
      return data.slots && typeof data.slots === "object" ? data.slots : {};
    },

    async book(booking) {
      // text/plain evita o preflight de CORS, que o Apps Script não responde.
      return request(endpoint(), {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "book", ...booking }),
      });
    },

    async health() {
      const url = endpoint();
      url.searchParams.set("action", "health");
      return request(url, { method: "GET" });
    },
  };
})();
