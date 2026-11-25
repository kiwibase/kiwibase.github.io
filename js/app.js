// Kiwibase accounts, profiles and settings (Firebase). Rules: ../Planning/Firestore-Rules.txt
//   users/{uid}     private: { username, usernameLower, createdAt }
//   profiles/{uid}  public:  { username, usernameLower, theme: { preset, angle }, bio, links: {}, avatar, updatedAt }
//   avatars/{uid}   public:  { data: "data:image/webp;base64,…", updatedAt }  (256x256; Storage needs the paid plan)
// Usernames become username@kiwibase.firebaseapp.com behind the scenes; Firebase keeps the passwords.
// profiles.links holds the user's linked project accounts, { <project id>: { url } }; the linking flows that write
// it come later, the profile already shows a button for each link present.

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAebQbNRPW9iARScrYQYqTP1Dy-WxvrBZs",
  authDomain: "kiwibase.firebaseapp.com",
  databaseURL: "https://kiwibase-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kiwibase",
  storageBucket: "kiwibase.firebasestorage.app",
  messagingSenderId: "508112907701",
  appId: "1:508112907701:web:2fd7318f957c696c83bdfc",
};

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

const KB = window.KB;
const esc = KB.esc;
const EMAIL_DOMAIN = "kiwibase.firebaseapp.com";
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;
const MIN_PASSWORD = 8;
const BIO_MAX = 280;
const AVATAR_PX = 256;
const AVATAR_MAX_CHARS = 160000; // the rules allow up to 180000

let user = null;
let account = null; // users/{uid}
let me = null; // profiles/{uid} of the signed-in user
let view = "login";

const ERRORS = {
  username: "Usernames are 3 to 20 characters: letters, digits, dots, underscores and dashes.",
  password: `Passwords need at least ${MIN_PASSWORD} characters.`,
  mismatch: "The passwords do not match.",
  taken: "That username is taken.",
  wrong: "Wrong username or password.",
  tooMany: "Too many attempts. Wait a little and try again.",
  network: "Could not connect. Check your connection and try again.",
  denied: "You are not allowed to do that.",
  other: "Something went wrong",
};

function errorText(err) {
  const code = (err && err.code) || "";
  if (code === "auth/email-already-in-use") return ERRORS.taken;
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"].includes(code)) return ERRORS.wrong;
  if (code === "auth/too-many-requests") return ERRORS.tooMany;
  if (code === "auth/network-request-failed" || code === "unavailable") return ERRORS.network;
  if (code === "auth/weak-password") return ERRORS.password;
  if (code === "permission-denied") return ERRORS.denied;
  return `${ERRORS.other}${code ? ` (${code})` : ""}.`;
}

// ---------- Avatars ----------

const avatarCache = new Map(); // uid -> data URL or null

async function avatarOf(uid, has) {
  if (!has) return null;
  if (avatarCache.has(uid)) return avatarCache.get(uid);
  let src = null;
  try {
    const snap = await getDoc(doc(db, "avatars", uid));
    src = snap.exists() ? snap.data().data : null;
  } catch {
    src = null;
  }
  avatarCache.set(uid, src);
  return src;
}

// ---------- Search, used by main.js ----------

KB.searchUsers = async (text) => {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const snap = await getDocs(
    query(collection(db, "profiles"), where("usernameLower", ">=", q), where("usernameLower", "<=", q + ""), orderBy("usernameLower"), limit(8))
  );
  const users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  await Promise.all(users.map(async (u) => (u.avatarSrc = await avatarOf(u.uid, u.avatar))));
  return users;
};

