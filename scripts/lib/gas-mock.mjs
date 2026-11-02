/**
 * Simulação local dos serviços do Google Apps Script usados por apps-script/Code.gs.
 *
 * Usada pelos testes e pelo `npm run dev:mock`. Reproduz os comportamentos que
 * costumam quebrar scripts de verdade:
 *   - a planilha converte "2026-11-03" e "09:00" em datas quando a coluna não é texto;
 *   - fuso horário do script, da planilha e do computador podem ser diferentes;
 *   - script fora de uma planilha (getActive() devolve null);
 *   - trava ocupada, e-mail falhando, cache por hora.
 */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CODE_PATH = path.join(ROOT, "apps-script/Code.gs");

/* ------------------------------------------------------------------------ */
/* Datas com fuso                                                           */
/* ------------------------------------------------------------------------ */
const partsCache = new Map();
function zonedParts(date, tz) {
  let fmt = partsCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    partsCache.set(tz, fmt);
  }
  const p = {};
  for (const { type, value } of fmt.formatToParts(date)) p[type] = value;
  return p;
}

export function formatDate(date, tz, pattern) {
  const p = zonedParts(date, tz);
  return pattern
    .replace("yyyy", p.year).replace("MM", p.month).replace("dd", p.day)
    .replace("HH", p.hour).replace("mm", p.minute).replace("ss", p.second);
}

/** Instante em que o relógio de `tz` marca a data/hora dada. */
export function zonedDate(y, mo, d, h = 0, mi = 0, tz = "UTC") {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), tz);
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    guess += Date.UTC(y, mo - 1, d, h, mi) - shown;
  }
  return new Date(guess);
}

