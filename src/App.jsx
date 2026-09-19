import React, { useState, useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import {
  Siren, HeartPulse, Building2, MapPin, Navigation2, Phone, Clock,
  Plus, Minus, AlertTriangle, CheckCircle2, Users, Zap, Droplet,
  Baby, Flame, Activity, ChevronDown, Wind, Mic,
  Ambulance as AmbulanceIcon, Landmark, ClipboardList, Brain, ShieldAlert,
  Sun, Moon,
} from "lucide-react";


// ---------------------------------------------------------------------------
// Design tokens — signal colors stay constant across themes (they need to
// read the same way on a hospital dashboard whether it's day or night shift).
// Surface/background/text tokens are theme-dependent, see THEME below.
// ---------------------------------------------------------------------------
const C = {
  ink: "#0F1721", inkRaised: "#182231", inkLine: "#28374A",
  paper: "#F7F5F0", paperRaised: "#FFFFFF", paperLine: "#E4DFD3",
  slate: "#6B7A89", red: "#E4572E", amber: "#F2A93B", green: "#3FA796",
};

const THEME = {
  light: {
    bg: "#F7F5F0", surface: "#FFFFFF", border: "#E4DFD3", text: "#1B2430",
    muted: "#6B7A89", pill: "#EDEAE0", pillHover: "#F1EEE4",
    accentBg: "#0F1721", accentText: "#F7F5F0",
  },
  dark: {
    bg: "#0B0F14", surface: "#141B22", border: "#28323C", text: "#E7EAEE",
    muted: "#8A97A6", pill: "#1C242D", pillHover: "#232D38",
    accentBg: "#F2EFE7", accentText: "#0F1721",
  },
};
function cssVars(mode) {
  const t = THEME[mode];
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [`--${k}`, v]));
}

const RESOURCES = [
  { key: "icu", label: "ICU Bed", icon: HeartPulse },
  { key: "bloodNeg", label: "O− Blood", icon: Droplet },
  { key: "ventilator", label: "Ventilator", icon: Wind },
  { key: "trauma", label: "Trauma Bay", icon: Activity },
  { key: "burn", label: "Burn Unit", icon: Flame },
  { key: "incubator", label: "Infant Incubator", icon: Baby },
];

const CRISIS_TYPES = ["Cardiac", "Trauma", "Respiratory", "Burn", "Obstetric", "Neurological", "Mass Casualty", "General"];
const CRISIS_RESOURCE = {
  Cardiac: "icu", Trauma: "trauma", Respiratory: "ventilator", Burn: "burn",
  Obstetric: "incubator", Neurological: "icu", "Mass Casualty": "trauma", General: "icu",
};
const CRISIS_ICON = {
  Cardiac: HeartPulse, Trauma: Activity, Respiratory: Wind, Burn: Flame,
  Obstetric: Baby, Neurological: Brain, "Mass Casualty": ShieldAlert, General: ClipboardList,
};

const HOSPITALS_INIT = [
  {
    id: "h1", name: "Vantage Trauma Center", distanceKm: 3.1, baseEta: 9, lat: 12.9716, lng: 77.5946,
    stock: { icu: 2, bloodNeg: 4, ventilator: 1, trauma: 3, burn: 0, incubator: 1 },
    freshness: { icu: 2, bloodNeg: 6, ventilator: 2, trauma: 1, burn: 40, incubator: 9 },
    capability: { Cardiac: 70, Trauma: 92, Respiratory: 65, Burn: 40, Obstetric: 50, Neurological: 60, "Mass Casualty": 88, General: 70 },
    currentCrisisType: "Trauma", crisisModeLocal: false
  },
  {
    id: "h2", name: "Sunrise Multispecialty", distanceKm: 5.6, baseEta: 14, lat: 12.9352, lng: 77.6245,
    stock: { icu: 0, bloodNeg: 1, ventilator: 0, trauma: 1, burn: 2, incubator: 0 },
    freshness: { icu: 33, bloodNeg: 12, ventilator: 51, trauma: 4, burn: 3, incubator: 22 },
    capability: { Cardiac: 55, Trauma: 45, Respiratory: 60, Burn: 75, Obstetric: 65, Neurological: 50, "Mass Casualty": 40, General: 60 },
    currentCrisisType: "Burn", crisisModeLocal: false
  },
  {
    id: "h3", name: "Ashirwad General Hospital", distanceKm: 2.2, baseEta: 6, lat: 12.9915, lng: 77.5942,
    stock: { icu: 5, bloodNeg: 0, ventilator: 3, trauma: 2, burn: 1, incubator: 2 },
    freshness: { icu: 1, bloodNeg: 58, ventilator: 5, trauma: 1, burn: 15, incubator: 2 },
    capability: { Cardiac: 85, Trauma: 60, Respiratory: 80, Burn: 45, Obstetric: 70, Neurological: 75, "Mass Casualty": 55, General: 80 },
    currentCrisisType: "General", crisisModeLocal: false
  },
  {
    id: "h4", name: "Green Valley Medical", distanceKm: 8.9, baseEta: 21, lat: 13.0104, lng: 77.5806,
    stock: { icu: 3, bloodNeg: 2, ventilator: 2, trauma: 0, burn: 0, incubator: 3 },
    freshness: { icu: 7, bloodNeg: 3, ventilator: 19, trauma: 60, burn: 60, incubator: 4 },
    capability: { Cardiac: 60, Trauma: 40, Respiratory: 55, Burn: 35, Obstetric: 88, Neurological: 55, "Mass Casualty": 45, General: 65 },
    currentCrisisType: "Obstetric", crisisModeLocal: false
  },
  {
    id: "h5", name: "Kaveri District Hospital", distanceKm: 4.4, baseEta: 11, lat: 12.9279, lng: 77.6271,
    stock: { icu: 1, bloodNeg: 0, ventilator: 1, trauma: 2, burn: 3, incubator: 0 },
    freshness: { icu: 4, bloodNeg: 45, ventilator: 8, trauma: 2, burn: 6, incubator: 30 },
    capability: { Cardiac: 50, Trauma: 65, Respiratory: 60, Burn: 80, Obstetric: 55, Neurological: 45, "Mass Casualty": 60, General: 60 },
    currentCrisisType: "Burn", crisisModeLocal: false
  },
];

