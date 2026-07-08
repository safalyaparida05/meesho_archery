(function () {
  "use strict";

  function goToArcheryGame() {
    window.location.href = "landing.html";
  }

  var widgetHotspot = document.getElementById("widget-hotspot");
  if (widgetHotspot) {
    widgetHotspot.addEventListener("click", goToArcheryGame);
  }

  var playWinBtn = document.getElementById("play-win-btn");
  if (playWinBtn) {
    playWinBtn.addEventListener("click", goToArcheryGame);
  }
})();
