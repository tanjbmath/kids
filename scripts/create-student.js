"use strict";

// Run locally after installing functions dependencies and setting
// GOOGLE_APPLICATION_CREDENTIALS to a private service-account JSON file.
// Never commit that credential file to this repository.
const crypto = require("node:crypto");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const projectId = process.env.GCLOUD_PROJECT || "word-adventure-tanjb";
const displayName = (process.argv[2] || "").normalize("NFKC").trim().replace(/\s+/g, " ");
const pin = process.argv[3] || "";

if (!displayName || displayName.length > 60 || !/^[0-9]{4}$/.test(pin)) {
  console.error('Usage: node scripts/create-student.js "Student Name" 1234');
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const auth = getAuth();

(async () => {
  const nameKey = displayName.toLocaleLowerCase("en");
  const duplicate = await db.collection("students").where("nameKey", "==", nameKey).limit(1).get();
  if (!duplicate.empty) throw new Error("A student with that name already exists. Use a distinct display name.");

  const studentId = crypto.randomBytes(18).toString("base64url");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pin, salt, 64).toString("hex");
  await auth.createUser({ uid: studentId, displayName });
  await db.collection("students").doc(studentId).set({
    displayName,
    nameKey,
    pinSalt: salt,
    pinHash: hash,
    active: true,
    totalAttempts: 0,
    totalXp: 0,
    dailyXpDate: "",
    dailyXp: 0,
    gameStats: {},
    failedPinAttempts: 0,
    pinLockedUntil: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  console.log("Created student profile:", displayName, "ID:", studentId);
  console.log("Keep the student's PIN private; it cannot be recovered from the stored hash.");
  process.exit(0);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