async function profileByName(name) {
  const snap = await getDocs(query(collection(db, "profiles"), where("usernameLower", "==", String(name).toLowerCase()), limit(1)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { uid: d.id, ...d.data() };
}

// ---------- Account buttons ----------

const tabs = document.querySelectorAll("[data-auth-tab]");

async function renderTabs() {
  let html;
  if (!user) {
    html = `<button type="button" class="btn" data-open="login">Log in</button>
            <button type="button" class="btn btn-accent" data-open="register">Sign up</button>`;
  } else {
    const name = (account && account.username) || "Me";
    const src = me ? await avatarOf(user.uid, me.avatar) : null;
    const css = KB.themeCss(me && me.theme);
    html = `<a class="who" href="#/me">${KB.avatarHtml(name, src, css.gradient, 30)}<span>${esc(name)}</span></a>
            <button type="button" class="btn" data-action="logout">Log out</button>`;
  }
  tabs.forEach((tab) => {
    tab.innerHTML = html;
    KB.animateIn(tab, "enter-fast");
  });
  document.querySelectorAll("[data-needs-user]").forEach((a) => (a.hidden = !user));
}

tabs.forEach((tab) =>
  tab.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    KB.closeMenu();
    if (b.dataset.open) openDialog(b.dataset.open);
    if (b.dataset.action === "logout") await signOut(auth);
  })
);

// ---------- Log in and sign up ----------

const dialog = document.createElement("dialog");
dialog.className = "kb-dialog";
document.body.appendChild(dialog);
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) return KB.closeDialog(dialog);
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.action === "close") KB.closeDialog(dialog);
  else if (b.dataset.open) openDialog(b.dataset.open);
});
dialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  KB.closeDialog(dialog);
});

const field = (name, label, type, hint, autocomplete) =>
  `<label class="auth-field"><span>${label}</span><input name="${name}" type="${type}" autocomplete="${autocomplete}" required>${hint ? `<small>${hint}</small>` : ""}</label>`;

function renderDialog() {
  const close = `<button type="button" class="auth-close" data-action="close" aria-label="Close">×</button>`;
  dialog.innerHTML =
    view === "login"
      ? `<form class="auth-panel" novalidate>
          ${close}
          <h2>Log in</h2>
          ${field("username", "Username", "text", "", "username")}
          ${field("password", "Password", "password", "", "current-password")}
          <p class="auth-error" role="alert"></p>
          <button type="submit" class="btn btn-accent auth-submit">Log in</button>
          <p class="auth-switch">No account yet? <button type="button" data-open="register">Sign up</button></p>
        </form>`
      : `<form class="auth-panel" novalidate>
          ${close}
          <h2>Sign up</h2>
          ${field("username", "Username", "text", "3–20 letters, digits, dots, underscores or dashes.", "username")}
          ${field("password", "Password", "password", `At least ${MIN_PASSWORD} characters.`, "new-password")}
          ${field("password2", "Password again", "password", "", "new-password")}
          <p class="auth-error" role="alert"></p>
          <button type="submit" class="btn btn-accent auth-submit">Sign up</button>
          <p class="auth-switch">Already have an account? <button type="button" data-open="login">Log in</button></p>
        </form>`;
  KB.animateIn(dialog.querySelector(".auth-panel"), "enter-fast");
}

function openDialog(which) {
  view = which;
  renderDialog();
  KB.openDialog(dialog);
  const first = dialog.querySelector("input");
  if (first) first.focus();
}
KB.openLogin = () => openDialog("login");

