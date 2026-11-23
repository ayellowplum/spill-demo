// Demo launcher: the game's own title screen is the menu. Its one item starts the Sieve fight through the
// game's public jump command (window.spill). The developer console is blocked.
// The title screen also shows the Kickstarter card (index.html #ks); it hides once the fight begins.
(function () {
  function hideKs() { var ks = document.getElementById('ks'); if (ks) ks.classList.add('gone'); }
  window.SPILL_DEMO_TITLE = [{ label: 'Begin', act: function () { hideKs(); try { window.spill.cmd('boss'); } catch (err) { console.error(err); } } }];
  window.addEventListener('keydown', function (e) { if (e.code === 'Backquote') { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
})();
