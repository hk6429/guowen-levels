(() => {
  const LEVELS = [
    { key: "pdf",   name: "挑戰版", hint: "課本原文",       img: "level-pdf.webp",
      has: (l) => !!l.pdf },
    { key: "plain", name: "白話版", hint: "白話文",         img: "level-plain.webp",
      has: (l) => !!l.plain },
    { key: "easy",  name: "輕鬆版", hint: "漫畫、聽朗讀",   img: "level-easy.webp",
      has: (l) => !!(l.comic || l.audio || l.audioText) },
  ];
  const STORE = "guowen-levels:level";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function loadIndex() {
    const r = await fetch("lessons/index.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

  function fail(el, msg) {
    el.innerHTML = `<p class="notice">${esc(msg)}</p>`;
  }

  /* ---------- 課程列表 ---------- */
  async function renderList() {
    const ul = $("lessons"), notice = $("notice");
    let lessons;
    try { lessons = await loadIndex(); }
    catch (e) { console.error(e); notice.textContent = "載入失敗，請重新整理"; notice.hidden = false; return; }
    if (!lessons.length) { notice.textContent = "尚未上架課程"; notice.hidden = false; return; }
    ul.innerHTML = lessons.map((l) => `
      <li class="lesson-card">
        <a href="lesson.html?id=${encodeURIComponent(l.id)}">
          ${l.unit ? `<div class="unit">${esc(l.unit)}</div>` : ""}
          <div class="title">${esc(l.title)}</div>
        </a>
      </li>`).join("");
  }

  /* ---------- 課程頁 ---------- */
  async function renderLesson() {
    const id = new URLSearchParams(location.search).get("id");
    const titleEl = $("title"), levelsEl = $("levels"), content = $("content");
    let lesson;
    try {
      const lessons = await loadIndex();
      lesson = lessons.find((l) => l.id === id);
    } catch (e) { console.error(e); fail(content, "載入失敗，請重新整理"); return; }
    if (!lesson) {
      titleEl.textContent = "找不到這一課";
      content.innerHTML = `<p class="notice"><a href="./">回課程列表</a></p>`;
      return;
    }
    document.title = `${lesson.title}｜國文分層教材`;
    titleEl.innerHTML = `${lesson.unit ? `<small>${esc(lesson.unit)}</small>` : ""}${esc(lesson.title)}`;

    const avail = LEVELS.filter((L) => L.has(lesson.levels));
    if (!avail.length) { fail(content, "這一課還沒有教材"); return; }
    levelsEl.innerHTML = avail.map((L) => `
      <button class="level-btn" data-level="${L.key}" aria-pressed="false">
        <img src="assets/img/${L.img}" alt="" onerror="this.remove()">
        <span class="name">${L.name}</span>
        <span class="hint">${L.hint}</span>
      </button>`).join("");

    let saved = localStorage.getItem(STORE);
    const current = avail.some((L) => L.key === saved) ? saved : avail[0].key;
    levelsEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".level-btn");
      if (btn) select(btn.dataset.level);
    });
    select(current);

    async function select(key) {
      localStorage.setItem(STORE, key);
      levelsEl.querySelectorAll(".level-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.level === key)));
      const base = `lessons/${encodeURIComponent(lesson.id)}/`;
      const lv = lesson.levels;
      content.innerHTML = `<p class="notice">載入中…</p>`;
      try {
        if (key === "pdf") {
          content.innerHTML = `<iframe src="${base}${lv.pdf}" title="課本"></iframe>`;
        } else if (key === "plain") {
          content.innerHTML = await md(base + lv.plain);
        } else {
          let html = "";
          if (lv.comic) html += lv.comic.map((p) => `<img class="comic" src="${base}${p}" alt="漫畫" loading="lazy">`).join("");
          if (lv.audio) html += `<audio controls preload="metadata" src="${base}${lv.audio}"></audio>`;
          if (lv.audioText) html += await md(base + lv.audioText);
          content.innerHTML = html;
        }
      } catch (e) { console.error(e); fail(content, "載入失敗，請重新整理"); }
    }
  }

  async function md(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    return marked.parse(await r.text());
  }

  if ($("lessons")) renderList();
  else if ($("levels")) renderLesson();
})();
