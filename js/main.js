import { hasPlaysLeftToday, renderPlaysGate } from "./plays.js";

const startGameBtn = document.getElementById("start-game-btn");
const landingPlaysChipText = document.getElementById("landing-plays-chip-text");

renderPlaysGate(landingPlaysChipText, startGameBtn);

startGameBtn.addEventListener("click", () => {
  // Defensive re-check: plays.js is IST-day-scoped, so a tab left open
  // across midnight (or another tab used up the last play) could make the
  // button's disabled state stale by the time it's actually clicked.
  if (!hasPlaysLeftToday()) {
    renderPlaysGate(landingPlaysChipText, startGameBtn);
    return;
  }
  window.location.href = "game.html";
});

document.getElementById("leaderboard-btn").addEventListener("click", () => {
  window.location.href = "leaderboard.html";
});

document.getElementById("rewards-btn").addEventListener("click", () => {
  window.location.href = "rewards.html";
});

document.getElementById("back-btn").addEventListener("click", () => {
  window.location.href = "index.html";
});

document.getElementById("share-btn").addEventListener("click", async () => {
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Meesho Archery",
        text: "Come play Meesho Archery!",
        url: window.location.href,
      });
    } catch (err) {
      // user cancelled share sheet, nothing to do
    }
  } else {
    console.log("Share tapped (Web Share API not supported)");
  }
});
