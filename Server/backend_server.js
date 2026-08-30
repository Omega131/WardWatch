/**
 * WardWatch — reference backend skeleton
 * -----------------------------------------------------------------------
 * This is a starting point for the real Node/Express service behind the
 * prototype, matching the architecture already on your pitch deck
 * (React front end, Node/Express + Firebase, Gemini, Google Maps).
 *
 *   npm i express cors dotenv firebase-admin @googlemaps/google-maps-services-js
 *   (Node 18+ has fetch built in — no extra package needed for Gemini itself)
 *
 *   Create a .env file next to this one containing:
 *     GEMINI_API_KEY=your_key_here
 *
 *   node backend_server.js
 * -----------------------------------------------------------------------
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { initializeApp, cert } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

let db = null;
let hospitals = require("./mock_hospitals.json"); 
let requests = [];

const serviceAccountPath = path.join(__dirname, "firebaseServiceAccountKey.json");
if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    initializeApp({
        credential: cert(serviceAccount),
        databaseURL: `https://wardwatch-f2045-default-rtdb.asia-southeast1.firebasedatabase.app`
    });
    db = getDatabase();
    
    console.log("🔥 Firebase initialized securely from Service Account!");
    
    // Sync in-memory state with Firebase automatically
    db.ref("hospitals").on("value", (snapshot) => {
        const data = snapshot.val();
        if (data && Array.isArray(data)) hospitals = data;
    });
    db.ref("requests").on("value", (snapshot) => {
        const data = snapshot.val();
        if (data) requests = Object.values(data);
    });
} else {
    console.warn("⚠️ firebaseServiceAccountKey.json not found! Running in memory-only fallback mode.");
}

const CRISIS_TYPES = ["Cardiac", "Trauma", "Respiratory", "Burn", "Obstetric", "Neurological", "Mass Casualty", "General"];
const RESOURCE_LABELS = ["ICU Bed", "O- Blood", "Ventilator", "Trauma Bay", "Burn Unit", "Infant Incubator"];
const CRISIS_RESOURCE = {
    Cardiac: "icu", Trauma: "trauma", Respiratory: "ventilator", Burn: "burn",
    Obstetric: "incubator", Neurological: "icu", "Mass Casualty": "trauma", General: "icu",
};
const RESOURCE_KEY_TO_LABEL = { icu: "ICU Bed", bloodNeg: "O- Blood", ventilator: "Ventilator", trauma: "Trauma Bay", burn: "Burn Unit", incubator: "Infant Incubator" };
const SPECIALIST_BY_TYPE = {
    Cardiac: ["Cardiologist"], Trauma: ["Trauma Surgeon"], Respiratory: ["Pulmonologist"],
    Burn: ["Burn Specialist"], Obstetric: ["Obstetrician"], Neurological: ["Neurologist"],
    "Mass Casualty": ["Emergency Medicine Physician"], General: ["General Physician"],
};
const FIRST_AID_BY_TYPE = {
    Cardiac: ["Keep the person calm and seated upright", "Loosen tight clothing", "Be ready to start CPR if they stop responding", "Do not give food or water"],
    Trauma: ["Apply firm, direct pressure to any bleeding wound", "Do not remove embedded objects", "Keep the person still", "Elevate the injured area if possible"],
    Respiratory: ["Help them into an upright, comfortable position", "Loosen clothing around the neck and chest", "Stay with them until help arrives"],
    Burn: ["Cool the burn under running water for 20 minutes", "Do not apply ice, butter, or ointments", "Cover loosely with a clean, non-stick cloth"],
    Obstetric: ["Help them lie on their left side if possible", "Time contractions if in labor", "Keep them warm and calm"],
    Neurological: ["Clear the area of anything that could cause injury", "Do not restrain a seizing person", "Turn them on their side once it ends"],
    "Mass Casualty": ["Prioritize the most severe, treatable injuries first", "Keep patients grouped by severity if possible"],
    General: ["Keep the person comfortable and hydrated if conscious", "Monitor for worsening symptoms"],
};

const KEYWORDS = [
    { phrase: "not breathing", weight: 40, type: "Respiratory" },
    { phrase: "no pulse", weight: 40, type: "Cardiac" },
    { phrase: "unconscious", weight: 35, type: "Neurological" },
    { phrase: "chest pain", weight: 35, type: "Cardiac" },
    { phrase: "severe bleeding", weight: 35, type: "Trauma" },
    { phrase: "seizure", weight: 30, type: "Neurological" },
    { phrase: "burn", weight: 25, type: "Burn" },
    { phrase: "fracture", weight: 20, type: "Trauma" },
    { phrase: "difficulty breathing", weight: 25, type: "Respiratory" },
    { phrase: "labor", weight: 22, type: "Obstetric" },
    { phrase: "high fever", weight: 12, type: "General" },
];

// ---------------------------------------------------------------------
// Gemini call. Uses a plain REST fetch (Node 18+ has fetch built in) so
// there's no extra SDK version to keep in sync — just an API key.
// Get a free key at https://aistudio.google.com/apikey
// ---------------------------------------------------------------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.6-flash"; // gemini-2.0-flash was retired — this is Google's current stable Flash model

const TRIAGE_SCHEMA_PROMPT = `You are an emergency medical triage assistant helping a 108-style dispatch platform. A caller has described the following situation:

"""{{TEXT}}"""

Respond with ONLY a JSON object (no markdown fences, no extra commentary) with exactly this shape:
{
  "score": <integer 0-100, overall severity>,
  "category": <"Critical" | "Urgent" | "Stable">,
  "type": <one of ${JSON.stringify(CRISIS_TYPES)}>,
  "ambulance": <true or false>,
  "resources": [<0-3 items, chosen only from ${JSON.stringify(RESOURCE_LABELS)}>],
  "specialists": [<0-2 relevant specialist doctor types, e.g. "Cardiologist", "Trauma Surgeon", "Pulmonologist", "Neurologist", "Obstetrician", "Burn Specialist", "General Physician">],
  "firstAid": [<3-5 short, plain-language immediate first aid steps a bystander with no medical training can follow right now, each under 15 words>]
}

Rules:
- score >= 70 means Critical, 35-69 Urgent, below 35 Stable — category MUST match score.
- ambulance MUST be true whenever score >= 55, false otherwise.
- Base every field strictly on what was actually described — don't invent symptoms.
- If the description is vague or clearly not a medical emergency, use score 0-10, category "Stable", type "General".`;

async function callGeminiTriage(text) {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

    const prompt = TRIAGE_SCHEMA_PROMPT.replace("{{TEXT}}", text);

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
            }),
        }
    );

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Gemini API responded ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error("Gemini returned no usable content (possibly blocked by safety filters)");

    const parsed = JSON.parse(raw); // throws if Gemini didn't return valid JSON — caught by the route below

    // Belt-and-braces validation — never trust an LLM's output blindly for
    // something that gates an ambulance dispatch.
    if (typeof parsed.score !== "number" || !CRISIS_TYPES.includes(parsed.type)) {
        throw new Error("Gemini response failed shape validation");
    }
    parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    parsed.category = parsed.score >= 70 ? "Critical" : parsed.score >= 35 ? "Urgent" : "Stable";
    parsed.ambulance = parsed.score >= 55; // recomputed server-side — the cutoff is not the model's call to make
    parsed.resources = Array.isArray(parsed.resources) ? parsed.resources.filter((r) => RESOURCE_LABELS.includes(r)) : [];
    parsed.specialists = Array.isArray(parsed.specialists) ? parsed.specialists.slice(0, 3) : [];
    parsed.firstAid = Array.isArray(parsed.firstAid) ? parsed.firstAid.slice(0, 5) : [];

    return parsed;
}

function keywordFallbackTriage(text) {
    let score = 0, bestType = "General", bestWeight = 0;
    const t = text.toLowerCase();
    KEYWORDS.forEach((k) => {
        if (t.includes(k.phrase)) {
            score += k.weight;
            if (k.weight > bestWeight) { bestWeight = k.weight; bestType = k.type; }
        }
    });
    score = Math.min(100, score);
    const category = score >= 70 ? "Critical" : score >= 35 ? "Urgent" : "Stable";
    const ambulance = score >= 55;
    return {
        score, category, type: bestType, ambulance,
        resources: [RESOURCE_KEY_TO_LABEL[CRISIS_RESOURCE[bestType]]],
        specialists: SPECIALIST_BY_TYPE[bestType],
        firstAid: FIRST_AID_BY_TYPE[bestType],
    };
}

// ---------------------------------------------------------------------
// POST /api/triage  { text }  ->  { score, category, type, ambulance,
//                                   resources, specialists, firstAid, source }
// ---------------------------------------------------------------------
app.post("/api/triage", async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });

    try {
        const ai = await callGeminiTriage(text);
        return res.json({ ...ai, source: "gemini" });
    } catch (err) {
        console.error("[triage] Gemini call failed, using keyword fallback:", err.message);
        return res.json({ ...keywordFallbackTriage(text), source: "keyword-fallback" });
    }
});

// ---------------------------------------------------------------------
// GET /api/hospitals/rank?crisisType=Trauma&lat=..&lng=..
// -> ranked hospital list using resource + traffic-aware ETA + capability
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// GET /api/hospitals  -> full unranked list, used by the frontend on load
// to sync its local state with whatever the backend currently holds.
// ---------------------------------------------------------------------
app.get("/api/hospitals", (req, res) => {
    res.json(hospitals);
});

app.post("/api/hospitals/sync", (req, res) => {
    const localHospitals = req.body;
    if (Array.isArray(localHospitals) && localHospitals.length > 0) {
        hospitals = localHospitals;
        if (db) db.ref("hospitals").set(hospitals);
        res.json({ success: true, count: hospitals.length });
    } else {
        res.status(400).json({ error: "Invalid hospital array" });
    }
});

app.get("/api/hospitals/rank", async (req, res) => {
    const { crisisType = "General" /*, lat, lng */ } = req.query;
    const resourceKey = CRISIS_RESOURCE[crisisType] || "icu";

    // TODO (real traffic data): replace baseEta*trafficX below with a live
    // Distance Matrix call, e.g.:
    //
    // const dm = await mapsClient.distancematrix({
    //   params: { origins: [`${lat},${lng}`], destinations: hospitals.map(h => h.address),
    //             departure_time: "now", key: process.env.GOOGLE_MAPS_API_KEY },
    // });
    // const etas = dm.data.rows[0].elements.map(e => e.duration_in_traffic.value / 60);

    const ranked = hospitals.map((h) => {
        const count = h.stock[resourceKey];
        const eta = Math.round(h.baseEta * h.trafficX);
        const resourceScore = Math.min(100, count * 25);
        const etaScore = Math.max(0, 100 - eta * 4);
        const capScore = (h.specialties && h.specialties.includes(crisisType)) ? 100 : (h.capability?.[crisisType] ?? 50);
        const total = Math.round(0.4 * resourceScore + 0.3 * etaScore + 0.3 * capScore);
        return { ...h, resourceKey, count, eta, total };
    }).sort((a, b) => b.total - a.total);

    res.json(ranked);
});

