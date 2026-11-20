// Porchlight site: the light-on intro, one-shot scroll reveals, the light following the pointer, the four-answers
// highlight, and the copy button. No libraries, nothing loaded from anywhere else.
(() => {
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.classList.add("js");

  // ---- Headline: split into words so the light can reach them one by one. The text itself is unchanged, so the
  // heading still reads as one sentence to screen readers.
  for (const el of document.querySelectorAll("[data-split]")) {
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = "";
    words.forEach((w, i) => {
      const s = document.createElement("span");
      s.className = "w";
      s.style.setProperty("--i", i);
      s.textContent = w;
      el.append(s, i < words.length - 1 ? " " : "");
    });
  }

  // ---- The light turns on (once, on load). "lit" sets up the timings; "on" (two frames later) flips to the lit
  // state, so every transition actually runs from the dark starting point.
  const hero = document.getElementById("hero");
  if (root.classList.contains("pl-intro")) {
    hero.classList.add("lit");
    void hero.offsetWidth; // commit the dark starting styles, so the change below is animated
    root.classList.add("pl-on");
  }

  // ---- Scroll reveals: each element materialises once as it enters the view, with a small stagger per group.
  const reveals = [...document.querySelectorAll(".reveal, .reveal-wipe")];
  if (reduce || !("IntersectionObserver" in window)) {
    reveals.forEach((n) => n.classList.add("seen"));
  } else {
    const groups = new Map();
    for (const n of reveals) {
      const g = n.parentElement;
      const k = groups.get(g) || 0;
      n.style.setProperty("--k", Math.min(k, 5));
      groups.set(g, k + 1);
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("seen");
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    reveals.forEach((n) => io.observe(n));
  }

  // ---- The light leans toward the pointer (fine pointers only, while the hero is on screen).
  const spot = hero.querySelector(".spot");
  if (!reduce && matchMedia("(pointer: fine)").matches && spot) {
    let target = { x: 0, y: 0 };
    let pos = { x: 0, y: 0 };
    let frame = 0;
    let visible = true;
    const step = () => {
      pos.x += (target.x - pos.x) * 0.12;
      pos.y += (target.y - pos.y) * 0.12;
      spot.style.transform = `translate3d(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px, 0)`;
      frame = Math.abs(target.x - pos.x) + Math.abs(target.y - pos.y) > 0.5 && visible ? requestAnimationFrame(step) : 0;
    };
    hero.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      target = { x: (e.clientX - r.left - r.width / 2) * 0.55, y: (e.clientY - r.top - 380) * 0.5 };
      hero.classList.add("pointing");
      if (!frame) frame = requestAnimationFrame(step);
    });
    hero.addEventListener("pointerleave", () => {
      target = { x: 0, y: 0 };
      hero.classList.remove("pointing");
      if (!frame) frame = requestAnimationFrame(step);
    });
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(hero);
    document.addEventListener("visibilitychange", () => { if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; } });
  }

  // ---- Four answers: point at a part, and the same part lights up in the example finding.
  const card = document.querySelector(".card-demo");
  const buttons = [...document.querySelectorAll(".parts button")];
  const light = (part) => {
    buttons.forEach((b) => b.classList.toggle("on", b.dataset.part === part));
    card?.querySelectorAll("[data-part]").forEach((d) => d.classList.toggle("on", d.dataset.part === part));
  };
  for (const b of buttons) {
    b.addEventListener("mouseenter", () => light(b.dataset.part));
    b.addEventListener("focus", () => light(b.dataset.part));
    b.addEventListener("click", () => light(b.dataset.part));
  }
  // When the example first comes into view, walk through the four parts once, then leave the first one lit.
  if (card && !reduce && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      ["found", "means", "likely", "fix"].forEach((p, i) => setTimeout(() => light(p), 500 + i * 650));
      setTimeout(() => light("found"), 500 + 4 * 650);
    }, { threshold: 0.5 });
    io.observe(card);
  } else {
    light("found");
  }

  // ---- Copy button: icon swaps to a check for a moment.
  for (const btn of document.querySelectorAll("[data-copy]")) {
    btn.addEventListener("click", async () => {
      const text = document.getElementById(btn.dataset.copy)?.textContent || "";
      try {
        await navigator.clipboard.writeText(text);
        btn.classList.add("done");
        btn.querySelector(".copy-label").textContent = "Copied";
        setTimeout(() => {
          btn.classList.remove("done");
          btn.querySelector(".copy-label").textContent = "Copy";
        }, 1600);
      } catch {
        btn.querySelector(".copy-label").textContent = "Select and copy";
      }
    });
  }
})();
