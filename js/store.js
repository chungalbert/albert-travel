window.TravelStore = (function () {
  const LOCAL_URL = "data/trips.json";
  const LIVE_URL = "https://crudcrud.com/api/12bf6277232149acb1dc874d7f198b15/trips";
  const CACHE_KEY = "albert-travel-v1";

  function cacheGet() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function cacheSet(trips) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(trips));
  }

  function normalize(trip) {
    const next = { ...trip, builtin: false };
    if (next._id) {
      next._crudId = next._id;
      delete next._id;
    }
    return next;
  }

  function payload(trip) {
    const next = { ...trip, updatedAt: Date.now() };
    delete next._id;
    delete next._crudId;
    delete next.builtin;
    return next;
  }

  function mergeTrips() {
    const byId = {};
    Array.from(arguments).flat().forEach((trip) => {
      if (!trip || !trip.id) return;
      const current = byId[trip.id];
      if (!current || (trip.updatedAt || 0) >= (current.updatedAt || 0)) {
        byId[trip.id] = normalize(trip);
      }
    });
    return Object.values(byId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function fetchJson(url, options, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms || 6000);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  async function pullPublished() {
    const response = await fetchJson(LOCAL_URL, { headers: { Accept: "application/json" } }, 5000);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data.map(normalize) : [];
  }

  async function pullLive() {
    const response = await fetchJson(LIVE_URL, { headers: { Accept: "application/json" } }, 6000);
    if (!response.ok) throw new Error("live pull failed");
    return (await response.json()).map(normalize);
  }

  async function load() {
    const published = await pullPublished().catch(() => []);
    let live = [];
    try {
      live = await pullLive();
    } catch {
      live = [];
    }
    const trips = mergeTrips(published, cacheGet(), live);
    cacheSet(trips);
    return trips;
  }

  async function save(trip) {
    const current = cacheGet();
    const existing = current.find((item) => item.id === trip.id);
    const crudId = (existing && existing._crudId) || trip._crudId;
    const body = JSON.stringify(payload(trip));
    let saved = { ...trip, builtin: false, updatedAt: Date.now() };

    try {
      if (crudId) {
        const response = await fetchJson(LIVE_URL + "/" + crudId, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: body
        });
        if (!response.ok) throw new Error("update failed");
        saved._crudId = crudId;
      } else {
        const response = await fetchJson(LIVE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: body
        });
        if (!response.ok) throw new Error("create failed");
        saved = normalize(await response.json());
      }
    } catch {
      saved = offlineSave(saved);
      return saved;
    }

    cacheSet(mergeTrips(current, [saved]));
    return saved;
  }

  async function remove(id) {
    const current = cacheGet();
    const existing = current.find((item) => item.id === id);
    if (existing && existing._crudId) {
      try {
        await fetchJson(LIVE_URL + "/" + existing._crudId, { method: "DELETE" }, 6000);
      } catch {
        /* still drop locally */
      }
    }
    cacheSet(current.filter((item) => item.id !== id));
  }

  function offlineSave(trip) {
    const saved = { ...trip, builtin: false, updatedAt: Date.now() };
    cacheSet(mergeTrips(cacheGet(), [saved]));
    return saved;
  }

  function offlineRemove(id) {
    cacheSet(cacheGet().filter((item) => item.id !== id));
  }

  return { load, save, remove, cacheGet, offlineSave, offlineRemove };
})();
