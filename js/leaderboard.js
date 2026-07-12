import {
  saveProfileAndSync,
  fetchLeaderboard,
  fetchDailyLeaderboard,
  getOrCreatePlayerId,
  isNameTaken,
} from "./firebase-init.js";
import { getIstDateString, renderPlaysGate } from "./plays.js";

/* ---------- Storage keys (must match js/game.js) ---------- */

const LIFETIME_SCORE_KEY = "meeshoArcheryLifetimeScore";
// Fastest single round ever played on this device — a running minimum, not
// a sum. Replaces the old cumulative "lifetime time" figure; see the same
// key/comment in js/game.js.
const LIFETIME_BEST_TIME_KEY = "meeshoArcheryLifetimeBestTime";
const NO_BEST_TIME_YET = 100000; // sentinel for "no round played yet" — mirrors firebase-init.js
const PROFILE_KEY = "meeshoArcheryProfile";

/* ---------- Avatar pools ---------- */
/* Randomly (but permanently, once chosen) assigned per player based on the
   gender they pick at signup — see assets/images/leaderboard/ for the
   source crops. "Don't wish" gets the one androgynous/neutral crop. */

const AVATAR_POOLS = {
  male: [
    "assets/images/leaderboard/avatar-male-1.png",
    "assets/images/leaderboard/avatar-male-2.png",
    "assets/images/leaderboard/avatar-male-3.png",
    "assets/images/leaderboard/avatar-male-4.png",
  ],
  female: [
    "assets/images/leaderboard/avatar-female-1.png",
    "assets/images/leaderboard/avatar-female-2.png",
    "assets/images/leaderboard/avatar-female-3.png",
    "assets/images/leaderboard/avatar-female-4.png",
  ],
  unspecified: ["assets/images/leaderboard/avatar-neutral-1.png"],
};

function pickRandomAvatar(gender) {
  const pool = AVATAR_POOLS[gender] || AVATAR_POOLS.unspecified;
  return pool[Math.floor(Math.random() * pool.length)];
}

const MEDALS = [
  "assets/images/leaderboard/medal-gold.png",
  "assets/images/leaderboard/medal-silver.png",
  "assets/images/leaderboard/medal-bronze.png",
];

/* ---------- Mock rows for the locked/blurred preview ---------- */
/* Purely decorative placeholder content — real names are never shown until
   the viewer unlocks their own ranking, so this mirrors the Figma mock data
   rather than anything real. */

const MOCK_ROWS = [
  { name: "Safalya", score: 100, time: 20, avatar: "assets/images/leaderboard/avatar-male-1.png" },
  { name: "Sunayana", score: 80, time: 22, avatar: "assets/images/leaderboard/avatar-female-1.png" },
  { name: "Dharmesh", score: 80, time: 23, avatar: "assets/images/leaderboard/avatar-male-2.png" },
  { name: "Nikita", score: 90, time: 15, avatar: "assets/images/leaderboard/avatar-female-2.png" },
  { name: "Somesh", score: 80, time: 24, avatar: "assets/images/leaderboard/avatar-male-3.png" },
  { name: "Sonali", score: 70, time: 30, avatar: "assets/images/leaderboard/avatar-female-3.png" },
  { name: "Aswin", score: 70, time: 35, avatar: "assets/images/leaderboard/avatar-male-4.png" },
  { name: "Nikita", score: 70, time: 36, avatar: "assets/images/leaderboard/avatar-female-4.png" },
  { name: "Nikita", score: 60, time: 15, avatar: "assets/images/leaderboard/avatar-neutral-1.png" },
];

/* ---------- DOM refs ---------- */

const backBtn = document.getElementById("back-btn");
const shareBtn = document.getElementById("share-btn");
const tabDailyBtn = document.getElementById("lb-tab-daily");
const tabLifetimeBtn = document.getElementById("lb-tab-lifetime");
const leaderboardCard = document.getElementById("leaderboard-card");
const rowsWrap = document.getElementById("lb-rows-wrap");
const rowsEl = document.getElementById("lb-rows");
const blurOverlay = document.getElementById("lb-blur-overlay");
const lockPill = document.getElementById("lb-lock-pill");
const leaderboardFade = document.getElementById("leaderboard-fade");
const unlockedActions = document.getElementById("leaderboard-unlocked-actions");
const playAgainBtn = document.getElementById("play-again-lb-btn");
const playAgainChipText = document.getElementById("lb-plays-chip-text");
const nameDetailsCard = document.getElementById("name-details-card");
const nameInput = document.getElementById("name-input");
const saveProfileBtn = document.getElementById("save-profile-btn");
const errorEl = document.getElementById("name-details-error");
const genderChips = Array.from(document.querySelectorAll(".gender-chip"));
const toastEl = document.getElementById("toast");

