(() => {
  "use strict";

  /* ---------- Config ---------- */

  const GAME_DURATION = 60; // seconds
  const TOTAL_ARROWS = 10;
  const POINTS_PER_HIT = 10;
  const ARROW_SPEED_PX_MS = 1.15; // flight speed, so travel time scales with screen size
  const FLIGHT_DURATION_MIN = 280; // ms
  const FLIGHT_DURATION_MAX = 650; // ms
  const FLIGHT_OVERSHOOT_PX = 14; // how far past the conveyor's top edge the arrow travels before vanishing
  const MIN_PULL_PX = 14; // below this, release cancels the shot
  const MAX_PULL_PX = 64; // full charge distance, capped further per-pull to fit on screen
  const PULL_SAFE_MARGIN_PX = 10; // keep the stretched string/arrow this far clear of the screen edge
  // Tight hit window: the arrow's lane has to land close to dead-center on the
  // object's own artwork (not just anywhere inside its padded box), so shots
  // must be timed/aimed precisely rather than lightly grazing an object.
  const MIN_TOLERANCE_FACTOR = 0.12; // fraction of an item's half-width counted as a hit at zero charge
  const MAX_TOLERANCE_FACTOR = 0.42; // fraction of an item's half-width counted as a hit at full charge
  const BELT_SPEED_START = 90; // px/s at game start
  const BELT_SPEED_END = 220; // px/s at game end (ramps up over GAME_DURATION)
  const RELOAD_DROP_PX = 46; // how far below rest the next arrow starts before sliding in
  const RELOAD_DURATION_MS = 280;
  const STRING_ANCHOR_LEFT = { xFrac: 0.11, yFrac: 0.9 };
  const STRING_ANCHOR_RIGHT = { xFrac: 0.89, yFrac: 0.9 };

  // Authoritative order from Figma node 11:122 ("List of objects")
  const OBJECT_SEQUENCE = [
    { name: "bomb", isBomb: true },
    { name: "obj-01", isBomb: false },
    { name: "obj-02", isBomb: false },
    { name: "obj-03", isBomb: false },
    { name: "bomb", isBomb: true },
    { name: "obj-04", isBomb: false },
    { name: "obj-05", isBomb: false },
    { name: "obj-06", isBomb: false },
    { name: "bomb", isBomb: true },
    { name: "obj-07", isBomb: false },
    { name: "obj-08", isBomb: false },
    { name: "obj-09", isBomb: false },
    { name: "bomb", isBomb: true },
    { name: "obj-10", isBomb: false },
    { name: "obj-11", isBomb: false },
    { name: "obj-12", isBomb: false },
    { name: "bomb", isBomb: true },
    { name: "obj-13", isBomb: false },
    { name: "obj-14", isBomb: false },
    { name: "obj-15", isBomb: false },
  ];

  /* ---------- DOM refs ---------- */

  const gameScreen = document.getElementById("game-screen");
  const conveyor = document.getElementById("conveyor");
  const conveyorTrack = document.getElementById("conveyor-track");
  const arena = document.getElementById("arena");
  const flightLayer = document.getElementById("flight-layer");
  const quiverEl = document.getElementById("quiver");
  const bowWrap = document.getElementById("bow-wrap");
  const nockedArrow = document.getElementById("nocked-arrow");
  const bowStringLeft = document.getElementById("bow-string-left");
  const bowStringRight = document.getElementById("bow-string-right");
  const scoreValueEl = document.getElementById("score-value");
  const timerValueEl = document.getElementById("timer-value");
  const gameOverOverlay = document.getElementById("game-over-overlay");
  const gameOverTitle = document.getElementById("game-over-title");
  const gameOverReason = document.getElementById("game-over-reason");
  const finalScoreEl = document.getElementById("final-score");
  const playAgainBtn = document.getElementById("play-again-btn");
  const backHomeBtn = document.getElementById("back-home-btn");
  const backBtn = document.getElementById("back-btn");
  const shareBtn = document.getElementById("share-btn");
  const toastEl = document.getElementById("toast");

  /* ---------- State ---------- */

  let score = 0;
  let timeLeft = GAME_DURATION;
  let arrowsRemaining = TOTAL_ARROWS;
  let timerHandle = null;
  let toastHandle = null;
  let gameOver = false;
  let isPulling = false;
  let isFiring = false;
  let pullStartY = 0;
  let pullDistance = 0;
  let maxPullPx = MAX_PULL_PX; // recomputed per-pull so it never exceeds on-screen space
  let uidCounter = 0;

  /* ---------- Audio (soft, synthesized SFX — no external audio files) ---------- */
  // Everything here is generated with the Web Audio API rather than sampled
  // files, kept deliberately quiet and lowpass-filtered so it reads as a
  // gentle accent rather than an arcade "beep". Sounds only ever start from
  // a real user gesture (pointerdown), so autoplay restrictions never block
  // them.

  let audioCtx = null;
  let masterGain = null;
  let drawOsc = null;
  let drawGain = null;

  function ensureAudioContext() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.6;
    masterGain.connect(audioCtx.destination);
    return audioCtx;
  }

  function resumeAudioContext() {
    const ctx = ensureAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  // Soft continuous tone while the string is being drawn — pitch rises very
  // gently with how far it's pulled, like a light creak of tension.
  function startDrawSound() {
    const ctx = resumeAudioContext();
    if (!ctx) return;
    stopDrawSound(true);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 170;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    const now = ctx.currentTime;
    gain.gain.linearRampToValueAtTime(0.045, now + 0.09);
    osc.start(now);

    drawOsc = osc;
    drawGain = gain;
  }

  function updateDrawSound(pullFraction) {
    if (!drawOsc || !drawGain || !audioCtx) return;
    const now = audioCtx.currentTime;
    const clamped = Math.max(0, Math.min(1, pullFraction));
    drawOsc.frequency.setTargetAtTime(170 + clamped * 130, now, 0.05);
    drawGain.gain.setTargetAtTime(0.04 + clamped * 0.03, now, 0.05);
  }

  function stopDrawSound(immediate) {
    if (!drawOsc || !drawGain || !audioCtx) return;
    const osc = drawOsc;
    const gain = drawGain;
    drawOsc = null;
    drawGain = null;
    const now = audioCtx.currentTime;
    const releaseTime = immediate ? 0.03 : 0.09;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + releaseTime);
    osc.stop(now + releaseTime + 0.02);
  }

  // Short, rounded "twang" plus a breath of filtered noise for the arrow
  // leaving the string — quick but soft, no harsh attack.
  function playReleaseSound(power) {
    const ctx = resumeAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const charge = Math.max(0, Math.min(1, power));

    const osc = ctx.createOscillator();
    osc.type = "sine";
    const startFreq = 300 + charge * 110;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(70, startFreq * 0.35), now + 0.22);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1300;

    const gain = ctx.createGain();
    const peak = 0.08 + charge * 0.04;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.32);

    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * 0.22));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1100;
    noiseFilter.Q.value = 0.6;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.03, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noise.start(now);
  }

  // Tiny, muted "tick" for the next arrow settling onto the string.
  function playLoadSound() {
    const ctx = resumeAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.exponentialRampToValueAtTime(350, now + 0.08);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1600;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.04, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  // Round-ending cue. A bomb hit gets a soft, muffled low thud (a gentle
  // "that's over" rather than a harsh buzzer); running out of time/arrows
  // gets a warm three-note chime — rounded sine tones with a slow, staggered
  // fade-in so it reads as a soothing "round complete" rather than an
  // arcade fanfare.
  function playEndGameSound(reason) {
    const ctx = resumeAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (reason === "bomb") {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.42);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 380;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.11, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.65);
      return;
    }

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 — soft resolving major triad
    notes.forEach((freq, i) => {
      const start = now + i * 0.1;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2200;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.065, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.75);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      osc.start(start);
      osc.stop(start + 0.8);
    });
  }

  /* ---------- Conveyor ---------- */

  let beltOffset = 0;
  let beltLoopWidth = 0;
  let beltRunning = false;
  let beltRafId = null;
  let beltLastTs = null;

  function buildConveyorItem(def) {
    const el = document.createElement("div");
    el.className = "conveyor__item";
    el.dataset.uid = String(uidCounter++);
    el.dataset.bomb = def.isBomb ? "true" : "false";
    el.dataset.hit = "false";

    const img = document.createElement("img");
    img.src = `assets/images/objects/${def.name}.png`;
    img.alt = "";
    img.draggable = false;
    el.appendChild(img);

    return el;
  }

  function renderConveyor() {
    conveyorTrack.innerHTML = "";
    // Duplicate the sequence so the belt can loop seamlessly once it has
    // scrolled exactly one sequence's worth of width.
    for (let copy = 0; copy < 2; copy++) {
      OBJECT_SEQUENCE.forEach((def) => {
        conveyorTrack.appendChild(buildConveyorItem(def));
      });
    }

    // Measure the exact pitch of one full sequence copy (item spacing is
    // uniform, so comparing the same index across both copies is precise).
    const firstOfCopy1 = conveyorTrack.children[0];
    const firstOfCopy2 = conveyorTrack.children[OBJECT_SEQUENCE.length];
    beltLoopWidth =
      firstOfCopy2 && firstOfCopy1
        ? firstOfCopy2.offsetLeft - firstOfCopy1.offsetLeft
        : conveyorTrack.scrollWidth / 2;

    beltOffset = -beltLoopWidth;
    conveyorTrack.style.transform = `translateX(${beltOffset}px)`;
  }

  function beltSpeedAt(elapsedSeconds) {
    const t = Math.max(0, Math.min(1, elapsedSeconds / GAME_DURATION));
    return BELT_SPEED_START + t * (BELT_SPEED_END - BELT_SPEED_START);
  }

  function beltTick(timestamp) {
    if (!beltRunning) return;
    if (beltLastTs === null) beltLastTs = timestamp;
    const dt = Math.min(0.05, (timestamp - beltLastTs) / 1000);
    beltLastTs = timestamp;

    const elapsed = GAME_DURATION - timeLeft;
    beltOffset += beltSpeedAt(elapsed) * dt;
    if (beltOffset >= 0 && beltLoopWidth > 0) {
      beltOffset -= beltLoopWidth;
    }
    conveyorTrack.style.transform = `translateX(${beltOffset}px)`;

    beltRafId = requestAnimationFrame(beltTick);
  }

  function setConveyorRunning(running) {
    beltRunning = running;
    if (running) {
      beltLastTs = null;
      if (!beltRafId) {
        beltRafId = requestAnimationFrame(beltTick);
      }
    } else if (beltRafId) {
      cancelAnimationFrame(beltRafId);
      beltRafId = null;
    }
  }

  /* ---------- Quiver ---------- */

  function renderQuiver() {
    quiverEl.innerHTML = "";
    for (let i = 0; i < TOTAL_ARROWS - 1; i++) {
      const el = document.createElement("div");
      el.className = "quiver-arrow";
      const img = document.createElement("img");
      img.src = "assets/images/arrow.png";
      img.alt = "";
      el.appendChild(img);
      quiverEl.appendChild(el);
    }
  }

  function consumeQuiverArrow() {
    const waiting = quiverEl.querySelectorAll(".quiver-arrow:not(.is-used)");
    if (waiting.length === 0) return;
    // Always consume the right-most remaining arrow (DOM order matches the
    // visual left-to-right order) and just hide it in place — the slot stays
    // in the flex row's layout so the row's fixed edge-to-edge span never
    // changes and the other arrows never redistribute/re-center. That keeps
    // the depletion reading as "arrows running out from the right", not an
    // equidistant reshuffle every shot.
    const arrowEl = waiting[waiting.length - 1];
    arrowEl.classList.add("is-used");
  }

  /* ---------- Bow string tension ---------- */

  let bowStringRafId = null;

  function setStringLine(el, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    el.style.width = `${length}px`;
    el.style.transform = `translate(${x1}px, ${y1}px) rotate(${angle}deg)`;
  }

  function updateBowString() {
    const wrapRect = bowWrap.getBoundingClientRect();
    if (wrapRect.width === 0) return;

    const leftX = wrapRect.width * STRING_ANCHOR_LEFT.xFrac;
    const leftY = wrapRect.height * STRING_ANCHOR_LEFT.yFrac;
    const rightX = wrapRect.width * STRING_ANCHOR_RIGHT.xFrac;
    const rightY = wrapRect.height * STRING_ANCHOR_RIGHT.yFrac;

    // At rest, the nock sits exactly on the straight line between the two
    // limb anchors, so both halves are perfectly collinear (one straight
    // string). Pulling drops the nock straight down from that baseline,
    // which is what bends the two halves into a "V".
    const baselineY = (leftY + rightY) / 2;
    const nockX = (leftX + rightX) / 2;
    const nockY = baselineY + pullDistance;

    setStringLine(bowStringLeft, leftX, leftY, nockX, nockY);
    setStringLine(bowStringRight, rightX, rightY, nockX, nockY);
  }

  function bowStringFrame() {
    updateBowString();
    bowStringRafId = requestAnimationFrame(bowStringFrame);
  }

  function startBowStringLoop() {
    if (!bowStringRafId) {
      bowStringRafId = requestAnimationFrame(bowStringFrame);
    }
  }

  /* ---------- HUD ---------- */

  function updateScoreDisplay() {
    scoreValueEl.textContent = score < 100 ? String(score).padStart(2, "0") : String(score);
  }

  function updateTimerDisplay() {
    timerValueEl.textContent = `${timeLeft}s`;
    timerValueEl.classList.toggle("is-low", timeLeft <= 10);
  }

  function showToast(message, duration = 1400) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastHandle);
    toastHandle = setTimeout(() => {
      toastEl.hidden = true;
    }, duration);
  }

  /* ---------- Timer ---------- */

  function startTimer() {
    clearInterval(timerHandle);
    timerHandle = setInterval(() => {
      timeLeft -= 1;
      if (timeLeft <= 0) {
        timeLeft = 0;
        updateTimerDisplay();
        endGame("timer", "Time's up!");
        return;
      }
      updateTimerDisplay();
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerHandle);
    timerHandle = null;
  }

  /* ---------- Score popup ---------- */

  function spawnScorePopup(x, y, text, isMiss) {
    const popup = document.createElement("div");
    popup.className = "score-popup" + (isMiss ? " is-miss" : "");
    popup.textContent = text;
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;
    arena.appendChild(popup);
    setTimeout(() => popup.remove(), 750);
  }

  /* ---------- Firing mechanic ---------- */

  function resetNockedArrowTransform() {
    nockedArrow.style.transition = "";
    nockedArrow.style.transform = "";
  }

  function reloadNockedArrow() {
    // Prep the (currently hidden) nocked arrow just below its resting spot,
    // then let it slide up into place — visually "the next arrow" arriving.
    nockedArrow.style.transition = "none";
    nockedArrow.style.transform = `translate(-50%, ${RELOAD_DROP_PX}px)`;
    nockedArrow.classList.add("is-reloading");
    playLoadSound();
    // Force reflow so the start position above is committed before we
    // animate away from it.
    // eslint-disable-next-line no-unused-expressions
    nockedArrow.offsetHeight;
    nockedArrow.classList.remove("is-flying");

    requestAnimationFrame(() => {
      nockedArrow.style.transition = `transform ${RELOAD_DURATION_MS}ms cubic-bezier(.2,.8,.2,1)`;
      nockedArrow.style.transform = "translate(-50%, 0)";
    });

    setTimeout(() => {
      nockedArrow.classList.remove("is-reloading");
      resetNockedArrowTransform();
    }, RELOAD_DURATION_MS + 40);
  }

  function onPointerDown(ev) {
    if (gameOver || isFiring || arrowsRemaining <= 0) return;
    isPulling = true;
    pullStartY = ev.clientY;
    pullDistance = 0;

    // Recompute how far the arrow can actually travel before its tip (or the
    // string's V) would reach the bottom of the screen — screen height,
    // quiver height, and safe-area insets all vary by device, so a fixed
    // pull distance can push the stretched string/arrow past the visible
    // viewport on shorter screens. Clamp to whatever room is really there.
    const screenRect = gameScreen.getBoundingClientRect();
    const nockRect = nockedArrow.getBoundingClientRect();
    const availablePx = screenRect.bottom - nockRect.bottom - PULL_SAFE_MARGIN_PX;
    maxPullPx = Math.max(MIN_PULL_PX, Math.min(MAX_PULL_PX, availablePx));

    nockedArrow.classList.add("is-pulling");
    nockedArrow.setPointerCapture(ev.pointerId);
    startDrawSound();
  }

  function onPointerMove(ev) {
    if (!isPulling) return;
    const delta = Math.max(0, Math.min(maxPullPx, ev.clientY - pullStartY));
    pullDistance = delta;
    nockedArrow.style.transform = `translate(-50%, ${delta}px)`;
    updateDrawSound(maxPullPx > 0 ? delta / maxPullPx : 0);
  }

  function onPointerUp(ev) {
    if (!isPulling) return;
    isPulling = false;
    nockedArrow.classList.remove("is-pulling");
    stopDrawSound(false);

    if (pullDistance < MIN_PULL_PX) {
      // Not enough pull to count as a shot — snap back.
      resetNockedArrowTransform();
      pullDistance = 0;
      return;
    }

    const power = pullDistance / maxPullPx;
    pullDistance = 0;
    fireArrow(power);
  }

  function fireArrow(power) {
    if (gameOver || isFiring) return;
    isFiring = true;
    arrowsRemaining -= 1;
    playReleaseSound(power);

    // Measure the real flight path — from the arrow's resting tip, straight
    // up past the conveyor's objects — before it visually flies off.
    // Measured in the flight layer's own coordinate space (it now spans the
    // full screen, not just the arena, so the arrow isn't clipped before it
    // ever reaches the conveyor row).
    const flightRect = flightLayer.getBoundingClientRect();
    const startArrowRect = nockedArrow.getBoundingClientRect();
    const conveyorRect = conveyor.getBoundingClientRect();

    const startX = startArrowRect.left + startArrowRect.width / 2 - flightRect.left;
    const startY = startArrowRect.top - flightRect.top;
    const endY = conveyorRect.top - flightRect.top - FLIGHT_OVERSHOOT_PX;
    const flightDistance = Math.max(0, startY - endY);
    const flightDuration = Math.min(
      FLIGHT_DURATION_MAX,
      Math.max(FLIGHT_DURATION_MIN, flightDistance / ARROW_SPEED_PX_MS)
    );

    nockedArrow.classList.add("is-flying");
    resetNockedArrowTransform();

    const flyingArrow = document.createElement("div");
    flyingArrow.className = "flying-arrow";
    flyingArrow.style.left = `${startX}px`;
    flyingArrow.style.top = `${startY}px`;
    flyingArrow.style.transform = "translate(-50%, 0)";
    const img = document.createElement("img");
    img.src = "assets/images/arrow.png";
    img.alt = "";
    flyingArrow.appendChild(img);
    flightLayer.appendChild(flyingArrow);

    // Force layout so the transition below actually animates.
    // eslint-disable-next-line no-unused-expressions
    flyingArrow.offsetHeight;
    flyingArrow.style.transition = `top ${flightDuration}ms linear`;
    flyingArrow.style.top = `${endY}px`;

    // Reload the next arrow onto the bow right away, rather than waiting
    // for this shot to land.
    if (arrowsRemaining > 0) {
      consumeQuiverArrow();
      reloadNockedArrow();
    }

    setTimeout(() => {
      resolveShot(power);
      flyingArrow.remove();
    }, flightDuration);
  }

  function resolveShot(power) {
    const arenaRect = arena.getBoundingClientRect();
    const laneX = arenaRect.left + arenaRect.width / 2;
    const laneY = arenaRect.top + arenaRect.height * 0.12;
    const toleranceFactor = MIN_TOLERANCE_FACTOR + power * (MAX_TOLERANCE_FACTOR - MIN_TOLERANCE_FACTOR);

    let bestItem = null;
    let bestDistance = Infinity;

    conveyorTrack.querySelectorAll(".conveyor__item").forEach((item) => {
      if (item.dataset.hit === "true") return;
      const rect = item.getBoundingClientRect();
      const itemCenterX = rect.left + rect.width / 2;
      const distance = Math.abs(itemCenterX - laneX);
      const tolerance = (rect.width / 2) * toleranceFactor;
      if (distance <= tolerance && distance < bestDistance) {
        bestDistance = distance;
        bestItem = item;
      }
    });

    if (bestItem) {
      bestItem.dataset.hit = "true";
      if (bestItem.dataset.bomb === "true") {
        bestItem.classList.add("is-bomb-hit");
        spawnScorePopup(laneX - arenaRect.left, laneY - arenaRect.top, "BOOM", false);
        finishFiring();
        endGame("bomb", "You hit a bomb!");
        return;
      }
      bestItem.classList.add("is-hit");
      score += POINTS_PER_HIT;
      updateScoreDisplay();
      spawnScorePopup(laneX - arenaRect.left, laneY - arenaRect.top, `+${POINTS_PER_HIT}`, false);
    } else {
      spawnScorePopup(laneX - arenaRect.left, laneY - arenaRect.top, "Miss", true);
    }

    finishFiring();

    if (arrowsRemaining <= 0 && !gameOver) {
      endGame("arrows", "You're out of arrows!");
    }
  }

  function finishFiring() {
    isFiring = false;
    // Reloading the next arrow (or leaving the bow empty) is already
    // handled synchronously in fireArrow() so the reload animation starts
    // the instant the shot is loosed, not after it lands.
  }

  /* ---------- Game over / reset ---------- */

  function endGame(reason, message) {
    if (gameOver) return;
    gameOver = true;
    stopTimer();
    setConveyorRunning(false);
    stopDrawSound(true);
    playEndGameSound(reason);

    const titles = {
      bomb: "Boom!",
      timer: "Time's Up!",
      arrows: "Out of Arrows!",
    };

    gameOverTitle.textContent = titles[reason] || "Game Over";
    gameOverReason.textContent = message || "";
    finalScoreEl.textContent = String(score);
    gameOverOverlay.hidden = false;
  }

  function resetGame() {
    score = 0;
    timeLeft = GAME_DURATION;
    arrowsRemaining = TOTAL_ARROWS;
    gameOver = false;
    isPulling = false;
    isFiring = false;
    pullDistance = 0;
    stopDrawSound(true);

    updateScoreDisplay();
    updateTimerDisplay();

    nockedArrow.classList.remove("is-flying", "is-pulling", "is-reloading");
    nockedArrow.style.visibility = "";
    resetNockedArrowTransform();

    startBowStringLoop();

    flightLayer.innerHTML = "";
    gameOverOverlay.hidden = true;

    renderConveyor();
    renderQuiver();
    setConveyorRunning(true);
    startTimer();
  }

  /* ---------- Wire up ---------- */

  nockedArrow.addEventListener("pointerdown", onPointerDown);
  nockedArrow.addEventListener("pointermove", onPointerMove);
  nockedArrow.addEventListener("pointerup", onPointerUp);
  nockedArrow.addEventListener("pointercancel", onPointerUp);

  playAgainBtn.addEventListener("click", resetGame);
  backHomeBtn.addEventListener("click", () => {
    window.location.href = "index.html";
  });
  backBtn.addEventListener("click", () => {
    window.location.href = "landing.html";
  });

  shareBtn.addEventListener("click", async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Meesho Archery",
          text: `I just scored ${score} points in Meesho Archery!`,
          url: window.location.href,
        });
      } catch (err) {
        // user cancelled share sheet, nothing to do
      }
    } else {
      showToast("Share not supported on this browser");
    }
  });

  // Prevent the page from scrolling while dragging the bow on touch devices.
  bowWrap.addEventListener(
    "touchmove",
    (ev) => {
      if (isPulling) ev.preventDefault();
    },
    { passive: false }
  );

  resetGame();
})();
