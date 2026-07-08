document.getElementById("back-btn").addEventListener("click", () => {
  window.location.href = "landing.html";
});

document.getElementById("share-btn").addEventListener("click", async () => {
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Meesho Archery",
        text: "Come play Meesho Archery and win exciting prizes!",
        url: window.location.href,
      });
    } catch (err) {
      // user cancelled share sheet, nothing to do
    }
  } else {
    console.log("Share tapped (Web Share API not supported)");
  }
});
