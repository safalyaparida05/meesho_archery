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
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { MAX_PLAYS_PER_DAY, getIstDateString } from "./plays.js";

// Re-exported so callers that already import from firebase-init.js (the
// leaderboard/daily-write surface) don't also need a separate import of
// js/plays.js just for this one constant.
export { MAX_PLAYS_PER_DAY };

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
// Daily leaderboard docs live at dailyLeaderboard/{istDate}/players/{playerId}
// — a subcollection per IST day rather than a flat collection with a
// composite id, so Firestore rules can bind istDate/playerId straight from
// the path instead of parsing them back out of a string. Each doc also
// doubles as that player's play-count audit trail for the day (playsUsed).
const DAILY_COLLECTION = "dailyLeaderboard";
const DAILY_SUBCOLLECTION = "players";
const PLAYER_ID_KEY = "meeshoArcheryPlayerId";
// Sentinel for "no round played yet" in a numeric bestTime field — Firestore
// rules need a number (not null) to validate against, so a fresh profile
// starts at this generous ceiling (matches the existing cap used elsewhere
// in firestore.rules) rather than a real elapsed time.
const NO_BEST_TIME_YET = 100000;
// Identity used for a round played before the device has ever saved a
// leaderboard profile — see the "sync every round, show only once a real
// profile exists" note above saveProfileAndSync().
const PLACEHOLDER_NAME = "Player";
const PLACEHOLDER_GENDER = "unspecified";
const PLACEHOLDER_AVATAR = "assets/images/leaderboard/avatar-neutral-1.png";

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
 *
 * Rounds played before a profile exists already synced their score/time
 * under a placeholder identity (see incrementPlayerStats/recordDailyRound
 * below) but stayed hidden from the leaderboard (hasProfile: false). This
 * is the moment that flips hasProfile to true — for the /players doc
 * directly, and for today's daily-leaderboard entry via
 * syncProfileToToday() — so real score/time already earned becomes visible
 * immediately, correctly labeled, with no extra "play" consumed.
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
      hasProfile: true,
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(ref, {
      name: profile.name,
      gender: profile.gender,
      avatar: profile.avatar,
      score: profile.score || 0,
      time: profile.time || 0,
      hasProfile: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await syncProfileToToday(profile).catch((err) => {
    console.warn("[meesho-archery] syncProfileToToday skipped:", err && err.message);
  });

  return playerId;
}

/**
 * Relabels today's daily-leaderboard entry (if one already exists from
 * rounds played before this profile was saved) with the real name/gender/
 * avatar and flips hasProfile to true — without touching bestScore/
 * bestTime/playsUsed. No-op if the player hasn't played today yet (nothing
 * to relabel).
 */
async function syncProfileToToday(profile) {
  const playerId = getOrCreatePlayerId();
  const istDate = getIstDateString();
  const ref = doc(db, DAILY_COLLECTION, istDate, DAILY_SUBCOLLECTION, playerId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  await updateDoc(ref, {
    name: profile.name,
    gender: profile.gender,
    avatar: profile.avatar,
    hasProfile: true,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Adds this round's score/time onto the player's Firestore totals — called
 * after EVERY finished round, whether or not a profile has been saved yet.
 * `profile` is the caller's current local profile (or null/undefined if
 * none exists yet). If this is the very first round ever synced for this
 * device, the doc doesn't exist yet: it's created directly with this
 * round's score/time as the starting totals, under a placeholder identity
 * (hasProfile: false) if no profile is saved, so the round's result is
 * never silently dropped while the player is still anonymous. Later rounds
 * just increment as before. Fails soft (logs + resolves) on error.
 */
export async function incrementPlayerStats(roundScore, roundTimeSeconds, profile) {
  const playerId = getOrCreatePlayerId();
  const ref = doc(db, PLAYERS_COLLECTION, playerId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        name: (profile && profile.name) || PLACEHOLDER_NAME,
        gender: (profile && profile.gender) || PLACEHOLDER_GENDER,
        avatar: (profile && profile.avatar) || PLACEHOLDER_AVATAR,
        score: roundScore,
        time: roundTimeSeconds,
        hasProfile: !!profile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return;
    }
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
 *
 * Rows with hasProfile explicitly false are skipped — those are rounds
 * synced under a placeholder identity before the device ever saved a real
 * profile, kept out of public view until the player actually claims a name.
 * A MISSING hasProfile field (every doc from before this feature existed)
 * is treated as visible, so no existing player's row disappears.
 */
export async function fetchLeaderboard() {
  const snap = await getDocs(collection(db, PLAYERS_COLLECTION));
  const players = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.hasProfile === false) return;
    players.push({ id: docSnap.id, ...data });
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

/* ---------- Daily leaderboard + play cap ---------- */

/**
 * Records one round against today's IST-date daily doc for this player —
 * creating it on the player's first play of the day, or updating it on
 * later plays. Unlike the lifetime collection, this is NOT a running sum:
 * bestScore/bestTime only move if this round actually beat the existing
 * value (per the "one row per player per day = their best score that day"
 * rule), and playsUsed always increments by exactly 1 per call.
 *
 * A transaction is required (not a plain update) because bestScore/bestTime
 * both depend on comparing against the current stored value, and
 * playsUsed's new value depends on the current count.
 *
 * `profile` is optional {name, gender, avatar} — passed so the daily doc has
 * enough info to render a row without a second lookup into /players; omitted
 * (or partial) if the player hasn't saved a profile yet. Called after EVERY
 * round now (not just once a profile exists) — `hasProfile` records whether
 * a real profile was attached at write time, so the row stays hidden (see
 * fetchDailyLeaderboard) until saveProfileAndSync()'s syncProfileToToday()
 * flips it to true, or a later round played post-profile does the same.
 */
export async function recordDailyRound({ istDate, score, timeSeconds, name, gender, avatar, hasProfile }) {
  const playerId = getOrCreatePlayerId();
  const ref = doc(db, DAILY_COLLECTION, istDate, DAILY_SUBCOLLECTION, playerId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        tx.set(ref, {
          name: name || PLACEHOLDER_NAME,
          gender: gender || PLACEHOLDER_GENDER,
          avatar: avatar || PLACEHOLDER_AVATAR,
          bestScore: score,
          bestTime: timeSeconds,
          playsUsed: 1,
          hasProfile: !!hasProfile,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return;
      }
      const data = snap.data();
      const currentBestScore = typeof data.bestScore === "number" ? data.bestScore : 0;
      const currentBestTime = typeof data.bestTime === "number" ? data.bestTime : NO_BEST_TIME_YET;
      const currentPlaysUsed = typeof data.playsUsed === "number" ? data.playsUsed : 0;
      // "Beats today's best" = higher score, or same score with a faster
      // time — matches the tie-break rule used for ranking the tab itself.
      const beatsBest =
        score > currentBestScore || (score === currentBestScore && timeSeconds < currentBestTime);
      tx.update(ref, {
        name: name || data.name,
        gender: gender || data.gender,
        avatar: avatar || data.avatar,
        bestScore: beatsBest ? score : currentBestScore,
        bestTime: beatsBest ? timeSeconds : currentBestTime,
        playsUsed: Math.min(MAX_PLAYS_PER_DAY, currentPlaysUsed + 1),
        hasProfile: !!hasProfile || data.hasProfile === true,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (err) {
    console.warn("[meesho-archery] recordDailyRound skipped:", err && err.message);
  }
}

/**
 * Fetches every player's row for one IST date and sorts by the same rule as
 * the daily tab: highest bestScore that day first, then fastest bestTime
 * that day as the tiebreak.
 *
 * Same hasProfile visibility rule as fetchLeaderboard(): explicit false
 * stays hidden, missing/true shows.
 */
export async function fetchDailyLeaderboard(istDate) {
  const snap = await getDocs(collection(db, DAILY_COLLECTION, istDate, DAILY_SUBCOLLECTION));
  const players = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.hasProfile === false) return;
    players.push({ id: docSnap.id, ...data });
  });

  players.sort((a, b) => {
    const scoreA = a.bestScore || 0;
    const scoreB = b.bestScore || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    const timeA = typeof a.bestTime === "number" ? a.bestTime : NO_BEST_TIME_YET;
    const timeB = typeof b.bestTime === "number" ? b.bestTime : NO_BEST_TIME_YET;
    return timeA - timeB;
  });

  return players;
}
