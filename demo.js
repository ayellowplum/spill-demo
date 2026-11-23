// Demo launcher: the game's own title screen is the menu. Its one item starts the Sieve fight through the
// game's public jump command (window.spill). The developer console is blocked.
// The Kickstarter button (index.html #ks) is drawn in the game's own pixel type (SpillFonts 'soft', the same
// face as the title menu) on a dark stone plate with stepped corners. It dims during the fight until hovered.
(function () {
  var LABEL = 'Support Spill on Kickstarter';
  function paintKs(hot) {
    var a = document.getElementById('ks'), F = window.SpillFonts;
    if (!a || !F) return;
    var cv = a.querySelector('canvas') || a.appendChild(document.createElement('canvas'));
    var P = 2, d = Math.max(1, Math.round(window.devicePixelRatio || 1)), p = P * d;   // one art pixel = P css px
    var tw = F.measure(LABEL, 'soft'), padX = 7, padY = 4, w = tw + padX * 2, h = 10 + padY * 2 - 2;
    cv.width = w * p; cv.height = h * p; cv.style.width = w * P + 'px'; cv.style.height = h * P + 'px';
    var c = cv.getContext('2d'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, cv.width, cv.height);
    function px(x, y, ww, hh, col) { c.fillStyle = col; c.fillRect(x * p, y * p, ww * p, hh * p); }
    var edge = hot ? '#8f8296' : '#5b5263', fill = hot ? '#221d29' : '#18141d', lip = hot ? '#3a3342' : '#2b2532', foot = '#0d0b10';
    // plate with stepped (rounded) corners: two-pixel step at each corner
    px(2, 0, w - 4, 1, edge); px(2, h - 1, w - 4, 1, edge); px(0, 2, 1, h - 4, edge); px(w - 1, 2, 1, h - 4, edge);
    px(1, 1, 1, 1, edge); px(w - 2, 1, 1, 1, edge); px(1, h - 2, 1, 1, edge); px(w - 2, h - 2, 1, 1, edge);
    px(2, 1, w - 4, h - 2, fill); px(1, 2, w - 2, h - 4, fill);
    px(2, 1, w - 4, 1, lip);                 // lit top edge, like the window ledges
    px(2, h - 2, w - 4, 1, foot);            // shadowed bottom edge
    F.draw(c, LABEL, padX * p, (padY - 1) * p, 'soft', p);
  }
  function dimKs() { var ks = document.getElementById('ks'); if (ks) ks.classList.add('play'); }
  window.addEventListener('load', function () {
    var a = document.getElementById('ks'); if (!a) return;
    paintKs(false);
    a.addEventListener('mouseenter', function () { paintKs(true); });
    a.addEventListener('mouseleave', function () { paintKs(false); });
  });
  window.SPILL_DEMO_TITLE = [{ label: 'Begin', act: function () { dimKs(); try { window.spill.cmd('boss'); } catch (err) { console.error(err); } } }];
  window.addEventListener('keydown', function (e) { if (e.code === 'Backquote') { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
})();
