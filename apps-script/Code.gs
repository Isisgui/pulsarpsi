/**
 * @OnlyCurrentDoc
 *
 * Pulsar Psicologia — "backend" da agenda, preso a uma planilha Google.
 *
 * SEGURANÇA
 *   - @OnlyCurrentDoc + appsscript.json: o script só enxerga ESTA planilha
 *     (escopo spreadsheets.currentonly) e só pode enviar e-mail. Nenhum outro
 *     arquivo do Drive é acessível.
 *   - A API pública só faz duas coisas: listar horários livres e criar um
 *     agendamento. Nenhum dado de paciente é devolvido.
 *
 * ABAS (criadas sozinhas se não existirem)
 *   Horarios      -> horários fixos de cada dia da semana
 *   Bloqueios     -> folgas, feriados ou horários específicos fechados
 *   Agendamentos  -> preenchida pelo site
 *
 * API (App da Web)
 *   GET  ?action=availability&from=AAAA-MM-DD&to=AAAA-MM-DD
 *   GET  ?action=health                 diagnóstico, sem dados pessoais
 *   POST {"action":"book", date, time, name, phone, email, mode, notes}
 *
 * Funções para rodar pelo editor: `setup` (cria as abas e pede autorização)
 * e `teste` (mostra o diagnóstico). As demais terminam em "_" e ficam ocultas.
 */

var VERSION = '2026-11-03.1';

var DAYS_AHEAD = 60;              // até quantos dias à frente o site mostra
var MIN_NOTICE_HOURS = 12;        // antecedência mínima para agendar
var NOTIFY_BY_EMAIL = true;       // e-mail para a dona da planilha a cada agendamento

// Proteção contra abuso (o endereço do App da Web é público).
// Acima disso o agendamento é salvo com status "revisar" (e avisado no e-mail),
// mas a resposta ao site é idêntica à de um agendamento normal: assim ninguém
// descobre, testando o WhatsApp/e-mail de outra pessoa, se ela é paciente.
var MAX_ACTIVE_PER_CONTACT = 2;   // agendamentos futuros ativos por WhatsApp/e-mail
var MAX_BOOKINGS_PER_HOUR = 15;   // teto geral de novos agendamentos por hora
var MODES = ['Online'];          // atendimento apenas online

var SHEET_HOURS = 'Horarios';
var SHEET_BLOCKS = 'Bloqueios';
var SHEET_BOOKINGS = 'Agendamentos';

var HEADERS = {
  Horarios: ['Dia da semana', 'Horários (separados por vírgula)'],
  Bloqueios: ['Data', 'Horário (vazio = dia todo)', 'Motivo'],
  Agendamentos: ['Criado em', 'Data', 'Horário', 'Nome', 'WhatsApp', 'E-mail', 'Modalidade', 'Observações', 'Status']
};

var DEFAULT_HOURS = [
  ['Segunda', '09:00, 10:00, 11:00, 14:00, 15:00, 16:00'],
  ['Terça', '13:00, 14:00, 15:00, 16:00, 17:00, 18:00'],
  ['Quarta', '09:00, 10:00, 11:00, 14:00, 15:00'],
  ['Quinta', '13:00, 14:00, 15:00, 16:00, 17:00, 18:00'],
  ['Sexta', '09:00, 10:00, 11:00']
];

var WEEKDAYS = [
  ['domingo', 'dom', 'sunday', 'sun'],
  ['segunda', 'seg', 'monday', 'mon'],
  ['terca', 'ter', 'tuesday', 'tue'],
  ['quarta', 'qua', 'wednesday', 'wed'],
  ['quinta', 'qui', 'thursday', 'thu'],
  ['sexta', 'sex', 'friday', 'fri'],
  ['sabado', 'sab', 'saturday', 'sat']
];

var MSG = {
  read: 'Erro ao ler a agenda.',
  book: 'Não foi possível concluir o agendamento. Tente novamente.',
  taken: 'Esse horário acabou de ser reservado. Escolha outro, por favor.',
  busy: 'A agenda está ocupada agora. Tente de novo em instantes.',
  hourly: 'Muitos agendamentos agora. Tente de novo mais tarde ou fale pelo WhatsApp.'
};

/* ========================================================================== */
/* Endpoints                                                                  */
/* ========================================================================== */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'health') return json_(health_());
    if (p.action === 'availability') {
      var ctx = context_();
      return json_({ ok: true, slots: availability_(ctx, p.from, p.to) });
    }
    return json_({ ok: false, code: 'BAD_ACTION', error: 'Ação desconhecida.' });
  } catch (err) {
    log_('doGet', err);
    return json_({ ok: false, code: err.code || 'INTERNAL', error: MSG.read });
  }
}

