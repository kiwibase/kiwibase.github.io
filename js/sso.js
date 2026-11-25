// Kiwibase quick login: linked projects and the hand-off to the project sites.
//   #/links          Linked projects: link an existing project account (signed in to that project right here, in a
//                    separate Firebase app instance), open a project, unlink. KB.mountLinkedProjects(el) draws the
//                    same panel inside another page, such as Settings.
//   #/sso/<project>  Opened by "Log in with Kiwibase" on a project site: after the Kiwibase login, asks the Worker
//                    for a sign-in token and returns to that project's own site with it in the URL fragment.
// The Worker (../Worker) checks every token itself; this page only carries them.
// Loads after js/app.js, which starts the default Firebase app this file shares.

import { getApp, initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

// The deployed Worker's address (wrangler deploy prints it)
const SSO_URL = "https://kiwibase-sso.REPLACE-WITH-SUBDOMAIN.workers.dev";

// Public web configs of the project sites, for signing in to them while linking
const PROJECTS = {
  cyberpunkgreen: {
    name: "Cyberpunk Green",
    domain: "cybergreen-9539c.firebaseapp.com",
    config: {
      apiKey: "AIzaSyB6fuOnyp_2-qxjDRLRA2vJGpW8qZJUF-M", authDomain: "cybergreen-9539c.firebaseapp.com", projectId: "cybergreen-9539c",
      storageBucket: "cybergreen-9539c.firebasestorage.app", messagingSenderId: "530477870448", appId: "1:530477870448:web:6509d9c7361c7510cb73b5",
    },
  },
  umacollector: {
    name: "UmaCollector",
    domain: "umacollector-b7e80.firebaseapp.com",
    config: {
      apiKey: "AIzaSyDn_4cN1bPCTg5YJg0CCliGh2XZKWtzhZQ", authDomain: "umacollector-b7e80.firebaseapp.com", projectId: "umacollector-b7e80",
      storageBucket: "umacollector-b7e80.firebasestorage.app", messagingSenderId: "165200897922", appId: "1:165200897922:web:ec8b55190ea5cacd21d19b",
    },
  },
  terminuxmc: {
    name: "TerminuxMC",
    domain: "terminuxmc.firebaseapp.com",
    config: {
      apiKey: "AIzaSyA4YumHcwdD8GaVFFdXncNAeLZOBzXOjyo", authDomain: "terminuxmc.firebaseapp.com", projectId: "terminuxmc",
      storageBucket: "terminuxmc.firebasestorage.app", messagingSenderId: "668616977979", appId: "1:668616977979:web:a8fce3e6a9c6db168a761e",
    },
  },
};
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;

const KB = window.KB;
const esc = KB.esc;
const auth = getAuth(getApp());
const db = getFirestore(getApp());
let user = null;

const ERRORS = {
  kiwibase_login_required: "Log in to Kiwibase first.",
  kiwibase_login_too_old: "Log in to Kiwibase again to continue.",
  username_taken: "That username is taken on this site. Link your existing account on it instead.",
  username_not_allowed: "Your Kiwibase username is not allowed on this site. Link an existing account instead.",
  already_linked: "One of these accounts is already linked.",
  not_linked: "This project is not linked.",
  project_login_required: "Log in to the project account to link it.",
  token_expired: "The session ran out. Try again.",
  slow_down: "Too many tries. Wait a minute.",
  not_configured: "Quick login is not available yet.",
  wrong: "Wrong username or password.",
  network: "Could not connect. Try again.",
};
const errorText = (code) => ERRORS[code] || `Something went wrong (${code}).`;

async function worker(path, body) {
  let res;
  try {
    res = await fetch(SSO_URL + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("network");
  }
  const data = await res.json().catch(() => ({ error: "internal" }));
  if (!res.ok) throw new Error(data.error || "internal");
  return data;
}

async function myLinks() {
  const snap = await getDoc(doc(db, "profiles", user.uid));
  return (snap.exists() && snap.data().links) || {};
}

/** Signs in to a project in its own Firebase app instance and returns its ID token; the instance is removed after. */
async function projectToken(id, username, password) {
  const p = PROJECTS[id];
  const app = initializeApp(p.config, `kb-link-${id}-${Date.now()}`);
  try {
    const cred = await signInWithEmailAndPassword(getAuth(app), `${username.toLowerCase()}@${p.domain}`, password);
    return await cred.user.getIdToken();
  } catch (e) {
    const code = (e && e.code) || "";
    throw new Error(/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code) ? "wrong" : /network/.test(code) ? "network" : "project_login_required");
  } finally {
    await signOut(getAuth(app)).catch(() => {});
    await deleteApp(app).catch(() => {});
  }
}

// ---------- Linked projects ----------

function rowHtml(id, link) {
  const p = PROJECTS[id];
  if (link) {
    return `
      <div class="sso-row" data-project="${id}">
        <div class="sso-main"><span class="sso-name">${esc(p.name)}</span><span class="sso-user">${esc(link.username || "")}</span></div>
        <div class="sso-actions">
          <a class="btn" href="#/sso/${id}">Open</a>
          <button type="button" class="btn btn-danger" data-unlink="${id}">Unlink</button>
        </div>
      </div>`;
  }
  return `
    <div class="sso-row" data-project="${id}">
      <div class="sso-main"><span class="sso-name">${esc(p.name)}</span></div>
      <div class="sso-actions">
        <button type="button" class="btn" data-show="${id}">Link account</button>
        <a class="btn" href="#/sso/${id}">Open</a>
      </div>
      <form class="sso-form" data-link="${id}" hidden novalidate>
        <label class="field"><span>${esc(p.name)} username</span><input type="text" name="username" autocomplete="off" required></label>
        <label class="field"><span>Password</span><input type="password" name="password" autocomplete="off" required></label>
        <p class="sso-error" role="alert"></p>
        <button type="submit" class="btn">Link</button>
      </form>
    </div>`;
}

KB.mountLinkedProjects = async (el) => {
  if (!user) {
    el.innerHTML = `<section class="panel sso-panel"><p class="eyebrow">Linked projects</p><div><button type="button" class="btn" data-login>Log in</button></div></section>`;
    el.querySelector("[data-login]").addEventListener("click", () => KB.openLogin && KB.openLogin());
    return;
  }
  let links = {};
  try {
    links = await myLinks();
  } catch {}
  el.innerHTML = `
    <section class="panel sso-panel">
      <p class="eyebrow">Linked projects</p>
      <div class="sso-list">${Object.keys(PROJECTS).map((id) => rowHtml(id, links[id])).join("")}</div>
      <p class="sso-error" role="alert" data-top></p>
    </section>`;
  if (KB.animateIn) KB.animateIn(el.querySelector(".sso-list"), "enter-fast");
  if (el.dataset.ssoBound) return; // re-renders after link/unlink keep the listeners added the first time
  el.dataset.ssoBound = "1";

  el.addEventListener("click", async (e) => {
    const show = e.target.closest("[data-show]");
    if (show) {
      const form = el.querySelector(`form[data-link="${show.dataset.show}"]`);
      form.hidden = !form.hidden;
      if (!form.hidden) form.querySelector("input").focus();
      return;
    }
    const un = e.target.closest("[data-unlink]");
    if (un) {
      un.disabled = true;
      try {
        await worker("/unlink", { kiwibaseToken: await user.getIdToken(), project: un.dataset.unlink });
        KB.mountLinkedProjects(el);
      } catch (err) {
        un.disabled = false;
        el.querySelector("[data-top]").textContent = errorText(err.message);
      }
    }
  });
  el.addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-link]");
    if (!form) return;
    e.preventDefault();
    const id = form.dataset.link;
    const err = form.querySelector(".sso-error");
    const btn = form.querySelector("button[type=submit]");
    const v = Object.fromEntries(new FormData(form));
    err.textContent = "";
    if (!USERNAME_RE.test(String(v.username || "").trim())) return (err.textContent = errorText("wrong"));
    btn.disabled = true;
    try {
      const projectTokenValue = await projectToken(id, String(v.username).trim(), String(v.password || ""));
      await worker("/link", { kiwibaseToken: await user.getIdToken(), project: id, projectToken: projectTokenValue });
      KB.mountLinkedProjects(el);
    } catch (e2) {
      btn.disabled = false;
      err.textContent = errorText(e2.message);
    }
  });
};