// ---------------------------------------------------------------------------
// Simulated AI triage layer — in production this call goes to the OpenAI/
// Gemini API (see backend/server.js: POST /api/triage). Kept local here so
// the prototype runs with no network access.
// ---------------------------------------------------------------------------
const KEYWORDS = [
  { phrase: "not breathing", weight: 40, type: "Respiratory" },
  { phrase: "no pulse", weight: 40, type: "Cardiac" },
  { phrase: "unconscious", weight: 35, type: "Neurological" },
  { phrase: "chest pain", weight: 35, type: "Cardiac" },
  { phrase: "severe bleeding", weight: 35, type: "Trauma" },
  { phrase: "heavy bleeding", weight: 35, type: "Trauma" },
  { phrase: "stroke", weight: 35, type: "Neurological" },
  { phrase: "seizure", weight: 30, type: "Neurological" },
  { phrase: "choking", weight: 35, type: "Respiratory" },
  { phrase: "burn", weight: 25, type: "Burn" },
  { phrase: "fracture", weight: 20, type: "Trauma" },
  { phrase: "broken bone", weight: 20, type: "Trauma" },
  { phrase: "difficulty breathing", weight: 25, type: "Respiratory" },
  { phrase: "labor", weight: 22, type: "Obstetric" },
  { phrase: "pregnant", weight: 15, type: "Obstetric" },
  { phrase: "allergic reaction", weight: 22, type: "Respiratory" },
  { phrase: "high fever", weight: 12, type: "General" },
  { phrase: "vomiting", weight: 10, type: "General" },
  { phrase: "headache", weight: 6, type: "Neurological" },
  { phrase: "sprain", weight: 6, type: "Trauma" },
  { phrase: "rash", weight: 5, type: "General" },
  { phrase: "cough", weight: 5, type: "Respiratory" },
];

const FIRST_AID = {
  Cardiac: ["Keep the person calm and seated upright", "Loosen tight clothing", "Be ready to start CPR if they stop responding", "Do not give food or water"],
  Trauma: ["Apply firm, direct pressure to any bleeding wound", "Do not remove embedded objects", "Keep the person still", "Elevate the injured area if possible"],
  Respiratory: ["Help them into an upright, comfortable position", "Loosen clothing around the neck and chest", "If choking, use back blows/abdominal thrusts if trained", "Stay with them until help arrives"],
  Burn: ["Cool the burn under running water for 20 minutes", "Do not apply ice, butter, or ointments", "Cover loosely with a clean, non-stick cloth", "Remove nearby jewelry before swelling starts"],
  Obstetric: ["Help them lie on their left side if possible", "Time contractions if in labor", "Do not attempt to delay delivery", "Keep them warm and calm"],
  Neurological: ["Clear the area of anything that could cause injury", "Do not restrain a seizing person", "Turn them on their side once it ends", "Note when the episode started"],
  "Mass Casualty": ["Prioritize the most severe, treatable injuries first", "Keep patients grouped by severity if possible", "Do not move spinal injuries unless necessary", "Await responder triage tags"],
  General: ["Keep the person comfortable and hydrated if conscious", "Monitor for worsening symptoms", "Note when symptoms started for the hospital team"],
};

const SPECIALIST_BY_TYPE = {
  Cardiac: ["Cardiologist"], Trauma: ["Trauma Surgeon"], Respiratory: ["Pulmonologist"],
  Burn: ["Burn Specialist"], Obstetric: ["Obstetrician"], Neurological: ["Neurologist"],
  "Mass Casualty": ["Emergency Medicine Physician"], General: ["General Physician"],
};

const SAMPLE_TRANSCRIPTS = [
  "My father is clutching his chest and says he has severe chest pain and is sweating a lot.",
  "My son fell off his bike, there's severe bleeding from his leg and a possible fracture.",
  "My grandmother has a high fever and has been vomiting since morning, feels weak.",
  "There was a kitchen fire, my neighbour has a burn on his arm, he is conscious and talking.",
];

function analyzeSeverity(text) {
  const t = text.toLowerCase();
  let score = 0;
  const typesSet = new Set();
  const matched = [];
  KEYWORDS.forEach((k) => {
    if (t.includes(k.phrase)) {
      matched.push(k.phrase);
      score += k.weight;
      typesSet.add(k.type);
    }
  });
  if (typesSet.size === 0) typesSet.add("General");
  score = Math.min(100, score);
  const types = Array.from(typesSet);
  const category = score >= 70 ? "Critical" : score >= 35 ? "Urgent" : "Stable";
  const ambulance = score >= 55; // single cutoff integer that gates ambulance dispatch
  return {
    score, category, types, matched, ambulance,
    resources: [RESOURCES.find((r) => r.key === CRISIS_RESOURCE[types[0]])?.label].filter(Boolean),
    specialists: SPECIALIST_BY_TYPE[types[0]],
    firstAid: FIRST_AID[types[0]],
  };
}

const CATEGORY_COLOR = { Critical: C.red, Urgent: C.amber, Stable: C.green };

function getMinutesAgo(val) {
  if (val < 1000000) return Math.floor(val); // Legacy format (minutes)
  return Math.floor((Date.now() - val) / 60000);
}
function freshnessColor(val) {
  const m = getMinutesAgo(val);
  return m <= 5 ? C.green : m <= 20 ? C.amber : C.red;
}
function freshnessLabel(val) {
  const m = getMinutesAgo(val);
  return m < 1 ? "just now" : m === 1 ? "1 min ago" : `${m} min ago`;
}