function doPost(e) {
  try {
    var raw = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    if (!raw || raw.length > 5000) return json_({ ok: false, code: 'BAD_REQUEST', error: 'Pedido inválido.' });

    var data;
    try { data = JSON.parse(raw); } catch (parseErr) { data = null; }
    if (!data || typeof data !== 'object' || data.action !== 'book') {
      return json_({ ok: false, code: 'BAD_REQUEST', error: 'Pedido inválido.' });
    }

    // Campo-armadilha: só robôs preenchem. Finge sucesso e descarta.
    if (data.website) return json_({ ok: true });

    var invalid = validate_(data);
    if (invalid) return json_({ ok: false, code: 'INVALID', error: invalid });

    var ctx = context_();
    var result = withLock_(function () { return book_(ctx, data); });
    if (!result.ok) return json_(result);
    // `result.status` fica só aqui no servidor: a resposta é sempre a mesma.

    if (NOTIFY_BY_EMAIL) {
      try { notify_(data, result.status); } catch (mailErr) { log_('notify', mailErr); } // o agendamento já foi salvo
    }
    return json_({ ok: true });
  } catch (err) {
    log_('doPost', err);
    return json_({ ok: false, code: err.code || 'INTERNAL', error: err.code === 'BUSY' ? MSG.busy : MSG.book });
  }
}

/* ========================================================================== */
/* Funções para rodar pelo editor                                             */
/* ========================================================================== */

/** Cria as abas que faltam e dispara o pedido de autorização. */
function setup() {
  var ss = spreadsheet_();
  ensureSheets_(ss);
  Logger.log('Pronto: abas conferidas na planilha "' + ss.getName() + '".');
}

/** Mostra o diagnóstico. O resultado aparece como erro (em vermelho) de propósito. */
function teste() {
  var h = health_();
  var msg = h.ok
    ? 'OK (versão ' + h.version + '). Dias com horário livre nos próximos ' + DAYS_AHEAD + ' dias: ' + h.freeDays + '.'
    : 'PROBLEMA [' + h.code + ']: ' + h.error;
  Logger.log(msg);
  throw new Error('[resultado do teste] ' + msg);
}

/* ========================================================================== */
/* Regras de agenda                                                           */
/* ========================================================================== */

function availability_(ctx, fromKey, toKey) {
  var todayKey = Utilities.formatDate(ctx.now, ctx.tz, 'yyyy-MM-dd');
  var minStamp = Utilities.formatDate(new Date(ctx.now.getTime() + MIN_NOTICE_HOURS * 3600000), ctx.tz, 'yyyy-MM-dd HH:mm');
  var limitKey = addDays_(todayKey, DAYS_AHEAD);

  var from = isDateKey_(fromKey) && fromKey > todayKey ? fromKey : todayKey;
  var to = isDateKey_(toKey) && toKey < limitKey ? toKey : limitKey;

  var weekly = readWeekly_(ctx);
  var blocks = readBlocks_(ctx);
  var taken = {};
  readBookings_(ctx).forEach(function (b) {
    if (b.active) taken[b.date + ' ' + b.time] = true;
  });

  var out = {};
  for (var key = from, guard = 0; key <= to && guard <= DAYS_AHEAD; key = addDays_(key, 1), guard++) {
    if (blocks[key + ' *']) continue;
    var free = (weekly[weekday_(key)] || []).filter(function (t) {
      var slot = key + ' ' + t;
      return slot >= minStamp && !blocks[slot] && !taken[slot];
    });
    if (free.length) out[key] = free;
  }
  return out;
}

function book_(ctx, d) {
  var cache = CacheService.getScriptCache();
  var hourKey = 'bookings-' + Math.floor(ctx.now.getTime() / 3600000);
  var count = Number(cache.get(hourKey) || 0);
  if (count >= MAX_BOOKINGS_PER_HOUR) return { ok: false, code: 'RATE_LIMIT', error: MSG.hourly };

  var free = availability_(ctx, d.date, d.date)[d.date] || [];
  if (free.indexOf(d.time) === -1) return { ok: false, code: 'TAKEN', error: MSG.taken };

  var todayKey = Utilities.formatDate(ctx.now, ctx.tz, 'yyyy-MM-dd');
  var phone = digits_(d.phone);
  var email = String(d.email).trim().toLowerCase();
  var active = readBookings_(ctx).filter(function (b) {
    return b.active && b.date >= todayKey && (b.phone === phone || b.email === email);
  }).length;
  // Não recusa nem muda a resposta (isso revelaria quem já é paciente): só marca para revisão.
  var status = active >= MAX_ACTIVE_PER_CONTACT ? 'revisar' : 'pendente';

  ctx.ss.getSheetByName(SHEET_BOOKINGS).appendRow([
    new Date(ctx.now.getTime()), d.date, d.time, clean_(d.name), clean_(d.phone),
    clean_(email), clean_(d.mode), clean_(d.notes), status
  ]);
  SpreadsheetApp.flush();
  cache.put(hourKey, String(count + 1), 3600);
  return { ok: true, status: status };
}

