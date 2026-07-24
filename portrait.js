/*
 * Halftone portrait: the photo is rebuilt as a grid of ink dots on the paper
 * background. Dots near the pointer are pushed away and spring back, so the
 * portrait behaves like a small force field rather than a static image.
 *
 * Light mode: dark dots, sized by how dark the photo is (classic halftone).
 * Dark mode: light dots, sized by how BRIGHT the photo is (chalk on
 * blackboard), so the face still looks like the face instead of a negative.
 * The photo's backdrop is removed with a flood fill from the edges so it
 * never renders in either mode.
 */
(function () {
  var canvas = document.getElementById("portrait");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  var GRID = 60; // dots per side
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var ink = "#1d1d1b";
  function refreshInk() {
    ink = getComputedStyle(document.body).color || ink;
  }
  refreshInk();

  function darkMode() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t === "dark") return true;
    if (t === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  var img = new Image();
  img.src = "portrait.jpg";
  img.onload = setup;

  var particles = [];
  var lumGrid = null; // luminance per cell
  var bgMask = null; // true = photo backdrop, never draw
  var size = 0; // CSS pixels, square
  var cell = 0;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var pointer = { x: -9999, y: -9999 };
  var running = false;

  function setup() {
    size = canvas.clientWidth;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    cell = size / GRID;

    // Sample the photo at GRID x GRID
    var off = document.createElement("canvas");
    off.width = GRID;
    off.height = GRID;
    var octx = off.getContext("2d");
    // Center-crop the source to a square before sampling
    var s = Math.min(img.width, img.height);
    octx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, GRID, GRID);
    var data = octx.getImageData(0, 0, GRID, GRID).data;

    lumGrid = new Float32Array(GRID * GRID);
    for (var i = 0; i < GRID * GRID; i++) {
      lumGrid[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    }
    buildBackgroundMask();
    buildParticles();
    draw();

    window.addEventListener("themechange", function () {
      refreshInk();
      buildParticles();
      draw();
    });
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) {
      mq.addEventListener("change", function () {
        refreshInk();
        buildParticles();
        draw();
      });
    }

    if (reduceMotion) return; // static art piece, no physics

    canvas.addEventListener("pointermove", function (e) {
      var rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      wake();
    });
    canvas.addEventListener("pointerleave", function () {
      pointer.x = -9999;
      pointer.y = -9999;
      wake();
    });
    canvas.addEventListener("pointerdown", function (e) {
      // A tap/click gives the dots a stronger kick
      var rect = canvas.getBoundingClientRect();
      burst(e.clientX - rect.left, e.clientY - rect.top);
      wake();
    });
  }

  // Flood fill from the image edges: backdrop cells are bright AND locally
  // flat. The white shirt is bright too, but it's textured (speckles), so the
  // smoothness test keeps the fill from eating the shoulders.
  function buildBackgroundMask() {
    var BG_LUM = 0.8;
    var SMOOTH = 0.16; // 3x3 max-min below this = flat backdrop

    // Local contrast per cell
    var range = new Float32Array(GRID * GRID);
    for (var gy = 0; gy < GRID; gy++) {
      for (var gx = 0; gx < GRID; gx++) {
        var lo = 1;
        var hi = 0;
        for (var ny = Math.max(0, gy - 1); ny <= Math.min(GRID - 1, gy + 1); ny++) {
          for (var nx = Math.max(0, gx - 1); nx <= Math.min(GRID - 1, gx + 1); nx++) {
            var v = lumGrid[ny * GRID + nx];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        range[gy * GRID + gx] = hi - lo;
      }
    }

    bgMask = new Uint8Array(GRID * GRID);
    var queue = [];
    function seed(idx) {
      if (!bgMask[idx] && lumGrid[idx] > BG_LUM && range[idx] < SMOOTH) {
        bgMask[idx] = 1;
        queue.push(idx);
      }
    }
    for (var e = 0; e < GRID; e++) {
      seed(e); // top row
      seed((GRID - 1) * GRID + e); // bottom row
      seed(e * GRID); // left column
      seed(e * GRID + GRID - 1); // right column
    }
    while (queue.length) {
      var idx = queue.pop();
      var x = idx % GRID;
      var y = (idx / GRID) | 0;
      if (x > 0) seed(idx - 1);
      if (x < GRID - 1) seed(idx + 1);
      if (y > 0) seed(idx - GRID);
      if (y < GRID - 1) seed(idx + GRID);
    }

    // The smoothness test leaves a thin bright ring where backdrop meets the
    // silhouette (high local contrast there). Absorb it so dark mode doesn't
    // draw a glowing halo.
    for (var pass = 0; pass < 2; pass++) {
      var grow = [];
      for (var i = 0; i < GRID * GRID; i++) {
        if (bgMask[i] || lumGrid[i] <= BG_LUM) continue;
        var cx = i % GRID;
        var cy = (i / GRID) | 0;
        if (
          (cx > 0 && bgMask[i - 1]) ||
          (cx < GRID - 1 && bgMask[i + 1]) ||
          (cy > 0 && bgMask[i - GRID]) ||
          (cy < GRID - 1 && bgMask[i + GRID])
        ) {
          grow.push(i);
        }
      }
      for (var g = 0; g < grow.length; g++) bgMask[grow[g]] = 1;
    }
  }

  function buildParticles() {
    var dark = darkMode();
    var old = particles;
    particles = [];
    var n = 0;
    for (var gy = 0; gy < GRID; gy++) {
      for (var gx = 0; gx < GRID; gx++) {
        var idx = gy * GRID + gx;
        if (bgMask[idx]) continue;
        var lum = lumGrid[idx];
        var r;
        if (dark) {
          // Bright areas of the face glow; dark hair stays a faint speckle.
          // The floor keeps the shirt/silhouette reading as one solid form.
          r = cell * (0.14 + 0.5 * Math.pow(lum, 1.25));
        } else {
          if (lum > 0.82) continue; // interior highlights dissolve into paper
          r = cell * 0.62 * Math.pow(1 - lum, 0.85);
        }
        if (r < 0.22) continue;
        var x = (gx + 0.5) * cell;
        var y = (gy + 0.5) * cell;
        // Keep current displacement if this dot existed before the theme flip
        var prev = old[n];
        if (prev && prev.hx === x && prev.hy === y) {
          prev.r = r;
          particles.push(prev);
        } else {
          particles.push({ hx: x, hy: y, x: x, y: y, vx: 0, vy: 0, r: r });
        }
        n++;
      }
    }
  }

  function burst(bx, by) {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var dx = p.x - bx;
      var dy = p.y - by;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d < size * 0.3) {
        var f = (1 - d / (size * 0.3)) * 6;
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
      }
    }
  }

  function wake() {
    if (!running) {
      running = true;
      requestAnimationFrame(tick);
    }
  }

  function tick() {
    var settled = step();
    draw();
    if (settled && pointer.x < -999) {
      running = false;
    } else {
      requestAnimationFrame(tick);
    }
  }

  var FORCE_RADIUS = 16;

  function step() {
    var settled = true;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var dx = p.x - pointer.x;
      var dy = p.y - pointer.y;
      var d2 = dx * dx + dy * dy;
      if (d2 < FORCE_RADIUS * FORCE_RADIUS) {
        var d = Math.sqrt(d2) || 1;
        var f = (1 - d / FORCE_RADIUS) * 1.6;
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
      }
      // Spring back home with damping
      p.vx += (p.hx - p.x) * 0.06;
      p.vy += (p.hy - p.y) * 0.06;
      p.vx *= 0.86;
      p.vy *= 0.86;
      p.x += p.vx;
      p.y += p.vy;
      if (settled && (Math.abs(p.vx) > 0.02 || Math.abs(p.vy) > 0.02)) settled = false;
    }
    return settled;
  }

  function draw() {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = ink;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.fill();
    }
  }
})();
