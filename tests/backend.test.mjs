/**
 * Testes do apps-script/Code.gs rodando sobre a simulação do Google (scripts/lib/gas-mock.mjs).
 * Relógio fixo: segunda-feira, 02/11/2026, 08:00 em São Paulo.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createGas, zonedDate } from "../scripts/lib/gas-mock.mjs";

const SP = "America/Sao_Paulo";
const NOW = zonedDate(2026, 11, 2, 8, 0, SP); // segunda 08:00

function ready(opts = {}) {
  const gas = createGas({ now: NOW, ...opts });
  if (gas.ss) gas.run("setup");
  return gas;
}

const person = (over = {}) => ({
  action: "book",
  date: "2026-11-03",
  time: "13:00",
  name: "Ana Souza",
  phone: "(11) 98888-7777",
  email: "ana@example.com",
  mode: "Online",
  notes: "",
  website: "",
  ...over,
});

describe("configuração da planilha", () => {
  test("setup cria as três abas com cabeçalho e horários de exemplo", () => {
    const gas = ready();
    assert.deepEqual(gas.ss.getSheets().map((s) => s.getName()), ["Horarios", "Bloqueios", "Agendamentos"]);
    assert.equal(gas.ss.data("Horarios").length, 5);
    assert.equal(gas.ss.getSheetByName("Agendamentos").getLastRow(), 1);
  });

  test("setup pode rodar de novo sem duplicar nada", () => {
    const gas = ready();
    gas.run("setup");
    gas.run("setup");
    assert.equal(gas.ss.getSheets().length, 3);
    assert.equal(gas.ss.data("Horarios").length, 5);
  });

  test("sem rodar setup, a primeira visita ao site cria as abas sozinha", () => {
    const gas = createGas({ now: NOW });
    assert.equal(gas.ss.getSheets().length, 0);
    const res = gas.get({ action: "availability" });
    assert.equal(res.ok, true);
    assert.equal(gas.ss.getSheets().length, 3);
    assert.ok(Object.keys(res.slots).length > 0);
  });

  test("abas existentes com dados são preservadas; só a que falta é criada", () => {
    const gas = createGas({ now: NOW });
    gas.ss.insertSheet("Horarios").setRawRows([["Dia", "Horários"], ["Sábado", "10:00"]]);
    gas.get({ action: "availability" });
    assert.deepEqual(gas.ss.data("Horarios"), [["Sábado", "10:00"]]);
    assert.ok(gas.ss.getSheetByName("Agendamentos"));
  });

  test("script fora de uma planilha devolve código NO_SPREADSHEET", () => {
    const gas = createGas({ now: NOW, bound: false });
    const res = gas.get({ action: "availability" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "NO_SPREADSHEET");
    const h = gas.get({ action: "health" });
    assert.equal(h.code, "NO_SPREADSHEET");
    assert.match(h.error, /Extensões > Apps Script/);
  });

  test("aba Horarios sem horários válidos aparece no diagnóstico", () => {
    const gas = ready();
    gas.ss.getSheetByName("Horarios").setRawRows([["Dia", "Horários"], ["Feriado", "manhã"]]);
    const h = gas.get({ action: "health" });
    assert.equal(h.ok, false);
    assert.equal(h.code, "NO_HOURS");
  });
});

describe("diagnóstico (health e teste)", () => {
  test("health informa versão, fusos e dias livres, sem dados pessoais", () => {
    const gas = ready();
    gas.post(person());
    const h = gas.get({ action: "health" });
    assert.equal(h.ok, true);
    assert.equal(h.version, gas.version());
    assert.deepEqual(h.timezone, { script: SP, spreadsheet: SP });
    assert.equal(h.checks.notifyEmail, true);
    assert.ok(h.freeDays > 30);
    const text = JSON.stringify(h);
    for (const secret of ["Ana", "98888", "ana@example.com", "dona@example.com", "Agenda Pulsar"]) {
      assert.ok(!text.includes(secret), `health vazou "${secret}"`);
    }
  });

  test("teste() sempre termina com o resultado visível em vermelho", () => {
    const gas = ready();
    assert.throws(() => gas.run("teste"), /\[resultado do teste\] OK \(versão/);
    const broken = createGas({ now: NOW, bound: false });
    assert.throws(() => broken.run("teste"), /\[resultado do teste\] PROBLEMA \[NO_SPREADSHEET\]/);
  });

  test("rodar doGet/doPost pelo editor (sem evento) não quebra", () => {
    const gas = ready();
    assert.equal(JSON.parse(gas.context.doGet().getContent()).code, "BAD_ACTION");
    assert.equal(JSON.parse(gas.context.doPost().getContent()).code, "BAD_REQUEST");
  });

  test("ação desconhecida", () => {
    assert.equal(ready().get({ action: "listar-tudo" }).code, "BAD_ACTION");
  });
});

describe("horários livres", () => {
  test("respeita os dias da semana e a antecedência mínima de 12h", () => {
    const { slots } = ready().get({ action: "availability" });
    assert.equal(slots["2026-11-02"], undefined, "segunda às 08:00: nenhum horário até 20:00");
    assert.deepEqual(slots["2026-11-03"], ["13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]);
    assert.deepEqual(slots["2026-11-06"], ["09:00", "10:00", "11:00"]);
    assert.equal(slots["2026-11-07"], undefined, "sábado");
    assert.equal(slots["2026-11-08"], undefined, "domingo");
  });

  test("antecedência corta no meio do dia", () => {
    const gas = ready({ now: zonedDate(2026, 11, 2, 1, 30, SP) }); // seg 01:30 -> mínimo 13:30
    assert.deepEqual(gas.get({ action: "availability" }).slots["2026-11-02"], ["14:00", "15:00", "16:00"]);
  });

  test("não passa de 60 dias nem volta ao passado", () => {
    const gas = ready();
    const { slots } = gas.get({ action: "availability", from: "2020-01-01", to: "2030-01-01" });
    const keys = Object.keys(slots).sort();
    assert.ok(keys[0] >= "2026-11-02");
    assert.ok(keys.at(-1) <= "2027-01-01");
  });

  test("filtro from/to e parâmetros inválidos", () => {
    const gas = ready();
    const one = gas.get({ action: "availability", from: "2026-11-04", to: "2026-11-04" }).slots;
    assert.deepEqual(Object.keys(one), ["2026-11-04"]);
    const junk = gas.get({ action: "availability", from: "abc", to: "2026-13-45" });
    assert.equal(junk.ok, true);
    assert.ok(Object.keys(junk.slots).length > 30);
  });

  test("o fuso do computador não muda o dia (servidor em UTC, agenda em São Paulo)", () => {
    const gas = ready({ now: zonedDate(2026, 11, 2, 22, 30, SP) }); // já é dia 03 em UTC
    const { slots } = gas.get({ action: "availability" });
    assert.deepEqual(slots["2026-11-03"], ["13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]);
    assert.equal(slots["2026-11-02"], undefined);
  });

  test("planilha em outro fuso: datas digitadas nela continuam certas", () => {
    const gas = ready({ sheetTz: "Asia/Tokyo" });
    gas.ss.getSheetByName("Bloqueios").setRawRows([["Data"], [zonedDate(2026, 11, 3, 0, 0, "Asia/Tokyo")]]);
    const { slots } = gas.get({ action: "availability" });
    assert.equal(slots["2026-11-03"], undefined);
    assert.ok(slots["2026-11-04"]);
  });

  test("bloqueio do dia todo, de um horário, e em formato DD/MM/AAAA", () => {
    const gas = ready();
    gas.ss.getSheetByName("Bloqueios").setRawRows([
      ["Data", "Horário", "Motivo"],
      ["2026-11-03", "", "Feriado"],
      ["04/11/2026", "10:00", "Médico"],
      [zonedDate(2026, 11, 5, 0, 0, SP), 14, "número digitado"],
      [zonedDate(2026, 11, 6, 0, 0, SP), zonedDate(1899, 12, 30, 9, 0, SP), "hora como data"],
    ]);
    const { slots } = gas.get({ action: "availability" });
    assert.equal(slots["2026-11-03"], undefined);
    assert.deepEqual(slots["2026-11-04"], ["09:00", "11:00", "14:00", "15:00"]);
    assert.ok(!slots["2026-11-05"].includes("14:00"));
    assert.deepEqual(slots["2026-11-06"], ["10:00", "11:00"]);
  });

  test("aceita vários jeitos de escrever dias e horários", () => {
    const gas = ready();
    gas.ss.getSheetByName("Horarios").setRawRows([
      ["Dia", "Horários"],
      ["segunda-feira", "9h, 10h30; 14:00"],
      ["TER", zonedDate(1899, 12, 30, 15, 0, SP), "16", 0.75],
      [3, "08:00 08:00"],
      ["Thursday", "7"],
      ["sábado", "25:00, 9:99, oi"],
      ["", "10:00"],
    ]);
    const { slots } = gas.get({ action: "availability", from: "2026-11-09", to: "2026-11-15" });
    assert.deepEqual(slots["2026-11-09"], ["09:00", "10:30", "14:00"]);
    assert.deepEqual(slots["2026-11-10"], ["15:00", "16:00", "18:00"]);
    assert.deepEqual(slots["2026-11-11"], ["08:00"]);
    assert.deepEqual(slots["2026-11-12"], ["07:00"]);
    assert.equal(slots["2026-11-14"], undefined);
  });

  test("dias com o mesmo nome em duas linhas são somados", () => {
    const gas = ready();
    gas.ss.getSheetByName("Horarios").setRawRows([["Dia", "H"], ["Sexta", "09:00"], ["Sexta", "17:00"]]);
    assert.deepEqual(gas.get({ action: "availability" }).slots["2026-11-06"], ["09:00", "17:00"]);
  });
});

describe("agendamento", () => {
  test("grava a linha completa, envia e-mail e ocupa o horário", () => {
    const gas = ready();
    const res = gas.post(person({ notes: "Primeira vez" }));
    assert.deepEqual(res, { ok: true });
    const [row] = gas.ss.data("Agendamentos");
    assert.ok(row[0] instanceof Date);
    assert.deepEqual(row.slice(1), ["2026-11-03", "13:00", "Ana Souza", "(11) 98888-7777", "ana@example.com", "Online", "Primeira vez", "pendente"]);
    assert.equal(gas.mails.length, 1);
    assert.equal(gas.mails[0].to, "dona@example.com");
    assert.match(gas.mails[0].subject, /2026-11-03 às 13:00/);
    assert.ok(!gas.get({ action: "availability" }).slots["2026-11-03"].includes("13:00"));
  });

  test("o mesmo horário não pode ser marcado duas vezes", () => {
    const gas = ready();
    assert.equal(gas.post(person()).ok, true);
    const again = gas.post(person({ name: "Outra Pessoa", phone: "11977776666", email: "o@x.com" }));
    assert.equal(again.code, "TAKEN");
    assert.equal(gas.ss.data("Agendamentos").length, 1);
  });

  test("cancelar na planilha libera o horário", () => {
    const gas = ready();
    gas.post(person());
    gas.ss.getSheetByName("Agendamentos").rows[1][8] = "Cancelado";
    assert.ok(gas.get({ action: "availability" }).slots["2026-11-03"].includes("13:00"));
    assert.equal(gas.post(person({ phone: "11911112222", email: "b@x.com" })).ok, true);
  });

  test("funciona mesmo se a planilha converter data e hora (coluna sem formato de texto)", () => {
    const gas = ready();
    gas.ss.getSheetByName("Agendamentos").textCols.clear();
    gas.post(person());
    const [row] = gas.ss.data("Agendamentos");
    assert.ok(row[1] instanceof Date && row[2] instanceof Date, "o mock converteu");
    assert.equal(gas.post(person({ phone: "11911112222", email: "b@x.com" })).code, "TAKEN");
  });

  test("não aceita horário que não está livre (fora da grade, passado, bloqueado)", () => {
    const gas = ready();
    assert.equal(gas.post(person({ time: "12:00" })).code, "TAKEN");
    assert.equal(gas.post(person({ date: "2026-11-02", time: "09:00" })).code, "TAKEN");
    assert.equal(gas.post(person({ date: "2026-11-07", time: "09:00" })).code, "TAKEN");
    assert.equal(gas.post(person({ date: "2027-06-01", time: "09:00" })).code, "TAKEN", "além de 60 dias");
    gas.ss.getSheetByName("Bloqueios").appendRow(["2026-11-03", "13:00", "x"]);
    assert.equal(gas.post(person()).code, "TAKEN");
    assert.equal(gas.ss.data("Agendamentos").length, 0);
  });

  const invalid = {
    "data inexistente": { date: "2026-02-30" },
    "data em outro formato": { date: "03/11/2026" },
    "horário 24:00": { time: "24:00" },
    "horário sem zero": { time: "9:00" },
    "nome curto": { name: "Al" },
    "nome enorme": { name: "x".repeat(121) },
    "nome não-texto": { name: ["Ana Souza"] },
    "telefone curto": { phone: "1199" },
    "telefone longo": { phone: "12345678901234" },
    "e-mail inválido": { email: "ana@" },
    "e-mail enorme": { email: "a".repeat(250) + "@x.com" },
    "modalidade inventada": { mode: "Híbrido" },
    "observações não-texto": { notes: { a: 1 } },
    "observações enormes": { notes: "x".repeat(1001) },
  };
  for (const [label, over] of Object.entries(invalid)) {
    test(`recusa ${label}`, () => {
      const gas = ready();
      const res = gas.post(person(over));
      assert.equal(res.ok, false);
      assert.equal(res.code, "INVALID");
      assert.equal(gas.ss.data("Agendamentos").length, 0);
    });
  }

  test("pedidos malformados", () => {
    const gas = ready();
    assert.equal(gas.post("não é json").code, "BAD_REQUEST");
    assert.equal(gas.post("").code, "BAD_REQUEST");
    assert.equal(gas.post("null").code, "BAD_REQUEST");
    assert.equal(gas.post({ action: "delete" }).code, "BAD_REQUEST");
    assert.equal(gas.post("x".repeat(5001)).code, "BAD_REQUEST");
  });

  test("robô que preenche o campo-armadilha recebe ok mas nada é gravado", () => {
    const gas = ready();
    assert.deepEqual(gas.post(person({ website: "http://spam" })), { ok: true });
    assert.equal(gas.ss.data("Agendamentos").length, 0);
    assert.equal(gas.mails.length, 0);
  });

  test("texto com cara de fórmula é gravado como texto", () => {
    const gas = ready();
    gas.post(person({ name: "=IMPORTXML(\"http://x\")", notes: "+1 ligação", email: "ana@example.com" }));
    const [row] = gas.ss.getSheetByName("Agendamentos").rows.slice(1);
    // o apóstrofo some na planilha (como no Google), mas o valor fica como texto
    assert.equal(row[3], "=IMPORTXML(\"http://x\")");
    assert.equal(row[7], "+1 ligação");
  });

  test("caracteres de controle são limpos", () => {
    const gas = ready();
    gas.post(person({ name: "Ana\u0000 Souza\u0007" }));
    assert.equal(gas.ss.data("Agendamentos")[0][3], "Ana  Souza");
  });

  test("acima de 2 horários futuros por pessoa: mesma resposta, mas salvo como \"revisar\"", () => {
    const gas = ready();
    assert.deepEqual(gas.post(person({ time: "13:00" })), { ok: true });
    assert.deepEqual(gas.post(person({ time: "14:00", phone: "11 988887777" })), { ok: true });
    // e-mail igual (outra caixa) e telefone igual (outro formato): resposta idêntica, sem revelar nada
    const third = gas.post(person({ time: "15:00", phone: "21900000000", email: "ANA@Example.com" }));
    assert.deepEqual(third, { ok: true });
    const byPhone = gas.post(person({ time: "16:00", phone: "(11) 98888-7777", email: "x@y.com" }));
    assert.deepEqual(byPhone, { ok: true });
    const other = gas.post(person({ time: "17:00", phone: "21911112222", email: "outra@x.com" }));
    assert.deepEqual(other, { ok: true });

    const status = gas.ss.data("Agendamentos").map((r) => [r[2], r[8]]);
    assert.deepEqual(status, [["13:00", "pendente"], ["14:00", "pendente"], ["15:00", "revisar"], ["16:00", "revisar"], ["17:00", "pendente"]]);

    // o horário "revisar" fica ocupado, igual a um normal (a disponibilidade também não revela nada)
    const free = gas.get({ action: "availability", from: "2026-11-03", to: "2026-11-03" }).slots["2026-11-03"] || [];
    for (const t of ["13:00", "14:00", "15:00", "16:00", "17:00"]) assert.ok(!free.includes(t), t);

    // só a dona fica sabendo, pelo e-mail
    const subjects = gas.mails.map((m) => m.subject);
    assert.equal(subjects.filter((s) => s.startsWith("[REVISAR]")).length, 2);
    assert.match(gas.mails[2].body, /revisar/);
  });

  test("agendamentos antigos não contam no limite por pessoa", () => {
    const gas = ready();
    const rows = gas.ss.getSheetByName("Agendamentos");
    rows.appendRow([new Date(), "2026-10-01", "09:00", "Ana", "(11) 98888-7777", "ana@example.com", "Online", "", "pendente"]);
    rows.appendRow([new Date(), "2026-10-02", "09:00", "Ana", "(11) 98888-7777", "ana@example.com", "Online", "", "pendente"]);
    assert.equal(gas.post(person()).ok, true);
  });

  test("teto de agendamentos por hora", () => {
    const gas = ready();
    let n = 0;
    for (let day = 3; n < 15; day++) {
      const date = `2026-11-${String(day).padStart(2, "0")}`;
      const slots = gas.get({ action: "availability", from: date, to: date }).slots[date] || [];
      for (const time of slots) {
        if (n === 15) break;
        const r = gas.post(person({ date, time, phone: `119${String(n).padStart(8, "0")}`, email: `p${n}@x.com` }));
        assert.equal(r.ok, true, JSON.stringify(r));
        n++;
      }
    }
    const blocked = gas.post(person({ date: "2026-11-20", time: "09:00", phone: "21999999999", email: "z@x.com" }));
    assert.equal(blocked.code, "RATE_LIMIT");
    gas.setNow(new Date(NOW.getTime() + 3600e3));
    assert.equal(gas.post(person({ date: "2026-11-20", time: "09:00", phone: "21999999999", email: "z@x.com" })).ok, true);
  });

  test("se o e-mail falhar o agendamento continua valendo", () => {
    const gas = ready();
    gas.state.mailFails = true;
    assert.deepEqual(gas.post(person()), { ok: true });
    assert.equal(gas.ss.data("Agendamentos").length, 1);
    assert.ok(gas.logs.some(([lvl, m]) => lvl === "error" && m.startsWith("notify")));
  });

  test("trava ocupada devolve mensagem de 'tente de novo' e não grava", () => {
    const gas = ready();
    gas.state.lockFree = false;
    const res = gas.post(person());
    assert.equal(res.code, "BUSY");
    assert.match(res.error, /tente de novo/i);
    assert.equal(gas.ss.data("Agendamentos").length, 0);
  });

  test("respostas de erro nunca trazem detalhes internos", () => {
    const gas = createGas({ now: NOW, bound: false });
    const res = gas.post(person());
    assert.equal(res.code, "NO_SPREADSHEET");
    assert.ok(!/stack|at |Code\.gs/.test(res.error));
  });
});
