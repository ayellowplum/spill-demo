// Demo launcher: the game's own title screen is the menu. Its one item starts the Sieve fight through the
// game's public jump command (window.spill). The developer console is blocked.
// The Kickstarter button (index.html #ks) stays in the corner; during the fight it dims until hovered.
(function () {
  function dimKs() { var ks = document.getElementById('ks'); if (ks) ks.classList.add('play'); }
  window.SPILL_DEMO_TITLE = [{ label: 'Begin', act: function () { dimKs(); try { window.spill.cmd('boss'); } catch (err) { console.error(err); } } }];
  window.addEventListener('keydown', function (e) { if (e.code === 'Backquote') { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
})();
