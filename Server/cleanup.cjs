const { initializeApp, cert } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const path = require("path");

const serviceAccountPath = path.join(__dirname, "firebaseServiceAccountKey.json");
const serviceAccount = require(serviceAccountPath);

initializeApp({
    credential: cert(serviceAccount),
    databaseURL: `https://wardwatch2-default-rtdb.firebaseio.com`
});

const db = getDatabase();

async function cleanup() {
    console.log("Fetching hospitals...");
    const snap = await db.ref("hospitals").once("value");
    let hospitals = snap.val() || [];
    
    if (Array.isArray(hospitals)) {
        const originalLength = hospitals.length;
        hospitals = hospitals.filter(h => h && !h.id.startsWith("real_h"));
        
        if (hospitals.length !== originalLength) {
            console.log(`Found ${originalLength - hospitals.length} ghost hospitals. Deleting...`);
            await db.ref("hospitals").set(hospitals);
            console.log("Successfully removed ghost hospitals from the database.");
        } else {
            console.log("No ghost hospitals found.");
        }
    }
    
    console.log("Fetching users to check for orphaned links...");
    const usersSnap = await db.ref("users").once("value");
    const users = usersSnap.val() || {};
    let usersUpdated = false;
    for (const [uid, data] of Object.entries(users)) {
        if (data && data.hospitalId && data.hospitalId.startsWith("real_h")) {
            console.log(`Removing orphaned hospitalId from user ${uid}`);
            await db.ref(`users/${uid}`).remove();
            usersUpdated = true;
        }
    }
    if (!usersUpdated) {
        console.log("No orphaned users found.");
    }
    
    console.log("Cleanup complete.");
    process.exit(0);
}

cleanup().catch(e => {
    console.error(e);
    process.exit(1);
});
