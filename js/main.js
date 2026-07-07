document.getElementById("start-game-btn").addEventListener("click", () => {
  window.location.href = "game.html";
});

document.getElementById("rewards-btn").addEventListener("click", () => {
  // TODO: navigate to rewards screen once it is built
  console.log("Rewards tapped");
});

document.getElementById("how-to-play-btn").addEventListener("click", () => {
  // TODO: open how-to-play modal/screen once it is built
  console.log("How to play tapped");
});

document.getElementById("back-btn").addEventListener("click", () => {
  console.log("Back tapped");
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