/* ========================================================================== */
/* Leitura da planilha                                                        */
/* ========================================================================== */

function readWeekly_(ctx) {
  var map = {};
  rows_(ctx.ss, SHEET_HOURS).forEach(function (r) {
    var day = weekdayIndex_(r[0]);
    if (day === -1) return;
    var times = [];
    r.slice(1).forEach(function (cell) {
      if (cell instanceof Date || typeof cell === 'number') {
        var t = cellTime_(cell, ctx.sheetTz);
        if (t) times.push(t);
      } else {
        String(cell || '').split(/[,;\s]+/).forEach(function (part) {
          var t2 = normTime_(part);
          if (t2) times.push(t2);
        });
      }
    });
    map[day] = unique_((map[day] || []).concat(times)).sort();
  });
  return map;
}

function readBlocks_(ctx) {
  var map = {};
  rows_(ctx.ss, SHEET_BLOCKS).forEach(function (r) {
    var key = cellDate_(r[0], ctx.sheetTz);
    if (!key) return;
    var time = cellTime_(r[1], ctx.sheetTz);
    map[key + ' ' + (time || '*')] = true;
  });
  return map;
}

function readBookings_(ctx) {
  return rows_(ctx.ss, SHEET_BOOKINGS).map(function (r) {
    var date = cellDate_(r[1], ctx.sheetTz);
    var time = cellTime_(r[2], ctx.sheetTz);
    var status = String(r[8] || '').trim().toLowerCase();
    return {
      date: date,
      time: time,
      phone: digits_(r[4]),
      email: String(r[5] || '').trim().toLowerCase(),
      active: Boolean(date && time) && status !== 'cancelado' && status !== 'cancelada'
    };
  });
}

function rows_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getDataRange().getValues().slice(1);
}

/* ========================================================================== */
/* Planilha: acesso, criação das abas e diagnóstico                           */
/* ========================================================================== */

function spreadsheet_() {
  var ss = SpreadsheetApp.getActive();
  if (!ss) {
    throw coded_('NO_SPREADSHEET',
      'O script não está ligado a uma planilha. Crie-o pela planilha em Extensões > Apps Script.');
  }
  return ss;
}

function context_() {
  var ss = spreadsheet_();
  if (!ss.getSheetByName(SHEET_HOURS) || !ss.getSheetByName(SHEET_BLOCKS) || !ss.getSheetByName(SHEET_BOOKINGS)) {
    withLock_(function () { ensureSheets_(ss); });
  }
  return {
    ss: ss,
    now: new Date(),
    tz: Session.getScriptTimeZone(),
    sheetTz: ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone()
  };
}

function ensureSheets_(ss) {
  ensureSheet_(ss, SHEET_HOURS, DEFAULT_HOURS, ['B:B']);
  ensureSheet_(ss, SHEET_BLOCKS, [], ['B:B']);
  var bookings = ensureSheet_(ss, SHEET_BOOKINGS, [], ['B:C']);
  bookings.getRange('I2:I').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['pendente', 'revisar', 'confirmado', 'cancelado'])
      .setAllowInvalid(true)
      .build()
  );
}

function ensureSheet_(ss, name, rows, textColumns) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  (textColumns || []).forEach(function (a1) { sheet.getRange(a1).setNumberFormat('@'); });
  if (sheet.getLastRow() === 0) {
    var header = HEADERS[name];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#dac4e0');
    sheet.setFrozenRows(1);
    rows.forEach(function (r) { sheet.appendRow(r); });
  }
  return sheet;
}