// hospital-ranking formula — mirrors backend/server.js rankHospitals()
function rankHospitals(hospitals, types, neededResources = []) {
  if (!Array.isArray(types)) types = [types || "General"];
  
  let neededKeys = (neededResources || []).map(label => {
    const found = RESOURCES.find(r => r.label === label);
    return found ? found.key : null;
  }).filter(Boolean);

  if (neededKeys.length === 0) {
    neededKeys = [CRISIS_RESOURCE[types[0]] || "icu"];
  }

  const resourceKey = neededKeys[0] || "icu";

  return hospitals.map((h) => {
    const count = h.stock[resourceKey] || 0;
    const eta = h.baseEta || 0;
    
    // Hospital gets proportional points for each requested resource they have in stock
    const matchedCount = neededKeys.filter(key => (h.stock[key] || 0) > 0).length;
    const resourceScore = neededKeys.length > 0 ? Math.round((matchedCount / neededKeys.length) * 100) : 0;

    let capScore = 50;
    let specialtyMatch = false;
    if (h.specialties && h.specialties.length > 0) {
      const matched = types.filter(t => h.specialties.includes(t)).length;
      capScore = Math.round((matched / types.length) * 100);
      if (matched === types.length) specialtyMatch = "full";
      else if (matched > 0) specialtyMatch = "partial";
    } else {
      const sum = types.reduce((acc, t) => acc + (h.capability?.[t] ?? 50), 0);
      capScore = Math.round(sum / types.length);
    }

    const total = Math.round(
      (0.5 * resourceScore) +
      (0.3 * capScore) -
      (1.5 * (h.distanceKm || 0))
    );
    return { ...h, resourceKey, count, eta, resourceScore, capScore, total, specialtyMatch };
  }).sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------

// Point this at wherever backend_server.js is actually running. Left as
// localhost:4000 to match `node backend_server.js`'s default PORT.
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
export default function App() {
  const [mode, setMode] = useState("patient");
  const [hospitals, setHospitals] = useState(HOSPITALS_INIT);
  const [requests, setRequests] = useState([]);
  const [globalCrisis, setGlobalCrisis] = useState(false);
  const [dark, setDark] = useState(false);
  const [backendOnline, setBackendOnline] = useState(null); // null = still checking
  const theme = dark ? "dark" : "light";

  const [userLocation, setUserLocation] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [authHospitalId, setAuthHospitalId] = useState(null);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => console.warn("Geolocation error, using default location", err)
      );
    }
  }, []);

  useEffect(() => {
    if (!userLocation) return;
    const fetchHospitalsAndRoutes = async () => {
      setScanning(true);
      let baseHospitals = [];

      // 1. Try to fetch existing hospitals from backend
      if (backendOnline) {
        let retries = 5;
        while (retries > 0) {
          try {
            const res = await fetch(`${API_BASE}/api/hospitals`);
            if (res.status === 503) {
              await new Promise(r => setTimeout(r, 500));
              retries--;
              continue;
            }
            if (res.ok) {
              const data = await res.json();
              if (data && data.length > 0) {
                baseHospitals = data;
              }
            }
            break;
          } catch (e) {
            console.warn("Failed to check backend for existing hospitals", e);
            break;
          }
        }
      }

      // 2. ALWAYS scan Nominatim for nearest 6 hospitals
      let newHospitalsToSync = [];
      try {
        const viewbox = `${userLocation.lng - 0.05},${userLocation.lat + 0.05},${userLocation.lng + 0.05},${userLocation.lat - 0.05}`;
        const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&amenity=hospital&viewbox=${viewbox}&bounded=1&limit=6`;
        const res = await fetch(nominatimUrl);
        const data = await res.json();

        if (data && data.length > 0) {
          data.forEach((el, i) => {
            // place_id is unstable and changes on OSM DB rebuilds.
            // osm_type + osm_id is the globally stable OpenStreetMap identifier.
            const hid = `osm_${el.osm_type}_${el.osm_id}`;
            if (!baseHospitals.some(h => h.id === hid)) {
              const newHosp = {
                id: hid,
                name: el.name || `Local Hospital ${i + 1}`,
                lat: parseFloat(el.lat),
                lng: parseFloat(el.lon),
                stock: {
                  icu: 0,
                  oxygen: 0,
                  bloodNeg: 0,
                  ventilator: 0,
                  trauma: 0,
                  burn: 0,
                  incubator: 0
                },
                capability: { Cardiac: 0, Trauma: 0, Respiratory: 0, Burn: 0, Obstetric: 0, Neurological: 0, "Mass Casualty": 0, General: 0 },
                freshness: { icu: Date.now(), oxygen: Date.now(), bloodNeg: Date.now(), ventilator: Date.now(), trauma: Date.now(), burn: Date.now(), incubator: Date.now() },
                
                specialties: [],
              };
              baseHospitals.push(newHosp);
              newHospitalsToSync.push(newHosp);
            }
          });
        }
      } catch (e) {
        console.warn("Nominatim API failed", e);
      }

      if (baseHospitals.length === 0) {
        baseHospitals = HOSPITALS_INIT; // Fallback
      }

      // 3. Fetch OSRM routes to update ETA and distance
      let updatedHospitals = [...baseHospitals];
      for (let i = 0; i < updatedHospitals.length; i++) {
        let h = updatedHospitals[i];
        if (h.lat && h.lng) {
          try {
            const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${userLocation.lng},${userLocation.lat};${h.lng},${h.lat}?overview=false`);
            const data = await res.json();
            if (data.routes && data.routes.length > 0) {
              const route = data.routes[0];
              h.distanceKm = Number((route.distance / 1000).toFixed(1));
              h.baseEta = Math.round(route.duration / 60);
            }
          } catch (e) {
            console.error("OSRM fetch error", e);
          }
        }
      }
      setHospitals(updatedHospitals);

      // 4. Upload newly discovered hospitals to the backend database
      if (newHospitalsToSync.length > 0 && backendOnline) {
        try {
          await fetch(`${API_BASE}/api/hospitals/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newHospitalsToSync)
          });
        } catch (e) {
          console.warn("Failed to sync hospitals to backend", e);
        }
      }
      setScanning(false);
    };
    fetchHospitalsAndRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation, backendOnline]);

  const handleGetDirections = (h) => {
    if (userLocation && h.lat && h.lng) {
      const url = `/directions?uLat=${userLocation.lat}&uLng=${userLocation.lng}&hLat=${h.lat}&hLng=${h.lng}&name=${encodeURIComponent(h.name)}`;
      window.open(url, "_blank");
    } else {
      alert("Location data is missing. Please ensure location services are enabled.");
    }
  };

  const [, setTick] = useState(0);
  useEffect(() => {
    // Force a re-render every minute so timestamp differences update accurately
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // On load: ping the backend, and if it's up, load dispatch requests.
  // We do NOT setHospitals here because the location effect below will fetch
  // them and compute OSRM driving routes before calling setHospitals.
  useEffect(() => {
    (async () => {
      try {
        const ping = await fetch(`${API_BASE}/api/health`);
        if (!ping.ok) throw new Error();
        setBackendOnline(true);
        const rRes = await fetch(`${API_BASE}/api/dispatch`);
        if (rRes.ok) setRequests(await rRes.json());
      } catch {
        setBackendOnline(false); // backend not running - the app still works on local mock data
      }
    })();
  }, []);

  // Every handler below updates local state immediately (so the UI never
  // waits on a network round trip), then best-effort mirrors the change to
  // the backend if it's reachable. If the backend call fails, the local
  // state is already correct, so the app keeps working either way.

  async function adjustStock(hospitalId, key, delta) {
    setHospitals((prev) => prev.map((h) => h.id === hospitalId ? {
      ...h,
      stock: { ...h.stock, [key]: Math.max(0, h.stock[key] + delta) },
      freshness: { ...h.freshness, [key]: 0 },
    } : h));
    try {
      await fetch(`${API_BASE}/api/hospitals/${hospitalId}/inventory`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, delta }),
      });
    } catch { /* offline — local state already applied */ }
  }

  function toggleHospitalSpecialty(hospitalId, type) {
    setHospitals((prev) => {
      const targetHospital = prev.find(h => h.id === hospitalId);
      if (!targetHospital) return prev;

      const current = targetHospital.specialties || [];
      const updatedSpecialties = current.includes(type) ? current.filter(t => t !== type) : [...current, type];

      if (backendOnline) {
        fetch(`${API_BASE}/api/hospitals/${hospitalId}/specialties`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ specialties: updatedSpecialties }),
        }).catch(() => { });
      }

      return prev.map((h) => h.id === hospitalId ? { ...h, specialties: updatedSpecialties } : h);
    });
  }

  // Returns the created request (with its real id) so callers — like the
  // Patient tab's tracking card — know exactly which request to watch.
  async function createRequest(req) {
    try {
      const res = await fetch(`${API_BASE}/api/dispatch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setRequests((prev) => [created, ...prev]);
      return created;
    } catch {
      // offline fallback — assign a local id the same way the old code did
      const created = { ...req, id: `local-${Date.now()}`, status: "dispatched", createdAt: Date.now() };
      setRequests((prev) => [created, ...prev]);
      return created;
    }
  }

  async function advanceRequest(id) {
    const order = ["dispatched", "en_route", "arrived", "handed_off"];
    try {
      const res = await fetch(`${API_BASE}/api/dispatch/${id}/advance`, { method: "PATCH" });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch {
      setRequests((prev) => prev.map((r) => {
        if (r.id !== id) return r;
        const i = order.indexOf(r.status);
        return i < order.length - 1 ? { ...r, status: order[i + 1] } : r;
      }));
    }
  }

  function updateRequestCrisisType(id, type) {
    // No dedicated backend endpoint for this yet — stays local for now.
    setRequests((prev) => prev.map((r) => r.id === id ? { ...r, confirmedType: type } : r));
  }

  const tabs = [
    { key: "patient", label: "Patient", icon: HeartPulse },
    { key: "hospital", label: "Hospital", icon: Building2 },
    { key: "ambulance", label: "Ambulance", icon: AmbulanceIcon },
    { key: "government", label: "Government", icon: Landmark },
  ];

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", ...cssVars(theme) }} className="w-full min-h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-200">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .font-display{font-family:'Space Grotesk',sans-serif;} .font-mono{font-family:'IBM Plex Mono',monospace;}
        @keyframes pulseDot{0%,100%{opacity:1;}50%{opacity:.35;}} .pulse-dot{animation:pulseDot 1.6s ease-in-out infinite;}
        @keyframes crisisGlow{0%,100%{box-shadow:0 0 0 0 rgba(228,87,46,0);}50%{box-shadow:0 0 0 6px rgba(228,87,46,.12);}} .crisis-ring{animation:crisisGlow 2.2s ease-in-out infinite;}
        ::-webkit-scrollbar{height:6px;width:6px;} ::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px;}
      `}</style>

      <header className="sticky top-0 z-20 bg-[var(--bg)] border-b border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <img src={dark ? "/logo-dark.png" : "/logo-light.png"} alt="WardWatch shield mark" className="w-8 h-8 object-contain shrink-0" />
            <span className="font-display font-semibold text-lg tracking-tight">WardWatch</span>
            <span className="hidden sm:inline text-xs font-mono text-[var(--muted)] ml-1">every second matters</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-[var(--pill)] rounded-full p-1">
              {tabs.map((t) => {
                const Icon = t.icon;
                const active = mode === t.key;
                return (
                  <button key={t.key} onClick={() => setMode(t.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${!active ? "text-[var(--muted)]" : ""}`}
                    style={active ? { background: "var(--accentBg)", color: "var(--accentText)" } : {}}>
                    <Icon size={14} /><span className="hidden sm:inline">{t.label}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setDark((d) => !d)} title={dark ? "Switch to light mode" : "Switch to dark mode"}
              className="w-9 h-9 rounded-full bg-[var(--pill)] flex items-center justify-center text-[var(--text)] hover:bg-[var(--pillHover)] transition-colors shrink-0">
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
        {globalCrisis && (
          <div className="bg-[#E4572E] text-white">
            <div className="max-w-6xl mx-auto px-5 py-1.5 flex items-center gap-2 text-xs font-medium">
              <Siren size={13} className="pulse-dot" /> Mass Casualty Crisis Mode is active across the network.
            </div>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-5 py-6">
        {mode === "patient" && <PatientView hospitals={hospitals} requests={requests} createRequest={createRequest} backendOnline={backendOnline} onGetDirections={handleGetDirections} scanning={scanning} userLocation={userLocation} />}
        {mode === "hospital" && !authHospitalId && (
          <HospitalAuth hospitals={hospitals} onLogin={(id) => setAuthHospitalId(id)} />
        )}
        {mode === "hospital" && authHospitalId && (
          <HospitalView hospitals={hospitals} requests={requests} adjustStock={adjustStock}
            toggleHospitalSpecialty={toggleHospitalSpecialty} updateRequestCrisisType={updateRequestCrisisType}
            globalCrisis={globalCrisis} setGlobalCrisis={setGlobalCrisis} authHospitalId={authHospitalId}
            onLogout={() => setAuthHospitalId(null)} />
        )}
        {mode === "ambulance" && <AmbulanceView requests={requests} hospitals={hospitals} advanceRequest={advanceRequest} onGetDirections={handleGetDirections} />}
        {mode === "government" && <GovernmentView hospitals={hospitals} requests={requests} />}
      </main>

    </div>
  );
}

