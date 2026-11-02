/**
 * Agenda: calendário, lista de horários e modal de confirmação.
 */
(function () {
  "use strict";

  const cfg = window.PULSAR_CONFIG || {};
  const api = window.PulsarAPI;
  const { dateKey, parseKey } = window.PulsarUtil;

  const $ = (sel) => document.querySelector(sel);
  const els = {
    grid: $("#cal-grid"),
    month: $("#cal-month"),
    year: $("#cal-year"),
    prev: $("#cal-prev"),
    next: $("#cal-next"),
    slots: $("#slots"),
    date: $("#selected-date"),
    notice: $("#agenda-notice"),
    modal: $("#booking-modal"),
    form: $("#booking-form"),
    summary: $("#modal-summary"),
    formView: $("#modal-form-view"),
    successView: $("#modal-success-view"),
    successTitle: $("#success-title"),
    successText: $("#success-text"),
    successWhats: $("#success-whatsapp"),
    submit: $("#submit-btn"),
    formError: $("#form-error"),
    toast: $("#toast"),
  };
  if (!els.grid) return;

  const fmtMonth = new Intl.DateTimeFormat("pt-BR", { month: "long" });
  const fmtWeekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long" });
  const fmtDayMonth = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" });
  const fmtFull = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastDay = new Date(today);
  lastDay.setDate(lastDay.getDate() + (cfg.daysAhead || 60));

  const state = {
    view: new Date(today.getFullYear(), today.getMonth(), 1),
    availability: {},
    loading: true,
    selectedKey: null,
    selectedTime: null,
  };

  /* ------------------------------------------------------------------ */
  /* Calendário                                                          */
  /* ------------------------------------------------------------------ */
  function monthIndex(d) {
    return d.getFullYear() * 12 + d.getMonth();
  }

  function renderCalendar(direction) {
    const { view } = state;
    const year = view.getFullYear();
    const month = view.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const offset = new Date(year, month, 1).getDay();

    els.month.textContent = cap(fmtMonth.format(view));
    els.year.textContent = year;
    els.prev.disabled = monthIndex(view) <= monthIndex(today);
    els.next.disabled = monthIndex(view) >= monthIndex(lastDay);

    const frag = document.createDocumentFragment();
    for (let i = 0; i < offset; i++) {
      const blank = document.createElement("span");
      blank.className = "day day--blank";
      frag.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const key = dateKey(date);
      const inRange = date >= today && date <= lastDay;
      const free = inRange && !state.loading && (state.availability[key] || []).length > 0;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = day;
      btn.dataset.key = key;
      btn.style.setProperty("--d", day);
      btn.className = "day";
      if (date.getTime() === today.getTime()) btn.classList.add("day--today");

      if (state.loading && inRange) {
        btn.classList.add("day--loading");
        btn.disabled = true;
        btn.setAttribute("aria-label", `${fmtFull.format(date)}, carregando`);
      } else if (free) {
        const n = state.availability[key].length;
        btn.classList.add("day--free");
        btn.setAttribute("aria-label", `${fmtFull.format(date)}, ${n} ${n === 1 ? "horário livre" : "horários livres"}`);
        if (key === state.selectedKey) {
          btn.classList.add("day--selected");
          btn.setAttribute("aria-pressed", "true");
        } else {
          btn.setAttribute("aria-pressed", "false");
        }
      } else {
        btn.classList.add("day--off");
        btn.disabled = true;
        btn.setAttribute("aria-label", `${fmtFull.format(date)}, sem horários`);
      }
      frag.appendChild(btn);
    }

    els.grid.replaceChildren(frag);

    if (direction) {
      els.grid.classList.remove("slide-left", "slide-right");
      void els.grid.offsetWidth; // reinicia a animação
      els.grid.classList.add(direction > 0 ? "slide-left" : "slide-right");
    }
  }

  function changeMonth(delta) {
    state.view = new Date(state.view.getFullYear(), state.view.getMonth() + delta, 1);
    renderCalendar(delta);
  }

  els.prev.addEventListener("click", () => changeMonth(-1));
  els.next.addEventListener("click", () => changeMonth(1));

  els.grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".day--free");
    if (btn) selectDay(btn.dataset.key);
  });

  // Setas do teclado navegam entre os dias com horário.
  els.grid.addEventListener("keydown", (e) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const step = moves[e.key];
    const current = e.target.closest(".day");
    if (!step || !current) return;
    e.preventDefault();
    const days = [...els.grid.querySelectorAll(".day--free")];
    if (!days.length) return;
    const from = parseKey(current.dataset.key).getTime();
    const ordered = step > 0 ? days : days.reverse();
    const target = ordered.find((b) => {
      const diff = (parseKey(b.dataset.key).getTime() - from) / 864e5;
      return step > 0 ? diff >= step : diff <= step;
    }) || ordered.find((b) => (parseKey(b.dataset.key).getTime() - from) * step > 0);
    if (target) target.focus();
  });

  // Gesto de arrastar para os lados troca o mês no celular.
  let touchX = null;
  els.grid.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  els.grid.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) < 50) return;
    const btn = dx < 0 ? els.next : els.prev;
    if (!btn.disabled) changeMonth(dx < 0 ? 1 : -1);
  });

  /* ------------------------------------------------------------------ */
  /* Horários                                                            */
  /* ------------------------------------------------------------------ */
  function setDateLabel(text) {
    els.date.textContent = text;
    els.date.classList.remove("is-changing");
    void els.date.offsetWidth;
    els.date.classList.add("is-changing");
  }

  function selectDay(key) {
    const changed = key !== state.selectedKey;
    state.selectedKey = key;
    state.selectedTime = null;
    const date = parseKey(key);

    // atualiza só as classes para não reiniciar a animação do grid
    els.grid.querySelectorAll(".day--free").forEach((b) => {
      const on = b.dataset.key === key;
      b.classList.toggle("day--selected", on);
      b.setAttribute("aria-pressed", String(on));
    });

    if (changed) setDateLabel(`${cap(fmtWeekday.format(date))} | dia ${fmtDayMonth.format(date)}`);
    renderSlots();

    // no celular, leva a pessoa até os horários
    if (window.matchMedia("(max-width: 860px)").matches) {
      const rect = els.date.getBoundingClientRect();
      if (rect.top > window.innerHeight * 0.6 || rect.top < 0) {
        els.date.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  function renderSlots() {
    const times = state.availability[state.selectedKey] || [];
    if (!times.length) {
      els.slots.innerHTML = `
        <div class="slots__empty">
          <svg class="slots__empty-star" aria-hidden="true"><use href="#star-burst"/></svg>
          <p>Os horários desse dia acabaram de ser preenchidos. Que tal escolher outro dia?</p>
        </div>`;
      return;
    }
    els.slots.replaceChildren(...times.map((t, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slot";
      b.style.setProperty("--i", i);
      b.dataset.time = t;
      const small = document.createElement("small");
      small.textContent = `${cfg.sessionMinutes || 50} min`;
      b.append(String(t), small);
      b.setAttribute("aria-label", `Agendar às ${t}`);
      return b;
    }));
  }

  function renderSlotSkeleton() {
    els.slots.replaceChildren(...Array.from({ length: 6 }, (_, i) => {
      const s = document.createElement("span");
      s.className = "slot slot--skeleton";
      s.style.setProperty("--i", i);
      return s;
    }));
  }

  els.slots.addEventListener("click", (e) => {
    const btn = e.target.closest(".slot[data-time]");
    if (btn) openModal(btn.dataset.time);
  });

  /* ------------------------------------------------------------------ */
  /* Dados                                                               */
  /* ------------------------------------------------------------------ */
  async function loadAvailability() {
    state.loading = true;
    renderCalendar();
    if (state.selectedKey) renderSlotSkeleton();
    try {
      state.availability = await api.getAvailability(today, lastDay);
      els.notice.hidden = true;
    } catch (err) {
      state.availability = {};
      els.notice.textContent = err.message || "Não foi possível carregar a agenda.";
      els.notice.hidden = false;
    }
    state.loading = false;
    renderCalendar();
    if (state.selectedKey) renderSlots();
  }

  /* ------------------------------------------------------------------ */
  /* Modal                                                               */
  /* ------------------------------------------------------------------ */
  function slotLabel() {
    const date = parseKey(state.selectedKey);
    return `${cap(fmtFull.format(date))} · ${state.selectedTime}`;
  }

  function openModal(time) {
    state.selectedTime = time;
    els.summary.textContent = `${slotLabel()} (${cfg.sessionMinutes || 50} min)`;
    els.formView.hidden = false;
    els.successView.hidden = true;
    els.formError.hidden = true;
    els.form.querySelectorAll(".field").forEach(clearError);
    els.modal.showModal();
    els.form.querySelector("input").focus();
  }

  function closeModal() {
    if (!els.modal.open || els.modal.classList.contains("is-closing")) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return els.modal.close();
    els.modal.classList.add("is-closing");
    els.modal.addEventListener("animationend", () => {
      els.modal.classList.remove("is-closing");
      els.modal.close();
    }, { once: true });
  }

  els.modal.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeModal();
  });
  els.modal.addEventListener("click", (e) => {
    if (e.target === els.modal || e.target.closest("[data-close]")) closeModal();
  });

  /* ---------- Validação ---------- */
  const validators = {
    name: (v) => (v.trim().length >= 3 ? "" : "Conte como você se chama."),
    phone: (v) => {
      const n = v.replace(/\D/g, "").length;
      return n >= 10 && n <= 13 ? "" : "Informe um WhatsApp com DDD.";
    },
    email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? "" : "Informe um e-mail válido."),
  };

  function clearError(field) {
    field.classList.remove("has-error");
    const msg = field.querySelector(".field__error");
    if (msg) msg.textContent = "";
    const input = field.querySelector("input");
    if (input) input.removeAttribute("aria-invalid");
  }

  function validateInput(input) {
    const check = validators[input.name];
    if (!check) return true;
    const field = input.closest(".field");
    const msg = check(input.value);
    clearError(field);
    if (msg) {
      void field.offsetWidth;
      field.classList.add("has-error");
      field.querySelector(".field__error").textContent = msg;
      input.setAttribute("aria-invalid", "true");
    }
    return !msg;
  }

  els.form.addEventListener("focusout", (e) => {
    if (e.target.matches("input") && e.target.value) validateInput(e.target);
  });
  els.form.addEventListener("input", (e) => {
    const field = e.target.closest(".field");
    if (field && field.classList.contains("has-error")) validateInput(e.target);
  });

  // Máscara de telefone: (00) 00000-0000
  const phone = els.form.elements.phone;
  phone.addEventListener("input", () => {
    const d = phone.value.replace(/\D/g, "").slice(0, 11);
    let out = d;
    if (d.length > 2) out = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length > 7) out = `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
    phone.value = out;
  });

  /* ---------- Envio ---------- */
  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const inputs = [...els.form.querySelectorAll("input[name]:not([type=radio])")];
    const valid = inputs.map(validateInput).every(Boolean);
    if (!valid) {
      els.form.querySelector("[aria-invalid=true]").focus();
      return;
    }

    const f = els.form.elements;
    const booking = {
      date: state.selectedKey,
      time: state.selectedTime,
      name: f.name.value.trim(),
      phone: f.phone.value.trim(),
      email: f.email.value.trim(),
      mode: f.mode.value,
      notes: f.notes.value.trim(),
      website: f.website.value, // armadilha para robôs: pessoas não veem esse campo
    };

    els.formError.hidden = true;
    els.submit.classList.add("is-loading");
    try {
      await api.book(booking);
      showSuccess(booking);
      // remove o horário da lista local na hora, sem esperar recarregar
      const left = (state.availability[booking.date] || []).filter((t) => t !== booking.time);
      if (left.length) state.availability[booking.date] = left;
      else delete state.availability[booking.date];
      renderCalendar();
      renderSlots();
    } catch (err) {
      els.formError.textContent = err.message;
      els.formError.hidden = false;
      loadAvailability();
    } finally {
      els.submit.classList.remove("is-loading");
    }
  });

  function showSuccess(booking) {
    const label = slotLabel().replace(" · ", " às ");
    const when = label.charAt(0).toLowerCase() + label.slice(1);
    const first = booking.name.split(" ")[0];
    els.successText.textContent =
      `${first}, sua sessão ficou para ${when}. ` +
      `Vou confirmar pelo WhatsApp ou e-mail em breve.`;

    const msg = `Olá, Isis! Acabei de agendar uma sessão pelo site para ${when} (${booking.mode}). Meu nome é ${booking.name}.`;
    els.successWhats.href = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(msg)}`;

    els.formView.hidden = true;
    els.successView.hidden = false;
    els.successTitle.focus();
    els.form.reset();
  }

  /* ------------------------------------------------------------------ */
  /* Toast                                                               */
  /* ------------------------------------------------------------------ */
  let toastTimer;
  function toast(text) {
    els.toast.textContent = text;
    els.toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 4200);
  }

  /* ------------------------------------------------------------------ */
  loadAvailability();
})();
