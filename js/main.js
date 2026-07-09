document.getElementById("start-game-btn").addEventListener("click", () => {
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
