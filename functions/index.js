"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const crypto = require("node:crypto");

initializeApp();
const db = getFirestore();

const MAX_PIN_ATTEMPTS = 5;
const LOCK_MINUTES = 10;
const ALLOWED_MODES = new Set([
  "word-match",
  "sentence-builder",
  "story-blanks",
  "math-quiz",
  "fill-in-the-blank",
  "word-detective",
  "other"
]);

function normaliseName(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 60);
}
function normaliseNameKey(value) {
  return normaliseName(value).toLocaleLowerCase("en");
}
function validPin(pin) {
  return typeof pin === "string" && /^[0-9]{4}$/.test(pin);
}
function pinHash(pin, salt) {
  return crypto.scryptSync(pin, salt, 64).toString("hex");
}
function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch (_) {
    return false;
  }
}

/**
 * Public profile picker. Only returns display names and opaque IDs; never returns PIN data.
 * Configure Firebase App Check before public deployment to reduce automated abuse.
 */
exports.listStudentProfiles = onCall({ region: "asia-southeast1" }, async () => {
  const snap = await db.collection("students").where("active", "==", true).orderBy("displayName").limit(500).get();
  return {
    profiles: snap.docs.map((doc) => ({
      id: doc.id,
      displayName: doc.get("displayName")
    }))
  };
});

/**
 * Verifies a four-digit PIN server-side, throttles failed attempts, and returns a custom token.
 * PIN hashes are never sent to the browser.
 */
exports.loginWithPin = onCall({ region: "asia-southeast1" }, async (request) => {
  const studentId = typeof request.data?.studentId === "string" ? request.data.studentId : "";
  const pin = request.data?.pin;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(studentId) || !validPin(pin)) {
    throw new HttpsError("invalid-argument", "Choose a profile and enter a four-digit PIN.");
  }

  const ref = db.collection("students").doc(studentId);
  const secretRef = db.collection("studentSecrets").doc(studentId);
  const result = await db.runTransaction(async (tx) => {
    const [snap, secretSnap] = await Promise.all([tx.get(ref), tx.get(secretRef)]);
    if (!snap.exists || snap.get("active") !== true || !secretSnap.exists) {
      return { ok: false, reason: "invalid" };
    }

    const data = snap.data();
    const secret = secretSnap.data();
    const now = Date.now();
    const lockedUntil = secret.pinLockedUntil?.toMillis?.() || 0;
    if (lockedUntil > now) return { ok: false, reason: "locked" };

    const expected = pinHash(pin, secret.pinSalt || "");
    if (!safeEqualHex(expected, secret.pinHash || "")) {
      const attempts = (secret.failedPinAttempts || 0) + 1;
      const update = { failedPinAttempts: attempts };
      if (attempts >= MAX_PIN_ATTEMPTS) {
        update.pinLockedUntil = Timestamp.fromMillis(now + LOCK_MINUTES * 60 * 1000);
        update.failedPinAttempts = 0;
      }
      tx.update(secretRef, update);
      return { ok: false, reason: attempts >= MAX_PIN_ATTEMPTS ? "locked" : "invalid" };
    }

    tx.update(secretRef, { failedPinAttempts: 0, pinLockedUntil: null });
    tx.update(ref, { lastLoginAt: FieldValue.serverTimestamp() });
    return { ok: true, displayName: data.displayName };
  });

  if (!result.ok) {
    if (result.reason === "locked") {
      throw new HttpsError("resource-exhausted", "Too many attempts. Wait 10 minutes and try again.");
    }
    throw new HttpsError("unauthenticated", "That PIN is not correct.");
  }

  const token = await getAuth().createCustomToken(studentId, { role: "student" });
  return { token, studentId, displayName: result.displayName };
});

/**
 * Records one result per unique attempt ID. The browser should generate a new random UUID
 * for each completed attempt and reuse it if retrying a failed network submission.
 */
exports.recordGameResult = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth || request.auth.token.role !== "student") {
    throw new HttpsError("unauthenticated", "Sign in with your student profile first.");
  }

  const studentId = request.auth.uid;
  const { attemptId, gameMode, score, maxScore, correct, incorrect, hintsUsed, durationSeconds } = request.data || {};
  if (typeof attemptId !== "string" || !/^[A-Za-z0-9_-]{12,80}$/.test(attemptId)) {
    throw new HttpsError("invalid-argument", "Invalid attempt ID.");
  }
  if (typeof gameMode !== "string" || !ALLOWED_MODES.has(gameMode)) {
    throw new HttpsError("invalid-argument", "Unsupported game mode.");
  }
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore < 1 || maxScore > 1000 || score < 0 || score > maxScore) {
    throw new HttpsError("invalid-argument", "Score is outside the allowed range.");
  }

  const safeCount = (n) => Number.isInteger(n) && n >= 0 ? Math.min(n, 10000) : 0;
  const resultRef = db.collection("students").doc(studentId).collection("attempts").doc(attemptId);
  const studentRef = db.collection("students").doc(studentId);
  const utcDate = new Date().toISOString().slice(0, 10);
  const xpRequested = Math.min(50, Math.max(5, Math.round((score / maxScore) * 50)));

  const outcome = await db.runTransaction(async (tx) => {
    const [studentSnap, existingSnap] = await Promise.all([tx.get(studentRef), tx.get(resultRef)]);
    if (!studentSnap.exists || studentSnap.get("active") !== true) {
      throw new HttpsError("permission-denied", "Student profile is inactive.");
    }
    if (existingSnap.exists) return { duplicate: true, xpAwarded: existingSnap.get("xpAwarded") || 0 };

    const data = studentSnap.data();
    const dailyXp = data.dailyXpDate === utcDate ? (data.dailyXp || 0) : 0;
    const xpAwarded = Math.max(0, Math.min(xpRequested, 100 - dailyXp));
    const oldStats = data.gameStats || {};
    const oldMode = oldStats[gameMode] || {};
    const result = {
      attemptId,
      gameMode,
      score: Math.round(score * 100) / 100,
      maxScore: Math.round(maxScore * 100) / 100,
      correct: safeCount(correct),
      incorrect: safeCount(incorrect),
      hintsUsed: safeCount(hintsUsed),
      durationSeconds: safeCount(durationSeconds),
      xpAwarded,
      completedAt: FieldValue.serverTimestamp()
    };
    tx.create(resultRef, result);
    tx.update(studentRef, {
      totalAttempts: (data.totalAttempts || 0) + 1,
      totalXp: (data.totalXp || 0) + xpAwarded,
      dailyXpDate: utcDate,
      dailyXp: dailyXp + xpAwarded,
      gameStats: {
        ...oldStats,
        [gameMode]: {
          attempts: (oldMode.attempts || 0) + 1,
          bestScore: Math.max(oldMode.bestScore || 0, result.score),
          lastScore: result.score,
          lastPlayedAt: FieldValue.serverTimestamp()
        }
      },
      updatedAt: FieldValue.serverTimestamp()
    });
    return { duplicate: false, xpAwarded, totalXp: (data.totalXp || 0) + xpAwarded };
  });

  return outcome;
});
