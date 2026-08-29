/**
 * WardWatch — reference backend skeleton
 * -----------------------------------------------------------------------
 * This is a starting point for the real Node/Express service behind the
 * prototype, matching the architecture already on your pitch deck
 * (React front end, Node/Express + Firebase, OpenAI/Gemini, Google Maps).
 *
 * It is NOT wired to live APIs — this sandbox has no network access — but
 * every endpoint mirrors the logic simulated in wardwatch_prototype.jsx,
 * so swapping in real keys is mostly a matter of filling in the two
 * marked TODOs.
 *
 *   npm i express cors firebase-admin openai @googlemaps/google-maps-services-js
 *   node backend_server.js
 * -----------------------------------------------------------------------
 */

const express = require("express");
const cors = require("cors");
// const admin = require("firebase-admin");         // real-time inventory DB
// const { OpenAI } = require("openai");             // AI triage
// const { Client } = require("@googlemaps/google-maps-services-js"); // ETA/traffic

const app = express();
app.use(cors());
app.use(express.json());

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// const mapsClient = new Client({});
// admin.initializeApp({ credential: admin.credential.applicationDefault() });
// const db = admin.database();

// ---------------------------------------------------------------------
// In-memory mock store (swap for Firebase Realtime Database / Firestore)
// ---------------------------------------------------------------------
const hospitals = require("./mock_hospitals.json"); // same shape as HOSPITALS_INIT in the frontend
let requests = [];

const CRISIS_RESOURCE = {
    Cardiac: "icu", Trauma: "trauma", Respiratory: "ventilator", Burn: "burn",
    Obstetric: "incubator", Neurological: "icu", "Mass Casualty": "trauma", General: "icu",
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
// POST /api/triage  { text }  ->  { score, category, type, ambulance }
// ---------------------------------------------------------------------
app.post("/api/triage", async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });

    // TODO (real AI call): replace the keyword scan below with a structured
    // OpenAI/Gemini call, e.g.:
    //
    // const completion = await openai.chat.completions.create({
    //   model: "gpt-4o-mini",
    //   response_format: { type: "json_object" },
    //   messages: [
    //     { role: "system", content: "You are an emergency triage classifier. " +
    //       "Given a patient description, return JSON: {score: 0-100, type: one of " +
    //       "[Cardiac,Trauma,Respiratory,Burn,Obstetric,Neurological,Mass Casualty,General]}." },
    //     { role: "user", content: text },
    //   ],
    // });
    // const ai = JSON.parse(completion.choices[0].message.content);

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
    const ambulance = score >= 55; // single cutoff integer gating dispatch, per spec

    res.json({ score, category, type: bestType, ambulance });
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
        const capScore = h.capability[crisisType] ?? 50;
        const total = Math.round(0.4 * resourceScore + 0.3 * etaScore + 0.3 * capScore);
        return { ...h, resourceKey, count, eta, total };
    }).sort((a, b) => b.total - a.total);

    res.json(ranked);
});

// ---------------------------------------------------------------------
// POST /api/dispatch  -> create a dispatch request, push to assigned hospital
// ---------------------------------------------------------------------
app.post("/api/dispatch", (req, res) => {
    const request = { id: `r${requests.length + 1}`, status: "dispatched", createdAt: Date.now(), ...req.body };
    requests.push(request);
    // db.ref(`requests/${request.id}`).set(request);   // Firebase real-time push
    res.status(201).json(request);
});

app.patch("/api/dispatch/:id/advance", (req, res) => {
    const order = ["dispatched", "en_route", "arrived", "handed_off"];
    const r = requests.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).end();
    const i = order.indexOf(r.status);
    if (i < order.length - 1) r.status = order[i + 1];
    res.json(r);
});

// ---------------------------------------------------------------------
// PATCH /api/hospitals/:id/inventory  { key, delta }  -> real-time update
// ---------------------------------------------------------------------
app.patch("/api/hospitals/:id/inventory", (req, res) => {
    const { key, delta } = req.body;
    const h = hospitals.find((x) => x.id === req.params.id);
    if (!h) return res.status(404).end();
    h.stock[key] = Math.max(0, h.stock[key] + delta);
    h.freshness[key] = 0;
    // db.ref(`hospitals/${h.id}/stock/${key}`).set(h.stock[key]);
    res.json(h);
});

app.patch("/api/hospitals/:id/crisis-type", (req, res) => {
    const h = hospitals.find((x) => x.id === req.params.id);
    if (!h) return res.status(404).end();
    h.currentCrisisType = req.body.type;
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