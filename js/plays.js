// Daily play-limit gating — shared by landing.html, game.html, and
// leaderboard.html so all three surfaces agree on "how many plays are left
// today" and render the same chip/disabled-button treatment.
//
// "Today" is always IST (Asia/Kolkata), not the device's local timezone —
// the whole game resets at IST midnight regardless of where the player
// physically is. This MUST stay in sync with the MAX_PLAYS_PER_DAY() rules
// function in firestore.rules and the daily-collection logic in
// js/firebase-init.js.

/* ---------- The one number to change ---------- */
// Change this single constant (and its twin, MAX_PLAYS_PER_DAY(), in
// firestore.rules) to move the daily cap, e.g. from 5 to 3.
export const MAX_PLAYS_PER_DAY = 5;

/* ---------- IST day helpers ---------- */

// en-CA's Intl date format is YYYY-MM-DD, so formatting straight into that
// locale gets us an ISO day string for Asia/Kolkata with no manual UTC-offset
// math (IST has a 30-minute-off, non-whole-hour offset from UTC, which makes
// hand-rolled arithmetic easy to get subtly wrong around midnight).
const IST_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getIstDateString(date = new Date()) {
  return IST_FORMATTER.format(date);
}

/* ---------- Local play-count storage ---------- */

const PLAYS_STATE_KEY = "meeshoArcheryPlaysState";

function readPlaysState() {
  const today = getIstDateString();
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(PLAYS_STATE_KEY) || "null");
  } catch (err) {
    raw = null;
  }
  // A stored count from any IST day other than today is stale — treat it as
  // zero rather than deleting it here, so we never write to storage on a
  // plain read (only consumePlay() writes).
  if (!raw || typeof raw !== "object" || raw.date !== today || typeof raw.count !== "number") {
    return { date: today, count: 0 };
  }
  return raw;
}

function writePlaysState(state) {
  try {
    localStorage.setItem(PLAYS_STATE_KEY, JSON.stringify(state));
  } catch (err) {
    // Storage full/unavailable (e.g. private browsing) — fail soft, the
    // play just won't be remembered across reloads this session.
  }
}

export function getPlaysUsedToday() {
  return readPlaysState().count;
}

export function getPlaysLeftToday() {
  return Math.max(0, MAX_PLAYS_PER_DAY - getPlaysUsedToday());
}

export function hasPlaysLeftToday() {
  return getPlaysLeftToday() > 0;
}

// Records one play against today's IST date. Called once per round started
// (see js/game.js). Returns the plays-left count after the consumption.
export function consumePlay() {
  const state = readPlaysState();
  state.count += 1;
  writePlaysState(state);
  return Math.max(0, MAX_PLAYS_PER_DAY - state.count);
}

/* ---------- Shared chip + button gating UI ---------- */

// Renders the plays chip's text/class and (optionally) disables a paired
// "start a round" button, exactly matching the three Figma states:
//   - Figma node 131:1505 — fresh day, full plays available ("Daily N chances")
//   - Figma node 131:1429 — some plays used ("N chances left")
//   - Figma node 131:1467 — all plays used ("Come back tomorrow", button disabled)
//
// `chipTextEl` is the element whose textContent gets the label; `buttonEl`
// (optional) is the button to disable/re-enable to match.
export function renderPlaysGate(chipTextEl, buttonEl) {
  const playsLeft = getPlaysLeftToday();
  const exhausted = playsLeft <= 0;

  if (chipTextEl) {
    if (exhausted) {
      chipTextEl.textContent = "Come back tomorrow!";
    } else if (playsLeft >= MAX_PLAYS_PER_DAY) {
      chipTextEl.textContent = `Daily ${MAX_PLAYS_PER_DAY} chances`;
    } else {
      chipTextEl.textContent = `${playsLeft} ${playsLeft === 1 ? "chance" : "chances"} left`;
    }
  }

  if (buttonEl) {
    buttonEl.disabled = exhausted;
  }

  return { playsLeft, exhausted };
}
