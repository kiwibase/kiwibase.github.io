// Kiwibase profile themes and small pure helpers (no DOM, also loadable in Node for tests).
// A theme is one of 20 two-color gradient presets plus an angle. Both colors are dark enough that white text on
// them stays readable; the profile's accent color is derived from the more saturated color, lightened until it reads on
// the site's dark grey ground.

(function (root) {
  const PRESETS = [
    { id: "kiwi", name: "Kiwi", a: "#1f6f3a", b: "#357a24" },
    { id: "forest", name: "Forest", a: "#123f2f", b: "#2a6e50" },
    { id: "moss", name: "Moss", a: "#33481a", b: "#5f6f1a" },
    { id: "teal", name: "Teal", a: "#0c5c5c", b: "#137060" },
    { id: "aurora", name: "Aurora", a: "#1a6458", b: "#55389e" },
    { id: "ocean", name: "Ocean", a: "#0b4a84", b: "#14798b" },
    { id: "deep_sea", name: "Deep Sea", a: "#0a2a5e", b: "#105f80" },
    { id: "midnight", name: "Midnight", a: "#141e30", b: "#2b4566" },
    { id: "steel", name: "Steel", a: "#2c3e50", b: "#2a6286" },
    { id: "slate", name: "Slate", a: "#2a323e", b: "#4a5670" },
    { id: "royal", name: "Royal", a: "#26268a", b: "#5f1fa8" },
    { id: "grape", name: "Grape", a: "#421a5e", b: "#7f2a80" },
    { id: "twilight", name: "Twilight", a: "#331a66", b: "#9a2d70" },
    { id: "rose", name: "Rose", a: "#8a2249", b: "#ad3560" },
    { id: "crimson", name: "Crimson", a: "#7d0a26", b: "#46093a" },
    { id: "ember", name: "Ember", a: "#6e1c1c", b: "#a8322a" },
    { id: "sunset", name: "Sunset", a: "#a2342a", b: "#a45514" },
    { id: "amber", name: "Amber", a: "#7a5000", b: "#9c4a16" },
    { id: "coral", name: "Coral", a: "#a03e35", b: "#952f63" },
    { id: "neon", name: "Neon", a: "#0d6e60", b: "#2453c2" },
  ];
  const DEFAULT = { preset: "kiwi", angle: 135 };
  const GROUND = "#121413";

  const hexToRgb = (hex) => {
    const h = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const rgbToHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

  /** WCAG relative luminance. */
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** Mixes a color toward white in small steps until it reads on the dark ground (4.5:1). */
  function accentFrom(hex, ground = GROUND, target = 4.5) {
    const rgb = hexToRgb(hex);
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const mixed = rgbToHex(rgb.map((v) => v + (255 - v) * t));
      if (contrast(mixed, ground) >= target) return mixed;
    }
    return "#ffffff";
  }

  function preset(id) {
    return PRESETS.find((p) => p.id === id) || PRESETS[0];
  }

  /** A saved theme made safe: a known preset and a whole angle 0..359. */
  function normalize(theme) {
    const t = theme || {};
    const angle = Number.isFinite(Number(t.angle)) ? ((Math.round(Number(t.angle)) % 360) + 360) % 360 : DEFAULT.angle;
    return { preset: preset(t.preset).id, angle };
  }

  /** CSS values for a theme: the gradient, the accent and readable text on the accent. */
  function themeCss(theme) {
    const t = normalize(theme);
    const p = preset(t.preset);
    // the accent comes from the more saturated of the two colors, so dark purple ends do not give a muddy accent
    const chroma = (hex) => { const c = hexToRgb(hex); return Math.max(...c) - Math.min(...c); };
    const accent = accentFrom(chroma(p.a) > chroma(p.b) ? p.a : p.b);
    return {
      gradient: `linear-gradient(${t.angle}deg, ${p.a}, ${p.b})`,
      a: p.a,
      b: p.b,
      accent,
      onAccent: contrast(accent, "#111111") >= contrast(accent, "#ffffff") ? "#111111" : "#ffffff",
    };
  }

  /**
   * Orders search results: exact name first, then names that start with the text, shorter first, then the rest
   * alphabetically. Firestore already returns only prefix matches; this keeps the order stable and sensible.
   */
  function rankUsers(users, query) {
    const q = String(query || "").trim().toLowerCase();
    const score = (u) => {
      const n = u.usernameLower || String(u.username || "").toLowerCase();
      if (n === q) return 0;
      if (n.startsWith(q)) return 1;
      if (n.includes(q)) return 2;
      return 3;
    };
    return users
      .slice()
      .sort((x, y) => score(x) - score(y) || (x.usernameLower || "").length - (y.usernameLower || "").length
        || (x.usernameLower || "").localeCompare(y.usernameLower || ""));
  }

  const api = { PRESETS, DEFAULT, GROUND, luminance, contrast, accentFrom, preset, normalize, themeCss, rankUsers };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KB = Object.assign(root.KB || {}, api);
})(typeof window !== "undefined" ? window : globalThis);
