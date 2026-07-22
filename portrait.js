/*
 * Halftone portrait: the photo is rebuilt as a grid of ink dots on the paper
 * background. Dots near the pointer are pushed away and spring back, so the
 * portrait behaves like a small force field rather than a static image.
 */
(function () {
  var canvas = document.getElementById("portrait");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  var INK = "#1d1d1b";
  var GRID = 48; // dots per side
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var img = new Image();
  img.src = "portrait.jpg";
  img.onload = setup;

  var particles = [];
  var size = 0; // CSS pixels, square
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var pointer = { x: -9999, y: -9999 };
  var running = false;

  function setup() {
    size = canvas.clientWidth;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    // Sample the photo at GRID x GRID
    var off = document.createElement("canvas");
    off.width = GRID;
    off.height = GRID;
    var octx = off.getContext("2d");
    // Center-crop the source to a square before sampling
    var s = Math.min(img.width, img.height);
    octx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, GRID, GRID);
    var data = octx.getImageData(0, 0, GRID, GRID).data;

    var cell = size / GRID;
    for (var gy = 0; gy < GRID; gy++) {
      for (var gx = 0; gx < GRID; gx++) {
        var i = (gy * GRID + gx) * 4;
        var lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        // Light pixels dissolve into the paper: no dot at all
        if (lum > 0.82) continue;
        var r = cell * 0.62 * Math.pow(1 - lum, 0.85);
        if (r < 0.25) continue;
        var x = (gx + 0.5) * cell;
        var y = (gy + 0.5) * cell;
        particles.push({ hx: x, hy: y, x: x, y: y, vx: 0, vy: 0, r: r });
      }
    }

    draw();
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

  function burst(bx, by) {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var dx = p.x - bx;
      var dy = p.y - by;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d < size * 0.4) {
        var f = (1 - d / (size * 0.4)) * 14;
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

  var FORCE_RADIUS = 34;

  function step() {
    var settled = true;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var dx = p.x - pointer.x;
      var dy = p.y - pointer.y;
      var d2 = dx * dx + dy * dy;
      if (d2 < FORCE_RADIUS * FORCE_RADIUS) {
        var d = Math.sqrt(d2) || 1;
        var f = (1 - d / FORCE_RADIUS) * 3.2;
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
    ctx.fillStyle = INK;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.fill();
    }
  }
})();
