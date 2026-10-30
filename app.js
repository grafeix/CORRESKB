// Clé PRIM publique : toute personne consultant le site peut la lire.
const API_KEY = "eCtJyyDcHpoU5bchyXHKz7zFsMDIIO0U";
const BASE = "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia";

const CONFIG = {
  gdn: "stop_area:IDFM:71410",
  aulnay: "stop_area:IDFM:72646",
  cdg1: localStorage.getItem("cdg1_id") || "",
  departureHour: 8,
  departureMinute: 10,
  minimumConnection: 2,
  rerDirection: /Charles de Gaulle|CDG/i
};

let mode = "today";
let loading = false;

const $ = (selector) => document.querySelector(selector);
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minutes = (a, b) => Math.round((a - b) / 60000);

function parseNavitia(value) {
  if (!value || value.length < 15) return null;
  return new Date(
    Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)), Number(value.slice(9, 11)),
    Number(value.slice(11, 13)), Number(value.slice(13, 15))
  );
}

function formatNavitia(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
         `T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

async function api(path) {
  const response = await fetch(BASE + path, {
    headers: { apiKey: API_KEY, Accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`API PRIM : erreur ${response.status}`);
  return response.json();
}

function tripState(departure, arrival) {
  const now = new Date();
  if (arrival <= now) return { label: "✓ Réalisé", css: "state-done" };
  if (departure <= now) return { label: "En cours", css: "state-live" };
  return { label: "À venir", css: "state-next" };
}

async function fetchRer(aulnay, cdg1, arrival) {
  const data = await api(`/journeys?from=${encodeURIComponent(aulnay)}` +
    `&to=${encodeURIComponent(cdg1)}&datetime=${formatNavitia(arrival)}` +
    `&datetime_represents=departure&max_nb_transfers=0&count=10&data_freshness=realtime`);

  const output = [];
  const seen = new Set();
  for (const journey of data.journeys || []) {
    const sections = journey.sections.filter(section => section.type === "public_transport");
    if (sections.length !== 1 || sections[0].display_informations?.code !== "B") continue;
    const section = sections[0];
    const departure = parseNavitia(section.departure_date_time);
    const end = parseNavitia(section.arrival_date_time);
    if (!departure || !end || seen.has(+departure)) continue;
    seen.add(+departure);
    output.push({
      time: departure,
      end,
      delay: minutes(departure, parseNavitia(section.base_departure_date_time) || departure),
      endDelay: minutes(end, parseNavitia(section.base_arrival_date_time) || end),
      margin: minutes(departure, arrival)
    });
  }
  return output.sort((a, b) => a.time - b.time).slice(0, 2);
}

async function discoverCdg1(aulnay, arrival) {
  const data = await api(`/stop_areas/${encodeURIComponent(aulnay)}/departures` +
    `?from_datetime=${formatNavitia(arrival)}&count=40&data_freshness=realtime`);
  const departure = (data.departures || []).find(item =>
    item.display_informations?.code === "B" &&
    CONFIG.rerDirection.test(item.display_informations.direction || "")
  );
  const link = departure?.links?.find(item => item.type === "vehicle_journey");
  if (!link) return null;
  const vehicle = await api(`/vehicle_journeys/${encodeURIComponent(link.id)}`);
  const stopTimes = vehicle.vehicle_journeys?.[0]?.stop_times || [];
  const hit = stopTimes.find(item => /Gaulle ?1|CDG ?1/i.test(item.stop_point?.name || ""));
  return hit?.stop_point?.stop_area?.id || null;
}

async function fallbackDepartures(aulnay, arrival) {
  const data = await api(`/stop_areas/${encodeURIComponent(aulnay)}/departures` +
    `?from_datetime=${formatNavitia(arrival)}&count=40&data_freshness=realtime`);
  return (data.departures || [])
    .filter(item => item.display_informations?.code === "B" &&
      CONFIG.rerDirection.test(item.display_informations.direction || ""))
    .map(item => {
      const time = parseNavitia(item.stop_date_time.departure_date_time);
      const base = parseNavitia(item.stop_date_time.base_departure_date_time) || time;
      return { time, end: null, delay: minutes(time, base), endDelay: 0, margin: minutes(time, arrival) };
    })
    .filter(item => item.time)
    .sort((a, b) => a.time - b.time)
    .slice(0, 2);
}

async function getData() {
  const target = new Date();
  target.setHours(CONFIG.departureHour, CONFIG.departureMinute, 0, 0);
  if (mode === "tomorrow") target.setDate(target.getDate() + 1);

  const data = await api(`/journeys?from=${encodeURIComponent(CONFIG.gdn)}` +
    `&to=${encodeURIComponent(CONFIG.aulnay)}&datetime=${formatNavitia(target)}` +
    `&datetime_represents=departure&count=10&data_freshness=realtime`);

  let selected = null;
  const baseDeparture = candidate =>
    parseNavitia(candidate.section.base_departure_date_time || candidate.section.departure_date_time);

  for (const journey of data.journeys || []) {
    const sections = journey.sections.filter(section => section.type === "public_transport");
    if (sections.length !== 1 || sections[0].display_informations?.code !== "K") continue;
    const candidate = { section: sections[0], journey };
    if (!selected || Math.abs(baseDeparture(candidate) - target) < Math.abs(baseDeparture(selected) - target)) {
      selected = candidate;
    }
  }

  if (!selected) return { k: null, rer: [] };

  const dep = parseNavitia(selected.section.departure_date_time);
  const arr = parseNavitia(selected.section.arrival_date_time);
  const baseArr = parseNavitia(selected.section.base_arrival_date_time) || arr;
  const k = {
    dep, arr,
    delay: minutes(arr, baseArr),
    cancelled: selected.journey.status === "NO_SERVICE",
    tomorrow: mode === "tomorrow"
  };

  let cdg1 = CONFIG.cdg1;
  let rer = cdg1 ? await fetchRer(CONFIG.aulnay, cdg1, arr) : [];
  if (!rer.length) {
    const discovered = await discoverCdg1(CONFIG.aulnay, arr);
    if (discovered) {
      cdg1 = discovered;
      rer = await fetchRer(CONFIG.aulnay, cdg1, arr);
      if (rer.length) {
        CONFIG.cdg1 = cdg1;
        localStorage.setItem("cdg1_id", cdg1);
      }
    }
  }
  if (!rer.length) rer = await fallbackDepartures(CONFIG.aulnay, arr);
  return { k, rer };
}

function renderTrain(train, index, k) {
  if (!train) {
    return `<article class="train-card"><div class="train-label">${index === 0 ? "1er" : "2e"} train</div>` +
      `<div class="train-time-row"><span class="train-time">—</span></div>` +
      `<div class="connection">Aucun départ trouvé</div></article>`;
  }
  const finalArrival = train.end || new Date(train.time.getTime() + 25 * 60000);
  const state = tripState(train.time, finalArrival);
  const connectionOk = !k.cancelled && train.margin >= CONFIG.minimumConnection;
  const delay = train.delay > 0 ? `<span class="train-delay">+${train.delay} min</span>` : "";
  const endDelay = train.end && train.endDelay > 0 ? ` (+${train.endDelay} min)` : "";
  return `<article class="train-card">
    <div class="train-label">${index === 0 ? "1er" : "2e"} train</div>
    <div class="train-time-row"><span class="train-time">${hhmm(train.time)}</span>${delay}</div>
    <div class="arrival">CDG 1 <span class="arrow">→</span> ${train.end ? hhmm(train.end) : "—"}${endDelay}</div>
    <div class="connection"><span class="dot ${connectionOk ? "" : "ko"}"></span>Corr. ${train.margin} min · <span class="${state.css}">${state.label}</span></div>
  </article>`;
}

function render(data) {
  $("#updated").textContent = `MàJ ${hhmm(new Date())}`;
  $("#message").hidden = true;

  if (!data.k) {
    $("#kTimes").innerHTML = `<span class="status-ko">Aucune K trouvée</span>`;
    $("#kDetail").textContent = "Aucun trajet direct de la ligne K n’a été retourné.";
    $("#trains").innerHTML = renderTrain(null, 0, { cancelled: false }) + renderTrain(null, 1, { cancelled: false });
    return;
  }

  const k = data.k;
  const delay = !k.cancelled && k.delay > 0 ? `<span class="delay">+${k.delay} min</span>` : "";
  $("#kTimes").innerHTML = `<span>${hhmm(k.dep)}</span><span class="k-arrow">→</span><span>${hhmm(k.arr)}</span>${delay}`;

  const state = tripState(k.dep, k.arr);
  let punctuality = k.cancelled
    ? `<span class="status-ko">Supprimé</span>`
    : k.delay <= 0 ? `<span class="status-ok">À l’heure</span>` : `<span class="delay">Retard ${k.delay} min</span>`;
  $("#kDetail").innerHTML = `${k.tomorrow ? "Demain · " : ""}Gare du Nord → Aulnay-sous-Bois · ${punctuality} · <span class="${state.css}">${state.label}</span>`;
  $("#trains").innerHTML = renderTrain(data.rer[0], 0, k) + renderTrain(data.rer[1], 1, k);
}

function renderError(error) {
  $("#message").hidden = false;
  $("#message").innerHTML = `<strong>Impossible de charger les horaires.</strong><br>${escapeHtml(error.message || error)}`;
  $("#kTimes").innerHTML = `<span class="status-ko">Erreur API</span>`;
  $("#kDetail").textContent = "Vérifie la clé PRIM, la connexion et la console du navigateur.";
  $("#trains").innerHTML = renderTrain(null, 0, { cancelled: false }) + renderTrain(null, 1, { cancelled: false });
  console.error(error);
}

async function load() {
  if (loading) return;
  loading = true;
  $("#refreshButton").disabled = true;
  try {
    render(await getData());
  } catch (error) {
    renderError(error);
  } finally {
    loading = false;
    $("#refreshButton").disabled = false;
  }
}

$("#refreshButton").addEventListener("click", load);
document.querySelectorAll(".day-button").forEach(button => {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    document.querySelectorAll(".day-button").forEach(item => item.classList.toggle("active", item === button));
    load();
  });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") load();
});

load();
setInterval(load, 2 * 60 * 1000);
