/* 無障礙閱讀層：閱讀設定、朗讀（TTS）、音檔速度。
   只依賴 DOM（#content、.splash 等），不依賴 app.js 內部。 */
(() => {
  "use strict";
  const STORE = "guowen-levels:a11y";
  const html = document.documentElement;
  const DEFAULTS = { size: "m", wide: false, sans: false, plain: false, quiet: false, still: false, rate: 1, audioRate: 1 };
  const CLASS_FLAGS = { wide: "a11y-wide", sans: "a11y-sans", plain: "a11y-plain-bg", quiet: "a11y-quiet", still: "a11y-still" };
  const SIZES = ["s", "m", "l", "xl"];

  /* ---------- 設定讀寫 ---------- */
  let settings = load();
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || "{}");
      return Object.assign({}, DEFAULTS, raw && typeof raw === "object" ? raw : {});
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (e) { /* 無痕模式等情況略過 */ }
  }
  function apply() {
    SIZES.forEach((s) => html.classList.toggle("a11y-size-" + s, settings.size === s));
    Object.keys(CLASS_FLAGS).forEach((k) => html.classList.toggle(CLASS_FLAGS[k], !!settings[k]));
    document.querySelectorAll("#content audio").forEach((a) => { try { a.playbackRate = settings.audioRate; } catch (e) {} });
  }
  function set(key, val) { settings[key] = val; save(); apply(); renderPanelState(); }
  apply(); // 盡早套用，減少閃動

  /* ---------- 小工具 ---------- */
  const el = (tag, attrs, text) => {
    const n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => n.setAttribute(k, attrs[k]));
    if (text != null) n.textContent = text;
    return n;
  };

  /* ---------- 閱讀設定面板 ---------- */
  const GROUPS = [
    { key: "size",  label: "字級",   opts: [["s", "小"], ["m", "中"], ["l", "大"], ["xl", "特大"]] },
    { key: "wide",  label: "行距",   opts: [[false, "標準"], [true, "寬"]] },
    { key: "sans",  label: "字體",   opts: [[false, "襯線"], [true, "黑體"]] },
    { key: "plain", label: "純白底", opts: [[false, "關"], [true, "開"]] },
    { key: "quiet", label: "安靜模式（隱藏插圖與潑墨）", opts: [[false, "關"], [true, "開"]] },
    { key: "still", label: "動畫",   opts: [[false, "開"], [true, "關閉動畫"]] },
    { key: "rate",  label: "朗讀速度", opts: [[0.8, "慢"], [1, "中"], [1.2, "快"]] },
  ];
  let panel, fab;
  function buildPanel() {
    if (!document.body) return;
    fab = el("button", { class: "a11y-fab", type: "button", "aria-expanded": "false", "aria-controls": "a11y-panel", "aria-label": "閱讀設定" }, "閱讀設定");
    panel = el("div", { class: "a11y-panel", id: "a11y-panel", role: "dialog", "aria-label": "閱讀設定", hidden: "" });
    const h = el("h2", null, "閱讀設定");
    const close = el("button", { class: "a11y-close", type: "button", "aria-label": "關閉" }, "✕");
    h.appendChild(close);
    panel.appendChild(h);
    GROUPS.forEach((g) => {
      const grp = el("div", { class: "a11y-group", role: "group", "aria-label": g.label });
      grp.appendChild(el("span", { class: "a11y-label" }, g.label));
      const opts = el("div", { class: "a11y-opts" });
      g.opts.forEach(([val, name]) => {
        const b = el("button", { type: "button", "data-key": g.key, "aria-pressed": "false" }, name);
        b.addEventListener("click", () => set(g.key, val));
        b._val = val;
        opts.appendChild(b);
      });
      grp.appendChild(opts);
      panel.appendChild(grp);
    });
    const reset = el("button", { class: "a11y-reset", type: "button" }, "重設為預設值");
    reset.addEventListener("click", () => { settings = Object.assign({}, DEFAULTS); save(); apply(); renderPanelState(); });
    panel.appendChild(reset);

    const open = (on) => {
      panel.hidden = !on;
      fab.setAttribute("aria-expanded", String(on));
      if (on) { const first = panel.querySelector("button[aria-pressed='true']") || close; first.focus(); }
      else fab.focus();
    };
    fab.addEventListener("click", () => open(panel.hidden));
    close.addEventListener("click", () => open(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) open(false); });
    document.addEventListener("click", (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== fab) { panel.hidden = true; fab.setAttribute("aria-expanded", "false"); }
    });
    document.body.append(fab, panel);
    renderPanelState();
  }
  function renderPanelState() {
    if (!panel) return;
    panel.querySelectorAll("button[data-key]").forEach((b) => {
      b.setAttribute("aria-pressed", String(settings[b.dataset.key] === b._val));
    });
  }

  /* ---------- 朗讀（TTS） ---------- */
  const synth = window.speechSynthesis;
  const hasTTS = !!(synth && window.SpeechSynthesisUtterance);
  const TARGETS = "p, li, h1, h2, h3, blockquote, figcaption";
  let voice = null, current = null, queue = [], statusEl = null;

  function pickVoice() {
    if (!hasTTS) return;
    try {
      const voices = synth.getVoices() || [];
      voice = voices.find((v) => /^zh[-_]TW/i.test(v.lang)) || voices.find((v) => /^zh/i.test(v.lang)) || null;
    } catch (e) { voice = null; }
  }
  if (hasTTS) {
    pickVoice();
    try { synth.addEventListener("voiceschanged", pickVoice); } catch (e) {}
  }
  const textOf = (node) => {
    const c = node.cloneNode(true);
    c.querySelectorAll(".a11y-tts-btn, .a11y-tts-bar, .a11y-audio-rate").forEach((b) => b.remove());
    return (c.textContent || "").replace(/\s+/g, " ").trim();
  };
  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }
  function clearHighlight() {
    if (!current) return;
    current.classList.remove("a11y-speaking");
    const b = current.querySelector(":scope > .a11y-tts-btn");
    if (b) b.setAttribute("aria-pressed", "false");
    current = null;
  }
  function stop() {
    queue = [];
    clearHighlight();
    try { synth.cancel(); } catch (e) {}
    setStatus("");
  }
  function speak(node) {
    if (!hasTTS || !node) return;
    const text = textOf(node);
    clearHighlight();
    try { synth.cancel(); } catch (e) {}
    if (!text) { next(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-TW";
    if (voice) u.voice = voice;
    u.rate = Number(settings.rate) || 1;
    current = node;
    node.classList.add("a11y-speaking");
    const b = node.querySelector(":scope > .a11y-tts-btn");
    if (b) b.setAttribute("aria-pressed", "true");
    try { node.scrollIntoView({ block: "nearest" }); } catch (e) {}
    const done = () => { if (current === node) { clearHighlight(); next(); } };
    u.onend = done;
    u.onerror = done;
    try { synth.speak(u); } catch (e) { done(); }
  }
  function next() {
    const n = queue.shift();
    if (n && document.contains(n)) speak(n);
    else if (n) next();
    else setStatus("");
  }
  function toggle(node) {
    if (current === node) { stop(); return; }
    queue = [];
    setStatus("");
    speak(node);
  }
  function readAll(root) {
    const list = Array.from(root.querySelectorAll("[data-a11y-tts]"));
    if (!list.length) return;
    stop();
    setStatus("朗讀中…");
    queue = list.slice(1);
    speak(list[0]);
  }

  function injectTTS(root) {
    if (!hasTTS || !root) return;
    const nodes = Array.from(root.querySelectorAll(TARGETS)).filter((n) =>
      !n.hasAttribute("data-a11y-tts") &&
      !n.closest("audio, iframe, .a11y-tts-bar, .a11y-audio-rate") &&
      !n.querySelector(TARGETS) &&               // 外層 blockquote/li 若已含 p，交給內層讀，避免重複
      textOf(n).length >= 4
    );
    nodes.forEach((n) => {
      n.setAttribute("data-a11y-tts", "");
      const b = el("button", { class: "a11y-tts-btn", type: "button", "aria-pressed": "false", "aria-label": "朗讀這一段" }, "🔊 朗讀");
      b.addEventListener("click", (e) => { e.stopPropagation(); toggle(n); });
      n.prepend(b);
    });
    const has = root.querySelector("[data-a11y-tts]");
    let bar = root.querySelector(":scope > .a11y-tts-bar");
    if (has && !bar) {
      bar = el("div", { class: "a11y-tts-bar", role: "group", "aria-label": "朗讀控制" });
      const all = el("button", { type: "button" }, "🔊 朗讀全部");
      const st = el("button", { type: "button" }, "停止");
      statusEl = el("span", { class: "a11y-tts-status", "aria-live": "polite" });
      all.addEventListener("click", () => readAll(root));
      st.addEventListener("click", stop);
      bar.append(all, st, statusEl);
      root.prepend(bar);
    } else if (!has && bar) {
      bar.remove();
    }
  }

  /* ---------- 音檔速度 ---------- */
  const RATES = [[0.75, "0.75×"], [1, "1×"], [1.25, "1.25×"]];
  function injectAudio(root) {
    if (!root) return;
    root.querySelectorAll("audio:not([data-a11y-rate])").forEach((a) => {
      a.setAttribute("data-a11y-rate", "");
      const box = el("div", { class: "a11y-audio-rate", role: "group", "aria-label": "音檔速度" });
      box.appendChild(el("span", null, "速度"));
      const btns = RATES.map(([r, name]) => {
        const b = el("button", { type: "button", "aria-pressed": String(Number(settings.audioRate) === r) }, name);
        b.addEventListener("click", () => {
          set("audioRate", r);
          btns.forEach((x, i) => x.setAttribute("aria-pressed", String(RATES[i][0] === r)));
        });
        return b;
      });
      btns.forEach((b) => box.appendChild(b));
      a.insertAdjacentElement("afterend", box);
      const applyRate = () => { try { a.playbackRate = Number(settings.audioRate) || 1; } catch (e) {} };
      applyRate();
      a.addEventListener("loadedmetadata", applyRate);
      a.addEventListener("play", applyRate);
    });
  }

  /* ---------- 掛上 #content 觀察 ---------- */
  function scan() {
    const root = document.getElementById("content");
    if (!root) return;
    if (current && !document.contains(current)) stop(); // 內容被換掉就停
    injectTTS(root);
    injectAudio(root);
  }
  function boot() {
    buildPanel();
    const root = document.getElementById("content");
    if (!root) return;
    scan();
    let pending = false;
    const mo = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; scan(); });
    });
    mo.observe(root, { childList: true, subtree: true });
  }
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
