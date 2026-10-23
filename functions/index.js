"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const crypto = require("node:crypto");

initializeApp();
const db = getFirestore();
const adminPassword = defineSecret("WORD_ADVENTURE_ADMIN_PASSWORD");
const MAX_PIN_ATTEMPTS = 5;
const LOCK_MINUTES = 10;
const ALLOWED_MODES = new Set(["word-match","sentence-builder","story-blanks","math-quiz","math-word-problems","ringgit-shop","fill-in-the-blank","word-detective","other"]);

function normaliseName(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 30);
}
function normaliseNameKey(value) {
  return normaliseName(value).toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}
function validPin(pin) { return typeof pin === "string" && /^[0-9]{4}$/.test(pin); }
function validAdminPassword(value) { return typeof value === "string" && value.length >= 4 && value.length <= 128; }
function pinHash(pin, salt) { return crypto.scryptSync(pin, salt, 64).toString("hex"); }
function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); } catch (_) { return false; }
}
function adminPasswordMatches(value) {
  const configured = adminPassword.value();
  if (!configured || !validAdminPassword(value)) return false;
  const a = Buffer.from(String(value));
  const b = Buffer.from(String(configured));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function requireAdmin(request) {
  if (!request.auth || request.auth.token.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin sign-in is required.");
  }
}
function functionsOptions() { return { region: "asia-southeast1", secrets: [adminPassword] }; }
function studentId() { return crypto.randomUUID().replace(/-/g, ""); }

/** Create a child-owned nickname/PIN profile. PIN data never leaves the server. */
exports.createStudentProfile = onCall(functionsOptions(), async (request) => {
  const displayName = normaliseName(request.data?.nickname);
  const nameKey = normaliseNameKey(displayName);
  const pin = request.data?.pin;
  if (displayName.length < 2 || nameKey.length < 2 || !validPin(pin)) {
    throw new HttpsError("invalid-argument", "Use a nickname of at least 2 characters and a four-digit PIN.");
  }
  const nameRef = db.collection("studentNames").doc(nameKey);
  const id = studentId();
  const studentRef = db.collection("students").doc(id);
  const secretRef = db.collection("studentSecrets").doc(id);
  const salt = crypto.randomBytes(16).toString("hex");
  try {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(nameRef)).exists) {
        throw new HttpsError("already-exists", "That nickname is already taken. Try another one.");
      }
      tx.create(nameRef, { studentId: id, createdAt: FieldValue.serverTimestamp() });
      tx.create(studentRef, {
        displayName, nameKey, active: true, totalXp: 0, totalAttempts: 0,
        dailyXp: 0, dailyXpDate: "", gameStats: {}, createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      tx.create(secretRef, { pinSalt: salt, pinHash: pinHash(pin, salt), failedPinAttempts: 0, pinLockedUntil: null });
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Could not create the profile. Please try again.");
  }
  const token = await getAuth().createCustomToken(id, { role: "student" });
  return { token, studentId: id, displayName };
});

/** Sign into a profile by nickname and PIN without exposing profile lists or PIN hashes. */
exports.loginStudent = onCall(functionsOptions(), async (request) => {
  const nameKey = normaliseNameKey(request.data?.nickname);
  const pin = request.data?.pin;
  if (!nameKey || !validPin(pin)) throw new HttpsError("invalid-argument", "Enter your nickname and four-digit PIN.");
  const nameSnap = await db.collection("studentNames").doc(nameKey).get();
  const id = nameSnap.exists ? nameSnap.get("studentId") : "";
  if (!id) throw new HttpsError("unauthenticated", "Nickname or PIN is not correct.");
  const ref = db.collection("students").doc(id);
  const secretRef = db.collection("studentSecrets").doc(id);
  const result = await db.runTransaction(async (tx) => {
    const [studentSnap, secretSnap] = await Promise.all([tx.get(ref), tx.get(secretRef)]);
    if (!studentSnap.exists || studentSnap.get("active") !== true || !secretSnap.exists) return { ok: false, reason: "invalid" };
    const secret = secretSnap.data();
    const now = Date.now();
    const lockedUntil = secret.pinLockedUntil?.toMillis?.() || 0;
    if (lockedUntil > now) return { ok: false, reason: "locked" };
    if (!safeEqualHex(pinHash(pin, secret.pinSalt || ""), secret.pinHash || "")) {
      const attempts = (secret.failedPinAttempts || 0) + 1;
      tx.update(secretRef, attempts >= MAX_PIN_ATTEMPTS
        ? { failedPinAttempts: 0, pinLockedUntil: Timestamp.fromMillis(now + LOCK_MINUTES * 60000) }
        : { failedPinAttempts: attempts });
      return { ok: false, reason: attempts >= MAX_PIN_ATTEMPTS ? "locked" : "invalid" };
    }
    tx.update(secretRef, { failedPinAttempts: 0, pinLockedUntil: null });
    tx.update(ref, { lastLoginAt: FieldValue.serverTimestamp() });
    return { ok: true, displayName: studentSnap.get("displayName") };
  });
  if (!result.ok) throw new HttpsError(result.reason === "locked" ? "resource-exhausted" : "unauthenticated", result.reason === "locked" ? "Too many attempts. Wait 10 minutes and try again." : "Nickname or PIN is not correct.");
  return { token: await getAuth().createCustomToken(id, { role: "student" }), studentId: id, displayName: result.displayName };
});

exports.adminLogin = onCall(functionsOptions(), async (request) => {
  if (!adminPasswordMatches(request.data?.password)) throw new HttpsError("unauthenticated", "Admin password is not correct.");
  return { token: await getAuth().createCustomToken("word-adventure-admin", { role: "admin" }) };
});
exports.adminListStudents = onCall(functionsOptions(), async (request) => {
  requireAdmin(request);
  const snap = await db.collection("students").where("active", "==", true).orderBy("displayName").limit(500).get();
  return { students: snap.docs.map(doc => ({ id: doc.id, displayName: doc.get("displayName"), totalXp: doc.get("totalXp") || 0, totalAttempts: doc.get("totalAttempts") || 0 })) };
});
exports.adminResetStudentPin = onCall(functionsOptions(), async (request) => {
  requireAdmin(request);
  const studentId = request.data?.studentId, pin = request.data?.pin;
  if (typeof studentId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(studentId) || !validPin(pin)) throw new HttpsError("invalid-argument", "Use a valid profile and four-digit PIN.");
  const ref = db.collection("studentSecrets").doc(studentId);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Profile not found.");
  const salt = crypto.randomBytes(16).toString("hex");
  await ref.update({ pinSalt: salt, pinHash: pinHash(pin, salt), failedPinAttempts: 0, pinLockedUntil: null });
  return { ok: true };
});
exports.adminDeleteStudent = onCall(functionsOptions(), async (request) => {
  requireAdmin(request);
  const studentId = request.data?.studentId;
  if (!adminPasswordMatches(request.data?.adminPassword)) throw new HttpsError("permission-denied", "Admin password is not correct.");
  if (typeof studentId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(studentId)) throw new HttpsError("invalid-argument", "Invalid profile.");
  const ref = db.collection("students").doc(studentId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Profile not found.");
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) return;
    tx.delete(db.collection("studentNames").doc(fresh.get("nameKey")));
    tx.delete(db.collection("studentSecrets").doc(studentId));
    tx.delete(ref);
  });
  await getAuth().deleteUser(studentId).catch(() => {});
  return { ok: true };
});
exports.deleteMyProfile = onCall(functionsOptions(), async (request) => {
  if (!request.auth || request.auth.token.role !== "student") throw new HttpsError("unauthenticated", "Student sign-in is required.");
  if (!adminPasswordMatches(request.data?.adminPassword)) throw new HttpsError("permission-denied", "Admin password is not correct.");
  const studentId = request.auth.uid;
  const ref = db.collection("students").doc(studentId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Profile not found.");
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) return;
    tx.delete(db.collection("studentNames").doc(fresh.get("nameKey")));
    tx.delete(db.collection("studentSecrets").doc(studentId));
    tx.delete(ref);
  });
  await getAuth().deleteUser(studentId).catch(() => {});
  return { ok: true };
});

