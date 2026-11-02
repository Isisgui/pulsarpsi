#!/usr/bin/env node
/**
 * Diagnóstico da agenda publicada:  npm run check
 *
 * Chama o App da Web de verdade (apiUrl do js/config.js, ou a URL passada:
 * `npm run check -- https://script.google.com/macros/s/…/exec`) e explica, em
 * português, o que está faltando. Não grava nada na planilha.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readApiUrl() {
  const cfg = fs.readFileSync(path.join(ROOT, "js/config.js"), "utf8");
  return (cfg.match(/apiUrl:\s*"([^"]*)"/) || [])[1] || "";
}

export function localVersion() {
  const code = fs.readFileSync(path.join(ROOT, "apps-script/Code.gs"), "utf8");
  return (code.match(/var VERSION = '([^']+)'/) || [])[1];
}

// Caminhos no editor do Apps Script (Planilha → Extensões → Apps Script).
const DO = {
  newVersion: "Cole o apps-script/Code.gs atual no editor, salve e publique:\n   Implantar → Gerenciar implantações → ✏️ Editar → Versão: Nova versão → Implantar (a URL continua a mesma).",
  authorize: "No editor: escolha a função `setup` → Executar → Revisar permissões → (Avançado → Acessar) → Permitir.\n   Use a MESMA conta dona da planilha.",
  access: 'Implantar → Gerenciar implantações → ✏️ Editar → "Quem pode acessar": Qualquer pessoa → Implantar.',
  deploy: 'Implantar → Nova implantação → ⚙️ App da Web → Executar como: Eu · Quem pode acessar: Qualquer pessoa → Implantar.\n   Copie a URL (termina em /exec) para apiUrl em js/config.js.',
};

const HINTS = {
  NO_SPREADSHEET: "O script não está preso a uma planilha. Abra a PLANILHA → Extensões → Apps Script\n   e cole os arquivos lá (não crie o projeto direto em script.google.com).",
  NO_HOURS: 'A aba "Horarios" não tem horários válidos. Preencha: Segunda | 09:00, 10:00, ...',
  BUSY: "A planilha estava ocupada. Rode de novo.",
};

/** Devolve { ok, lines[] } — usado também pelo gas.mjs depois do deploy. */
export async function check(apiUrl = readApiUrl()) {
  const lines = [];
  const say = (s) => lines.push(s);
  const expected = localVersion();

  if (!apiUrl) {
    say("✖ apiUrl está vazio em js/config.js.\n   " + DO.deploy);
    return { ok: false, lines };
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(apiUrl)) {
    say(`✖ apiUrl não parece um App da Web: ${apiUrl}\n   Deve ser https://script.google.com/macros/s/…/exec`);
    return { ok: false, lines };
  }

  let res, text;
  try {
    res = await fetch(`${apiUrl}?action=health`, { redirect: "follow" });
    text = await res.text();
  } catch (e) {
    say(`✖ Não consegui acessar o Google: ${e.message}`);
    return { ok: false, lines };
  }

  if (res.status === 404) {
    say("✖ Essa URL não existe (implantação apagada/arquivada, ou URL copiada errada).\n   " + DO.deploy);
    return { ok: false, lines };
  }

  let data = null;
  try { data = JSON.parse(text); } catch { /* HTML */ }

  if (!data) {
    const html = text.toLowerCase();
    if (/accounts\.google\.com|servicelogin|faça login|sign in/.test(html)) {
      say('✖ O Google pediu login: o App da Web não está aberto para "Qualquer pessoa".\n   ' + DO.access);
    } else if (/authoriz|autoriza|permission|permiss|acesso negado|access denied|precisa ter acesso|need access/.test(html)) {
      say("✖ O Google negou acesso (403). Quase sempre: o script ainda não foi autorizado pela conta dona.\n   " + DO.authorize +
        "\n   Se já autorizou, confira o acesso: " + DO.access);
    } else if (/script function not found|função de script não encontrada|doget/.test(html)) {
      say("✖ O código publicado não tem doGet.\n   " + DO.newVersion);
    } else {
      say(`✖ O Google respondeu com uma página HTML (status ${res.status}), não com a agenda.`);
      const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1];
      if (title) say(`   Título da página: "${title.trim()}"`);
      say("   Abra a URL no navegador logado na conta dona para ver a mensagem.");
    }
    return { ok: false, lines };
  }

  if (data.code === "BAD_ACTION" || !data.version) {
    say("✖ A URL está publicando uma versão antiga do código (sem diagnóstico).\n   " + DO.newVersion);
    return { ok: false, lines };
  }
  if (data.version !== expected) {
    say(`⚠ Versão publicada ${data.version}, mas o Code.gs local é ${expected}.\n   ` + DO.newVersion);
  }
  if (!data.ok) {
    say(`✖ Problema [${data.code}]: ${data.error}`);
    say("   " + (HINTS[data.code] || (/permiss|authoriz|autoriza/i.test(data.error)
      ? DO.authorize
      : "Detalhes no editor do Apps Script → Execuções (ícone ☰), ou rode a função `teste`.")));
    return { ok: false, lines };
  }

  say(`✔ Planilha conectada (versão ${data.version}).`);
  say(`✔ Fuso do script: ${data.timezone.script} · fuso da planilha: ${data.timezone.spreadsheet}`);
  if (data.timezone.script !== data.timezone.spreadsheet) {
    say("  ⚠ Fusos diferentes. Na planilha: Arquivo > Configurações > Fuso horário = (GMT-03:00) São Paulo.");
  }
  say(`✔ ${data.checks.weeklySlots} horários por semana na aba Horarios, ${data.freeDays} dias com vaga.`);
  say(data.checks.notifyEmail === true ? "✔ E-mail de aviso: ativo." : `⚠ E-mail de aviso: ${data.checks.notifyEmail}`);

  try {
    const av = await (await fetch(`${apiUrl}?action=availability`, { redirect: "follow" })).json();
    if (!av.ok) throw new Error(av.error);
    const first = Object.keys(av.slots).sort()[0];
    say(`✔ O site recebe os horários. Próximo dia livre: ${first || "nenhum"}${first ? " → " + av.slots[first].join(", ") : ""}`);
  } catch (e) {
    say(`✖ Diagnóstico ok, mas a consulta de horários falhou: ${e.message}`);
    return { ok: false, lines };
  }
  return { ok: true, lines };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] || readApiUrl();
  console.log(`\nVerificando ${url || "(apiUrl vazio)"}\n`);
  const { ok, lines } = await check(url);
  console.log(lines.join("\n") + "\n");
  process.exit(ok ? 0 : 1);
}