// ---------------------------------------------------------------------------
// PATIENT VIEW — voice/text intake -> AI severity -> ranked hospitals -> dispatch
// ---------------------------------------------------------------------------
function PatientView({ hospitals, requests, createRequest, backendOnline, onGetDirections, scanning, userLocation }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState(null);
  const recognitionRef = useRef(null);
  const speechSupported = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const [result, setResult] = useState(null);
  const [resultSource, setResultSource] = useState(null); // "backend" | "local"
  const [ranked, setRanked] = useState([]);
  const [rankSource, setRankSource] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [showFormula, setShowFormula] = useState(false);
  const [myRequestId, setMyRequestId] = useState(null);
  const [dispatching, setDispatching] = useState(false);

  const myRequest = requests.find((r) => r.id === myRequestId);

  function startVoice() {
    setVoiceError(null);

    // No real speech recognition in this browser (e.g. Firefox, or non-HTTPS
    // context) — fall back to the scripted demo transcript so the flow still
    // works for a live demo.
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setListening(true);
      setTimeout(() => {
        setText(SAMPLE_TRANSCRIPTS[Math.floor(Math.random() * SAMPLE_TRANSCRIPTS.length)]);
        setListening(false);
      }, 1400);
      return;
    }

    // If already listening, treat a second click as "stop."
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "en-IN";
    recognition.interimResults = true; // show words as they're recognized, not just at the end
    recognition.continuous = false;    // stop automatically after one pause in speech

    recognition.onstart = () => setListening(true);

    recognition.onresult = (e) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      setText(transcript);
    };

    recognition.onerror = (e) => {
      // "not-allowed" = mic permission denied, "no-speech" = silence timeout, etc.
      setVoiceError(
        e.error === "not-allowed" ? "Microphone permission was denied — allow mic access in your browser and try again."
          : e.error === "no-speech" ? "Didn't catch any speech — try again."
            : `Voice recognition error: ${e.error}`
      );
    };

    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
  }

  // Stop any in-progress recognition if the component unmounts mid-listen.
  useEffect(() => () => recognitionRef.current?.stop(), []);

  async function analyze() {
    if (!text.trim()) return;
    setAnalyzing(true);
    setMyRequestId(null);

    // 1. Severity scoring — try the backend's /api/triage first.
    let severity;
    try {
      const res = await fetch(`${API_BASE}/api/triage`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error();
      severity = await res.json();
      // The backend itself reports "gemini" or "keyword-fallback" in its
      // response — surface that distinction rather than just "reached the backend."
      setResultSource(severity.source === "gemini" ? "gemini" : "backend-fallback");
    } catch {
      severity = analyzeSeverity(text); // local fallback, identical formula
      setResultSource("local");
    }
    setResult(severity);

    // 2. Hospital ranking — try the backend's /api/hospitals/rank, which
    // ranks *its own* copy of the hospital data, not this tab's local state.
    try {
      const res = await fetch(`${API_BASE}/api/hospitals/rank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hospitals,
          types: severity.types,
          resources: severity.resources || []
        })
      });
      if (!res.ok) throw new Error();
      setRanked(await res.json());
      setRankSource("backend");
    } catch {
      setRanked(rankHospitals(hospitals, severity.types, severity.resources)); // local fallback
      setRankSource("local");
    }
    setAnalyzing(false);
  }

  async function dispatch() {
    setDispatching(true);
    const top = ranked[0];
    const created = await createRequest({
      patientText: text, score: result.score, category: result.category, crisisTypeAI: result.types[0],
      confirmedType: null, ambulance: result.ambulance, hospitalId: top.id, hospitalName: top.name, eta: top.eta,
      patientLat: userLocation?.lat, patientLng: userLocation?.lng,
      hospitalLat: top.lat, hospitalLng: top.lng,
    });
    setMyRequestId(created.id);
    setDispatching(false);
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">Describe the emergency</h1>
        <p className="text-sm text-[var(--muted)] mt-1">Speak or type what's happening — our AI triage layer scores severity and finds the right hospital.</p>

        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <textarea
            value={text} onChange={(e) => setText(e.target.value)}
            placeholder="e.g. My father is clutching his chest, says it hurts badly and he's sweating..."
            className="w-full h-24 resize-none outline-none text-sm placeholder:text-[var(--muted)]"
          />
          <div className="flex items-center justify-between mt-2">
            <button onClick={startVoice}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border border-[var(--border)] hover:bg-[var(--pillHover)]">
              <Mic size={14} className={listening ? "pulse-dot" : ""} color={listening ? C.red : "var(--text)"} />
              {listening ? (speechSupported ? "Listening… (tap to stop)" : "Listening…") : "Speak symptoms"}
            </button>
            <button onClick={analyze} disabled={!text.trim() || listening || analyzing}
              className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40" style={{ background: "var(--accentBg)", color: "var(--accentText)" }}>
              {analyzing ? "Analyzing…" : "Analyze severity"}
            </button>
          </div>
          {voiceError && <p className="text-[11px] mt-1.5" style={{ color: C.red }}>{voiceError}</p>}
          <p className="text-[10px] font-mono text-[var(--muted)] mt-1.5">
            {speechSupported
              ? "Real voice recognition via your browser's Web Speech API — needs mic permission and works best in Chrome/Edge."
              : "Your browser doesn't support live voice recognition (Web Speech API) — using a scripted demo transcript instead. Try Chrome or Edge for real mic input."}
          </p>
        </div>
      </section>

      {result && (
        <section className="rounded-xl border p-4 space-y-4" style={{ borderColor: `${CATEGORY_COLOR[result.category]}55`, background: `${CATEGORY_COLOR[result.category]}0A` }}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="font-mono text-3xl font-semibold" style={{ color: CATEGORY_COLOR[result.category] }}>{result.score}</div>
              <div>
                <div className="font-display font-semibold text-sm" style={{ color: CATEGORY_COLOR[result.category] }}>{result.category}</div>
                <div className="text-xs text-[var(--muted)] flex items-center gap-1">
                  {React.createElement(CRISIS_ICON[result.types[0]], { size: 12 })} {result.types.join(", ")} case
                  <span className="text-[10px] font-mono ml-1">
                    · {resultSource === "gemini" ? "scored by Gemini" : resultSource === "backend-fallback" ? "backend online, keyword fallback used" : "scored locally (backend offline)"}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-xs font-mono text-[var(--text)] bg-[var(--surface)]/70 rounded-lg px-3 py-2 border border-[var(--border)]">
              {result.ambulance ? (
                <span className="flex items-center gap-1.5" style={{ color: C.red }}><AmbulanceIcon size={13} /> Ambulance dispatch triggered — score ≥ 55</span>
              ) : (
                <span className="flex items-center gap-1.5" style={{ color: C.green }}><CheckCircle2 size={13} /> Score &lt; 55 — self-transport advised</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-mono">
            {["Stable <35", "Urgent 35–69", "Critical ≥70"].map((label, i) => (
              <div key={label} className="rounded-md py-1.5 border" style={{
                borderColor: [C.green, C.amber, C.red][i], background: result.category === ["Stable", "Urgent", "Critical"][i] ? `${[C.green, C.amber, C.red][i]}22` : "transparent",
                color: [C.green, C.amber, C.red][i], fontWeight: result.category === ["Stable", "Urgent", "Critical"][i] ? 600 : 400,
              }}>{label}</div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-semibold text-[var(--text)] mb-1.5">Resources needed</div>
              <div className="flex flex-wrap gap-1.5">
                {(result.resources?.length ? result.resources : ["—"]).map((r) => (
                  <span key={r} className="text-[11px] px-2 py-1 rounded-full bg-[var(--pill)] text-[var(--text)]">{r}</span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-[var(--text)] mb-1.5">Specialties required</div>
              <div className="flex flex-wrap gap-1.5">
                {(result.types?.length ? result.types : ["—"]).map((s) => (
                  <span key={s} className="text-[11px] px-2 py-1 rounded-full bg-[var(--pill)] text-[var(--text)]">{s}</span>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-[var(--text)] mb-1.5">Immediate first aid — {result.types.join(", ")}</div>
            <ul className="text-xs text-[var(--text)] space-y-1 list-disc list-inside">
              {(result.firstAid?.length ? result.firstAid : FIRST_AID[result.types[0]]).map((tip) => <li key={tip}>{tip}</li>)}
            </ul>
            <p className="text-[10px] text-[var(--muted)] mt-1.5">This is general guidance, not a diagnosis. Follow instructions from emergency responders once they arrive.</p>
          </div>
        </section>
      )}

      {result && !myRequest && (
        <section>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h2 className="font-display font-semibold text-base">Ranked hospitals for {result.types.join(", ")}</h2>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-[var(--muted)]">
                {rankSource === "backend" ? "from backend_server.js" : "local fallback — backend offline"}
              </span>
              <button onClick={() => setShowFormula((s) => !s)} className="text-[11px] font-mono text-[var(--muted)] underline">
                {showFormula ? "hide" : "how we ranked these"}
              </button>
            </div>
          </div>
          {scanning && <div className="text-[11px] font-mono text-[var(--accentBg)] mb-2 animate-pulse">Scanning locality for hospitals...</div>}
          {showFormula && (
            <div className="text-[11px] font-mono text-[var(--text)] bg-[var(--pill)] rounded-lg p-3 mb-3 leading-relaxed">
              score = 0.7 × resource availability + 0.4 × specialty + 0.5 × distance(km)<br />
              Distance & ETA sourced live from OpenRouteService using user's real location.
            </div>
          )}
          <div className="space-y-2.5">
            {ranked.slice(0, 6).map((h, i) => <RankedHospitalCard key={h.id} h={h} rank={i + 1} onGetDirections={onGetDirections} />)}
          </div>
          <button onClick={() => {
            if (result.ambulance) dispatch();
            else onGetDirections(ranked[0]);
          }} disabled={dispatching} className="mt-4 w-full sm:w-auto px-5 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: result.ambulance ? C.red : "var(--accentBg)", color: result.ambulance ? "#fff" : "var(--accentText)" }}>
            {result.ambulance ? <AmbulanceIcon size={15} /> : <Navigation2 size={15} />}
            {dispatching ? "Sending…" : result.ambulance ? `Confirm & dispatch ambulance to ${ranked[0]?.name}` : `Get directions to ${ranked[0]?.name}`}
          </button>
        </section>
      )}

      {myRequest && <TrackingCard request={myRequest} />}
    </div>
  );
}

function RankedHospitalCard({ h, rank, onGetDirections }) {
  const Icon = RESOURCES.find((r) => r.key === h.resourceKey)?.icon || HeartPulse;
  const fColor = freshnessColor(h.freshness[h.resourceKey]);
  const has = h.count > 0;
  return (
    <div className="rounded-xl border bg-[var(--surface)] p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 hover:shadow-sm transition-shadow" style={{ borderColor: rank === 1 ? "var(--accentBg)" : "var(--border)" }}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className="font-mono text-xs text-[var(--muted)] w-6 shrink-0">#{rank}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-display font-semibold text-[14px] truncate">{h.name}</h3>
            {rank === 1 && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ background: "var(--accentBg)", color: "var(--accentText)" }}>TOP MATCH</span>}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--muted)] font-mono flex-wrap">
            <span className="flex items-center gap-1"><MapPin size={10} />{h.distanceKm} km</span>
            <span className="flex items-center gap-1"><Navigation2 size={10} />{h.eta} min ETA</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: fColor }} />{freshnessLabel(h.freshness[h.resourceKey])}</span>
            {h.specialtyMatch && (
              <span className="flex items-center gap-1 font-medium" style={{ color: "var(--accentBg)" }}>
                <CheckCircle2 size={10} /> {h.specialtyMatch === "full" ? "Full Match" : "Partial Match"}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 pl-9 sm:pl-0">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg shrink-0" style={{ background: has ? `${C.green}18` : `${C.red}18` }}>
          <Icon size={13} color={has ? C.green : C.red} />
          <span className="font-mono text-sm font-semibold" style={{ color: has ? C.green : C.red }}>{h.count}</span>
        </div>
        <div className="font-mono text-sm font-semibold shrink-0 text-right">{h.total} pts</div>
        <button onClick={() => onGetDirections(h)} className="px-3 py-1.5 rounded-lg text-[11px] font-medium border border-[var(--border)] hover:bg-[var(--pill)] transition-colors shrink-0 whitespace-nowrap ml-auto">
          Get directions
        </button>
      </div>
    </div>
  );
}

function TrackingCard({ request }) {
  const STAGES = [
    { key: "dispatched", label: "Dispatched" },
    { key: "en_route", label: "En route" },
    { key: "arrived", label: "Arrived" },
    { key: "handed_off", label: "Handed off" },
  ];
  const idx = STAGES.findIndex((s) => s.key === request.status);
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-semibold text-base">Tracking your request</h2>
        <span className="text-xs font-mono text-[var(--muted)]">→ {request.hospitalName}</span>
      </div>
      <div className="flex items-center">
        {STAGES.map((s, i) => (
          <React.Fragment key={s.key}>
            <div className="flex flex-col items-center gap-1">
              <div className="w-3 h-3 rounded-full" style={{ background: i <= idx ? "var(--accentBg)" : "var(--border)" }} />
              <span className="text-[10px] font-mono text-[var(--muted)]">{s.label}</span>
            </div>
            {i < STAGES.length - 1 && <div className="flex-1 h-[2px] mx-1" style={{ background: i < idx ? "var(--accentBg)" : "var(--border)" }} />}
          </React.Fragment>
        ))}
      </div>
      <p className="text-[11px] text-[var(--muted)] mt-3">Status updates here live-sync from the Ambulance dashboard — switch tabs to advance it.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// HOSPITAL AUTHENTICATION
// ---------------------------------------------------------------------------
function HospitalAuth({ hospitals, onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hospitalId, setHospitalId] = useState(hospitals[0]?.id || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/signup';
    const body = { email, password };
    if (!isLogin) body.hospitalId = hospitalId;

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      onLogin(data.hospitalId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-sm">
      <div className="flex justify-center mb-4">
        <div className="p-3 bg-[var(--accentBg)] rounded-full text-[var(--accentText)]">
          <Building2 size={24} />
        </div>
      </div>
      <h2 className="text-xl font-bold font-display mb-6 text-center">{isLogin ? 'Hospital Portal Login' : 'Hospital Portal Registration'}</h2>

      {error && <div className="p-3 mb-4 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold mb-1 text-[var(--muted)]">Email Address</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full p-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accentBg)] transition-colors" />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1 text-[var(--muted)]">Password</label>
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full p-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accentBg)] transition-colors" />
        </div>
        {!isLogin && (
          <div>
            <label className="block text-xs font-semibold mb-1 text-[var(--muted)]">Claim Hospital Profile</label>
            <select value={hospitalId} onChange={e => setHospitalId(e.target.value)} className="w-full p-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accentBg)] transition-colors">
              {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        )}
        <button disabled={loading} type="submit" className="w-full py-2.5 bg-[var(--text)] text-[var(--bg)] rounded-lg font-semibold hover:opacity-90 transition-opacity mt-2">
          {loading ? 'Processing...' : (isLogin ? 'Login to Portal' : 'Register Account')}
        </button>
      </form>
      <div className="mt-5 text-center">
        <button onClick={() => { setIsLogin(!isLogin); setError(''); }} type="button" className="text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors">
          {isLogin ? 'New hospital? Register here' : 'Already registered? Login here'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HOSPITAL VIEW
// ---------------------------------------------------------------------------
function HospitalView({ hospitals, requests, adjustStock, toggleHospitalSpecialty, updateRequestCrisisType, globalCrisis, setGlobalCrisis, authHospitalId, onLogout }) {
  const hospital = hospitals.find((h) => h.id === authHospitalId);
  if (!hospital) {
    return (
      <div className="text-center py-10">
        <h2 className="text-lg font-semibold mb-2">Hospital Not Found</h2>
        <p className="text-sm text-[var(--muted)] mb-4">Your associated hospital profile could not be found. It may have been removed or the ID has changed.</p>
        <button onClick={onLogout} className="px-4 py-2 bg-[var(--border)] rounded-lg text-sm hover:bg-[var(--surface)] transition-colors">Logout</button>
      </div>
    );
  }

  const hospitalId = hospital.id;
  const incoming = requests.filter((r) => r.hospitalId === hospitalId);
  const specialties = hospital.specialties || [];

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 pl-3 pr-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <Building2 size={15} className="text-[var(--accentBg)]" />
            <span className="font-display font-semibold text-sm">{hospital.name}</span>
          </div>
          <button onClick={onLogout} className="text-xs font-semibold px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            Logout
          </button>
        </div>
        <button onClick={() => setGlobalCrisis((c) => !c)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm ${globalCrisis ? "bg-[#E4572E] text-white crisis-ring" : "bg-[var(--surface)] border border-[var(--border)] text-[var(--text)]"}`}>
          <Siren size={15} />{globalCrisis ? "Crisis Mode - Active" : "Activate Crisis Mode"}
        </button>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="relative">
          <div className="text-xs font-mono text-[var(--muted)] mb-2">Select hospital specialties (click to add/remove):</div>
          <div className="flex items-center gap-2 flex-wrap">
            {CRISIS_TYPES.map((t) => {
              const isSelected = specialties.includes(t);
              return (
                <button key={t} onClick={() => toggleHospitalSpecialty(hospitalId, t)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${isSelected ? "border-[var(--accentBg)] shadow-sm" : "border-[var(--border)] opacity-70 hover:opacity-100"}`}
                  style={{ background: isSelected ? "var(--accentBg)" : "var(--surface)", color: isSelected ? "var(--accentText)" : "var(--text)" }}>
                  {isSelected ? <CheckCircle2 size={13} /> : <Plus size={13} />}
                  {t}
                </button>
              );
            })}
          </div>
        </div>
        <span className="text-[11px] font-mono text-[var(--muted)] flex items-center gap-1"><CheckCircle2 size={12} color={C.green} /> EHR auto-sync connected</span>
      </section>

      <section>
        <h2 className="font-display font-semibold text-base mb-2">Resource inventory</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {RESOURCES.map((r) => {
            const Icon = r.icon;
            const count = hospital.stock[r.key];
            const fresh = hospital.freshness[r.key];
            const fColor = freshnessColor(fresh);
            return (
              <div key={r.key} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text)]"><Icon size={14} className="text-[var(--muted)]" />{r.label}</div>
                  <span className="flex items-center gap-1 text-[10px] font-mono" style={{ color: fColor }}>
                    <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: fColor }} />{freshnessLabel(fresh)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-3xl font-semibold" style={{ color: count > 0 ? "var(--text)" : C.red }}>{String(count).padStart(2, "0")}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => adjustStock(hospital.id, r.key, -1)} className="w-7 h-7 rounded-md border border-[var(--border)] flex items-center justify-center hover:bg-[var(--pillHover)]"><Minus size={13} /></button>
                    <button onClick={() => adjustStock(hospital.id, r.key, 1)} className="w-7 h-7 rounded-md flex items-center justify-center hover:opacity-85" style={{ background: "var(--accentBg)", color: "var(--accentText)" }}><Plus size={13} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="font-display font-semibold text-base mb-2">Incoming patients</h2>
        {incoming.length === 0 ? (
          <p className="text-sm text-[var(--muted)] rounded-xl border border-dashed border-[var(--border)] p-4">No dispatches to this hospital yet — try sending one from the Patient tab.</p>
        ) : (
          <div className="space-y-2.5">
            {incoming.map((r) => (
              <div key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-lg font-semibold" style={{ color: CATEGORY_COLOR[r.category] }}>{r.score}</span>
                    <span className="text-xs font-medium" style={{ color: CATEGORY_COLOR[r.category] }}>{r.category}</span>
                    <span className="text-xs text-[var(--muted)]">· AI suggested: {r.crisisTypeAI}</span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--muted)] uppercase">{r.status.replace("_", " ")}</span>
                </div>
                <p className="text-xs text-[var(--text)] mt-1.5">{r.patientText}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[11px] text-[var(--muted)]">Confirm crisis type:</span>
                  {CRISIS_TYPES.slice(0, 6).map((t) => (
                    <button key={t} onClick={() => updateRequestCrisisType(r.id, t)}
                      className={`text-[10px] px-2 py-1 rounded-full border ${(r.confirmedType || r.crisisTypeAI) === t ? "border-[var(--accentBg)]" : "border-[var(--border)]"}`}
                      style={(r.confirmedType || r.crisisTypeAI) === t ? { background: "var(--accentBg)", color: "var(--accentText)" } : { color: "var(--text)" }}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// AMBULANCE VIEW
// ---------------------------------------------------------------------------
function AmbulanceView({ requests, hospitals, advanceRequest, onGetDirections }) {
  const active = requests.filter((r) => r.ambulance);
  const STAGE_LABEL = { dispatched: "Dispatched", en_route: "En route", arrived: "Arrived", handed_off: "Handed off" };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Active ambulance dispatches</h1>
      {active.length === 0 ? (
        <p className="text-sm text-[var(--muted)] rounded-xl border border-dashed border-[var(--border)] p-4">No active dispatches. Requests scoring &gt;= 55 from the Patient tab will appear here.</p>
      ) : active.map((r) => (
        <div key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg font-semibold" style={{ color: CATEGORY_COLOR[r.category] }}>{r.score}</span>
                <span className="text-sm font-medium" style={{ color: CATEGORY_COLOR[r.category] }}>{r.category} · {r.confirmedType || r.crisisTypeAI}</span>
              </div>
              <p className="text-xs text-[var(--text)] mt-1 max-w-md">{r.patientText}</p>
              <div className="flex items-center gap-3 mt-1.5 text-[11px] font-mono text-[var(--muted)]">
                <span className="flex items-center gap-1"><Building2 size={11} />{r.hospitalName}</span>
                <span className="flex items-center gap-1"><Clock size={11} />{r.eta} min ETA</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => {
                let h = hospitals.find(h => h.id === r.hospitalId);
                if (!h) h = hospitals.find(h => h.name === r.hospitalName); // fallback if IDs reset
                if (!h && r.hospitalLat && r.hospitalLng) {
                  h = { lat: r.hospitalLat, lng: r.hospitalLng, name: r.hospitalName };
                }
                if (h) {
                  onGetDirections(h);
                } else {
                  alert("Cannot find hospital location for this request.");
                }
              }} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] hover:bg-[var(--pill)] transition-colors">
                Get Directions
              </button>
              <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-[var(--pill)]">{STAGE_LABEL[r.status]}</span>
              <button disabled={r.status === "handed_off"} onClick={() => advanceRequest(r.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style={{ background: "var(--accentBg)", color: "var(--accentText)" }}>
                Advance status
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GOVERNMENT VIEW
// ---------------------------------------------------------------------------
function GovernmentView({ hospitals, requests }) {
  const totals = RESOURCES.map((r) => ({ ...r, total: hospitals.reduce((s, h) => s + h.stock[r.key], 0) }));
  const byCategory = ["Critical", "Urgent", "Stable"].map((c) => ({ c, n: requests.filter((r) => r.category === c).length }));
  const maxCat = Math.max(1, ...byCategory.map((b) => b.n));
  const crisisHospitals = hospitals.filter((h) => h.crisisModeLocal);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Network overview</h1>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Hospitals online", value: hospitals.length },
          { label: "Active dispatches", value: requests.filter((r) => r.status !== "handed_off").length },
          { label: "Ambulances rolling", value: requests.filter((r) => r.ambulance && r.status !== "handed_off").length },
          { label: "Crisis-mode sites", value: crisisHospitals.length },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <div className="font-mono text-2xl font-semibold">{s.value}</div>
            <div className="text-[11px] text-[var(--muted)]">{s.label}</div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="font-display font-semibold text-base mb-2">Severity distribution, network-wide</h2>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2.5">
          {byCategory.map((b) => (
            <div key={b.c} className="flex items-center gap-3">
              <span className="text-xs font-medium w-14" style={{ color: CATEGORY_COLOR[b.c] }}>{b.c}</span>
              <div className="flex-1 h-3 rounded-full bg-[var(--pill)] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(b.n / maxCat) * 100}%`, background: CATEGORY_COLOR[b.c] }} />
              </div>
              <span className="text-xs font-mono w-5 text-right">{b.n}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display font-semibold text-base mb-2">Resource totals across the network</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {totals.map((r) => {
            const Icon = r.icon;
            return (
              <div key={r.key} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[13px] text-[var(--text)]"><Icon size={14} className="text-[var(--muted)]" />{r.label}</div>
                <span className="font-mono text-xl font-semibold">{r.total}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
