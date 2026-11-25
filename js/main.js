// Kiwibase: page router, shared helpers, the home page and the live people search.
// Pages are chosen by the hash: #/ (home), #/u/<username> (profile), #/me, #/settings. Each page is a
// mount(el, args) function in KB.PAGES; app.js (Firebase) adds the account pages. Page changes fade the old page
// out and let the new one rise in, as on TerminuxMC.

const KB = (window.KB = window.KB || {});

KB.esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

KB.animateIn = (container, cls = "enter") => {
  Array.from(container.children).forEach((child, i) => {
    child.style.setProperty("--i", String(Math.min(i, 14)));
    child.classList.add(cls);
  });
};

/** A round avatar: the picture when there is one, else the first letter on the user's gradient. */
KB.avatarHtml = (name, src, gradient, size) => {
  const style = `${size ? `--size:${size}px;` : ""}${gradient ? `--grad:${gradient};` : ""}`;
  return `<span class="avatar" style="${style}" aria-hidden="true">${
    src ? `<img src="${KB.esc(src)}" alt="">` : KB.esc(String(name || "?").charAt(0))
  }</span>`;
};

KB.PROJECTS = [
  {
    id: "cyberpunkgreen",
    name: "Cyberpunk Green",
    url: "https://cyberpunkgreen.github.io",
    color: "#39ff14",
    text: "A tabletop role-playing ruleset set in Night City: rules, character creation and online game tables.",
  },
  {
    id: "umacollector",
    name: "UmaCollector",
    url: "https://umacollector.github.io",
    color: "#ff7ab6",
    text: "A collection tracker and toolbox for Umamusume: cards, guides and race tools.",
  },
  {
    id: "terminuxmc",
    name: "TerminuxMC",
    url: "https://terminuxmc.github.io",
    color: "#e9b115",
    text: "The Terminux Server AIO Minecraft modpack: relics, gear, the skill tree and player profiles.",
  },
];

KB.PAGES = KB.PAGES || {};

// ---------- Home ----------

KB.PAGES.home = (el) => {
  el.innerHTML = `
    <section class="hero">
      <h1>Welcome to <span>Kiwibase</span></h1>
      <div class="search hero-search" data-search>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2"/></svg>
        <input type="search" placeholder="Find someone" aria-label="Search people" autocomplete="off"
          role="combobox" aria-expanded="false" aria-autocomplete="list">
        <ul class="suggest" role="listbox"></ul>
      </div>
    </section>
    <p class="eyebrow" style="margin-bottom:12px">Projects</p>
    <div class="projects">
      ${KB.PROJECTS.map(
        (p) => `
        <a class="project" href="${p.url}" target="_blank" rel="noopener" style="--card:${p.color}">
          <h2>${KB.esc(p.name)}</h2>
          <p>${KB.esc(p.text)}</p>
          <span class="go">Open ${KB.esc(p.name)} →</span>
        </a>`
      ).join("")}
    </div>`;
  KB.animateIn(el);
  KB.bindSearch(el.querySelector("[data-search]"));
};

KB.PAGES.notfound = (el) => {
  el.innerHTML = `<div class="page-head"><h1>Not found</h1></div><section class="panel"><p>There is nothing here. <a href="#/">Go home</a>.</p></section>`;
  KB.animateIn(el);
};

// ---------- Router ----------

const app = document.getElementById("app");
let current = null;
let leaveTimer = 0;

KB.route = (instant = false) => {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  let id = parts[0] || "home";
  let args = parts.slice(1).map(decodeURIComponent);
  if (id === "u") id = "profile";
  if (!KB.PAGES[id]) id = "notfound";
  const draw = () => {
    app.classList.remove("leaving");
    app.innerHTML = "";
    current = id;
    KB.PAGES[id](app, args);
  };
  clearTimeout(leaveTimer);
  if (instant || current === null) return draw();
  app.classList.add("leaving");
  leaveTimer = setTimeout(draw, 140);
};