exports.recordGameResult = onCall(functionsOptions(), async (request) => {
  if (!request.auth || request.auth.token.role !== "student") throw new HttpsError("unauthenticated", "Sign in with your student profile first.");
  const studentId = request.auth.uid;
  const { attemptId, gameMode, score, maxScore, correct, incorrect, hintsUsed, durationSeconds } = request.data || {};
  if (typeof attemptId !== "string" || !/^[A-Za-z0-9_-]{12,80}$/.test(attemptId)) throw new HttpsError("invalid-argument", "Invalid attempt ID.");
  if (typeof gameMode !== "string" || !ALLOWED_MODES.has(gameMode)) throw new HttpsError("invalid-argument", "Unsupported game mode.");
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore < 1 || maxScore > 1000 || score < 0 || score > maxScore) throw new HttpsError("invalid-argument", "Score is outside the allowed range.");
  const safeCount = n => Number.isInteger(n) && n >= 0 ? Math.min(n, 10000) : 0;
  const resultRef = db.collection("students").doc(studentId).collection("attempts").doc(attemptId);
  const studentRef = db.collection("students").doc(studentId);
  const utcDate = new Date().toISOString().slice(0, 10);
  const xpRequested = Math.min(50, Math.max(5, Math.round((score / maxScore) * 50)));
  return db.runTransaction(async (tx) => {
    const [studentSnap, existingSnap] = await Promise.all([tx.get(studentRef), tx.get(resultRef)]);
    if (!studentSnap.exists || studentSnap.get("active") !== true) throw new HttpsError("permission-denied", "Student profile is inactive.");
    if (existingSnap.exists) return { duplicate: true, xpAwarded: existingSnap.get("xpAwarded") || 0 };
    const data = studentSnap.data(), dailyXp = data.dailyXpDate === utcDate ? (data.dailyXp || 0) : 0;
    const xpAwarded = Math.max(0, Math.min(xpRequested, 100 - dailyXp)), oldStats = data.gameStats || {}, oldMode = oldStats[gameMode] || {};
    const result = { attemptId, gameMode, score: Math.round(score * 100) / 100, maxScore: Math.round(maxScore * 100) / 100, correct: safeCount(correct), incorrect: safeCount(incorrect), hintsUsed: safeCount(hintsUsed), durationSeconds: safeCount(durationSeconds), xpAwarded, completedAt: FieldValue.serverTimestamp() };
    tx.create(resultRef, result);
    tx.update(studentRef, { totalAttempts: (data.totalAttempts || 0) + 1, totalXp: (data.totalXp || 0) + xpAwarded, dailyXpDate: utcDate, dailyXp: dailyXp + xpAwarded, gameStats: { ...oldStats, [gameMode]: { attempts: (oldMode.attempts || 0) + 1, bestScore: Math.max(oldMode.bestScore || 0, result.score), lastScore: result.score, lastPlayedAt: FieldValue.serverTimestamp() } }, updatedAt: FieldValue.serverTimestamp() });
    return { duplicate: false, xpAwarded, totalXp: (data.totalXp || 0) + xpAwarded };
  });
});