/* ------------------------------------------------------------------------ */
/* Planilha                                                                 */
/* ------------------------------------------------------------------------ */
function colIndex(letters) {
  return [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

class MockSheet {
  constructor(spreadsheet, name) {
    this.ss = spreadsheet;
    this.name = name;
    this.rows = [];
    this.textCols = new Set();
    this.frozen = 0;
    this.validation = null;
  }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  setFrozenRows(n) { this.frozen = n; }

  /** O que a planilha de verdade faz com um valor digitado/colado. */
  coerce(value, col) {
    if (typeof value !== "string") return value;
    if (value.startsWith("'")) return value.slice(1);
    // Como no Google: texto começando com = + - @ vira fórmula, mesmo em coluna de texto.
    if (/^[=+\-@]/.test(value) && !/^-?\d/.test(value)) return { formula: value };
    if (this.textCols.has(col)) return value;
    const tz = this.ss.tz;
    let m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return zonedDate(+m[1], +m[2], +m[3], 0, 0, tz);
    m = value.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return zonedDate(1899, 12, 30, +m[1], +m[2], tz);
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    return value;
  }

  appendRow(values) {
    this.rows.push(values.map((v, i) => this.coerce(v, i)));
    return this;
  }

  /** Atalho dos testes: grava valores "crus", como se viessem da planilha. */
  setRawRows(rows) { this.rows = rows.map((r) => r.slice()); }

  getDataRange() {
    const width = Math.max(1, ...this.rows.map((r) => r.length));
    return { getValues: () => this.rows.map((r) => Array.from({ length: width }, (_, i) => (r[i] === undefined || r[i] === null ? "" : r[i]))) };
  }

  getRange(a1OrRow, col, numRows, numCols) {
    const sheet = this;
    let cols = [];
    if (typeof a1OrRow === "string") {
      const m = a1OrRow.match(/^([A-Z]+)\d*:([A-Z]+)\d*$/i);
      if (!m) throw new Error("Intervalo não suportado no mock: " + a1OrRow);
      for (let c = colIndex(m[1]); c <= colIndex(m[2]); c++) cols.push(c);
    } else {
      for (let c = col - 1; c < col - 1 + (numCols || 1); c++) cols.push(c);
    }
    const range = {
      setNumberFormat(fmt) { if (fmt === "@") cols.forEach((c) => sheet.textCols.add(c)); return range; },
      setFontWeight() { return range; },
      setBackground() { return range; },
      setDataValidation(rule) { sheet.validation = rule; return range; },
    };
    return range;
  }
}

class MockSpreadsheet {
  constructor({ name = "Agenda Pulsar", tz = "America/Sao_Paulo" } = {}) {
    this.name = name;
    this.tz = tz;
    this.sheets = new Map();
  }
  getName() { return this.name; }
  getSpreadsheetTimeZone() { return this.tz; }
  getSheets() { return [...this.sheets.values()]; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    if (this.sheets.has(name)) throw new Error(`Já existe uma aba chamada "${name}".`);
    const s = new MockSheet(this, name);
    this.sheets.set(name, s);
    return s;
  }
  /** Linhas da aba sem o cabeçalho (atalho dos testes). */
  data(name) { return this.getSheetByName(name).getDataRange().getValues().slice(1); }
}

/* ------------------------------------------------------------------------ */
/* Ambiente do Apps Script                                                  */
/* ------------------------------------------------------------------------ */
/**
 * Cria um "projeto Apps Script" com o Code.gs carregado.
 * @param {object} opts
 *   now          Date|number|function — relógio do script (padrão: agora real)
 *   scriptTz     fuso do script (appsscript.json)
 *   sheetTz      fuso da planilha
 *   bound        false simula script fora de uma planilha
 *   ownerEmail   e-mail da conta dona
 */
export function createGas(opts = {}) {
  const RealDate = Date;
  let clock = opts.now ?? null;
  const nowMs = () => {
    if (clock === null) return RealDate.now();
    if (typeof clock === "function") return +clock();
    return +clock;
  };

  class ScriptDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(nowMs());
      else super(...args);
    }
    static now() { return nowMs(); }
    static [Symbol.hasInstance](v) { return v instanceof RealDate; }
  }

  const scriptTz = opts.scriptTz || "America/Sao_Paulo";
  const ss = opts.bound === false ? null : new MockSpreadsheet({ tz: opts.sheetTz || scriptTz });
  const mails = [];
  const logs = [];
  const cache = new Map();
  const state = { lockFree: true, mailFails: false, lockAttempts: 0 };

  const sandbox = {
    Date: ScriptDate,
    console: {
      log: (...a) => logs.push(["log", a.join(" ")]),
      error: (...a) => logs.push(["error", a.join(" ")]),
      warn: (...a) => logs.push(["warn", a.join(" ")]),
    },
    Logger: { log: (m) => logs.push(["log", String(m)]) },
    SpreadsheetApp: {
      getActive: () => ss,
      getActiveSpreadsheet: () => ss,
      flush() {},
      newDataValidation() {
        const rule = { values: null, allowInvalid: false };
        const b = {
          requireValueInList(v) { rule.values = v; return b; },
          setAllowInvalid(x) { rule.allowInvalid = x; return b; },
          build: () => rule,
        };
        return b;
      },
    },
    Session: {
      getScriptTimeZone: () => scriptTz,
      getEffectiveUser: () => ({ getEmail: () => opts.ownerEmail ?? "dona@example.com" }),
    },
    Utilities: { formatDate },
    LockService: {
      getScriptLock: () => {
        let held = false;
        return {
          tryLock() { state.lockAttempts++; if (!state.lockFree) return false; held = true; return true; },
          waitLock() { if (!state.lockFree) throw new Error("Lock timeout"); held = true; },
          releaseLock() { held = false; },
          hasLock: () => held,
        };
      },
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); },
      }),
    },
    MailApp: {
      sendEmail(to, subject, body) {
        if (state.mailFails) throw new Error("Service invoked too many times: email");
        mails.push({ to, subject, body });
      },
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text) => ({
        mime: null,
        setMimeType(m) { this.mime = m; return this; },
        getContent: () => text,
      }),
    },
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CODE_PATH, "utf8"), context, { filename: "Code.gs" });

  const call = (fn, ...args) => {
    const out = context[fn](...args);
    return out && typeof out.getContent === "function" ? JSON.parse(out.getContent()) : out;
  };

  return {
    ss, mails, logs, cache, state, context,
    setNow(v) { clock = v; },
    get: (params = {}) => call("doGet", { parameter: params }),
    post: (body) => call("doPost", { postData: { contents: typeof body === "string" ? body : JSON.stringify(body), type: "text/plain" } }),
    run: (fn) => context[fn](),
    version: () => context.VERSION,
  };
}
