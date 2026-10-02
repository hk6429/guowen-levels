(() => {
  /* ===================== 常數與小工具 ===================== */
  const LEVELS = [
    { key: "pdf",   name: "原文版", hint: "課本原文",       img: "level-pdf.webp",
      has: (l) => !!l.pdf },
    { key: "plain", name: "白話版", hint: "白話文",         img: "level-plain.webp",
      has: (l) => !!l.plain },
    { key: "easy",  name: "輕鬆版", hint: "漫畫、聽朗讀",   img: "level-easy.webp",
      has: (l) => !!(l.comic || l.audio || l.audioText) },
  ];
  const K = {
    tiers: "guowen-levels:tiers",
    scaffold: "guowen-levels:scaffold",
    seat: "guowen-levels:seat",
    board: (id) => `guowen-levels:board:${id}`,
    pre: (id) => `guowen-levels:pre:${id}`,
    exit: (id) => `guowen-levels:exit:${id}`,
    step: (id) => `guowen-levels:step:${id}`,
  };
  const SCAFFOLDS = [
    { key: "lite", name: "精簡", hint: "只看白話" },
    { key: "std",  name: "標準", hint: "白話＋解析" },
    { key: "full", name: "滿版", hint: "原文＋注音＋詞語" },
  ];
  const TASK_TIERS = [["basic", "基礎"], ["advanced", "進階"], ["challenge", "挑戰"]];
  const BLK_LABELS = ["原文", "白話", "解析"];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    has(k) { try { return localStorage.getItem(k) != null; } catch { return false; } },
  };
  const session = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  async function loadIndex() {
    const r = await fetch("lessons/index.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
  async function fetchText(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    return r.text();
  }
  async function md(url) { return marked.parse(await fetchText(url)); }
  /* 選用資料：失敗一律回 null，不丟錯 */
  async function optionalJSON(url) {
    try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; }
  }
  function fail(el, msg) { el.innerHTML = `<p class="notice">${esc(msg)}</p>`; }

  /* 事件上報：靜默失敗 */
  function sendEvent(lesson, data) {
    try {
      const body = JSON.stringify({ lesson, ...data });
      if (navigator.sendBeacon && navigator.sendBeacon("/api/event", new Blob([body], { type: "application/json" }))) return;
      fetch("/api/event", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    } catch {}
  }

  /* ===================== 課程列表 ===================== */
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

  /* ===================== 白話版：結構化與分頁 ===================== */
  function labelOf(node) {
    if (node.nodeName !== "P") return null;
    const first = node.firstElementChild;
    if (!first || first.nodeName !== "STRONG" || first.previousSibling?.textContent?.trim()) return null;
    const c = first.cloneNode(true);
    c.querySelectorAll("rt, rp").forEach((x) => x.remove());
    const t = c.textContent.trim();
    return BLK_LABELS.includes(t) ? t : null;
  }
  /* 把 marked／注音版 HTML 包成 .blk 區塊並依 <h2> 切頁；回傳 [{title, html}] */
  function structurePlain(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nodes = [...doc.body.childNodes].filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
    const newPage = () => { const p = doc.createElement("div"); p.className = "page"; return p; };
    const pages = [newPage()];
    let page = pages[0], blk = null;
    for (const n of nodes) {
      if (n.nodeName === "H2") { page = newPage(); pages.push(page); blk = null; page.append(n); continue; }
      if (n.nodeName === "H1" || n.nodeName === "BLOCKQUOTE") { blk = null; page.append(n); continue; }
      const label = labelOf(n);
      if (label) { blk = doc.createElement("div"); blk.className = `blk blk-${label}`; blk.append(n); page.append(blk); continue; }
      (blk || page).append(n);
    }
    return pages.filter((p) => p.childNodes.length).map((p) => ({ title: p.querySelector("h2")?.textContent.trim() || "開頭", html: p.outerHTML }));
  }

  /* ===================== 詞語解釋 ===================== */
  function markTerm(blk, g) {
    const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.parentElement.closest("rt, rp, button, strong") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const texts = []; let s = "", n;
    while ((n = walker.nextNode())) { texts.push({ n, start: s.length }); s += n.data; }
    const i = s.indexOf(g.term);
    if (i < 0) return;
    const j = i + g.term.length;
    const at = (pos, excl) => { let t = texts[0]; for (const x of texts) { if (excl ? x.start < pos : x.start <= pos) t = x; else break; } return t; };
    const a = at(i), b = at(j, true);
    const r = document.createRange();
    const ra = a.n.parentElement.closest("ruby"), rb = b.n.parentElement.closest("ruby");
    if (ra && blk.contains(ra)) r.setStartBefore(ra); else r.setStart(a.n, i - a.start);
    if (rb && blk.contains(rb)) r.setEndAfter(rb); else r.setEnd(b.n, j - b.start);
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "gloss"; btn.setAttribute("aria-expanded", "false");
    btn.dataset.term = g.term; btn.dataset.zhuyin = g.zhuyin || ""; btn.dataset.def = g.def || "";
    try { r.surroundContents(btn); } catch { /* 跨元素無法包裹就略過 */ }
  }
  function applyGlossary(root, glossary) {
    root.querySelectorAll(".blk-原文").forEach((blk) => glossary.forEach((g) => markTerm(blk, g)));
  }
  function glossaryList(glossary) {
    return `<details class="gloss-list"><summary>詞語表（${glossary.length}）</summary><dl>${glossary.map((g) => `
      <div><dt>${esc(g.term)}${g.zhuyin ? ` <span class="zy">${esc(g.zhuyin)}</span>` : ""}</dt><dd>${esc(g.def)}</dd></div>`).join("")}</dl></details>`;
  }

  /* ===================== 課程頁 ===================== */
  async function renderLesson() {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    const titleEl = $("title"), levelsEl = $("levels"), content = $("content"), extras = $("extras");
    let lesson;
    try { lesson = (await loadIndex()).find((l) => l.id === id); }
    catch (e) { console.error(e); fail(content, "載入失敗，請重新整理"); return; }
    if (!lesson) {
      titleEl.textContent = "找不到這一課";
      content.innerHTML = `<p class="notice"><a href="./">回課程列表</a></p>`;
      return;
    }
    document.title = `${lesson.title}｜國文分層教材`;
    titleEl.innerHTML = `${lesson.unit ? `<small>${esc(lesson.unit)}</small>` : ""}${esc(lesson.title)}`;

    const lv = lesson.levels || {};
    const base = `lessons/${encodeURIComponent(lesson.id)}/`;
    const avail = LEVELS.filter((L) => L.has(lv));
    if (!avail.length) { fail(content, "這一課還沒有教材"); return; }
    const availKeys = avail.map((L) => L.key);

    /* ---- 選用資料（全部可缺） ---- */
    const [glossary, tasks, quiz] = await Promise.all([
      lesson.glossary ? optionalJSON(base + lesson.glossary) : null,
      lesson.tasks ? optionalJSON(base + lesson.tasks) : null,
      lesson.quiz ? optionalJSON(base + lesson.quiz) : null,
    ]);
    const gl = Array.isArray(glossary) ? glossary.filter((g) => g && typeof g.term === "string" && g.term) : [];
    const extend = Array.isArray(lesson.extend) ? lesson.extend.filter((x) => x && x.file) : [];

    /* ---- 狀態 ---- */
    const lockLevels = (params.get("level") || "").split(",").map((s) => s.trim()).filter((k) => availKeys.includes(k));
    const hadSavedTiers = store.has(K.tiers);
    let tiers = lockLevels.length ? lockLevels : store.get(K.tiers, []).filter((k) => availKeys.includes(k));
    if (!tiers.length) tiers = [availKeys[0]];
    tiers = availKeys.filter((k) => tiers.includes(k));
    const scParam = params.get("scaffold");
    let scaffold = SCAFFOLDS.some((s) => s.key === scParam) ? scParam : store.get(K.scaffold, "std");
    if (!SCAFFOLDS.some((s) => s.key === scaffold)) scaffold = "std";
    const stepState = Object.assign({ on: false, page: 0 }, session.get(K.step(lesson.id), {}));
    if (params.get("mode") === "step") stepState.on = true;
    const cache = { plain: null, ruby: null, easy: null };

    /* ---- 版本按鈕（可疊加） ---- */
    levelsEl.innerHTML = avail.map((L) => `
      <button class="level-btn" data-level="${L.key}" aria-pressed="false">
        <img src="assets/img/${L.img}" alt="" onerror="this.remove()">
        <span class="name">${L.name}</span>
        <span class="hint">${L.hint}</span>
        ${lockLevels.includes(L.key) ? `<span class="lock">老師指定</span>` : ""}
      </button>`).join("");
    const syncButtons = () => levelsEl.querySelectorAll(".level-btn").forEach((b) => b.setAttribute("aria-pressed", String(tiers.includes(b.dataset.level))));
    let levelTimer;
    const logLevel = () => { clearTimeout(levelTimer); levelTimer = setTimeout(() => sendEvent(lesson.id, { type: "level", level: [...tiers] }), 1000); };
    levelsEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".level-btn");
      if (!btn) return;
      const key = btn.dataset.level;
      if (tiers.includes(key)) { if (tiers.length === 1) return; tiers = tiers.filter((k) => k !== key); }
      else tiers = availKeys.filter((k) => tiers.includes(k) || k === key);
      store.set(K.tiers, tiers); syncButtons(); logLevel(); renderTiers();
    });

    /* ---- 內容區骨架 ---- */
    content.innerHTML = "";
    const preHost = h(`<div class="pre-host"></div>`);
    const tiersHost = h(`<div class="tiers"></div>`);
    const fbHost = h(`<div class="feedback"></div>`);
    content.append(preHost, tiersHost, fbHost);

    /* ---- 疊加渲染：固定順序 pdf → plain → easy，已存在的區段不重建 ---- */
    async function renderTiers() {
      tiersHost.querySelectorAll("section.tier").forEach((s) => { if (!tiers.includes(s.dataset.tier)) s.remove(); });
      for (const L of avail) {
        if (!tiers.includes(L.key) || tiersHost.querySelector(`section.tier[data-tier="${L.key}"]`)) continue;
        const sec = h(`<section class="tier tier-${L.key}" data-tier="${L.key}"><h2 class="tier-head"><span>${L.name}</span></h2><div class="tier-body"><p class="notice">載入中…</p></div></section>`);
        const next = [...tiersHost.children].find((s) => availKeys.indexOf(s.dataset.tier) > availKeys.indexOf(L.key));
        tiersHost.insertBefore(sec, next || null);
        try {
          if (L.key === "pdf") renderPdf(sec);
          else if (L.key === "plain") await renderPlain(sec);
          else await renderEasy(sec);
        } catch (e) { console.error(e); fail(sec.querySelector(".tier-body"), "載入失敗，請重新整理"); }
      }
    }
    function renderPdf(sec) {
      sec.querySelector(".tier-body").innerHTML = `<iframe src="${base}${esc(lv.pdf)}" title="課本原文"></iframe>`;
    }
    async function renderEasy(sec) {
      if (!cache.easy) {
        let html = "";
        if (lv.comic) {
          const caps = Array.isArray(lv.comicCaptions) ? lv.comicCaptions : null;
          html += lv.comic.map((p, i) => {
            const cap = caps?.[i];
            const img = `<img class="comic" src="${base}${esc(p)}" alt="${esc(cap || `第 ${i + 1} 格漫畫`)}" loading="lazy">`;
            return cap ? `<figure>${img}<figcaption>第 ${i + 1} 格｜${esc(cap)}</figcaption></figure>` : img;
          }).join("");
        }
        if (lv.audio) html += `<audio controls preload="metadata" src="${base}${esc(lv.audio)}"></audio>`;
        if (lv.audioText) html += await md(base + lv.audioText);
        cache.easy = html;
      }
      sec.querySelector(".tier-body").innerHTML = cache.easy;
    }

    /* ---- 白話版 ---- */
    async function getPages(useRuby) {
      const key = useRuby ? "ruby" : "plain";
      if (!cache[key]) {
        const html = useRuby ? await fetchText(base + lv.ruby) : await md(base + lv.plain);
        cache[key] = structurePlain(html);
      }
      return cache[key];
    }
    async function renderPlain(sec) {
      const body = sec.querySelector(".tier-body");
      body.innerHTML = `
        <div class="plain-tools">
          <div class="seg" role="group" aria-label="鷹架密度">
            ${SCAFFOLDS.map((s) => `<button type="button" data-sc="${s.key}" aria-pressed="false" title="${s.hint}">${s.name}</button>`).join("")}
          </div>
          <label class="step-toggle"><input type="checkbox" class="step-on"> 一次一段</label>
        </div>
        <nav class="step-nav" aria-label="分段" hidden>
          <button type="button" class="prev">上一段</button>
          <span class="page-no" aria-live="polite"></span>
          <button type="button" class="next">下一段</button>
        </nav>
        <div class="plain-body"></div>
        <div class="plain-foot"></div>
        <div class="gloss-pop" role="dialog" aria-label="詞語解釋" hidden></div>`;
      const plainBody = body.querySelector(".plain-body");
      const nav = body.querySelector(".step-nav");
      const stepOn = body.querySelector(".step-on");
      if (gl.length) body.querySelector(".plain-foot").innerHTML = glossaryList(gl);

      const draw = async (scrollTop) => {
        sec.className = `tier tier-plain scaffold-${scaffold}`;
        body.querySelectorAll(".seg [data-sc]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sc === scaffold)));
        stepOn.checked = stepState.on;
        nav.hidden = !stepState.on;
        let pages;
        try { pages = await getPages(scaffold === "full" && !!lv.ruby); }
        catch (e) { console.error(e); pages = await getPages(false); }
        let html;
        if (stepState.on) {
          stepState.page = Math.min(Math.max(stepState.page, 0), pages.length - 1);
          const p = pages[stepState.page];
          html = p.html;
          nav.querySelector(".page-no").textContent = `${p.title}　${stepState.page + 1}／${pages.length}`;
          nav.querySelector(".prev").disabled = stepState.page === 0;
          nav.querySelector(".next").disabled = stepState.page === pages.length - 1;
        } else html = pages.map((p) => p.html).join("");
        plainBody.innerHTML = html;
        if (scaffold === "full" && gl.length) applyGlossary(plainBody, gl);
        session.set(K.step(lesson.id), stepState);
        hidePop();
        if (scrollTop) sec.scrollIntoView({ block: "start", behavior: "smooth" });
      };
      body.querySelector(".seg").addEventListener("click", (e) => {
        const b = e.target.closest("[data-sc]");
        if (!b || b.dataset.sc === scaffold) return;
        scaffold = b.dataset.sc; store.set(K.scaffold, scaffold); draw();
      });
      stepOn.addEventListener("change", () => { stepState.on = stepOn.checked; draw(); });
      nav.addEventListener("click", (e) => {
        if (e.target.closest(".prev")) { stepState.page--; draw(true); }
        else if (e.target.closest(".next")) { stepState.page++; draw(true); }
      });

      /* 詞語解釋浮窗 */
      const pop = body.querySelector(".gloss-pop");
      function hidePop() {
        pop.hidden = true;
        sec.querySelectorAll(".gloss[aria-expanded='true']").forEach((b) => b.setAttribute("aria-expanded", "false"));
      }
      function showPop(btn) {
        hidePop();
        btn.setAttribute("aria-expanded", "true");
        pop.innerHTML = `<b>${esc(btn.dataset.term)}</b>${btn.dataset.zhuyin ? ` <span class="zy">${esc(btn.dataset.zhuyin)}</span>` : ""}<p>${esc(btn.dataset.def)}</p>`;
        pop.hidden = false;
        const sr = sec.getBoundingClientRect(), br = btn.getBoundingClientRect();
        pop.style.top = `${br.bottom - sr.top + 6}px`;
        pop.style.left = `${Math.max(0, Math.min(br.left - sr.left, sec.clientWidth - pop.offsetWidth - 8))}px`;
      }
      sec.addEventListener("click", (e) => {
        const b = e.target.closest(".gloss");
        if (b) { if (b.getAttribute("aria-expanded") === "true") hidePop(); else showPop(b); }
      });
      document.addEventListener("click", (e) => { if (!e.target.closest(".gloss, .gloss-pop")) hidePop(); });
      await draw();
    }

    /* ---- 前測 ---- */
    const pre = quiz?.pre;
    if (Array.isArray(pre) && pre.length && !lockLevels.length && !hadSavedTiers && !store.has(K.pre(lesson.id))) {
      const card = h(`<form class="quiz pre-card">
        <h2>先試試看：這幾題你會嗎？</h2>
        ${quizItems(pre, "pre")}
        <div class="row"><button type="submit" class="primary">看結果</button></div>
        <div class="result" aria-live="polite" hidden></div></form>`);
      preHost.append(card);
      const dismiss = () => { store.set(K.pre(lesson.id), true); card.remove(); };
      card.addEventListener("submit", (e) => {
        e.preventDefault();
        const res = card.querySelector(".result");
        const ans = readAnswers(card, pre.length, "pre");
        if (ans.includes(null)) { res.hidden = false; res.textContent = "還有題目沒作答喔。"; return; }
        const score = ans.filter((a, i) => a === pre[i].answer).length;
        const want = score >= 3 ? "pdf" : score === 2 ? "plain" : "easy";
        const order = ["pdf", "plain", "easy"];
        const sug = availKeys.includes(want) ? want
          : (order.slice(order.indexOf(want)).find((k) => availKeys.includes(k)) || availKeys[availKeys.length - 1]);
        const name = LEVELS.find((L) => L.key === sug)?.name || "";
        sendEvent(lesson.id, { type: "pre", value: { score } });
        card.querySelectorAll("input, button[type=submit]").forEach((x) => { x.disabled = true; });
        res.hidden = false;
        res.innerHTML = `<p>答對 ${score}／${pre.length} 題，建議從「${esc(name)}」開始。</p>
          <div class="row"><button type="button" class="primary use">就用建議的</button><button type="button" class="self">我自己選</button></div>`;
        res.querySelector(".use").addEventListener("click", () => {
          tiers = [sug]; store.set(K.tiers, tiers); syncButtons(); logLevel(); renderTiers(); dismiss();
        });
        res.querySelector(".self").addEventListener("click", dismiss);
      });
    }

    /* ---- 回饋 ---- */
    fbHost.innerHTML = `
      <div class="row"><button type="button" class="primary" data-fb="done">我讀完了</button><button type="button" data-fb="question">我有問題</button></div>
      <form class="fb-q" hidden><label>想問什麼？（可留空，100 字內）<textarea maxlength="100" rows="2"></textarea></label><button type="submit">送出</button></form>
      <p class="thanks" aria-live="polite" hidden></p>`;
    const fbQ = fbHost.querySelector(".fb-q"), thanks = fbHost.querySelector(".thanks");
    const sayThanks = (t) => { thanks.textContent = t; thanks.hidden = false; };
    fbHost.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fb]");
      if (!b) return;
      if (b.dataset.fb === "done") { fbQ.hidden = true; sendEvent(lesson.id, { type: "feedback", value: { kind: "done" }, level: [...tiers] }); sayThanks("收到，讀完真棒！"); }
      else { fbQ.hidden = false; thanks.hidden = true; fbQ.querySelector("textarea").focus(); }
    });
    fbQ.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = fbQ.querySelector("textarea").value.trim().slice(0, 100);
      sendEvent(lesson.id, { type: "feedback", value: { kind: "question", text }, level: [...tiers] });
      fbQ.hidden = true; fbQ.reset(); sayThanks("收到，老師會看到你的問題。");
    });

    /* ---- 任務卡／九宮格／延伸角度／出場券 ---- */
    extras.innerHTML = "";
    if (tasks?.tiers) extras.append(renderTasks(tasks, params.get("task")));
    if (Array.isArray(tasks?.board) && tasks.board.length) extras.append(renderBoard(tasks.board, lesson.id));
    if (extend.length) extras.append(renderExtend(extend, base));
    if (Array.isArray(quiz?.exit) && quiz.exit.length) extras.append(renderExit(quiz.exit, lesson.id));

    syncButtons();
    await renderTiers();
  }

  /* ===================== 任務卡 ===================== */
  function renderTasks(tasks, preselect) {
    const tiersAvail = TASK_TIERS.filter(([k]) => Array.isArray(tasks.tiers[k]) && tasks.tiers[k].length);
    if (!tiersAvail.length) return document.createDocumentFragment();
    let cur = tiersAvail.some(([k]) => k === preselect) ? preselect : tiersAvail[0][0];
    const sec = h(`<section class="panel tasks"><h2>任務卡</h2>
      <div class="tabs" role="tablist">${tiersAvail.map(([k, n]) => `<button type="button" role="tab" data-tab="${k}">${n}</button>`).join("")}</div>
      <div class="cards" role="tabpanel"></div></section>`);
    const draw = () => {
      sec.querySelectorAll("[role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === cur)));
      sec.querySelector(".cards").innerHTML = tasks.tiers[cur].map((t, i) => `
        <article class="card"><h3>${esc(t.title || `任務 ${i + 1}`)}</h3><p>${esc(t.prompt)}</p></article>`).join("");
    };
    sec.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { cur = b.dataset.tab; draw(); } });
    draw();
    return sec;
  }

  function renderBoard(board, id) {
    const key = K.board(id);
    const cells = board.slice(0, 9);
    const picked = new Set((store.get(key, []) || []).filter((i) => Number.isInteger(i) && i >= 0 && i < cells.length));
    const sec = h(`<section class="panel board"><h2>九宮格選擇板 <span class="count" aria-live="polite"></span></h2>
      <p class="hint">點選你想做的任務，最多 3 個。</p>
      <div class="grid">${cells.map((t, i) => `
        <button type="button" class="cell" data-i="${i}" aria-pressed="false"><b>${esc(t.title || `任務 ${i + 1}`)}</b><span>${esc(t.prompt)}</span></button>`).join("")}</div></section>`);
    const draw = () => {
      sec.querySelector(".count").textContent = `已選 ${picked.size}／3`;
      sec.querySelectorAll(".cell").forEach((c) => c.setAttribute("aria-pressed", String(picked.has(+c.dataset.i))));
    };
    sec.querySelector(".grid").addEventListener("click", (e) => {
      const c = e.target.closest(".cell"); if (!c) return;
      const i = +c.dataset.i;
      if (picked.has(i)) picked.delete(i); else if (picked.size < 3) picked.add(i); else return;
      store.set(key, [...picked]); draw();
    });
    draw();
    return sec;
  }

  function renderExtend(extend, base) {
    const sec = h(`<section class="panel extend"><h2>延伸角度</h2>
      <div class="tabs" role="tablist">${extend.map((x, i) => `<button type="button" role="tab" data-tab="${i}">${esc(x.title || `角度 ${i + 1}`)}</button>`).join("")}</div>
      <div class="ext-body" role="tabpanel"></div></section>`);
    const bodyEl = sec.querySelector(".ext-body"), cacheMap = new Map();
    let cur = 0;
    const draw = async () => {
      sec.querySelectorAll("[role=tab]").forEach((b) => b.setAttribute("aria-selected", String(+b.dataset.tab === cur)));
      const i = cur;
      if (!cacheMap.has(i)) {
        bodyEl.innerHTML = `<p class="notice">載入中…</p>`;
        try { cacheMap.set(i, await md(base + extend[i].file)); }
        catch { cacheMap.set(i, `<p class="notice">載入失敗，請重新整理</p>`); }
      }
      if (i === cur) bodyEl.innerHTML = cacheMap.get(i);
    };
    sec.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { cur = +b.dataset.tab; draw(); } });
    draw();
    return sec;
  }

  /* ===================== 測驗共用／出場券 ===================== */
  function quizItems(items, ns) {
    return items.map((q, i) => `
      <fieldset class="q"><legend>${i + 1}. ${esc(q.q)}</legend>
        ${(q.options || []).map((o, j) => `<label><input type="radio" name="${ns}-${i}" value="${j}"> ${esc(o)}</label>`).join("")}
        <span class="mark" aria-live="polite"></span></fieldset>`).join("");
  }
  function readAnswers(form, n, ns) {
    return Array.from({ length: n }, (_, i) => { const v = form.querySelector(`input[name="${ns}-${i}"]:checked`); return v ? +v.value : null; });
  }
  function renderExit(items, id) {
    const key = K.exit(id);
    const sec = h(`<section class="panel exit"><h2>出場券</h2>
      <form class="quiz">
        ${quizItems(items, "exit")}
        <div class="row seat-row"><label>座號（選填）<input type="number" class="seat" min="1" max="40" inputmode="numeric"></label>
          <button type="submit" class="primary">交出場券</button></div>
        <p class="result" aria-live="polite" hidden></p>
      </form></section>`);
    const form = sec.querySelector("form"), result = form.querySelector(".result");
    const savedSeat = store.get(K.seat, "");
    if (savedSeat) form.querySelector(".seat").value = savedSeat;
    const showResult = (answers, score) => {
      form.querySelectorAll("fieldset").forEach((fs, i) => {
        const q = items[i], ok = answers[i] === q.answer;
        fs.classList.add(ok ? "ok" : "ng");
        fs.querySelector(".mark").textContent = ok ? "✔ 答對" : `✘ 正解：${q.options?.[q.answer] ?? ""}`;
        const inp = fs.querySelector(`input[value="${answers[i]}"]`); if (inp) inp.checked = true;
      });
      form.querySelectorAll("input, button").forEach((x) => { x.disabled = true; });
      result.hidden = false; result.textContent = `已交出場券：答對 ${score}／${items.length} 題。`;
    };
    const done = store.get(key, null);
    if (Array.isArray(done?.answers)) showResult(done.answers, done.score);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const answers = readAnswers(form, items.length, "exit");
      if (answers.includes(null)) { result.hidden = false; result.textContent = "還有題目沒作答喔。"; return; }
      const seatEl = form.querySelector(".seat"), seat = seatEl.value.trim();
      if (seat && !(Number.isInteger(+seat) && +seat >= 1 && +seat <= 40)) { result.hidden = false; result.textContent = "座號請填 1 到 40。"; seatEl.focus(); return; }
      if (seat) store.set(K.seat, seat);
      const correct = answers.map((a, i) => a === items[i].answer);
      const score = correct.filter(Boolean).length;
      sendEvent(id, { type: "exit", value: { correct, score }, seat: seat || undefined });
      store.set(key, { answers, score });
      showResult(answers, score);
    });
    return sec;
  }

  if ($("lessons")) renderList();
  else if ($("levels")) renderLesson();
})();
