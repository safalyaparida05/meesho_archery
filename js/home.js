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

  /* ---------- "Play & Win" nudge tooltip ---------- */
  // A one-time coach-mark above the nav item. Shown once per browser (via
  // localStorage), auto-dismisses itself after a few seconds so it stays a
  // "subtle nudge" rather than a persistent nag, and can also be dismissed
  // early with its own close button or by tapping through to the game.
  var NUDGE_SEEN_KEY = "meeshoArcheryNudgeSeen";
  var NUDGE_AUTO_HIDE_MS = 6000;
  var nudge = document.getElementById("nav-nudge");

  if (nudge) {
    if (localStorage.getItem(NUDGE_SEEN_KEY)) {
      nudge.hidden = true;
    } else {
      var nudgeCloseBtn = document.getElementById("nav-nudge-close");
      var hideTimer = setTimeout(dismissNudge, NUDGE_AUTO_HIDE_MS);

      nudge.addEventListener("click", function () {
        dismissNudge();
        goToArcheryGame();
      });

      if (nudgeCloseBtn) {
        nudgeCloseBtn.addEventListener("click", function (ev) {
          ev.stopPropagation();
          dismissNudge();
        });
      }
    }
  }

  function dismissNudge() {
    if (!nudge || nudge.hidden) return;
    clearTimeout(hideTimer);
    nudge.hidden = true;
    localStorage.setItem(NUDGE_SEEN_KEY, "1");
  }
})();