window.addEventListener("hashchange", () => {
  closeMenu();
  window.scrollTo({ top: 0, behavior: "smooth" });
  KB.route();
  app.focus({ preventScroll: true });
});

// ---------- Phone menu ----------

const menuBtn = document.getElementById("menu-toggle");
const scrim = document.getElementById("scrim");
function openMenu() {
  document.body.classList.add("menu-open");
  menuBtn.setAttribute("aria-expanded", "true");
  menuBtn.setAttribute("aria-label", "Close menu");
}
function closeMenu() {
  document.body.classList.remove("menu-open");
  menuBtn.setAttribute("aria-expanded", "false");
  menuBtn.setAttribute("aria-label", "Open menu");
}
KB.closeMenu = closeMenu;
menuBtn.addEventListener("click", () => (document.body.classList.contains("menu-open") ? closeMenu() : openMenu()));
scrim.addEventListener("click", closeMenu);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("menu-open")) closeMenu();
});

// ---------- Dialogs that fade in and out ----------

KB.openDialog = (dialog) => {
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add("show")));
};
KB.closeDialog = (dialog) => {
  if (!dialog.open) return;
  dialog.classList.remove("show");
  setTimeout(() => dialog.open && dialog.close(), 280);
};

// ---------- Live people search ----------
// KB.searchUsers(text) is set by app.js and resolves to [{ uid, username, usernameLower, avatar, theme }].

KB.bindSearch = (box) => {
  if (!box || box.dataset.bound) return;
  box.dataset.bound = "1";
  const input = box.querySelector("input");
  const list = box.querySelector(".suggest");
  let results = [];
  let active = -1;
  let timer = 0;
  let seq = 0;

  const setOpen = (open) => {
    box.classList.toggle("open", open);
    input.setAttribute("aria-expanded", String(open));
  };
  const highlight = (name, q) => {
    const i = name.toLowerCase().indexOf(q);
    if (i < 0 || !q) return KB.esc(name);
    return KB.esc(name.slice(0, i)) + "<mark>" + KB.esc(name.slice(i, i + q.length)) + "</mark>" + KB.esc(name.slice(i + q.length));
  };
  const render = (q) => {
    if (!q) return setOpen(false);
    if (!results.length) {
      list.innerHTML = `<li class="note" role="option" aria-disabled="true">No one found</li>`;
    } else {
      list.innerHTML = results
        .map((u, i) => {
          const css = KB.themeCss(u.theme);
          return `<li role="option" data-name="${KB.esc(u.username)}" aria-selected="${i === active}" style="--i:${i}">
            ${KB.avatarHtml(u.username, u.avatarSrc, css.gradient, 30)}<span>${highlight(u.username, q)}</span></li>`;
        })
        .join("");
    }
    setOpen(true);
  };
  const go = (name) => {
    setOpen(false);
    input.value = "";
    input.blur();
    location.hash = "#/u/" + encodeURIComponent(name);
  };

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    clearTimeout(timer);
    active = -1;
    if (!q) {
      results = [];
      return setOpen(false);
    }
    timer = setTimeout(async () => {
      const mine = ++seq;
      let found = [];
      try {
        found = KB.searchUsers ? await KB.searchUsers(q) : [];
      } catch {
        found = [];
      }
      if (mine !== seq) return; // a newer search started meanwhile
      results = KB.rankUsers(found, q);
      render(q);
    }, 180);
  });
  input.addEventListener("keydown", (e) => {
    if (!box.classList.contains("open") || !results.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      list.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[Math.max(0, active)].username);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-name]");
    if (li) {
      e.preventDefault();
      go(li.dataset.name);
    }
  });
  input.addEventListener("blur", () => setTimeout(() => setOpen(false), 120));
  input.addEventListener("focus", () => input.value.trim() && results.length && render(input.value.trim().toLowerCase()));
};

document.querySelectorAll(".topbar [data-search], .drawer [data-search]").forEach(KB.bindSearch);
document.addEventListener("DOMContentLoaded", () => KB.route(true));