dialog.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const errBox = form.querySelector(".auth-error");
  const submit = form.querySelector(".auth-submit");
  const v = Object.fromEntries(new FormData(form));
  const username = String(v.username || "").trim();
  const showError = (msg) => (errBox.textContent = msg);
  showError("");
  if (!USERNAME_RE.test(username)) return showError(ERRORS.username);
  if (view === "register") {
    if (String(v.password).length < MIN_PASSWORD) return showError(ERRORS.password);
    if (v.password !== v.password2) return showError(ERRORS.mismatch);
  }
  const label = submit.textContent;
  submit.disabled = true;
  submit.textContent = "Please wait…";
  const email = `${username.toLowerCase()}@${EMAIL_DOMAIN}`;
  try {
    if (view === "login") {
      await signInWithEmailAndPassword(auth, email, v.password);
    } else {
      const cred = await createUserWithEmailAndPassword(auth, email, v.password);
      const lower = username.toLowerCase();
      const acc = { username, usernameLower: lower, createdAt: serverTimestamp() };
      const prof = { username, usernameLower: lower, theme: { ...KB.DEFAULT }, bio: "", links: {}, avatar: false, updatedAt: serverTimestamp() };
      try {
        const batch = writeBatch(db);
        batch.set(doc(db, "users", cred.user.uid), acc);
        batch.set(doc(db, "profiles", cred.user.uid), prof);
        await batch.commit();
      } catch (err) {
        await deleteUser(cred.user).catch(() => {});
        throw err;
      }
      account = acc;
      me = prof;
      renderTabs();
    }
    KB.closeDialog(dialog);
  } catch (err) {
    showError(errorText(err));
  } finally {
    submit.disabled = false;
    submit.textContent = label;
  }
});

// ---------- Profile ----------

