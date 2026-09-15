(function () {
  const app = document.getElementById("app");
  const store = window.TravelStore;
  const ADMIN_PASSWORD = "123456789";
  const ADMIN_KEY = "albert-travel-admin";
  const UNLOCK_PREFIX = "albert-travel-unlock:";

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function builtinTrips() {
    return (window.BUILTIN_TRIPS || []).map((trip) => ({ ...trip, builtin: true }));
  }

  function isBuiltinId(id) {
    return (window.BUILTIN_TRIPS || []).some((trip) => trip.id === id);
  }

  function allTrips() {
    const byId = {};
    builtinTrips().forEach((trip) => {
      byId[trip.id] = trip;
    });
    (store.cacheGet() || []).forEach((trip) => {
      if (!trip || !trip.id) return;
      byId[trip.id] = { ...trip, builtin: isBuiltinId(trip.id) };
    });
    const builtinIds = (window.BUILTIN_TRIPS || []).map((trip) => trip.id);
    const seen = new Set();
    const ordered = [];
    builtinIds.concat(Object.keys(byId)).forEach((id) => {
      if (seen.has(id) || !byId[id]) return;
      seen.add(id);
      ordered.push(byId[id]);
    });
    return ordered;
  }

  function findTrip(id) {
    return allTrips().find((trip) => trip.id === id) || null;
  }

  async function upsertUserTrip(trip) {
    try {
      return await store.save(trip);
    } catch {
      return store.offlineSave(trip);
    }
  }

  async function deleteUserTrip(id) {
    try {
      await store.remove(id);
    } catch {
      store.offlineRemove(id);
    }
  }

  function mapUrl(query, city) {
    return "https://uri.amap.com/search?keyword=" + encodeURIComponent(query) + "&city=" + encodeURIComponent(city || "");
  }

  function parseHash() {
    const raw = (location.hash || "#/").replace(/^#/, "") || "/";
    const parts = raw.split("/").filter(Boolean);
    if (!parts.length) return { name: "home" };
    if (parts[0] === "trip" && parts[1]) return { name: "trip", id: decodeURIComponent(parts[1]) };
    if (parts[0] === "new") return { name: "edit", id: null };
    if (parts[0] === "edit" && parts[1]) return { name: "edit", id: decodeURIComponent(parts[1]) };
    if (parts[0] === "admin") return { name: "admin" };
    return { name: "home" };
  }

  function go(hash) {
    location.hash = hash;
  }

  function blankTrip() {
    return {
      id: "trip-" + Date.now(),
      title: "",
      subtitle: "",
      city: "",
      coverTag: "",
      coverMeta: "",
      stats: [],
      hotel: { name: "", tag: "", address: "", detail: "", note: "", mapQuery: "" },
      notes: [],
      overviewDays: [],
      transport: [],
      days: [
        {
          id: "d1",
          date: "",
          weekday: "",
          title: "第 1 天",
          pace: "",
          slots: [{ time: "", stop: "", how: "", note: "", map: "" }]
        }
      ],
      extraPages: [],
      bookings: [],
      password: ""
    };
  }

  function tripPassword(trip) {
    return String((trip && trip.password) || "").trim();
  }

  function isAdmin() {
    return sessionStorage.getItem(ADMIN_KEY) === "1";
  }

  function setAdmin(on) {
    if (on) sessionStorage.setItem(ADMIN_KEY, "1");
    else sessionStorage.removeItem(ADMIN_KEY);
  }

  function isUnlocked(trip) {
    if (!tripPassword(trip)) return true;
    if (isAdmin()) return true;
    return sessionStorage.getItem(UNLOCK_PREFIX + trip.id) === "1";
  }

  function unlockTrip(trip) {
    sessionStorage.setItem(UNLOCK_PREFIX + trip.id, "1");
  }

  function dayCountLabel(trip) {
    const count = (trip.days || []).length;
    if (trip.coverTag) return trip.coverTag;
    return count ? count + " 天" : "新專案";
  }

  function renderHome() {
    document.body.className = "home";
    const trips = allTrips();
    app.innerHTML = `
      <section class="home-hero">
        <p class="brand">ALBERT TRAVEL</p>
        <h1>旅遊專案</h1>
        <p class="sub">手機上也能看的行程本。長沙五日是第一份範本，你可以再新增自己的旅遊專案。</p>
      </section>
      <div class="home-actions">
        <button class="btn primary" data-go="#/new">新增旅遊專案</button>
        <button class="btn ghost" data-go-admin="#/admin">管理員</button>
      </div>
      ${trips.map((trip) => `
        <a class="trip-card" href="#/trip/${encodeURIComponent(trip.id)}">
          <h2>${esc(trip.title || "未命名專案")}</h2>
          <p class="sub">${esc(trip.subtitle || "還沒有副標題")}</p>
          <div class="chips">
            <span class="chip">${esc(dayCountLabel(trip))}</span>
            <span class="chip">${trip.builtin ? "內建範本" : "線上專案"}</span>
            ${trip.city ? `<span class="chip">${esc(trip.city)}</span>` : ""}
            ${tripPassword(trip) ? `<span class="chip">有密碼</span>` : ""}
          </div>
        </a>
      `).join("")}
      <p class="hint">不需登入。新增的專案會出現在這個網站上，其他人打開同一個網址也看得到。</p>
    `;
    app.querySelector("[data-go]").onclick = () => go("#/new");
    app.querySelector("[data-go-admin]").onclick = () => go("#/admin");
  }

  function renderGate(trip, nextHash) {
    document.body.className = "home";
    app.innerHTML = `
      <div class="topbar">
        <div class="topbar-left"><a class="btn ghost" href="#/">全部專案</a></div>
      </div>
      <h1>${esc(trip.title || "未命名專案")}</h1>
      <p class="sub">這個專案有密碼，輸入後才能查看。</p>
      <div class="editor-card" style="margin-top:16px">
        <div class="field">
          <label>專案密碼</label>
          <input id="gatePassword" type="password" autocomplete="current-password">
        </div>
        <p class="error" id="gateError" hidden>密碼不對，再試一次。</p>
        <div class="editor-save">
          <button class="btn primary" id="gateSubmit">進入專案</button>
        </div>
      </div>
    `;
    const input = document.getElementById("gatePassword");
    const submit = () => {
      if (input.value.trim() === tripPassword(trip)) {
        unlockTrip(trip);
        go(nextHash);
        render();
        return;
      }
      document.getElementById("gateError").hidden = false;
      input.focus();
    };
    document.getElementById("gateSubmit").onclick = submit;
    input.onkeydown = (event) => {
      if (event.key === "Enter") submit();
    };
    input.focus();
  }

  function renderAdmin() {
    document.body.className = "home";
    if (!isAdmin()) {
      app.innerHTML = `
        <div class="topbar">
          <div class="topbar-left"><a class="btn ghost" href="#/">全部專案</a></div>
        </div>
        <h1>管理員</h1>
        <p class="sub">輸入管理員密碼後，可以看到每個專案的密碼。</p>
        <div class="editor-card" style="margin-top:16px">
          <div class="field">
            <label>管理員密碼</label>
            <input id="adminPassword" type="password" autocomplete="current-password">
          </div>
          <p class="error" id="adminError" hidden>密碼不對，再試一次。</p>
          <div class="editor-save">
            <button class="btn primary" id="adminSubmit">進入</button>
          </div>
        </div>
      `;
      const input = document.getElementById("adminPassword");
      const submit = () => {
        if (input.value === ADMIN_PASSWORD) {
          setAdmin(true);
          renderAdmin();
          return;
        }
        document.getElementById("adminError").hidden = false;
        input.focus();
      };
      document.getElementById("adminSubmit").onclick = submit;
      input.onkeydown = (event) => {
        if (event.key === "Enter") submit();
      };
      input.focus();
      return;
    }

    const trips = allTrips();
    app.innerHTML = `
      <div class="topbar">
        <div class="topbar-left"><a class="btn ghost" href="#/">全部專案</a></div>
        <div class="topbar-right"><button class="btn ghost" id="adminLogout">退出管理員</button></div>
      </div>
      <h1>所有專案密碼</h1>
      <p class="sub">只有管理員看得到這頁。內建範本沒有專案密碼。</p>
      ${trips.map((trip) => `
        <a class="trip-card" href="#/trip/${encodeURIComponent(trip.id)}">
          <h2>${esc(trip.title || "未命名專案")}</h2>
          <p class="sub">${esc(trip.subtitle || "還沒有副標題")}</p>
          <div class="chips">
            <span class="chip">${trip.builtin ? "內建範本" : "線上專案"}</span>
            <span class="chip">${tripPassword(trip) ? "密碼：" + tripPassword(trip) : "沒有設定密碼"}</span>
          </div>
        </a>
      `).join("")}
    `;
    document.getElementById("adminLogout").onclick = () => {
      setAdmin(false);
      go("#/");
    };
  }

  function hotelBlock(trip) {
    const hotel = trip.hotel || {};
    if (!hotel.name) return "";
    return `
      <div class="item">
        <div class="row"><b>${esc(hotel.name)}</b><span class="tag">${esc(hotel.tag || "")}</span></div>
        ${hotel.address ? `<p class="meta">${esc(hotel.address)}</p>` : ""}
        ${hotel.detail ? `<p class="meta">${esc(hotel.detail)}</p>` : ""}
        ${hotel.note ? `<p class="meta">${esc(hotel.note)}</p>` : ""}
        ${hotel.mapQuery ? `<a class="map" href="${mapUrl(hotel.mapQuery, trip.city)}">用地圖打開酒店</a>` : ""}
      </div>
    `;
  }

  function derivedStats(trip) {
    if (trip.stats && trip.stats.length) return trip.stats;
    const days = trip.days || [];
    const first = days[0] || {};
    const last = days[days.length - 1] || {};
    const items = [];
    if (days.length) items.push({ value: days.length + " 天", label: [first.date, last.date].filter(Boolean).join(" — ") || "行程天數" });
    if (trip.hotel && trip.hotel.name) items.push({ value: trip.hotel.name, label: trip.hotel.address || "住宿" });
    return items;
  }

  function derivedOverviewDays(trip) {
    if (trip.overviewDays && trip.overviewDays.length) return trip.overviewDays;
    return (trip.days || []).map((day) => ({
      title: [day.date, day.weekday, day.title].filter(Boolean).join(" · "),
      tag: day.pace || "",
      meta: (day.slots || []).map((slot) => slot.stop).filter(Boolean).slice(0, 3).join("、")
    }));
  }

  function renderBlocks(blocks, city) {
    return (blocks || []).map((block) => {
      if (block.type === "h2") return `<h2>${esc(block.text)}</h2>`;
      if (block.type === "p") return `<p class="sub" style="margin-bottom:10px">${esc(block.text)}</p>`;
      if (block.type === "note") return `<div class="note"><strong>${esc(block.title)}</strong>${esc(block.body)}</div>`;
      if (block.type === "item") {
        return `
          <div class="item">
            <div class="row"><b>${esc(block.name)}</b><span class="tag">${esc(block.tag || "")}</span></div>
            ${(block.metas || []).map((line) => `<p class="meta">${esc(line)}</p>`).join("")}
            ${block.map ? `<a class="map" href="${mapUrl(block.map, city)}">用地圖打開</a>` : ""}
          </div>
        `;
      }
      if (block.type === "items") {
        return (block.items || []).map((item) => `
          <div class="item">
            <div class="row"><b>${esc(item.name)}</b><span class="tag">${esc(item.tag || "")}</span></div>
            <p class="meta">${esc(item.meta || "")}</p>
          </div>
        `).join("");
      }
      return "";
    }).join("");
  }

  function renderTrip(trip) {
    document.body.className = "trip";
    const pages = [
      { id: "plan", label: "每日" },
      { id: "overview", label: "總覽" },
      ...(trip.extraPages || []).map((page) => ({ id: page.id, label: page.label })),
      { id: "book", label: "預約" }
    ];
    const dayKey = "albert-travel-day:" + trip.id;
    const days = trip.days || [];
    let dayId = localStorage.getItem(dayKey) || (days[0] && days[0].id) || "";

    app.innerHTML = `
      <div class="topbar">
        <div class="topbar-left">
          <a class="btn ghost" href="#/">全部專案</a>
        </div>
        <div class="topbar-right">
          <button class="btn" id="copyTrip">複製</button>
          <a class="btn" href="#/edit/${encodeURIComponent(trip.id)}">編輯</a>
        </div>
      </div>
      <h1>${esc(trip.title)}</h1>
      <p class="sub">${esc(trip.subtitle || "")}</p>
      <nav class="nav" id="nav" style="grid-template-columns: repeat(${pages.length}, 1fr)">
        ${pages.map((page, index) => `<button data-page="${esc(page.id)}" class="${index === 0 ? "on" : ""}">${esc(page.label)}</button>`).join("")}
      </nav>
      <section id="plan" class="page on">
        <div class="days" id="days"></div>
        <p class="sub" id="dayMeta"></p>
        <div id="slots" style="margin-top:10px"></div>
      </section>
      <section id="overview" class="page">
        <div class="stats">
          ${derivedStats(trip).map((stat) => `<div class="stat"><b>${esc(stat.value)}</b><span>${esc(stat.label)}</span></div>`).join("")}
        </div>
        ${hotelBlock(trip)}
        ${(trip.notes || []).map((note) => `<div class="note"><strong>${esc(note.title)}</strong>${esc(note.body)}</div>`).join("")}
        <h2>怎麼走</h2>
        ${derivedOverviewDays(trip).map((day) => `
          <div class="item"><div class="row"><b>${esc(day.title)}</b><span class="tag">${esc(day.tag || "")}</span></div><p class="meta">${esc(day.meta || "")}</p></div>
        `).join("") || `<div class="empty">還沒有總覽。編輯專案後會自動用每日行程產生。</div>`}
        ${(trip.transport || []).length ? `<h2>怎麼住、怎麼坐</h2>` : ""}
        ${(trip.transport || []).map((item) => `<div class="item"><b>${esc(item.title)}</b><p class="meta">${esc(item.body)}</p></div>`).join("")}
      </section>
      ${(trip.extraPages || []).map((page) => `
        <section id="${esc(page.id)}" class="page">
          ${page.intro ? `<p class="sub">${esc(page.intro)}</p>` : ""}
          ${renderBlocks(page.blocks, trip.city)}
        </section>
      `).join("")}
      <section id="book" class="page">
        <h2>出發前要約</h2>
        ${(trip.bookings || []).map((book) => `
          <div class="item">
            <div class="row"><b>${esc(book.name)}</b><span class="tag">${esc(book.tag || "")}</span></div>
            ${book.where ? `<p class="meta">${esc(book.where)}</p>` : ""}
            ${book.detail ? `<p class="meta">${esc(book.detail)}</p>` : ""}
          </div>
        `).join("") || `<div class="empty">還沒有預約清單。</div>`}
        <p class="hint">Safari / Chrome 可「加入主畫面」，之後沒網也能看。用系統瀏覽器打開，不要困在微信內建頁。</p>
      </section>
    `;

    function renderPlan() {
      const wrap = document.getElementById("days");
      wrap.innerHTML = (trip.days || []).map((day) =>
        `<button class="${day.id === dayId ? "on" : ""}" data-day="${esc(day.id)}">${esc([day.date, day.title].filter(Boolean).join(" "))}</button>`
      ).join("") || `<div class="empty">還沒有每日行程。</div>`;
      wrap.querySelectorAll("button").forEach((btn) => {
        btn.onclick = () => {
          dayId = btn.dataset.day;
          localStorage.setItem(dayKey, dayId);
          renderPlan();
        };
      });
      const day = (trip.days || []).find((item) => item.id === dayId);
      const meta = document.getElementById("dayMeta");
      const slots = document.getElementById("slots");
      if (!day) {
        meta.textContent = "";
        slots.innerHTML = "";
        return;
      }
      meta.textContent = [day.date, day.weekday ? "（周" + day.weekday + "）" : "", day.title, day.pace ? " · " + day.pace : ""].join("");
      slots.innerHTML = (day.slots || []).map((slot) => `
        <article class="slot">
          ${slot.time ? `<div class="time">${esc(slot.time)}</div>` : ""}
          <div class="stop">${esc(slot.stop || "未命名時段")}</div>
          ${slot.how ? `<p class="meta">怎麼去：${esc(slot.how)}</p>` : ""}
          ${slot.note ? `<p class="meta">${esc(slot.note)}</p>` : ""}
          ${slot.map ? `<a class="map" href="${mapUrl(slot.map, trip.city)}">用地圖打開</a>` : ""}
        </article>
      `).join("");
    }

    renderPlan();

    document.getElementById("nav").onclick = (event) => {
      const btn = event.target.closest("button");
      if (!btn) return;
      document.querySelectorAll(".nav button").forEach((item) => item.classList.toggle("on", item === btn));
      document.querySelectorAll(".page").forEach((page) => page.classList.toggle("on", page.id === btn.dataset.page));
      window.scrollTo(0, 0);
    };

    const copyBtn = document.getElementById("copyTrip");
    if (copyBtn) {
      copyBtn.onclick = async () => {
        copyBtn.disabled = true;
        copyBtn.textContent = "複製中…";
        const copy = clone(trip);
        copy.id = "trip-" + Date.now();
        copy.builtin = false;
        copy.title = (trip.title || "未命名專案") + "（我的副本）";
        delete copy._crudId;
        delete copy._id;
        await upsertUserTrip(copy);
        unlockTrip(copy);
        go("#/trip/" + encodeURIComponent(copy.id));
      };
    }
  }

  function field(label, name, value, extra) {
    const multiline = extra === "area";
    const secret = extra === "password";
    return `
      <div class="field">
        <label>${esc(label)}</label>
        ${multiline
          ? `<textarea name="${esc(name)}">${esc(value || "")}</textarea>`
          : `<input name="${esc(name)}" ${secret ? 'type="password" autocomplete="new-password"' : ""} value="${esc(value || "")}">`}
      </div>
    `;
  }

  function renderEdit(trip) {
    document.body.className = "editor";
    const draft = trip ? clone(trip) : blankTrip();
    const isNew = !trip;
    draft.hotel = draft.hotel || { name: "", tag: "", address: "", detail: "", note: "", mapQuery: "" };
    draft.days = draft.days || [];
    draft.notes = draft.notes || [];
    draft.bookings = draft.bookings || [];
    draft.extraPages = draft.extraPages || [];
    draft.stats = draft.stats || [];
    draft.overviewDays = draft.overviewDays || [];
    draft.transport = draft.transport || [];
    draft.password = draft.password || "";

    function paint() {
      app.innerHTML = `
        <div class="topbar">
          <div class="topbar-left">
            <a class="btn ghost" href="${isNew ? "#/" : "#/trip/" + encodeURIComponent(draft.id)}">返回</a>
          </div>
          <div class="topbar-right">
            ${!isNew && !isBuiltinId(draft.id) ? `<button class="btn danger" id="deleteTrip">刪除</button>` : ""}
          </div>
        </div>
        <h1>${isNew ? "新增旅遊專案" : "編輯專案"}</h1>
        <p class="sub">先寫基本資料和每日行程就很好用。總覽、預約、額外分頁可以之後再補。</p>

        <div class="editor-section">
          <h2>基本資料</h2>
          <div class="editor-card">
            ${field("專案名稱", "title", draft.title)}
            ${field("副標題（日期、飯店、一句話）", "subtitle", draft.subtitle)}
            <div class="grid-2">
              ${field("地圖城市（高德搜尋用）", "city", draft.city)}
              ${field("封面標籤（如 5 天 4 夜）", "coverTag", draft.coverTag)}
            </div>
            ${field("封面說明", "coverMeta", draft.coverMeta)}
            ${field("專案密碼（可留空）", "password", draft.password, "password")}
            <p class="sub">設定後，其他人要先輸入這個密碼才能看這個專案。管理員可在首頁查看所有專案密碼。</p>
          </div>
        </div>

        <div class="editor-section">
          <h2>住宿</h2>
          <div class="editor-card">
            ${field("飯店名稱", "hotel.name", draft.hotel && draft.hotel.name)}
            <div class="grid-2">
              ${field("標籤", "hotel.tag", draft.hotel && draft.hotel.tag)}
              ${field("地圖關鍵字", "hotel.mapQuery", draft.hotel && draft.hotel.mapQuery)}
            </div>
            ${field("地址", "hotel.address", draft.hotel && draft.hotel.address)}
            ${field("房型 / 細節", "hotel.detail", draft.hotel && draft.hotel.detail, "area")}
            ${field("入住備註", "hotel.note", draft.hotel && draft.hotel.note)}
          </div>
        </div>

        <div class="editor-section">
          <div class="editor-toolbar">
            <h2>每日行程</h2>
            <button class="btn" id="addDay">新增一天</button>
          </div>
          ${(draft.days || []).map((day, dayIndex) => `
            <div class="editor-card" data-day-index="${dayIndex}">
              <div class="grid-2">
                ${field("日期", "days." + dayIndex + ".date", day.date)}
                ${field("星期", "days." + dayIndex + ".weekday", day.weekday)}
              </div>
              ${field("這天標題", "days." + dayIndex + ".title", day.title)}
              ${field("節奏（早上上島、下午逛街…）", "days." + dayIndex + ".pace", day.pace)}
              ${(day.slots || []).map((slot, slotIndex) => `
                <div class="slot-editor">
                  <p class="time">時段 ${slotIndex + 1}</p>
                  <div class="grid-2">
                    ${field("時間", "days." + dayIndex + ".slots." + slotIndex + ".time", slot.time)}
                    ${field("地圖關鍵字", "days." + dayIndex + ".slots." + slotIndex + ".map", slot.map)}
                  </div>
                  ${field("地點 / 活動", "days." + dayIndex + ".slots." + slotIndex + ".stop", slot.stop)}
                  ${field("怎麼去", "days." + dayIndex + ".slots." + slotIndex + ".how", slot.how)}
                  ${field("備註", "days." + dayIndex + ".slots." + slotIndex + ".note", slot.note, "area")}
                  <div class="mini-actions">
                    <button class="btn danger" data-remove-slot="${dayIndex}:${slotIndex}">刪此時段</button>
                  </div>
                </div>
              `).join("")}
              <div class="mini-actions">
                <button class="btn" data-add-slot="${dayIndex}">新增時段</button>
                <button class="btn danger" data-remove-day="${dayIndex}">刪這一天</button>
              </div>
            </div>
          `).join("")}
        </div>

        <div class="editor-section">
          <div class="editor-toolbar">
            <h2>總覽補充</h2>
          </div>
          <div class="editor-card">
            <p class="sub" style="margin-bottom:10px">可不填。空白時會用每日行程自動產生總覽。</p>
            ${(draft.notes || []).map((note, index) => `
              <div>
                ${field("注意事項標題", "notes." + index + ".title", note.title)}
                ${field("內容", "notes." + index + ".body", note.body, "area")}
                <div class="mini-actions"><button class="btn danger" data-remove-note="${index}">刪除</button></div>
              </div>
            `).join("")}
            <button class="btn" id="addNote">新增注意事項</button>
          </div>
          <div class="editor-card">
            ${(draft.bookings || []).map((book, index) => `
              <div>
                <div class="grid-2">
                  ${field("預約名稱", "bookings." + index + ".name", book.name)}
                  ${field("狀態 / 價格", "bookings." + index + ".tag", book.tag)}
                </div>
                ${field("地點 / 預約管道", "bookings." + index + ".where", book.where)}
                ${field("細節", "bookings." + index + ".detail", book.detail, "area")}
                <div class="mini-actions"><button class="btn danger" data-remove-book="${index}">刪除</button></div>
              </div>
            `).join("")}
            <button class="btn" id="addBook">新增預約項目</button>
          </div>
        </div>

        <div class="editor-section">
          <div class="editor-toolbar">
            <h2>額外分頁</h2>
            <button class="btn" id="addPage">新增分頁</button>
          </div>
          <p class="sub">像長沙範本的「五一」「公社」。底部導覽會多一格。</p>
          ${(draft.extraPages || []).map((page, pageIndex) => `
            <div class="editor-card">
              <div class="grid-2">
                ${field("分頁名稱", "extraPages." + pageIndex + ".label", page.label)}
                ${field("開頭說明", "extraPages." + pageIndex + ".intro", page.intro)}
              </div>
              ${(page.blocks || []).map((block, blockIndex) => {
                if (block.type === "h2" || block.type === "p") {
                  return `${field(block.type === "h2" ? "小標題" : "段落", "extraPages." + pageIndex + ".blocks." + blockIndex + ".text", block.text)}
                    <div class="mini-actions"><button class="btn danger" data-remove-block="${pageIndex}:${blockIndex}">刪區塊</button></div>`;
                }
                if (block.type === "note") {
                  return `${field("便利貼標題", "extraPages." + pageIndex + ".blocks." + blockIndex + ".title", block.title)}
                    ${field("便利貼內容", "extraPages." + pageIndex + ".blocks." + blockIndex + ".body", block.body, "area")}
                    <div class="mini-actions"><button class="btn danger" data-remove-block="${pageIndex}:${blockIndex}">刪區塊</button></div>`;
                }
                if (block.type === "item") {
                  return `
                    <div class="grid-2">
                      ${field("卡片名稱", "extraPages." + pageIndex + ".blocks." + blockIndex + ".name", block.name)}
                      ${field("標籤", "extraPages." + pageIndex + ".blocks." + blockIndex + ".tag", block.tag)}
                    </div>
                    ${field("說明（一行一則）", "extraPages." + pageIndex + ".blocks." + blockIndex + ".metasText", (block.metas || []).join("\n"), "area")}
                    ${field("地圖關鍵字", "extraPages." + pageIndex + ".blocks." + blockIndex + ".map", block.map)}
                    <div class="mini-actions"><button class="btn danger" data-remove-block="${pageIndex}:${blockIndex}">刪區塊</button></div>
                  `;
                }
                return "";
              }).join("")}
              <div class="mini-actions">
                <button class="btn" data-add-block="${pageIndex}:h2">加標題</button>
                <button class="btn" data-add-block="${pageIndex}:item">加卡片</button>
                <button class="btn" data-add-block="${pageIndex}:note">加便利貼</button>
                <button class="btn danger" data-remove-page="${pageIndex}">刪分頁</button>
              </div>
            </div>
          `).join("")}
        </div>

        <div class="editor-save">
          <button class="btn primary" id="saveTrip">儲存專案</button>
        </div>
      `;
      bindEditorButtons(draft, isNew, paint);
    }

    paint();
  }

  function readFields(root, draft) {
    root.querySelectorAll("[name]").forEach((input) => {
      setPath(draft, input.name, input.value);
    });
    (draft.extraPages || []).forEach((page) => {
      (page.blocks || []).forEach((block) => {
        if (block.metasText != null) {
          block.metas = String(block.metasText).split("\n").map((line) => line.trim()).filter(Boolean);
          delete block.metasText;
        }
      });
    });
  }

  function setPath(target, path, value) {
    const parts = path.split(".");
    let cursor = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
      const nextKey = parts[i + 1];
      const nextIsIndex = /^\d+$/.test(nextKey);
      if (cursor[key] == null) cursor[key] = nextIsIndex ? [] : {};
      cursor = cursor[key];
    }
    const last = /^\d+$/.test(parts[parts.length - 1]) ? Number(parts[parts.length - 1]) : parts[parts.length - 1];
    cursor[last] = value;
  }

  function bindEditorButtons(draft, isNew, paint) {
    const refresh = (mutator) => {
      readFields(app, draft);
      mutator();
      paint();
    };

    const addDay = document.getElementById("addDay");
    if (addDay) {
      addDay.onclick = () => refresh(() => {
        const index = draft.days.length + 1;
        draft.days.push({
          id: "d" + index + "-" + Date.now(),
          date: "",
          weekday: "",
          title: "第 " + index + " 天",
          pace: "",
          slots: [{ time: "", stop: "", how: "", note: "", map: "" }]
        });
      });
    }

    app.querySelectorAll("[data-add-slot]").forEach((btn) => {
      btn.onclick = () => refresh(() => {
        draft.days[Number(btn.dataset.addSlot)].slots.push({ time: "", stop: "", how: "", note: "", map: "" });
      });
    });
    app.querySelectorAll("[data-remove-slot]").forEach((btn) => {
      btn.onclick = () => refresh(() => {
        const [dayIndex, slotIndex] = btn.dataset.removeSlot.split(":").map(Number);
        draft.days[dayIndex].slots.splice(slotIndex, 1);
      });
    });
    app.querySelectorAll("[data-remove-day]").forEach((btn) => {
      btn.onclick = () => refresh(() => draft.days.splice(Number(btn.dataset.removeDay), 1));
    });

    const addNote = document.getElementById("addNote");
    if (addNote) addNote.onclick = () => refresh(() => draft.notes.push({ title: "", body: "" }));
    app.querySelectorAll("[data-remove-note]").forEach((btn) => {
      btn.onclick = () => refresh(() => draft.notes.splice(Number(btn.dataset.removeNote), 1));
    });

    const addBook = document.getElementById("addBook");
    if (addBook) addBook.onclick = () => refresh(() => draft.bookings.push({ name: "", tag: "", where: "", detail: "" }));
    app.querySelectorAll("[data-remove-book]").forEach((btn) => {
      btn.onclick = () => refresh(() => draft.bookings.splice(Number(btn.dataset.removeBook), 1));
    });

    const addPage = document.getElementById("addPage");
    if (addPage) {
      addPage.onclick = () => refresh(() => draft.extraPages.push({
        id: "page-" + Date.now(),
        label: "新分頁",
        intro: "",
        blocks: [{ type: "item", name: "", tag: "", metas: [], map: "" }]
      }));
    }
    app.querySelectorAll("[data-add-block]").forEach((btn) => {
      btn.onclick = () => refresh(() => {
        const [pageIndex, type] = btn.dataset.addBlock.split(":");
        const block = type === "h2" ? { type: "h2", text: "" }
          : type === "note" ? { type: "note", title: "", body: "" }
          : { type: "item", name: "", tag: "", metas: [], map: "" };
        draft.extraPages[Number(pageIndex)].blocks.push(block);
      });
    });
    app.querySelectorAll("[data-remove-block]").forEach((btn) => {
      btn.onclick = () => refresh(() => {
        const [pageIndex, blockIndex] = btn.dataset.removeBlock.split(":").map(Number);
        draft.extraPages[pageIndex].blocks.splice(blockIndex, 1);
      });
    });
    app.querySelectorAll("[data-remove-page]").forEach((btn) => {
      btn.onclick = () => refresh(() => draft.extraPages.splice(Number(btn.dataset.removePage), 1));
    });

    document.getElementById("saveTrip").onclick = async () => {
      readFields(app, draft);
      if (!draft.title.trim()) {
        alert("請先填專案名稱。");
        return;
      }
      if (!draft.days.length) {
        alert("至少留一天行程。");
        return;
      }
      draft.coverTag = draft.coverTag || ((draft.days || []).length + " 天");
      draft.coverMeta = draft.coverMeta || draft.subtitle;
      const saveBtn = document.getElementById("saveTrip");
      saveBtn.disabled = true;
      saveBtn.textContent = "儲存中…";
      await upsertUserTrip(draft);
      unlockTrip(draft);
      go("#/trip/" + encodeURIComponent(draft.id));
    };

    const deleteBtn = document.getElementById("deleteTrip");
    if (deleteBtn) {
      deleteBtn.onclick = async () => {
        if (confirm("確定刪除這個專案？其他人之後也會看不到。")) {
          deleteBtn.disabled = true;
          await deleteUserTrip(draft.id);
          go("#/");
        }
      };
    }
  }

  function render() {
    const route = parseHash();
    if (route.name === "home") {
      renderHome();
      return;
    }
    if (route.name === "admin") {
      renderAdmin();
      return;
    }
    if (route.name === "edit") {
      if (!route.id) {
        renderEdit(null);
        return;
      }
      const editing = findTrip(route.id);
      if (!editing) {
        app.innerHTML = `<h1>找不到這個專案</h1><p class="sub">可能已被刪除，或線上資料還沒載入完成。</p><p><a class="btn" href="#/">回全部專案</a></p>`;
        return;
      }
      if (!isUnlocked(editing)) {
        renderGate(editing, "#/edit/" + encodeURIComponent(editing.id));
        return;
      }
      renderEdit(editing);
      return;
    }
    const trip = findTrip(route.id);
    if (!trip) {
      app.innerHTML = `<h1>找不到這個專案</h1><p class="sub">可能已被刪除，或線上資料還沒載入完成。</p><p><a class="btn" href="#/">回全部專案</a></p>`;
      return;
    }
    if (!isUnlocked(trip)) {
      renderGate(trip, "#/trip/" + encodeURIComponent(trip.id));
      return;
    }
    renderTrip(trip);
  }

  window.addEventListener("hashchange", render);
  if (!location.hash) location.hash = "#/";
  app.innerHTML = `<p class="sub">載入旅遊專案…</p>`;
  Promise.resolve(store && store.load ? store.load() : null).catch(() => {}).finally(render);
})();
