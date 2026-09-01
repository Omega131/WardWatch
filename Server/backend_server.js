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
const { getAuth } = require("firebase-admin/auth");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

let hospitals = [];
let requests = [];
let db = null;
let firebaseLoaded = false;

const serviceAccountPath = path.join(__dirname, "firebaseServiceAccountKey.json");
if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    initializeApp({
        credential: cert(serviceAccount),
        databaseURL: `https://wardwatch2-default-rtdb.firebaseio.com`
    });
    db = getDatabase();
    console.log("✅ Firebase initialized securely from Service Account!");
    
    // Initial fetch to prevent race conditions
    db.ref("hospitals").once("value").then((snapshot) => {
        const data = snapshot.val();
        if (data && Array.isArray(data)) hospitals = data;
        firebaseLoaded = true;
        console.log("✅ Firebase hospitals loaded into memory");
        
        // Sync in-memory state with Firebase automatically
        db.ref("hospitals").on("value", (snapshot) => {
            const data = snapshot.val();
            if (data && Array.isArray(data)) hospitals = data;
        });
    });
    
    db.ref("requests").on("value", (snapshot) => {
        const data = snapshot.val();
        if (data) requests = Object.values(data);
    });
} else {
    firebaseLoaded = true; // Memory-only mode
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
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS 
    ? process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()) 
    : [process.env.GEMINI_API_KEY].filter(Boolean);
let currentKeyIndex = 0;
const GEMINI_MODEL = "gemini-3.6-flash"; // gemini-2.0-flash was retired — this is Google's current stable Flash model

const TRIAGE_SCHEMA_PROMPT = `You are an emergency medical triage assistant helping a 108-style dispatch platform. A caller has described the following situation:

"""{{TEXT}}"""

Respond with ONLY a JSON object (no markdown fences, no extra commentary) with exactly this shape:
{
  "score": <integer 0-100, overall severity>,
  "category": <"Critical" | "Urgent" | "Stable">,
  "types": [<1 or more from ${JSON.stringify(CRISIS_TYPES)} that aptly describe the patient's requirements>],
  "ambulance": <true or false>,
  "resources": [<0-3 items, chosen only from ${JSON.stringify(RESOURCE_LABELS)}>],

  "firstAid": [<3-5 short, plain-language immediate first aid steps a bystander with no medical training can follow right now, each under 15 words>]
}

Rules:
- score >= 70 means Critical, 35-69 Urgent, below 35 Stable - category MUST match score.
- ambulance MUST be true whenever score >= 55, false otherwise.
- Base every field strictly on what was actually described - don't invent symptoms.
- If the description is vague or clearly not a medical emergency, use score 0-10, category "Stable", types ["General"].`;