let selectedGender = null;
// "daily" or "lifetime" — which tab's data is currently rendered. Daily
// starts active per the feature spec's TAB 1/TAB 2 ordering.
let activeTab = "daily";

/* ---------- Helpers ---------- */

function getLifetimeScore() {
  return Number(localStorage.getItem(LIFETIME_SCORE_KEY) || 0);
}

function getLifetimeBestTime() {
  return Number(localStorage.getItem(LIFETIME_BEST_TIME_KEY) || NO_BEST_TIME_YET);
}

function getProfile() {
  const raw = localStorage.getItem(PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function showToast(message, duration = 1800) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(showToast._handle);
  showToast._handle = setTimeout(() => {
    toastEl.hidden = true;
  }, duration);
}

function rankBadgeMarkup(index) {
  if (index < 3) {
    return `<span class="lb-row__rank"><img src="${MEDALS[index]}" alt="" /></span>`;
  }
  return `<span class="lb-row__rank lb-row__rank--num">${index + 1}.</span>`;
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

function buildRowEl({ name, score, time, avatar, isMe }, index) {
  const li = document.createElement("li");
  li.className = "lb-row" + (isMe ? " lb-row--me" : "");
  li.innerHTML = `
    ${rankBadgeMarkup(index)}
    <img class="lb-row__avatar" src="${avatar}" alt="" />
    <span class="lb-row__name">${escapeHtml(name)}</span>
    <span class="lb-row__score">${score}</span>
    <span class="lb-row__time">${formatTime(time)}</span>
  `;
  return li;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

function renderRows(rows) {
  rowsEl.innerHTML = "";
  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "lb-empty";
    empty.textContent = "No rankings yet — be the first!";
    rowsEl.appendChild(empty);
    return;
  }
  rows.forEach((row, index) => {
    rowsEl.appendChild(buildRowEl(row, index));
  });
}

/* ---------- Locked state ---------- */

function renderLockedState() {
  leaderboardCard.classList.add("leaderboard-card--locked");
  blurOverlay.hidden = false;
  lockPill.hidden = false;
  leaderboardFade.hidden = false;
  leaderboardFade.classList.add("leaderboard-fade--locked");
  leaderboardFade.classList.remove("leaderboard-fade--unlocked");
  unlockedActions.hidden = true;
  nameDetailsCard.hidden = false;
  renderRows(MOCK_ROWS);
}

/* ---------- Tabs ---------- */

function setActiveTab(tab) {
  if (tab === activeTab) return;
  activeTab = tab;
  tabDailyBtn.classList.toggle("is-active", tab === "daily");
  tabDailyBtn.setAttribute("aria-selected", String(tab === "daily"));
  tabLifetimeBtn.classList.toggle("is-active", tab === "lifetime");
  tabLifetimeBtn.setAttribute("aria-selected", String(tab === "lifetime"));
  refreshActiveTab();
}

function refreshActiveTab() {
  if (getProfile()) {
    renderUnlockedState();
  } else {
    renderLockedState();
  }
}

tabDailyBtn.addEventListener("click", () => setActiveTab("daily"));
tabLifetimeBtn.addEventListener("click", () => setActiveTab("lifetime"));

function setSelectedGender(gender) {
  selectedGender = gender;
  genderChips.forEach((chip) => {
    const isSelected = chip.dataset.gender === gender;
    chip.classList.toggle("is-selected", isSelected);
    chip.querySelector(".gender-chip__tick").hidden = !isSelected;
  });
}

genderChips.forEach((chip) => {
  chip.addEventListener("click", () => setSelectedGender(chip.dataset.gender));
});

saveProfileBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) {
    errorEl.textContent = "Please enter your name.";
    errorEl.hidden = false;
    return;
  }
  if (!selectedGender) {
    errorEl.textContent = "Please select a gender.";
    errorEl.hidden = false;
    return;
  }
  errorEl.hidden = true;

  saveProfileBtn.disabled = true;
  const originalLabel = saveProfileBtn.textContent;
  saveProfileBtn.textContent = "Saving...";

  try {
    const myPlayerId = getOrCreatePlayerId();
    const nameTaken = await isNameTaken(name, myPlayerId);
    if (nameTaken) {
      errorEl.textContent = "This name is already taken. Please try another one.";
      errorEl.hidden = false;
      saveProfileBtn.disabled = false;
      saveProfileBtn.textContent = originalLabel;
      return;
    }

    const profile = {
      name,
      gender: selectedGender,
      avatar: pickRandomAvatar(selectedGender),
    };

    await saveProfileAndSync({
      ...profile,
      score: getLifetimeScore(),
      bestTime: getLifetimeBestTime(),
    });
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    await renderUnlockedState();
  } catch (err) {
    console.warn("[meesho-archery] saveProfileAndSync failed:", err && err.message);
    showToast("Couldn't save right now — please try again");
    saveProfileBtn.disabled = false;
    saveProfileBtn.textContent = originalLabel;
  }
});

