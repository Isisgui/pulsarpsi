/**
 * Navegação, seção ativa e animações de entrada.
 */
(function () {
  "use strict";

  document.documentElement.classList.remove("no-js");

  const nav = document.getElementById("nav");
  const hero = document.querySelector(".hero");
  const links = [...document.querySelectorAll(".nav__link")];
  const indicator = document.querySelector(".nav__indicator");

  /* ---------- Nav "gruda" no topo depois do hero ---------- */
  new IntersectionObserver(([entry]) => {
    nav.classList.toggle("is-stuck", !entry.isIntersecting);
  }, { rootMargin: `-${nav.offsetHeight}px 0px 0px 0px` }).observe(hero);

  /* ---------- Seção ativa + indicador ---------- */
  function moveIndicator(link) {
    if (!link) {
      indicator.style.opacity = "0";
      return;
    }
    const box = link.getBoundingClientRect();
    const parent = nav.querySelector(".nav__inner").getBoundingClientRect();
    indicator.style.width = `${box.width}px`;
    indicator.style.transform = `translateX(${box.left - parent.left}px)`;
    indicator.style.opacity = "1";
  }

  let active = null;
  function setActive(id) {
    const link = links.find((l) => l.getAttribute("href") === `#${id}`) || null;
    if (link === active) return;
    active = link;
    links.forEach((l) => {
      l.classList.toggle("is-active", l === link);
      if (l === link) l.setAttribute("aria-current", "true");
      else l.removeAttribute("aria-current");
    });
    moveIndicator(link);
  }

  const sections = links.map((l) => document.querySelector(l.getAttribute("href"))).filter(Boolean);
  function updateActive() {
    const line = window.innerHeight * 0.4;
    let current = null;
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= line) current = s.id;
    }
    setActive(current);
  }

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateActive();
      ticking = false;
    });
  }, { passive: true });
  window.addEventListener("resize", () => moveIndicator(active));
  // a transição da marca no nav muda a posição dos links
  nav.addEventListener("transitionend", () => moveIndicator(active));
  updateActive();

  /* ---------- Revelar elementos ao rolar ---------- */
  const reveals = document.querySelectorAll(".reveal");
  // escalona elementos irmãos para entrarem em sequência
  reveals.forEach((el) => {
    const siblings = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
    el.style.setProperty("--delay", `${siblings.indexOf(el) * 0.09}s`);
  });

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        io.unobserve(entry.target);
      }
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  reveals.forEach((el) => io.observe(el));
})();
