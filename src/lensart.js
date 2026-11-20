// Lens portraits: each lens is drawn like a small portrait card, with its
// own background colour and a hand-drawn 12x12 icon in four shades.
// Icon letters: k outline, d dark, m mid, l light, h highlight (the lens's
// own hue), a sand, s sand light, w white glint. '.' is the background.
(function (root) {
  'use strict';
  const L = {
    wide: { bg: ['#14262a', '#1c343a', '#25454c'], hue: ['#1f4f57', '#2f7a84', '#56a9b2', '#9fdde2'], icon: [
      'k..........k', '.kk......kk.', '.kmk....kmk.', '..kk.kk.kk..', '....kaak....', '...kasaak...', '...kaaadk...', '....kddk....', '..kk.kk.kk..', '.kmk....kmk.', '.kk......kk.', 'k..........k'] },
    feather: { bg: ['#1d1726', '#271f33', '#332944'], hue: ['#4b3b63', '#6f5a91', '#a58fc6', '#e2d6f2'], icon: [
      '.........kk.', '........klhk', '.......klhmk', '......klhmk.', '.....klhmk..', '....klhmk...', '...klhmdk...', '..klmmdk....', '..kmddk.....', '.kkdkk......', 'kk.k........', 'k...........'] },
    breath: { bg: ['#271b12', '#352517', '#47321d'], hue: ['#6b4a22', '#a0702f', '#d7a253', '#f6dc9f'], icon: [
      '.......kkk..', '.....kk...k.', '...kk.....kk', '..k.....kask', '.k......kaak', '.k.......kk.', 'k...........', 'k...........', 'kk..........', 'kmk.........', 'kmmk........', 'kkkk........'] },
    stone: { bg: ['#1b1c20', '#25272c', '#31343a'], hue: ['#3b3f47', '#5e636d', '#8d939e', '#c7ccd4'], icon: [
      '............', '....kkkk....', '..kkhllmkk..', '.khlllmmmdk.', '.klllmmkmdk.', 'kllmmmkmmmdk', 'klmmmkmmmmdk', 'kmmmmmkmmddk', '.kmmmmmmddk.', '.kddmmmddk..', '..kkdddkk...', '....kkkk....'] },
    damp: { bg: ['#14201a', '#1b2b22', '#24392d'], hue: ['#26472f', '#3a6e47', '#5fa06c', '#a8dcb0'], icon: [
      'kk..........', 'kmk...k.....', 'kmk..khk....', 'kmk.khlmk...', 'kmk.klmmk...', 'kdk.kmmdk...', 'kdk..kdk....', 'kdk...k..k..', 'kdk.....khk.', 'kdk....klmk.', 'kdk....kmdk.', 'kkk.....kk..'] },
    wet: { bg: ['#0f1a2a', '#15243a', '#1d314d'], hue: ['#1f3f6a', '#2f63a0', '#5a95d1', '#acd2f4'], icon: [
      '.....kk.....', '....khlk....', '....khmk....', '...khlmmk...', '..khllmmdk..', '.khllmmmmdk.', '.klhmmmmmdk.', 'kllmmmmmmmdk', 'klmmmmmmmddk', '.kmmmmmmddk.', '..kkmmddkk..', '....kkkk....'] },
    pull: { bg: ['#16142a', '#1f1c3a', '#29254d'], hue: ['#3a3270', '#5a4ea6', '#8e82d6', '#d2ccf6'], icon: [
      '.....a......', '..k.......a.', '.....kkk....', '.a..khlmk...', '...khmmmdk.k', 'k..kmmmmdk..', '...kmmmddk..', '....kmddk...', '.k...kkk..a.', '...a........', '.......k....', 'a.........k.'] },
    glass: { bg: ['#122028', '#192c36', '#213a47'], hue: ['#3d6b7c', '#64a2b8', '#9ed3e6', '#e6f7fc'], icon: [
      '.....kk.....', '....khlk....', '....khmk....', '...khlmmk...', '...khlmmk...', '..khlmmmdk..', '..khlmmmdk..', '.khllmmmmdk.', '.khlmmmmmdk.', 'kkkkkkkkkkkk', 'kddddddddddk', 'kkkkkkkkkkkk'] },
    debt: { bg: ['#25110f', '#331714', '#451e1a'], hue: ['#5a2a22', '#8a3f30', '#b8634c', '#e9a98f'], icon: [
      'kkkkkkkkkkkk', 'khllllllmmdk', '.khsssssadk.', '..khssaadk..', '...khaadk...', '....kwak....', '....kk.k....', '...kk..ak...', '..kk...kak..', '.kmk..kaaak.', 'kmmmmaaaaadk', 'kkkkkkkkkkkk'] },
    undertow: { bg: ['#0e1d22', '#132830', '#1a3641'], hue: ['#1e4e5a', '#2f7f8d', '#5db6c2', '#b4ecf0'], icon: [
      '............', '...kkkk.....', '..khllmk....', '.khlkkmmk...', '.klk..kmk...', 'khk...kmdk..', 'kk..a.kmdk..', '...asakmmdk.', '..kkkkmmmdk.', '.khllmmmmmdk', 'khlmmmmmmddk', 'kkkkkkkkkkkk'] },
    eternal: { bg: ['#211b10', '#2e2616', '#3f341e'], hue: ['#6a5626', '#a0853a', '#d9b26a', '#fbe2a2'], icon: [
      '....kkkk....', '..kkhllmkk..', '.khlkkkkmdk.', '.klk....kdk.', 'khk..aa..kdk', 'klk.asaa.kdk', 'kmk.aaaa.kdk', 'kmk..aa..kdk', '.kmk....kdk.', '.kmdkkkkddk.', '..kkmmddkk..', '....kkkk....'] },
    // a quick hand: three motion strokes and an open palm of sand
    quick: { bg: ['#271a10', '#352416', '#4a311c'], hue: ['#6a3e1c', '#a8622a', '#e09a4e', '#ffd9a0'], icon: [
      '............', 'kk..........', '.kkk...kkk..', '..kk..khlhk.', 'kk...khllmdk', '.kkk.klssmdk', '..k..kmsamdk', 'kk...kmaamk.', '.kkk..kmmk..', '..kk...kk...', '............', '............'] },
    // a steady bolt: a straight line of sand running true, with a sighting ring
    steady: { bg: ['#1a1a12', '#24241a', '#323224'], hue: ['#4a4a2a', '#7a7a3e', '#b8b45e', '#f0eaa0'], icon: [
      '....kkkk....', '..kkhllmkk..', '.kh......mk.', '.kl......mk.', 'kl...kk...dk', 'kl.kkssak.dk', 'km.kkssak.dk', 'km...kk...dk', '.km......dk.', '.km......dk.', '..kkmmddkk..', '....kkkk....'] },
    // second wind: a gust curling up under three small clumps
    wind: { bg: ['#14202a', '#1a2b38', '#22394a'], hue: ['#26506a', '#3a7aa0', '#6ab0d6', '#bfe6f6'], icon: [
      '..ka.....ka.', '.kask...kask', '..kk.ka..kk.', '.....kask...', '......kk....', '............', 'kkkk........', 'hllmkk......', '...kmlhk....', '.kkk..kmlk..', 'kmmlk...kmk.', '.kkkk....k..'] },
    // anvil heart: an anvil with a glowing heart of sand in its waist
    anvil: { bg: ['#1c1a1e', '#26242a', '#323038'], hue: ['#3a3a44', '#5e5e6c', '#9a9aaa', '#dcdce6'], icon: [
      '............', 'kkkkkkkkkkk.', 'khhllllllmdk', '.kkkllllmdk.', '...kmssmdk..', '...kmsamdk..', '..kkmmmmdkk.', '.kllmmmmmddk', 'klmmmmmmmddk', 'kkkkkkkkkkkk', '............', '............'] },
    // splinter crown: five sand spikes rising from a band
    crown: { bg: ['#241a10', '#322416', '#45321d'], hue: ['#6a4a22', '#a0702f', '#d8a656', '#fde0a0'], icon: [
      '............', 'k...k..k...k', 'hk.khk.hk.kh', 'lk.klk.lk.kl', 'lmkklmklmkml', 'lmklmmklmkml', 'mmmmmmmmmmmd', 'kkkkkkkkkkkk', 'kassasassaak', 'kkkkkkkkkkkk', '............', '............'] },
    // starborn: a falling star with a long tail
    starborn: { bg: ['#1a1226', '#241a36', '#30244a'], hue: ['#5a3a7a', '#9a5ab0', '#e08ac8', '#ffe0f0'], icon: [
      'h...........', '.l..........', '..m.........', '...m........', '....d...k...', '.....d.khk..', '......khwhk.', '.....khwwwhk', '......khwhk.', '.......khk..', '........k...', '............'] },
    // hungry sand: a heap with an open maw
    hungry: { bg: ['#260f0d', '#341513', '#481d1a'], hue: ['#6a2a22', '#a0432e', '#d8724c', '#ffb48a'], icon: [
      '............', '....kkkk....', '..kksaaskk..', '.ksaaaaaask.', 'ksakkkkkkask', 'kakwkwkwkwak', 'kak......kak', 'kakwkwkwkwak', 'ksakkkkkkask', '.kssaaaassk.', '..kkkkkkkk..', '............'] },
    // keen grit: a short sand blade, edge lit
    keen: { bg: ['#221a14', '#2f241b', '#403124'], hue: ['#5a4632', '#8a6c4c', '#c49c6e', '#f2d8b4'], icon: [
      '..........kk', '.........khk', '........khlk', '.......khlk.', '......khlk..', '.....khlk...', '....khmk....', '.k.kmmk.....', '.kkddk......', '..kak.......', '.kask.......', 'kkk.........'] },
    // thin frost: a six-armed flake
    frost: { bg: ['#121c26', '#182634', '#203245'], hue: ['#2c4a66', '#4a78a0', '#86b6dc', '#d8eefc'], icon: [
      '.....kk.....', '..k..hl..k..', '...k.lh.k...', '....kllk....', '.k..khhk..k.', 'khllhwwhllhk', 'khllhwwhllhk', '.k..khhk..k.', '....kllk....', '...k.lh.k...', '..k..hl..k..', '.....kk.....'] },
    // long needle: a thin bolt with a weaving trail of sand
    needle: { bg: ['#141a24', '#1b2331', '#242f42'], hue: ['#2f405e', '#4c6690', '#86a6d4', '#d4e2fa'], icon: [
      '..........kk', '.........kwk', '........khk.', '.......khk..', '......khk...', '.....kmk....', '....kmk.....', '...kdk......', '..a.k.......', '.a..........', '..a.........', '.a..........'] },
    // falling weight: a sand-heavy stone with motion lines over it
    fall: { bg: ['#1c1a18', '#272421', '#34302b'], hue: ['#4a4038', '#72645a', '#a8988a', '#e0d4c8'], icon: [
      '.k..k..k..k.', '.k..k..k..k.', '............', '....kkkk....', '...khllmk...', '..khllmmdk..', '.khlmmmmmdk.', '.klmmasmmdk.', 'kmmmaaammddk', 'kmmmmmmmdddk', '.kkddddddkk.', '...kkkkkk...'] },
    // winter vow: a ring of ice around a held grain
    vow: { bg: ['#1a1426', '#231b34', '#2e2446'], hue: ['#4a3a6e', '#6f5aa0', '#a890d6', '#e6dcfa'], icon: [
      '....kkkk....', '..kkhllhkk..', '.khlk..klhk.', '.kl.k..k.lk.', 'khk..kk..khk', 'kl..kask..lk', 'kl..kaak..lk', 'khk..kk..khk', '.kl.k..k.lk.', '.khlk..klhk.', '..kkmddmkk..', '....kkkk....'] },
    // tidebreaker: a curling wave of sand about to break
    tide: { bg: ['#1e1a10', '#2a2416', '#3a311d'], hue: ['#6a5626', '#a0853a', '#d9b26a', '#fbe2a2'], icon: [
      '............', '.....kkkk...', '...kkhllhk..', '..khlkkkhlk.', '.khlk...khk.', '.klk..kk.kk.', 'khk..kask...', 'kmk..kaak...', 'kmmk..kk....', 'kassk....kk.', 'kaaasskkkask', 'kkkkkkkkkkkk'] },
    // last winter: a great crystal star over a drift of sand
    winter: { bg: ['#1e1a10', '#2a2416', '#3a311d'], hue: ['#4a6a7a', '#78a6bc', '#b8e0f0', '#f4fcff'], icon: [
      '.....kk.....', '....khlk....', '.k..khlk..k.', '.khkkhlkkhk.', '..khhwwhhk..', 'kkhlwwwwlhkk', 'kkhlwwwwlhkk', '..khhwwhhk..', '.kdkkmmkkdk.', '.k..kmdk..k.', 'kaassaassaak', 'kkkkkkkkkkkk'] },
  };
  const api = { L };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpillLensArt = api;
})(typeof window !== 'undefined' ? window : globalThis);
