/* =========================================================
   tatilvillaGO — tarayıcı tarafı
   Sayfalar hazır HTML olarak üretilir; bu dosya yalnızca
   etkileşim ekler (harita, filtre, takvim, favoriler).
   ========================================================= */
(function () {
  "use strict";
  const D = window.TVG, S = D.site;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const body = document.body, page = body.dataset.page, ROOT = body.dataset.root || "";
  const byId = id => D.villas.find(v => v.id === id);

  /* ---------- yardımcılar ---------- */
  const fmt = n => "₺" + new Intl.NumberFormat("tr-TR").format(n);
  const pad = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { if (!s) return null; const [y, m, d] = String(s).split("-").map(Number); return y ? new Date(y, m - 1, d) : null; };
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const nights = (a, b) => Math.round((b - a) / 86400000);
  const trDate = d => d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
  const wa = t => `https://wa.me/${S.whatsapp}?text=${encodeURIComponent(t)}`;
  const isFree = (v, a, b) => !a || !b || !v.booked.some(([s, e]) => a < parse(e) && b > parse(s));
  const isBusy = (v, d) => v.booked.some(([s, e]) => d >= parse(s) && d < parse(e));
  const ico = n => `<svg class="icon" aria-hidden="true"><use href="#i-${n}"></use></svg>`;

  function toast(msg) {
    let t = $(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); body.append(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ---------- üst menü ---------- */
  const mb = $(".menu-btn"), nav = $("#nav");
  mb && mb.addEventListener("click", () => {
    const o = nav.classList.toggle("open");
    mb.setAttribute("aria-expanded", o); mb.setAttribute("aria-label", o ? "Menüyü kapat" : "Menüyü aç");
    mb.innerHTML = ico(o ? "x" : "menu");
  });
  $$(".has-sub > .nav-btn").forEach(b => b.addEventListener("click", () => {
    const li = b.parentElement, o = li.classList.toggle("open"); b.setAttribute("aria-expanded", o);
  }));
  const hdr = $(".site-header");
  const onScroll = () => hdr && hdr.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  /* ---------- favoriler ---------- */
  const FK = "tvg-favs";
  const favs = {
    get() { try { return JSON.parse(localStorage.getItem(FK)) || []; } catch { return []; } },
    set(a) { try { localStorage.setItem(FK, JSON.stringify(a)); } catch { /* depolama kapalı */ } },
    has(id) { return this.get().includes(id); },
    toggle(id) { const a = this.get(), i = a.indexOf(id); i < 0 ? a.push(id) : a.splice(i, 1); this.set(a); return i < 0; },
  };
  function syncFav() {
    const n = favs.get().length;
    $$(".fav-n").forEach(el => (el.textContent = n || ""));
    $$(".fav[data-id]").forEach(b => { const on = favs.has(b.dataset.id); b.setAttribute("aria-pressed", on); b.setAttribute("aria-label", on ? "Favorilerden çıkar" : "Favorilere ekle"); });
    if (page === "favoriler") {
      const list = favs.get();
      $$("#favs .card").forEach(c => (c.hidden = !list.includes(c.dataset.id)));
      $("#fav-empty").hidden = list.length > 0;
      const sh = $("#fav-share");
      sh.hidden = !list.length;
      sh.href = wa("Merhaba, şu villalar için müsaitlik sormak istiyorum:\n" + list.map(id => byId(id)).filter(Boolean).map(v => `• ${v.name} (${v.areaName})`).join("\n"));
    }
  }
  document.addEventListener("click", e => {
    const b = e.target.closest(".fav[data-id]"); if (!b) return;
    e.preventDefault();
    toast(favs.toggle(b.dataset.id) ? "Favorilere eklendi" : "Favorilerden çıkarıldı");
    syncFav();
  });

  /* ---------- tarih alanlarını bağla ---------- */
  function linkDates(a, b, gap = 5) {
    a.min = iso(today()); b.min = iso(addDays(today(), 1));
    a.addEventListener("change", () => {
      const d = parse(a.value); if (!d) return;
      b.min = iso(addDays(d, 1));
      if (!b.value || parse(b.value) <= d) b.value = iso(addDays(d, gap));
      b.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  /* ---------- karusel ---------- */
  $$(".carousel").forEach(root => {
    const tr = $(".track", root), p = $(".prev", root), n = $(".next", root);
    const step = () => (tr.firstElementChild ? tr.firstElementChild.getBoundingClientRect().width + 22 : 300);
    const upd = () => { p.disabled = tr.scrollLeft < 4; n.disabled = tr.scrollLeft + tr.clientWidth >= tr.scrollWidth - 4; };
    p.addEventListener("click", () => tr.scrollBy({ left: -step(), behavior: "smooth" }));
    n.addEventListener("click", () => tr.scrollBy({ left: step(), behavior: "smooth" }));
    tr.addEventListener("scroll", upd, { passive: true }); addEventListener("resize", upd); upd();
  });

  /* =========================================================
     HARİTA (Leaflet + OpenStreetMap)
     Harita, ekrana girdiğinde yüklenir; sayfa hızını korur.
     ========================================================= */
  function whenVisible(el, fn) {
    if (!("IntersectionObserver" in window)) return fn();
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: "200px" });
    io.observe(el);
  }
  function baseMap(el, opts = {}) {
    if (!window.L) { el.dataset.loading = "Harita yüklenemedi. Sayfayı yenileyin."; return null; }
    const map = L.map(el, { scrollWheelZoom: opts.wheel ?? false, zoomControl: false, attributionControl: true });
    L.control.zoom({ position: "topright", zoomInTitle: "Yakınlaştır", zoomOutTitle: "Uzaklaştır" }).addTo(map);
    L.tileLayer(S.tiles.url, { maxZoom: 19, attribution: S.tiles.attribution }).addTo(map);
    map.attributionControl.setPrefix(false);
    el.addEventListener("click", () => map.scrollWheelZoom.enable(), { once: true });
    return map;
  }
  const pop = v => `<div class="mpop"><img src="${ROOT}${v.img}" alt="" width="520" height="292" loading="lazy">
    <div class="b"><span class="loc">${v.areaName}</span><h3>${v.name}</h3>
    <span class="muted" style="font-size:.85rem">${v.guests} kişi · ${v.bedrooms} yatak odası${v.toCenter ? ` · ${v.toCenter}` : ""}</span>
    <div class="row"><span><strong>${fmt(v.price)}</strong> / gece</span><a class="btn btn-coral" href="${ROOT}${v.url}">Villayı gör</a></div></div></div>`;
  function priceMarkers(map, villas, onPick) {
    const ms = {};
    villas.forEach(v => {
      const m = L.marker([v.lat, v.lng], { icon: L.divIcon({ className: "pm", html: `<span>${fmt(v.price)}</span>`, iconSize: [0, 0] }), title: v.name, riseOnHover: true, keyboard: true, alt: v.name })
        .addTo(map).bindPopup(pop(v), { offset: [0, -10], maxWidth: 280, autoPanPadding: [40, 40] });
      m.on("click", () => onPick && onPick(v.id));
      ms[v.id] = m;
    });
    return ms;
  }
  const setActive = (ms, id) => Object.entries(ms).forEach(([k, m]) => { const el = m.getElement(); if (el) el.classList.toggle("is-active", k === id); m.setZIndexOffset(k === id ? 1000 : 0); });
  const fit = (map, pts, pad = 40, max = 15) => { if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [pad, pad], maxZoom: max }); };

  /* ---------- ana sayfa: bölgelerle harita ---------- */
  const homeMap = $("#home-map");
  if (homeMap) whenVisible(homeMap, () => {
    const map = baseMap(homeMap); if (!map) return;
    const ms = priceMarkers(map, D.villas);
    fit(map, D.villas.map(v => [v.lat, v.lng]), 50, 13);
    $$(".arealist button").forEach(b => b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      $$(".arealist button").forEach(x => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", on);
      const list = on ? D.villas.filter(v => (b.dataset.city ? v.city === b.dataset.city : v.area === b.dataset.area)) : D.villas;
      Object.entries(ms).forEach(([id, m]) => (list.some(v => v.id === id) ? m.addTo(map) : m.remove()));
      if (list.length) fit(map, list.map(v => [v.lat, v.lng]), 60, list.length === 1 ? 15 : 14);
      else if (b.dataset.lat) map.setView([+b.dataset.lat, +b.dataset.lng], 14);
    }));
  });

  /* ---------- liste haritası (bölge ve koleksiyon sayfaları) ---------- */
  $$(".listmap[data-ids]").forEach(el => whenVisible(el, () => {
    const map = baseMap(el); if (!map) return;
    const list = el.dataset.ids.split(",").map(byId).filter(Boolean);
    const ms = priceMarkers(map, list);
    fit(map, list.map(v => [v.lat, v.lng]), 50, 15);
    $$(".card[data-id]").forEach(c => {
      c.addEventListener("mouseenter", () => setActive(ms, c.dataset.id));
      c.addEventListener("mouseleave", () => setActive(ms, null));
    });
  }));

  /* =========================================================
     ANA SAYFA ARAMA
     ========================================================= */
  const sf = $("#search");
  if (sf) {
    linkDates($("#s-giris"), $("#s-cikis"));
    sf.addEventListener("submit", e => {
      e.preventDefault();
      const p = new URLSearchParams();
      for (const [k, v] of new FormData(sf)) if (v) p.set(k, v);
      location.href = `${ROOT}villalar.html${p.toString() ? "?" + p : ""}`;
    });
  }

  /* =========================================================
     VİLLALAR: liste + harita + filtreler
     ========================================================= */
  if (page === "villalar") {
    const q = new URLSearchParams(location.search);
    const F = { bolge: $("#f-bolge"), giris: $("#f-giris"), cikis: $("#f-cikis"), misafir: $("#f-misafir"), maks: $("#f-maks"), sirala: $("#f-sirala") };
    Object.entries(F).forEach(([k, el]) => { if (q.get(k)) el.value = q.get(k); });
    linkDates(F.giris, F.cikis);
    const want = new Set((q.get("etiket") || "").split(",").filter(Boolean));
    if (q.get("firsat")) want.add("firsat");
    $$(".tag").forEach(b => b.setAttribute("aria-pressed", want.has(b.dataset.k)));
    const grid = $("#results"), cards = $$(".card", grid), order = cards.slice();
    cards.forEach(c => { const p = $(".price", c); c._price = p.innerHTML; });
    const mapEl = $("#explore-map"), boundsBox = $("#f-bounds");
    let map = null, ms = {}, inBounds = null;

    function run() {
      const tags = $$(".tag[aria-pressed=true]").map(b => b.dataset.k);
      const a = parse(F.giris.value), b = parse(F.cikis.value), ok = a && b && b > a, n = ok ? nights(a, b) : 0;
      const g = +F.misafir.value || 0, mx = +F.maks.value || Infinity, area = F.bolge.value;
      let shown = [];
      cards.forEach(c => {
        const v = byId(c.dataset.id);
        const match = (!area || v.area === area || v.city === area) && v.guests >= g && v.price <= mx &&
          tags.every(t => (t === "firsat" ? !!v.oldPrice : v.tags.includes(t))) && (!ok || isFree(v, a, b)) &&
          (!inBounds || inBounds.contains([v.lat, v.lng]));
        c.hidden = !match;
        $(".avail", c)?.remove();
        const p = $(".price", c);
        if (match && ok) {
          p.innerHTML = `<small>${n} gece, temizlik dahil</small><strong>${fmt(n * v.price + S.cleaningFee)}</strong>`;
          $(".card-media", c).insertAdjacentHTML("beforeend", `<span class="avail">${ico("check")}Bu tarihlerde müsait</span>`);
          $("h3 a", c).href = `${ROOT}${v.url}?giris=${iso(a)}&cikis=${iso(b)}`;
        } else { p.innerHTML = c._price; $("h3 a", c).href = `${ROOT}${v.url}`; }
        if (match) shown.push(v);
      });
      const s = F.sirala.value;
      const sorted = order.slice().sort((x, y) => {
        const vx = byId(x.dataset.id), vy = byId(y.dataset.id);
        if (s === "artan") return vx.price - vy.price;
        if (s === "azalan") return vy.price - vx.price;
        if (s === "kisi") return vy.guests - vx.guests;
        return 0;
      });
      sorted.forEach(c => grid.append(c));
      $("#empty").hidden = shown.length > 0;
      $("#count").textContent = shown.length ? `${shown.length} villa${ok ? `, ${n} gece için müsait` : ""}${inBounds ? " (harita alanında)" : ""}` : "Uygun villa yok";
      if (map) Object.entries(ms).forEach(([id, m]) => (shown.some(v => v.id === id) ? m.addTo(map) : m.remove()));
      const p = new URLSearchParams();
      Object.entries(F).forEach(([k, el]) => { if (el.value && !(k === "sirala" && el.value === "onerilen")) p.set(k, el.value); });
      const et = tags.filter(t => t !== "firsat"); if (et.length) p.set("etiket", et.join(","));
      if (tags.includes("firsat")) p.set("firsat", "1");
      history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : ""));
      return shown;
    }
    $(".fbar").addEventListener("change", () => { const sh = run(); if (map && !inBounds && sh.length) fit(map, sh.map(v => [v.lat, v.lng]), 50, 14); });
    $(".tags").addEventListener("click", e => { const b = e.target.closest(".tag"); if (!b) return; b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); $(".fbar").dispatchEvent(new Event("change")); });
    $("#reset").addEventListener("click", () => {
      Object.values(F).forEach(el => (el.value = el === F.sirala ? "onerilen" : ""));
      $$(".tag").forEach(b => b.setAttribute("aria-pressed", "false"));
      if (boundsBox) { boundsBox.checked = false; inBounds = null; }
      $(".fbar").dispatchEvent(new Event("change"));
    });
    const sh = run();
    const start = () => {
      if (map) return;
      map = baseMap(mapEl, { wheel: true }); if (!map) return;
      ms = priceMarkers(map, D.villas, id => { const c = $(`.card[data-id="${id}"]`); if (c && !c.hidden) { c.scrollIntoView({ behavior: "smooth", block: "center" }); c.classList.add("is-hover"); setTimeout(() => c.classList.remove("is-hover"), 1500); } });
      run();
      fit(map, (sh.length ? sh : D.villas).map(v => [v.lat, v.lng]), 50, 14);
      map.on("moveend", () => { if (boundsBox.checked) { inBounds = map.getBounds(); run(); } });
      boundsBox.addEventListener("change", () => { inBounds = boundsBox.checked ? map.getBounds() : null; run(); });
    };
    cards.forEach(c => {
      c.addEventListener("mouseenter", () => setActive(ms, c.dataset.id));
      c.addEventListener("mouseleave", () => setActive(ms, null));
    });
    const ex = $(".explore"), mt = $(".map-toggle");
    mt.addEventListener("click", () => {
      const on = ex.classList.toggle("show-map");
      mt.setAttribute("aria-expanded", on);
      mt.innerHTML = on ? `${ico("list")} Haritayı gizle` : `${ico("map")} Haritada göster`;
      if (on) { start(); setTimeout(() => map && map.invalidateSize(), 50); }
    });
    if (getComputedStyle(mapEl.parentElement).display !== "none") start();
  }

  /* =========================================================
     VİLLA SAYFASI
     ========================================================= */
  if (page === "villa") {
    const v = byId(body.dataset.villa);
    const q = new URLSearchParams(location.search);

    // Konum haritası: villa + çevresi
    const vm = $("#villa-map");
    whenVisible(vm, () => {
      const map = baseMap(vm); if (!map) return;
      const house = `<div><svg viewBox="0 0 44 44" aria-hidden="true"><path d="M22 2C13.2 2 6 9.1 6 17.9 6 29.7 22 42 22 42s16-12.3 16-24.1C38 9.1 30.8 2 22 2Z" fill="#E8604A" stroke="#fff" stroke-width="2.5"/><path d="M14.5 19.5 22 13l7.5 6.5V27a1 1 0 0 1-1 1h-4.5v-5h-4v5h-4.5a1 1 0 0 1-1-1Z" fill="#fff"/></svg></div>`;
      const pts = [[v.lat, v.lng]];
      if (S.exactLocation) L.marker([v.lat, v.lng], { icon: L.divIcon({ className: "vpin", html: house, iconSize: [0, 0] }), title: v.name, zIndexOffset: 2000 }).addTo(map).bindTooltip(v.name, { direction: "top", offset: [0, -40] });
      else L.circle([v.lat, v.lng], { radius: 300, className: "area-circle", weight: 2, fillOpacity: .15 }).addTo(map);
      const pm = {}; let line = null;
      v.nearby.forEach((p, i) => {
        const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "poi", html: `<div class="t-${p.type}">${ico(p.type)}</div>`, iconSize: [0, 0] }), title: p.name }).addTo(map)
          .bindTooltip(`<b>${p.name}</b><br>${p.time}`, { direction: "top", offset: [0, -16] });
        m.on("click", () => pick(i));
        pm[i] = m;
        if (p.near) pts.push([p.lat, p.lng]);
      });
      fit(map, pts, 50, 16);
      function pick(i) {
        const p = v.nearby[i];
        $$(".pois button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.i === i));
        Object.entries(pm).forEach(([k, m]) => m.getElement()?.classList.toggle("is-active", +k === i));
        line && line.remove();
        line = L.polyline([[v.lat, v.lng], [p.lat, p.lng]], { color: "#3D1421", weight: 3, dashArray: "6 8", opacity: .8 }).addTo(map);
        map.fitBounds(line.getBounds(), { padding: [60, 60], maxZoom: 16 });
        pm[i].openTooltip();
      }
      $$(".pois button").forEach(b => b.addEventListener("click", () => pick(+b.dataset.i)));
      $("#map-reset")?.addEventListener("click", () => { line && line.remove(); $$(".pois button").forEach(b => b.setAttribute("aria-pressed", "false")); fit(map, pts, 50, 16); });
    });

    // Paylaş
    $("#share")?.addEventListener("click", async () => {
      const url = location.href.split("?")[0];
      try { await navigator.clipboard.writeText(url); toast("Bağlantı kopyalandı"); }
      catch { toast("Bağlantı: " + url); }
    });

    // Rezervasyon
    const bin = $("#b-in"), bout = $("#b-out"), bg = $("#b-g"), sum = $("#b-sum"), msg = $("#b-msg"), wb = $("#b-wa");
    if (q.get("giris")) bin.value = q.get("giris");
    if (q.get("cikis")) bout.value = q.get("cikis");
    if (q.get("misafir")) bg.value = Math.min(+q.get("misafir"), v.guests);
    linkDates(bin, bout, Math.max(v.minNights, 3));
    function calc() {
      const a = parse(bin.value), b = parse(bout.value);
      let err = ""; sum.innerHTML = ""; msg.innerHTML = "";
      $("#mb-p").textContent = fmt(v.price); $("#mb-s").textContent = "gecelik";
      if (a && b) {
        const n = nights(a, b);
        if (a < today()) err = "Giriş tarihi bugünden önce olamaz.";
        else if (n < 1) err = "Çıkış tarihi girişten sonra olmalı.";
        else if (n < v.minNights) err = `Bu villa en az ${v.minNights} gece kiralanıyor. ${v.minNights - n} gece daha ekleyin.`;
        else if (!isFree(v, a, b)) err = "Seçtiğiniz günlerin bir kısmı dolu. Takvimde boş görünen günleri seçin.";
        if (!err) {
          const tot = n * v.price + S.cleaningFee;
          sum.innerHTML = `<div><span>${fmt(v.price)} × ${n} gece</span><span>${fmt(n * v.price)}</span></div><div><span>Temizlik ücreti</span><span>${fmt(S.cleaningFee)}</span></div><div class="tot"><span>Toplam</span><span>${fmt(tot)}</span></div>`;
          msg.innerHTML = `<div class="msg ok">Seçtiğiniz tarihler müsait görünüyor.</div>`;
          $("#mb-p").textContent = fmt(tot); $("#mb-s").textContent = `${n} gece toplam`;
          wb.href = wa(`Merhaba, ${v.name} (${v.areaName}) için rezervasyon talebim var.\nGiriş: ${trDate(a)}\nÇıkış: ${trDate(b)} (${n} gece)\nMisafir: ${bg.value} kişi\nSitedeki toplam: ${fmt(tot)}\n${S.url}/${v.url}`);
          drawCal(); return;
        }
      }
      if (err) msg.innerHTML = `<div class="msg err">${err}</div>`;
      wb.href = wa(`Merhaba, ${v.name} (${v.areaName}) hakkında bilgi almak istiyorum.\n${S.url}/${v.url}`);
      drawCal();
    }
    [bin, bout, bg].forEach(el => el.addEventListener("change", calc));

    // Takvim
    const first = parse(bin.value) && parse(bin.value) > today() ? parse(bin.value) : today();
    let cs = new Date(first.getFullYear(), first.getMonth(), 1);
    const minM = new Date(today().getFullYear(), today().getMonth(), 1);
    function month(d0) {
      const y = d0.getFullYear(), m = d0.getMonth(), days = new Date(y, m + 1, 0).getDate(), lead = (new Date(y, m, 1).getDay() + 6) % 7;
      const a = parse(bin.value), b = parse(bout.value);
      let h = `<div class="cal"><h3>${d0.toLocaleDateString("tr-TR", { month: "long", year: "numeric" })}</h3><div class="cal-grid">${["Pt", "Sa", "Ça", "Pe", "Cu", "Ct", "Pz"].map(x => `<span class="dow">${x}</span>`).join("")}${"<span></span>".repeat(lead)}`;
      for (let i = 1; i <= days; i++) {
        const d = new Date(y, m, i), past = d < today(), busy = !past && isBusy(v, d);
        let c = "d" + (past ? " past" : busy ? " busy" : "");
        if ((a && +d === +a) || (b && +d === +b)) c += " sel"; else if (a && b && d > a && d < b) c += " in";
        h += past || busy ? `<span class="${c}" aria-label="${trDate(d)}${busy ? ", dolu" : ""}">${i}</span>` : `<button type="button" class="${c}" data-d="${iso(d)}" aria-label="${trDate(d)}">${i}</button>`;
      }
      return h + "</div></div>";
    }
    function drawCal() { $("#cal").innerHTML = month(cs) + month(new Date(cs.getFullYear(), cs.getMonth() + 1, 1)); $("#cp").disabled = cs <= minM; }
    $("#cp").addEventListener("click", () => { cs = new Date(cs.getFullYear(), cs.getMonth() - 1, 1); drawCal(); });
    $("#cn").addEventListener("click", () => { cs = new Date(cs.getFullYear(), cs.getMonth() + 1, 1); drawCal(); });
    $("#cal").addEventListener("click", e => {
      const btn = e.target.closest("button[data-d]"); if (!btn) return;
      const d = btn.dataset.d;
      if (!bin.value || bout.value || parse(d) <= parse(bin.value)) { bin.value = d; bout.value = ""; } else bout.value = d;
      calc();
    });
    calc();

    // Işık kutusu
    const imgs = $$(".gallery button").map(b => ({ src: b.dataset.full, alt: $("img", b).alt }));
    const lb = document.createElement("div");
    lb.className = "lightbox"; lb.setAttribute("role", "dialog"); lb.setAttribute("aria-modal", "true"); lb.setAttribute("aria-label", "Fotoğraflar");
    lb.innerHTML = `<img alt=""><button class="lb-x" aria-label="Kapat">${ico("x")}</button><button class="lb-p" aria-label="Önceki">${ico("left")}</button><button class="lb-n" aria-label="Sonraki">${ico("right")}</button><span class="lb-c"></span>`;
    body.append(lb);
    let cur = 0, back = null;
    const show = i => { cur = (i + imgs.length) % imgs.length; $("img", lb).src = imgs[cur].src; $("img", lb).alt = imgs[cur].alt; $(".lb-c", lb).textContent = `${cur + 1} / ${imgs.length}`; };
    const close = () => { lb.classList.remove("open"); back && back.focus(); };
    $$(".gallery button").forEach((b, i) => b.addEventListener("click", () => { back = b; show(i); lb.classList.add("open"); $(".lb-x", lb).focus(); }));
    $(".lb-x", lb).addEventListener("click", close);
    $(".lb-p", lb).addEventListener("click", () => show(cur - 1));
    $(".lb-n", lb).addEventListener("click", () => show(cur + 1));
    lb.addEventListener("click", e => { if (e.target === lb) close(); });
    document.addEventListener("keydown", e => { if (!lb.classList.contains("open")) return; if (e.key === "Escape") close(); if (e.key === "ArrowLeft") show(cur - 1); if (e.key === "ArrowRight") show(cur + 1); });
  }

  /* =========================================================
     İLETİŞİM
     ========================================================= */
  const cf = $("#contact-form");
  if (cf) {
    const cmap = $("#contact-map");
    cmap && whenVisible(cmap, () => {
      const map = baseMap(cmap); if (!map) return;
      L.marker([S.address.lat, S.address.lng], { icon: L.divIcon({ className: "pm", html: `<span>${S.brand} ofis</span>`, iconSize: [0, 0] }) }).addTo(map);
      map.setView([S.address.lat, S.address.lng], 16);
    });
    cf.addEventListener("submit", e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(cf)), m = $("#contact-msg");
      if (!d.ad || !d.telefon || !d.mesaj) { m.innerHTML = `<div class="msg err">Ad, telefon ve mesaj alanlarını doldurun.</div>`; return; }
      if (!$("#kvkk").checked) { m.innerHTML = `<div class="msg err">Göndermeden önce aydınlatma metnini onaylayın.</div>`; return; }
      const text = `Merhaba, ben ${d.ad}.\nTelefon: ${d.telefon}${d.eposta ? "\nE-posta: " + d.eposta : ""}\nKonu: ${d.konu}\n\n${d.mesaj}`;
      m.innerHTML = `<div class="msg ok">Mesajınız hazır. WhatsApp'ta açıp göndere basın.</div><a class="btn btn-wa btn-block" style="margin-top:10px" href="${wa(text)}" target="_blank" rel="noopener">${ico("chat")} Mesajı WhatsApp'ta aç</a>`;
    });
  }

  syncFav();
})();