KB.PAGES.links = (el) => {
  el.innerHTML = `<div class="page-head"><h1>Linked projects</h1></div><div class="sso-mount"></div>`;
  if (KB.animateIn) KB.animateIn(el);
  KB.mountLinkedProjects(el.querySelector(".sso-mount"));
};

// ---------- Hand-off to a project site ----------

KB.PAGES.sso = async (el, args) => {
  const id = args && args[0];
  const p = PROJECTS[id];
  const shell = (body) => {
    el.innerHTML = `<div class="page-head"><h1>${p ? esc(p.name) : "Quick login"}</h1></div><section class="panel sso-panel">${body}</section>`;
    if (KB.animateIn) KB.animateIn(el);
  };
  if (!p) return shell(`<p>Unknown project.</p>`);
  if (!user) {
    shell(`<div><button type="button" class="btn" data-login>Log in to Kiwibase</button></div>`);
    el.querySelector("[data-login]").addEventListener("click", () => KB.openLogin && KB.openLogin());
    return;
  }
  shell(`<p class="sso-wait">Signing in…</p>`);
  try {
    const r = await worker("/login", { kiwibaseToken: await user.getIdToken(), project: id });
    // The token goes in the fragment: it is never sent to a server, kept in logs or passed on as a referrer
    location.replace(`${r.site}#kbtoken=${encodeURIComponent(r.token)}`);
  } catch (err) {
    const code = err.message;
    shell(`
      <p class="sso-error" role="alert">${esc(errorText(code))}</p>
      <div class="sso-actions">
        ${code === "username_taken" || code === "username_not_allowed" ? `<a class="btn" href="#/links">Linked projects</a>` : `<button type="button" class="btn" data-retry>Try again</button>`}
      </div>`);
    const retry = el.querySelector("[data-retry]");
    if (retry) retry.addEventListener("click", () => KB.route(true));
  }
};

// ---------- Session ----------

onAuthStateChanged(auth, (u) => {
  user = u && !u.isAnonymous ? u : null;
  if (/^#\/(links|sso)(\/|$)/.test(location.hash)) KB.route(true);
});

window.dispatchEvent(new Event("kb-sso-ready"));
// The sso pages exist now; draw the page again if the router ran before this module loaded.
if (/^#\/(links|sso)(\/|$)/.test(location.hash)) KB.route(true);