const chevron = `<svg class="chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;

function themeStyle(theme) {
  const css = KB.themeCss(theme);
  return { css, style: `--grad:${css.gradient};--p-accent:${css.accent};--p-on:${css.onAccent}` };
}

KB.PAGES.profile = async (el, args) => {
  const name = args[0] || "";
  let p = null;
  try {
    p = await profileByName(name);
  } catch {
    p = null;
  }
  if (!p) return KB.PAGES.notfound(el);
  const src = await avatarOf(p.uid, p.avatar);
  const { css, style } = themeStyle(p.theme);
  const own = user && user.uid === p.uid;
  const links = p.links || {};
  const projects = KB.PROJECTS.filter((pr) => links[pr.id]);
  el.innerHTML = `
    <div class="profile" style="${style}">
      <div class="profile-banner"></div>
      <div class="profile-head">
        ${KB.avatarHtml(p.username, src, css.gradient)}
        <div class="profile-name"><h1>${esc(p.username)}</h1></div>
        ${own ? `<div class="profile-actions"><a class="btn btn-accent" href="#/settings">Edit profile</a></div>` : ""}
      </div>
      <div class="profile-body">
        ${p.bio ? `<section class="panel"><p class="eyebrow">About</p><p class="bio">${esc(p.bio)}</p></section>` : ""}
        ${
          projects.length
            ? `<section class="panel"><p class="eyebrow">Projects</p><div class="links">${projects
                .map((pr) => {
                  const url = (links[pr.id] && links[pr.id].url) || pr.url;
                  return `<a class="link-btn" href="${esc(url)}" target="_blank" rel="noopener" style="--card:${pr.color}"><span class="dot"></span><span>${esc(pr.name)}</span>${chevron}</a>`;
                })
                .join("")}</div></section>`
            : ""
        }
      </div>
    </div>`;
  const prof = el.querySelector(".profile");
  KB.animateIn(prof);
  KB.animateIn(el.querySelector(".profile-body"));
};

KB.PAGES.me = (el) => {
  if (user && account) {
    location.replace("#/u/" + encodeURIComponent(account.username));
    return;
  }
  el.innerHTML = `<div class="page-head"><h1>Profile</h1></div>
    <section class="panel"><div class="row-btns"><button type="button" class="btn btn-accent" id="me-login">Log in</button></div></section>`;
  el.querySelector("#me-login").addEventListener("click", () => openDialog("login"));
  KB.animateIn(el);
};

// ---------- Settings ----------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}

/** Draws the cropped square at 256 px and encodes it, lowering quality until it fits the size cap. */
function encodeAvatar(img, crop, box) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_PX;
  const g = canvas.getContext("2d");
  g.imageSmoothingQuality = "high";
  const k = AVATAR_PX / box;
  g.drawImage(img, crop.x * k, crop.y * k, img.naturalWidth * crop.scale * k, img.naturalHeight * crop.scale * k);
  for (const type of ["image/webp", "image/jpeg"]) {
    for (let q = 0.9; q >= 0.4; q -= 0.1) {
      const data = canvas.toDataURL(type, q);
      if (!data.startsWith("data:" + type)) break; // this browser cannot encode the type
      if (data.length <= AVATAR_MAX_CHARS) return data;
    }
  }
  return null;
}

KB.PAGES.settings = async (el) => {
  if (!user) {
    el.innerHTML = `<div class="page-head"><h1>Settings</h1></div>
      <section class="panel"><div class="row-btns"><button type="button" class="btn btn-accent" id="set-login">Log in</button></div></section>`;
    el.querySelector("#set-login").addEventListener("click", () => openDialog("login"));
    KB.animateIn(el);
    return;
  }
  let prof = me;
  try {
    const snap = await getDoc(doc(db, "profiles", user.uid));
    prof = snap.exists() ? snap.data() : me;
  } catch {}
  if (!prof) return KB.PAGES.notfound(el);
  const state = {
    theme: KB.normalize(prof.theme),
    bio: prof.bio || "",
    avatarSrc: await avatarOf(user.uid, prof.avatar),
    newImage: null, // { img, url } when a new picture is chosen
    removed: false,
    crop: { x: 0, y: 0, scale: 1, min: 1 },
  };
  const BOX = 168;

  el.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    <div class="settings">
      <div style="display:flex;flex-direction:column;gap:20px">
        <section class="panel">
          <p class="eyebrow">Profile picture</p>
          <div class="avatar-edit">
            <div class="crop" aria-label="Picture crop"></div>
            <div class="avatar-tools">
              <label class="field zoom-field" hidden><span>Zoom</span><input type="range" class="zoom" min="1" max="4" step="0.01" value="1"></label>
              <div class="row-btns">
                <label class="btn"><input type="file" accept="image/*" class="file" hidden>Choose picture</label>
                <button type="button" class="btn btn-danger remove">Remove</button>
              </div>
            </div>
          </div>
        </section>
        <section class="panel">
          <label class="field"><span class="eyebrow">About</span>
            <textarea class="bio-in" rows="4" maxlength="${BIO_MAX}">${esc(state.bio)}</textarea></label>
        </section>
        <section class="panel">
          <p class="eyebrow">Theme</p>
          <div class="swatches" role="group" aria-label="Theme">
            ${KB.PRESETS.map(
              (p) => `<button type="button" class="swatch" data-preset="${p.id}" aria-pressed="false" style="--grad:linear-gradient(135deg, ${p.a}, ${p.b})">${esc(p.name)}</button>`
            ).join("")}
          </div>
          <div class="angle">
            <div class="dial" role="slider" tabindex="0" aria-label="Gradient angle" aria-valuemin="0" aria-valuemax="359">
              <span class="hand"></span><span class="knob"></span>
            </div>
            <input type="range" class="angle-in" min="0" max="359" step="1" aria-label="Gradient angle">
            <span class="angle-value"></span>
          </div>
        </section>
        <div class="save-row"><button type="button" class="btn btn-accent save">Save</button><span class="status" role="status"></span></div>
      </div>
      <aside class="preview">
        <div class="card">
          <div class="card-banner"></div>
          <div class="card-body"><span class="pv-avatar"></span><b>${esc(prof.username)}</b></div>
          <div class="accent-bar"></div>
        </div>
      </aside>
    </div>`;
  KB.animateIn(el.querySelector(".settings > div"));

  const $ = (s) => el.querySelector(s);
  const cropBox = $(".crop");
  const zoom = $(".zoom");
  const angleIn = $(".angle-in");
  const dial = $(".dial");
  const status = $(".status");

  // --- preview and theme ---
  const previewAvatar = () => {
    const css = KB.themeCss(state.theme);
    let src = state.removed ? null : state.avatarSrc;
    if (state.newImage) src = encodeAvatar(state.newImage.img, state.crop, BOX) || src;
    $(".pv-avatar").innerHTML = KB.avatarHtml(prof.username, src, css.gradient, 64);
  };
  const paintTheme = () => {
    const css = KB.themeCss(state.theme);
    const card = $(".preview");
    card.style.setProperty("--grad", css.gradient);
    card.style.setProperty("--p-accent", css.accent);
    el.querySelectorAll(".swatch").forEach((s) => s.setAttribute("aria-pressed", String(s.dataset.preset === state.theme.preset)));
    angleIn.value = String(state.theme.angle);
    $(".angle-value").textContent = state.theme.angle + "°";
    const a = state.theme.angle;
    $(".hand").style.transform = `rotate(${a + 180}deg)`;
    const r = 28;
    const rad = ((a - 90) * Math.PI) / 180;
    const knob = $(".knob");
    knob.style.left = `${36 + r * Math.cos(rad) - 7}px`;
    knob.style.top = `${36 + r * Math.sin(rad) - 7}px`;
    dial.setAttribute("aria-valuenow", String(a));
    previewAvatar();
  };
  el.querySelector(".swatches").addEventListener("click", (e) => {
    const s = e.target.closest(".swatch");
    if (!s) return;
    state.theme.preset = s.dataset.preset;
    paintTheme();
  });
  angleIn.addEventListener("input", () => {
    state.theme.angle = Number(angleIn.value);
    paintTheme();
  });
  const setFromPointer = (e) => {
    const r = dial.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    state.theme.angle = (Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90) + 360) % 360;
    paintTheme();
  };
  dial.addEventListener("pointerdown", (e) => {
    dial.setPointerCapture(e.pointerId);
    setFromPointer(e);
  });
  dial.addEventListener("pointermove", (e) => dial.hasPointerCapture(e.pointerId) && setFromPointer(e));
  dial.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 15 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") state.theme.angle = (state.theme.angle + step) % 360;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") state.theme.angle = (state.theme.angle - step + 360) % 360;
    else return;
    e.preventDefault();
    paintTheme();
  });

  // --- avatar crop: drag to move, zoom with the slider or the wheel ---
  const clampCrop = () => {
    const c = state.crop;
    const w = state.newImage.img.naturalWidth * c.scale;
    const h = state.newImage.img.naturalHeight * c.scale;
    c.x = Math.min(0, Math.max(BOX - w, c.x));
    c.y = Math.min(0, Math.max(BOX - h, c.y));
  };
  const drawCrop = () => {
    if (state.newImage) {
      const c = state.crop;
      const im = cropBox.querySelector("img");
      im.style.width = `${state.newImage.img.naturalWidth * c.scale}px`;
      im.style.height = `${state.newImage.img.naturalHeight * c.scale}px`;
      im.style.transform = `translate(${c.x}px, ${c.y}px)`;
    }
  };
  const showCurrent = () => {
    const css = KB.themeCss(state.theme);
    const src = state.removed ? null : state.avatarSrc;
    cropBox.innerHTML = src ? `<img src="${esc(src)}" alt="" style="width:100%;height:100%">` : KB.avatarHtml(prof.username, null, css.gradient, BOX);
    $(".zoom-field").hidden = true;
    $(".remove").hidden = !src;
  };
  showCurrent();
  $(".file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (state.newImage) URL.revokeObjectURL(state.newImage.url);
      state.newImage = await loadImage(file);
    } catch {
      status.textContent = "That file is not a picture.";
      return;
    }
    state.removed = false;
    const im = state.newImage.img;
    const min = BOX / Math.min(im.naturalWidth, im.naturalHeight);
    state.crop = { scale: min, min, x: (BOX - im.naturalWidth * min) / 2, y: (BOX - im.naturalHeight * min) / 2 };
    cropBox.innerHTML = `<img src="${state.newImage.url}" alt="">`;
    zoom.value = "1";
    $(".zoom-field").hidden = false;
    $(".remove").hidden = false;
    drawCrop();
    previewAvatar();
  });
  const zoomTo = (factor, cx = BOX / 2, cy = BOX / 2) => {
    if (!state.newImage) return;
    const c = state.crop;
    const next = c.min * Math.min(4, Math.max(1, factor));
    c.x = cx - ((cx - c.x) * next) / c.scale;
    c.y = cy - ((cy - c.y) * next) / c.scale;
    c.scale = next;
    zoom.value = String(next / c.min);
    clampCrop();
    drawCrop();
    previewAvatar();
  };
  zoom.addEventListener("input", () => zoomTo(Number(zoom.value)));
  cropBox.addEventListener("wheel", (e) => {
    if (!state.newImage) return;
    e.preventDefault();
    const r = cropBox.getBoundingClientRect();
    zoomTo(state.crop.scale / state.crop.min * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let drag = null;
  cropBox.addEventListener("pointerdown", (e) => {
    if (!state.newImage) return;
    cropBox.setPointerCapture(e.pointerId);
    cropBox.classList.add("dragging");
    drag = { x: e.clientX, y: e.clientY, cx: state.crop.x, cy: state.crop.y };
  });
  cropBox.addEventListener("pointermove", (e) => {
    if (!drag) return;
    state.crop.x = drag.cx + e.clientX - drag.x;
    state.crop.y = drag.cy + e.clientY - drag.y;
    clampCrop();
    drawCrop();
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    cropBox.classList.remove("dragging");
    previewAvatar();
  };
  cropBox.addEventListener("pointerup", endDrag);
  cropBox.addEventListener("pointercancel", endDrag);
  $(".remove").addEventListener("click", () => {
    if (state.newImage) URL.revokeObjectURL(state.newImage.url);
    state.newImage = null;
    state.removed = true;
    showCurrent();
    previewAvatar();
  });

  // --- save ---
  $(".save").addEventListener("click", async () => {
    const btn = $(".save");
    btn.disabled = true;
    status.textContent = "Saving…";
    try {
      const bio = $(".bio-in").value.slice(0, BIO_MAX);
      let avatarFlag = !!(state.avatarSrc && !state.removed);
      const batch = writeBatch(db);
      if (state.newImage) {
        const data = encodeAvatar(state.newImage.img, state.crop, BOX);
        if (!data) throw new Error("avatar");
        batch.set(doc(db, "avatars", user.uid), { data, updatedAt: serverTimestamp() });
        avatarCache.set(user.uid, data);
        state.avatarSrc = data;
        avatarFlag = true;
      } else if (state.removed && prof.avatar) {
        batch.delete(doc(db, "avatars", user.uid));
        avatarCache.set(user.uid, null);
        state.avatarSrc = null;
        avatarFlag = false;
      }
      const update = { theme: { ...state.theme }, bio, avatar: avatarFlag, updatedAt: serverTimestamp() };
      batch.update(doc(db, "profiles", user.uid), update);
      await batch.commit();
      prof.avatar = avatarFlag;
      me = { ...(me || prof), ...update };
      state.newImage = null;
      state.removed = false;
      showCurrent();
      status.textContent = "Saved";
      renderTabs();
    } catch (err) {
      status.textContent = err && err.message === "avatar" ? "That picture could not be made small enough." : errorText(err);
    } finally {
      btn.disabled = false;
    }
  });

  paintTheme();
};

// ---------- Session ----------

onAuthStateChanged(auth, async (u) => {
  user = u && !u.isAnonymous ? u : null;
  account = null;
  me = null;
  if (user) {
    try {
      const [a, p] = await Promise.all([getDoc(doc(db, "users", user.uid)), getDoc(doc(db, "profiles", user.uid))]);
      account = a.exists() ? a.data() : null;
      me = p.exists() ? p.data() : null;
    } catch {}
  }
  renderTabs();
  const h = location.hash;
  if (h.startsWith("#/me") || h.startsWith("#/settings") || h.startsWith("#/u/")) KB.route(true);
});

renderTabs();
// The account pages exist now; draw the page again if the router ran before this module loaded.
if (/^#\/(me|settings|u\/)/.test(location.hash)) KB.route(true);
