// Firebase wiring for the leaderboard feature.
//
// This is a plain client-side Web SDK config (apiKey/authDomain/projectId/
// etc.) — it is NOT a secret. Firebase's actual security boundary is
// Firestore's security rules (and optionally App Check), not hiding this
// config. See the Firestore rules note left for the team when this file was
// introduced: since there's no auth layer, the rules need to validate writes
// (e.g. only allow score/time to increase, cap per-write deltas) rather than
// trusting the client blindly.
//
// Loaded as an ES module (see the `type="module"` script tags in
// leaderboard.html and game.html) so it can use import/export directly via
// the Firebase CDN, with no bundler.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  increment,
  collection,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAirBWzcDj2ct3cCdcirxommFPWiIQSm5I",
  authDomain: "meesho-archery.firebaseapp.com",
  projectId: "meesho-archery",
  storageBucket: "meesho-archery.firebasestorage.app",
  messagingSenderId: "1093635456290",
  appId: "1:1093635456290:web:788084d6aa17227f10797b",
  measurementId: "G-VC65RDGZ6J",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const PLAYERS_COLLECTION = "players";
const PLAYER_ID_KEY = "meeshoArcheryPlayerId";

/**
 * Every device gets a stable random player id the first time it's needed,
 * persisted in localStorage — this is what ties a device's local profile to
 * its Firestore document, with no auth/login involved.
 */
export function getOrCreatePlayerId() {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

/**
 * Creates (or updates) this device's player document with profile info —
 * called once, right after the player fills in the name/gender form and
 * taps Save. `profile` is { name, gender, avatar, score, time }; score/time
 * are the lifetime totals already accumulated locally so the very first
 * sync doesn't start the player back at zero.
 */
export async function saveProfileAndSync(profile) {
  const playerId = getOrCreatePlayerId();
  const ref = doc(db, PLAYERS_COLLECTION, playerId);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    await updateDoc(ref, {
      name: profile.name,
      gender: profile.gender,
      avatar: profile.avatar,
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(ref, {
      name: profile.name,
      gender: profile.gender,
      avatar: profile.avatar,
      score: profile.score || 0,
      time: profile.time || 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  return playerId;
}

/**
 * Adds this round's score/time onto the player's Firestore totals. Only
 * meaningful once a profile has been saved (i.e. the player has a Firestore
 * doc) — callers should check for a saved local profile before calling this,
 * and it fails soft (logs + resolves) if the doc doesn't exist yet.
 */
export async function incrementPlayerStats(roundScore, roundTimeSeconds) {
  const playerId = getOrCreatePlayerId();
  const ref = doc(db, PLAYERS_COLLECTION, playerId);
  try {
    await updateDoc(ref, {
      score: increment(roundScore),
      time: increment(roundTimeSeconds),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[meesho-archery] incrementPlayerStats skipped:", err && err.message);
  }
}

/**
 * Checks whether another player has already claimed this name (case- and
 * whitespace-insensitive, e.g. "Ankita" and " ankita " collide) so the
 * name-details form can block duplicates before saving. `excludePlayerId`
 * is this device's own player id, so a returning player never gets flagged
 * against their own already-saved name.
 *
 * This does a full-collection read rather than a Firestore query because
 * there's no normalized "nameLower" field in the schema (and adding one
 * would require a security-rules change) — fine at this app's scale, and
 * it's the same read pattern fetchLeaderboard() already relies on.
 */
export async function isNameTaken(name, excludePlayerId) {
  const target = name.trim().toLowerCase();
  const snap = await getDocs(collection(db, PLAYERS_COLLECTION));
  let taken = false;
  snap.forEach((docSnap) => {
    if (docSnap.id === excludePlayerId) return;
    const existingName = docSnap.data().name;
    if (typeof existingName === "string" && existingName.trim().toLowerCase() === target) {
      taken = true;
    }
  });
  return taken;
}

/**
 * Fetches every player and sorts by the ranking rule the user specified:
 * highest lifetime score first, then lowest lifetime time as the tiebreak.
 */
export async function fetchLeaderboard() {
  const snap = await getDocs(collection(db, PLAYERS_COLLECTION));
  const players = [];
  snap.forEach((docSnap) => {
    players.push({ id: docSnap.id, ...docSnap.data() });
  });

  players.sort((a, b) => {
    const scoreA = a.score || 0;
    const scoreB = b.score || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    const timeA = a.time || 0;
    const timeB = b.time || 0;
    return timeA - timeB;
  });

  return players;
}