// ---------------------------------------------------------------------
// POST /api/dispatch  -> create a dispatch request, push to assigned hospital
// ---------------------------------------------------------------------
app.post("/api/dispatch", (req, res) => {
    const request = { id: `r${Date.now()}`, status: "dispatched", createdAt: Date.now(), ...req.body };
    requests.push(request);
    if (db) db.ref(`requests/${request.id}`).set(request);
    res.status(201).json(request);
});

app.patch("/api/dispatch/:id/advance", (req, res) => {
    const order = ["dispatched", "en_route", "arrived", "handed_off"];
    const rIndex = requests.findIndex((x) => x.id === req.params.id);
    if (rIndex === -1) return res.status(404).end();
    
    const r = requests[rIndex];
    const i = order.indexOf(r.status);
    if (i < order.length - 1) {
        r.status = order[i + 1];
        if (db) db.ref(`requests/${r.id}/status`).set(r.status);
    }
    res.json(r);
});

// ---------------------------------------------------------------------
// PATCH /api/hospitals/:id/inventory  { key, delta }  -> real-time update
// ---------------------------------------------------------------------
app.patch("/api/hospitals/:id/inventory", (req, res) => {
    const { key, delta } = req.body;
    const hIndex = hospitals.findIndex((x) => x.id === req.params.id);
    if (hIndex === -1) return res.status(404).end();
    
    const h = hospitals[hIndex];
    h.stock[key] = Math.max(0, h.stock[key] + delta);
    h.freshness[key] = 0;
    
    if (db) db.ref(`hospitals/${hIndex}`).set(h);
    res.json(h);
});