/* ---------- Unlocked state ---------- */

async function renderUnlockedState() {
  leaderboardCard.classList.remove("leaderboard-card--locked");
  blurOverlay.hidden = true;
  lockPill.hidden = true;
  leaderboardFade.hidden = false;
  leaderboardFade.classList.add("leaderboard-fade--unlocked");
  leaderboardFade.classList.remove("leaderboard-fade--locked");
  nameDetailsCard.hidden = true;
  unlockedActions.hidden = false;
  renderPlaysGate(playAgainChipText, playAgainBtn);

  renderRows([]); // clear immediately, then fill in once the fetch resolves
  rowsEl.innerHTML = `<li class="lb-empty">Loading rankings...</li>`;

  const profile = getProfile();
  const myPlayerId = getOrCreatePlayerId();

  if (activeTab === "daily") {
    try {
      const players = await fetchDailyLeaderboard(getIstDateString());
      const rows = players.map((player) => ({
        name: player.name || "Player",
        score: player.bestScore || 0,
        time: player.bestTime || 0,
        avatar: player.avatar || pickRandomAvatar(player.gender),
        isMe: player.id === myPlayerId,
      }));
      renderRows(rows);
    } catch (err) {
      console.warn("[meesho-archery] fetchDailyLeaderboard failed:", err && err.message);
      // Fail soft: there's no reliable local "today's best score" to fall
      // back on (that's tracked server-side only), so just show an empty
      // board rather than a stale/wrong number.
      renderRows([]);
      showToast("Couldn't load today's leaderboard");
    }
    return;
  }

  try {
    const players = await fetchLeaderboard();
    const rows = players.map((player) => ({
      name: player.name || "Player",
      score: player.score || 0,
      time: typeof player.bestTime === "number" ? player.bestTime : NO_BEST_TIME_YET,
      avatar: player.avatar || pickRandomAvatar(player.gender),
      isMe: player.id === myPlayerId,
    }));
    renderRows(rows);
  } catch (err) {
    console.warn("[meesho-archery] fetchLeaderboard failed:", err && err.message);
    // Fail soft: still show the player their own row so the screen isn't
    // just an error state, even if the live board couldn't be reached.
    if (profile) {
      renderRows([
        {
          name: profile.name,
          score: getLifetimeScore(),
          time: getLifetimeBestTime(),
          avatar: profile.avatar,
          isMe: true,
        },
      ]);
    } else {
      renderRows([]);
    }
    showToast("Couldn't load the live leaderboard");
  }
}

/* ---------- Init ---------- */

function init() {
  const profile = getProfile();
  if (profile) {
    renderUnlockedState();
  } else {
    renderLockedState();
  }
}

backBtn.addEventListener("click", () => {
  window.location.href = "landing.html";
});

playAgainBtn.addEventListener("click", () => {
  window.location.href = "game.html";
});

shareBtn.addEventListener("click", async () => {
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Meesho Archery",
        text: "Check out the Meesho Archery leaderboard!",
        url: window.location.href,
      });
    } catch (err) {
      // user cancelled share sheet, nothing to do
    }
  } else {
    showToast("Share not supported on this browser");
  }
});

init();
