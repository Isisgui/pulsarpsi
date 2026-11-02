/**
 * Teste de ponta a ponta: Chrome de verdade (sem janela) + site local + planilha simulada.
 * Pulado automaticamente se não houver Chrome/Chromium instalado.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "../scripts/dev-server.mjs";

const CHROME = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && fs.existsSync(p));

let puppeteer = null;
try { puppeteer = (await import("puppeteer-core")).default; } catch { /* sem dependência instalada */ }
const skip = !CHROME || !puppeteer ? "Chrome ou puppeteer-core não encontrado" : false;

describe("site no navegador", { skip }, () => {
  let srv, browser;

  before(async () => {
    srv = await startServer({ port: 0, mock: true });
    srv.url = srv.url.replace("localhost", "127.0.0.1");
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  async function open(viewport = { width: 1280, height: 900 }, setup) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    if (setup) await setup(page);
    await page.goto(srv.url, { waitUntil: "networkidle0" });
    return { page, errors };
  }

  async function pickFirstSlot(page) {
    await page.waitForSelector(".day--free", { timeout: 10000 });
    await page.click(".day--free");
    await page.waitForSelector(".slot[data-time]");
    const key = await page.$eval(".day--selected", (b) => b.dataset.key);
    const time = await page.$eval(".slot[data-time]", (b) => b.dataset.time);
    return { key, time };
  }

  async function fill(page, { name = "Teste Navegador", phone = "11987654321", email = "nav@example.com" } = {}) {
    await page.type("#f-name", name);
    await page.type("#f-phone", phone);
    await page.type("#f-email", email);
  }

  test("carrega os horários da planilha e marca uma sessão do começo ao fim", async () => {
    const { page, errors } = await open();
    const { key, time } = await pickFirstSlot(page);

    assert.equal(await page.$eval("#agenda-notice", (n) => n.hidden), true, "aviso de erro não deve aparecer");
    const expected = srv.gas.get({ action: "availability" }).slots[key];
    const shown = await page.$$eval(".slot[data-time]", (bs) => bs.map((b) => b.dataset.time));
    assert.deepEqual(shown, expected, "horários na tela = horários da planilha");

    await page.click(".slot[data-time]");
    await page.waitForSelector("#booking-modal[open]");
    await fill(page);
    assert.equal(await page.$eval("#f-phone", (i) => i.value), "(11) 98765-4321", "máscara do telefone");
    await page.click("#submit-btn");
    await page.waitForSelector("#modal-success-view:not([hidden])", { timeout: 10000 });

    const rows = srv.gas.ss.data("Agendamentos");
    const row = rows.find((r) => r[3] === "Teste Navegador");
    assert.ok(row, "linha gravada na planilha");
    assert.deepEqual(row.slice(1, 9), [key, time, "Teste Navegador", "(11) 98765-4321", "nav@example.com", "Online", "", "pendente"]);

    const whats = await page.$eval("#success-whatsapp", (a) => a.href);
    assert.match(whats, /^https:\/\/wa\.me\/\d+\?text=/);

    await page.click("#modal-success-view [data-close]");
    const after = await page.$$eval(".slot[data-time]", (bs) => bs.map((b) => b.dataset.time));
    assert.ok(!after.includes(time), "horário some da tela depois de marcado");
    assert.deepEqual(errors, []);
    await page.close();
  });

  test("validação do formulário impede envio incompleto", async () => {
    const { page } = await open();
    await pickFirstSlot(page);
    await page.click(".slot[data-time]");
    await page.waitForSelector("#booking-modal[open]");
    const before = srv.gas.ss.data("Agendamentos").length;
    await page.click("#submit-btn");
    const invalid = await page.$$eval("[aria-invalid=true]", (els) => els.map((e) => e.name));
    assert.deepEqual(invalid.sort(), ["email", "name", "phone"]);
    assert.equal(srv.gas.ss.data("Agendamentos").length, before);
    await page.close();
  });

  test("se alguém pegar o horário antes, mostra o aviso e atualiza a agenda", async () => {
    const { page } = await open();
    const { key, time } = await pickFirstSlot(page);
    const other = srv.gas.post({ action: "book", date: key, time, name: "Outra Pessoa", phone: "21911112222", email: "outra@example.com", mode: "Online" });
    assert.equal(other.ok, true, JSON.stringify(other));

    await page.click(`.slot[data-time="${time}"]`);
    await page.waitForSelector("#booking-modal[open]");
    await fill(page, { name: "Atrasada Silva", phone: "31933334444", email: "atrasada@example.com" });
    await page.click("#submit-btn");
    await page.waitForSelector("#form-error:not([hidden])", { timeout: 10000 });
    assert.match(await page.$eval("#form-error", (e) => e.textContent), /acabou de ser reservado/);
    assert.ok(!srv.gas.ss.data("Agendamentos").some((r) => r[3] === "Atrasada Silva"));
    await page.close();
  });

  test("campo-armadilha fica invisível para pessoas", async () => {
    const { page } = await open();
    const box = await page.$eval("#f-website", (i) => { const r = i.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    assert.ok(box.w <= 1 && box.h <= 1, JSON.stringify(box));
    await page.close();
  });

  test("se o Google responder com HTML (falta autorização), aparece aviso com WhatsApp", async () => {
    const { page } = await open(undefined, async (p) => {
      await p.setRequestInterception(true);
      p.on("request", (r) => (r.url().includes("/mock/exec")
        ? r.respond({ status: 200, contentType: "text/html", headers: { "Access-Control-Allow-Origin": "*" }, body: "<html>Autorização necessária</html>" })
        : r.continue()));
    });
    await page.waitForSelector("#agenda-notice:not([hidden])", { timeout: 10000 });
    assert.match(await page.$eval("#agenda-notice", (n) => n.textContent), /WhatsApp/);
    assert.equal(await page.$$eval(".day--free", (d) => d.length), 0);
    await page.close();
  });

  test("celular: sem rolagem lateral e agenda funciona", async () => {
    const { page, errors } = await open({ width: 375, height: 740, isMobile: true, hasTouch: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `rolagem lateral de ${overflow}px`);
    await pickFirstSlot(page);
    assert.deepEqual(errors, []);
    await page.close();
  });
});