/** Diagnóstico sem dados pessoais. Usado por ?action=health e por `teste`. */
function health_() {
  var out = { ok: false, version: VERSION, checks: {} };
  try {
    var ctx = context_();
    out.checks.spreadsheet = true;
    out.checks.tabs = true;
    out.timezone = { script: ctx.tz, spreadsheet: ctx.sheetTz };

    var weekly = readWeekly_(ctx);
    var slotsPerWeek = 0;
    for (var day in weekly) slotsPerWeek += weekly[day].length;
    out.checks.weeklySlots = slotsPerWeek;

    out.freeDays = Object.keys(availability_(ctx)).length;
    out.checks.notifyEmail = NOTIFY_BY_EMAIL ? Boolean(Session.getEffectiveUser().getEmail()) : 'off';
    out.ok = true;
    if (!slotsPerWeek) {
      out.ok = false;
      out.code = 'NO_HOURS';
      out.error = 'A aba "' + SHEET_HOURS + '" não tem nenhum horário válido.';
    }
  } catch (err) {
    log_('health', err);
    out.code = err.code || 'INTERNAL';
    out.error = String(err && err.message || err).slice(0, 300);
  }
  return out;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw coded_('BUSY', MSG.busy);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ========================================================================== */
/* Validação, limpeza e e-mail                                                */
/* ========================================================================== */

function validate_(d) {
  var str = function (v) { return typeof v === 'string' ? v : ''; };
  if (!isDateKey_(d.date)) return 'Data inválida.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(str(d.time))) return 'Horário inválido.';
  var name = str(d.name).trim();
  if (name.length < 3 || name.length > 120) return 'Informe seu nome.';
  var phone = digits_(str(d.phone));
  if (phone.length < 10 || phone.length > 13) return 'Informe um WhatsApp com DDD.';
  var email = str(d.email).trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Informe um e-mail válido.';
  if (MODES.indexOf(d.mode) === -1) return 'Escolha a modalidade.';
  if (d.notes != null && typeof d.notes !== 'string') return 'Observações inválidas.';
  if (str(d.notes).length > 1000) return 'Observações muito longas.';
  return '';
}

// Tira caracteres de controle e impede que o texto vire fórmula na planilha.
function clean_(v) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ').trim().slice(0, 500);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function notify_(d, status) {
  var to = Session.getEffectiveUser().getEmail();
  if (!to) return;
  var review = status === 'revisar';
  MailApp.sendEmail(to, (review ? '[REVISAR] ' : '') + 'Novo agendamento: ' + d.date + ' às ' + d.time,
    (review
      ? 'ATENÇÃO: este WhatsApp/e-mail já tinha ' + MAX_ACTIVE_PER_CONTACT + ' ou mais horários futuros.\n' +
        'Pode ser a mesma pessoa marcando mais sessões, ou alguém usando os dados de outra pessoa.\n' +
        'O horário fica reservado com status "revisar" até você confirmar ou cancelar.\n\n'
      : '') +
    'Nome: ' + d.name + '\nWhatsApp: ' + d.phone + '\nE-mail: ' + d.email +
    '\nModalidade: ' + d.mode + '\nObservações: ' + (d.notes || '-') +
    '\n\nConfira a aba "' + SHEET_BOOKINGS + '" da planilha.');
}

/* ========================================================================== */
/* Datas e horários (sempre como texto "AAAA-MM-DD" e "HH:mm")                */
/* ========================================================================== */

function isDateKey_(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  var p = v.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function addDays_(key, n) {
  var p = key.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + pad_(d.getUTCMonth() + 1) + '-' + pad_(d.getUTCDate());
}

function weekday_(key) {
  var p = key.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

function weekdayIndex_(v) {
  if (typeof v === 'number') return v >= 0 && v <= 6 ? v : -1;
  var s = String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (!s) return -1;
  if (/^[0-6]$/.test(s)) return Number(s);
  for (var i = 0; i < WEEKDAYS.length; i++) {
    for (var j = 0; j < WEEKDAYS[i].length; j++) {
      if (s.indexOf(WEEKDAYS[i][j]) === 0) return i;
    }
  }
  return -1;
}

/** Data de uma célula: objeto Date, "AAAA-MM-DD" ou "DD/MM/AAAA". */
function cellDate_(v, tz) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim();
  var br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) s = br[3] + '-' + pad_(br[2]) + '-' + pad_(br[1]);
  return isDateKey_(s) ? s : '';
}

/** Horário de uma célula: objeto Date, fração do dia (número) ou texto "9", "9h", "09:00". */
function cellTime_(v, tz) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'HH:mm');
  if (typeof v === 'number') {
    if (v >= 1 && v <= 23 && v % 1 === 0) return pad_(v) + ':00'; // "14" digitado como número
    if (v < 0 || v >= 1) return '';
    var mins = Math.round(v * 1440);
    return pad_(Math.floor(mins / 60)) + ':' + pad_(mins % 60);
  }
  return normTime_(v);
}

function normTime_(v) {
  var m = String(v == null ? '' : v).trim().toLowerCase().match(/^(\d{1,2})(?:[:h](\d{2})?)?h?$/);
  if (!m) return '';
  var h = Number(m[1]);
  var min = Number(m[2] || 0);
  if (h > 23 || min > 59) return '';
  return pad_(h) + ':' + pad_(min);
}

/* ========================================================================== */
/* Utilidades                                                                 */
/* ========================================================================== */

function pad_(n) {
  return ('0' + n).slice(-2);
}

function digits_(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

function unique_(list) {
  return list.filter(function (x, i) { return list.indexOf(x) === i; });
}

function coded_(code, message) {
  var err = new Error(message);
  err.code = code;
  return err;
}

function log_(where, err) {
  console.error(where + ': ' + (err && err.stack || err));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