async function callGeminiTriage(text, retryCount = 0) {
    if (GEMINI_API_KEYS.length === 0) throw new Error("No Gemini API keys are set");

    const currentKey = GEMINI_API_KEYS[currentKeyIndex];
    const prompt = TRIAGE_SCHEMA_PROMPT.replace("{{TEXT}}", text);

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${currentKey}`,
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
        if (res.status === 429) {
            console.warn(`[Gemini API] Key at index ${currentKeyIndex} exhausted. Switching keys...`);
            currentKeyIndex = (currentKeyIndex + 1) % GEMINI_API_KEYS.length;
            
            // Prevent infinite loop if ALL keys are exhausted
            if (retryCount < GEMINI_API_KEYS.length) {
                return callGeminiTriage(text, retryCount + 1);
            }
        }
        const errText = await res.text().catch(() => "");
        throw new Error(`Gemini API responded ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error("Gemini returned no usable content (possibly blocked by safety filters)");

    const parsed = JSON.parse(raw); // throws if Gemini didn't return valid JSON — caught by the route below

    // Belt-and-braces validation — never trust an LLM's output blindly for
    // something that gates an ambulance dispatch.
    if (typeof parsed.score !== "number" || !Array.isArray(parsed.types) || !parsed.types.every(t => CRISIS_TYPES.includes(t)) || parsed.types.length === 0) {
        throw new Error("Gemini response failed shape validation: " + JSON.stringify(parsed));
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
    let score = 0;
    const typesSet = new Set();
    const t = text.toLowerCase();
    KEYWORDS.forEach((k) => {
        if (t.includes(k.phrase)) {
            score += k.weight;
            typesSet.add(k.type);
        }
    });
    if (typesSet.size === 0) typesSet.add("General");
    score = Math.min(100, score);
    const category = score >= 70 ? "Critical" : score >= 35 ? "Urgent" : "Stable";
    const types = Array.from(typesSet);
    return {
        score, category, types, ambulance: score >= 55,
        resources: [RESOURCE_KEY_TO_LABEL[CRISIS_RESOURCE[types[0]]]],
        specialists: SPECIALIST_BY_TYPE[types[0]],
        firstAid: FIRST_AID_BY_TYPE[types[0]],
    };
}

// ---------------------------------------------------------------------
// POST /api/triage  { text }  ->  { score, category, type, ambulance,
//                                   resources, specialists, firstAid, source }
// ---------------------------------------------------------------------
app.post("/api/triage", async (req, res) => {
    try {
        const result = await callGeminiTriage(req.body.text);
        res.json({ ...result, source: "gemini" });
    } catch (e) {
        console.error("[Gemini Error]", e.message);
        const fb = keywordFallbackTriage(req.body.text || "");
        res.json({ ...fb, source: "keyword-fallback" });
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
    if (!firebaseLoaded) return res.status(503).json({ error: "Loading" });
    res.json(hospitals);
});

app.post("/api/hospitals/sync", async (req, res) => {
    const newHospitals = req.body;
    if (Array.isArray(newHospitals) && newHospitals.length > 0) {
        // Merge into existing, avoiding duplicates by id
        for (const h of newHospitals) {
            if (!hospitals.some(existing => existing.id === h.id)) {
                hospitals.push(h);
                
                // Auto-create Auth users for these hospitals if Firebase is connected
                if (db) {
                    let firstWord = h.name.split(" ")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
                    if (!firstWord) firstWord = "hospital";
                    const email = `${firstWord}@gmail.com`;
                    const password = "123456";
                    
                    try {
                        const userRecord = await getAuth().createUser({ email, password });
                        await db.ref(`users/${userRecord.uid}`).set({ hospitalId: h.id });
                        console.log(`Auto-created auth for ${h.name}: ${email}`);
                    } catch (e) {
                        if (e.code === 'auth/email-already-exists') {
                            try {
                                const userRecord = await getAuth().getUserByEmail(email);
                                await db.ref(`users/${userRecord.uid}`).set({ hospitalId: h.id });
                                console.log(`Auth already exists for ${email}. Re-linked to ${h.name}`);
                            } catch (err) {
                                console.error(`Error re-linking auth for ${h.name}:`, err.message);
                            }
                        } else {
                            console.error(`Error auto-creating auth for ${h.name}:`, e.message);
                        }
                    }
                }
            }
        }
        
        if (db) await db.ref("hospitals").set(hospitals);
        res.json({ success: true, count: hospitals.length });
    } else {
        res.status(400).json({ error: "Invalid hospital array" });
    }
});

app.post("/api/hospitals/rank", (req, res) => {
    let types = ["General"];
    if (req.body.types && Array.isArray(req.body.types)) {
        types = req.body.types;
    }
    
    let neededKeys = [];
    if (req.body.resources && Array.isArray(req.body.resources)) {
        neededKeys = req.body.resources.map(label => {
            const entry = Object.entries(RESOURCE_KEY_TO_LABEL).find(([k, v]) => v === label);
            return entry ? entry[0] : null;
        }).filter(Boolean);
    }
    if (neededKeys.length === 0) {
        neededKeys = [CRISIS_RESOURCE[types[0]] || "icu"];
    }
    
    const hospitalsToRank = req.body.hospitals || hospitals;
    const resourceKey = neededKeys[0] || "icu";

    const ranked = hospitalsToRank.map((h) => {
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

        return { ...h, resourceKey, count, eta, total, specialtyMatch };
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
// AUTH ROUTES
// ---------------------------------------------------------------------
app.post("/api/auth/signup", async (req, res) => {
    const { email, password, hospitalId } = req.body;
    if (!db) return res.status(503).json({ error: "Database not initialized" });
    try {
        const userRecord = await getAuth().createUser({ email, password });
        await db.ref(`users/${userRecord.uid}`).set({ hospitalId });
        res.json({ success: true, hospitalId });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
    if (!FIREBASE_WEB_API_KEY) return res.status(500).json({ error: "FIREBASE_WEB_API_KEY is not set in Server/.env" });
    if (!db) return res.status(503).json({ error: "Database not initialized" });
    
    try {
        const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, returnSecureToken: true })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        
        const uid = data.localId;
        const snap = await db.ref(`users/${uid}`).once("value");
        const userData = snap.val();
        res.json({ success: true, hospitalId: userData?.hospitalId });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.patch("/api/hospitals/:id/inventory", (req, res) => {
    const { key, delta } = req.body;
    const hIndex = hospitals.findIndex((x) => x.id === req.params.id);
    if (hIndex === -1) return res.status(404).end();
    
    const h = hospitals[hIndex];
    h.stock[key] = Math.max(0, h.stock[key] + delta);
    h.freshness[key] = Date.now();
    
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