app.patch("/api/hospitals/:id/specialties", (req, res) => {
    const hIndex = hospitals.findIndex((x) => x.id === req.params.id);
    if (hIndex === -1) return res.status(404).end();
    
    const h = hospitals[hIndex];
    h.specialties = req.body.specialties || [];
    
    console.log(`[Firebase Sync] Updating specialties for ${h.name} (${h.id}) to:`, h.specialties);
    if (db) {
        db.ref(`hospitals/${hIndex}/specialties`).set(h.specialties)
          .then(() => console.log(`[Firebase Sync] Successfully saved to Firebase!`))
          .catch(e => console.error(`[Firebase Sync] Error saving to Firebase:`, e));
    }
    res.json(h);
});

app.get("/api/government/overview", (req, res) => {
    res.json({
        hospitalCount: hospitals.length,
        activeRequests: requests.filter((r) => r.status !== "handed_off").length,
        crisisModeSites: hospitals.filter((h) => h.crisisModeLocal).length,
        severityBreakdown: ["Critical", "Urgent", "Stable"].map((c) => ({
            category: c, count: requests.filter((r) => r.category === c).length,
        })),
    });
});

// ---------------------------------------------------------------------
// GET /api/health  -> cheap ping the frontend uses to show a connected/
// offline badge, and GET /api/dispatch to sync the full requests list.
// ---------------------------------------------------------------------
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/dispatch", (req, res) => res.json(requests));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`WardWatch backend listening on :${PORT}`));