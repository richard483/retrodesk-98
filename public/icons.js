// Hand-made 16x16 pixel icons in a Win98 palette, drawn as SVG rects (crisp at any zoom).
const P = { k: '#000', w: '#fff', g: '#808080', s: '#c0c0c0', y: '#ffff00', o: '#c0a000', b: '#000080', B: '#0000ff', c: '#00ffff', t: '#008080', r: '#ff0000', R: '#800000', G: '#008000', l: '#00ff00', d: '#404040', p: '#800080' };

// Each icon: rows of 16 chars; '.' is transparent.
const ART = {
  computer: [
    '..kkkkkkkkkkkk..', '..ksssssssssskk.', '..ksbbbbbbbbbsk.', '..ksbBBBBBBBbsk.', '..ksbBcBBBBBbsk.', '..ksbBBBBBBBbsk.',
    '..ksbBBBBBBBbsk.', '..ksbbbbbbbbbsk.', '..ksssssssssgsk.', '..kkkkkkkkkkkkk.', '.....kssssk.....', '..kkkkkkkkkkkk..',
    '.kwsssssssssssk.', '.kssssssgGgssgk.', '.kgggggggggggggk', '..kkkkkkkkkkkkk.'],
  folder: [
    '................', '..kkkkk.........', '.kyyyyyk........', 'kyowowowkkkkkkk.', 'kwyyyyyyyyyyyyok', 'kyyyyyyyyyyyyyok',
    'kyyyyyyyyyyyyyok', 'kyyyyyyyyyyyyyok', 'kyyyyyyyyyyyyyok', 'kyyyyyyyyyyyyyok', 'kyyyyyyyyyyyyyok', 'kyyyyyyyyyyyyyok',
    'kooooooooooooook', '.kkkkkkkkkkkkkk.', '................', '................'],
  cart: [
    '................', '..kkkkkkkkkkkk..', '..kssssssssssgk.', '..kswwwwwwwwsgk.', '..kswrrrrrrwsgk.', '..kswrwwwwrwsgk.',
    '..kswrrrrrrwsgk.', '..kswwwwwwwwsgk.', '..kssssssssssgk.', '..ksgsgsgsgsggk.', '..ksssssssssssk.', '..kggggggggggggk',
    '...koykoykoyko..', '...kkkkkkkkkkk..', '................', '................'],
  disc: [
    '.....kkkkkk.....', '...kkwwwwwwkk...', '..kwwcwwwwwwgk..', '.kwccwwwwwwwwgk.', '.kwcwwwwwwwwwgk.', 'kwwwwwwkkwwwwwgk',
    'kwwwwwk..kwwwwgk', 'kwwwwk....kwwwgk', 'kwwwwk....kwwggk', 'kwwwwwk..kwwwggk', 'kwwwwwwkkwwwgggk', '.kwwwwwwwwwgggk.',
    '.kwwwwwwwwgggpk.', '..kgwwwwgggppk..', '...kkggggggkk...', '.....kkkkkk.....'],
  handheld: [
    '...kkkkkkkkkk...', '...kssssssssk...', '...ksttttttsk...', '...ksttllttsk...', '...ksttttttsk...', '...ksttttttsk...',
    '...kssssssssk...', '...kskssssrsk...', '...kkkksrsssk...', '...kskssssssk...', '...kssssggssk...', '...kssssssssk...',
    '...kkkkkkkkkk...', '................', '................', '................'],
  chip: [
    '................', '...k.k.k.k.k....', '..kkkkkkkkkkk...', '.kkdddddddddkk..', '..kdgggggggdk...', '.kkdgwwwwwgdkk..',
    '..kdgwbbbwgdk...', '.kkdgwbbbwgdkk..', '..kdgwwwwwgdk...', '.kkdgggggggdkk..', '..kdddddddddk...', '..kkkkkkkkkkk...',
    '...k.k.k.k.k....', '................', '................', '................'],
  drive: [
    '................', '................', '................', '.kkkkkkkkkkkkkk.', 'kwwwwwwwwwwwwwwk', 'kwssssssssssssgk',
    'kwssssssssssssgk', 'kwsggggggggssGgk', 'kwssssssssssssgk', 'kggggggggggggggk', '.kkkkkkkkkkkkkk.', '................',
    '................', '................', '................', '................'],
  upload: [
    '.......k........', '......kGk.......', '.....kGlGk......', '....kGlllGk.....', '...kkkGlGkkk....', '.....kGlGk......',
    '.....kGlGk......', '.kkkkkkkkkkkkkk.', '.kbbbbbbbbbbbbk.', '.kbsswwwwwwssbk.', '.kbsswwwwwwssbk.', '.kbbbbbbbbbbbbk.',
    '.kbbkssssssbbbk.', '.kbbkskksssbbbk.', '.kbbkssssssbbbk.', '.kkkkkkkkkkkkkk.'],
  start: [
    '................', '.....rrr.G......', '....rrrr.GG.....', '....rrrr.GGG....', '...rrrr.GGGG....', '...rrrr.GGGG....',
    '................', '..BBBB.yyyy.....', '..BBBB.yyyy.....', '.BBBB.yyyy......', '.BBBB.yyyy......', '................',
    '................', '................', '................', '................'],
  info: [
    '.....kkkkkk.....', '...kkBBBBBBkk...', '..kBBBBwwBBBBk..', '.kBBBBBwwBBBBBk.', '.kBBBBBBBBBBBBk.', 'kBBBBBwwwBBBBBBk',
    'kBBBBBBwwBBBBBBk', 'kBBBBBBwwBBBBBBk', 'kBBBBBBwwBBBBBBk', 'kBBBBBBwwBBBBBBk', '.kBBBBwwwwBBBBk.', '.kBBBBBBBBBBBBk.',
    '..kBBBBBBBBBBk..', '...kkBBBBBBkk...', '.....kkkkkk.....', '................'],
  warn: [
    '.......kk.......', '......kyyk......', '......kyyk......', '.....kyyyyk.....', '.....kykkyk.....', '....kyykkyyk....',
    '....kyykkyyk....', '...kyyykkyyyk...', '...kyyykkyyyk...', '..kyyyyyyyyyyk..', '..kyyyykkyyyyk..', '.kyyyyykkyyyyyk.',
    '.kyyyyyyyyyyyyk.', 'kkkkkkkkkkkkkkkk', '................', '................'],
  error: [
    '.....kkkkkk.....', '...kkrrrrrrkk...', '..krrrrrrrrrrk..', '.krrwrrrrrrwrrk.', '.krwwwrrrrwwwrk.', 'krrrwwwrrwwwrrrk',
    'krrrrwwwwwwrrrrk', 'krrrrrwwwwrrrrrk', 'krrrrrwwwwrrrrrk', 'krrrrwwwwwwrrrrk', '.krrwwwrrwwwrrk.', '.krwwwrrrrwwwrk.',
    '..krrrrrrrrrrk..', '...kkrrrrrrkk...', '.....kkkkkk.....', '................'],
  gamepad: [
    '................', '................', '................', '...kkkkkkkkkk...', '..kssssssssssk..', '.ksskssssssrssk.',
    '.kskkksssssrsrk.', '.ksskssggssrssk.', '.kssssskksssssk.', '.ksssskkkksssk..', '..ksskk..kkssk..', '..kkk......kkk..',
    '................', '................', '................', '................'],
  trash: [
    '................', '.....kkkkkk.....', '..kkkkkkkkkkkk..', '..kwwwwwwwwwwk..', '..kkkkkkkkkkkk..', '...kswswswswk...',
    '...kswswswswk...', '...kswswswswk...', '...kswswswswk...', '...kswswswswk...', '...kswswswswk...', '...kswswswswk...',
    '...kswswswswk...', '....kkkkkkkk....', '................', '................'],
};

export { ART, P };

export function icon(name) {
  const art = ART[name] || ART.folder;
  let rects = '';
  art.forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
      const c = P[row[x]];
      if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }
  });
  return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

const DISC = new Set(['psx', 'ps2', 'psp', 'segaCD', 'segaSaturn', 'gamecube', 'wii', '3do', 'pcfx']);
const HANDHELD = new Set(['gb', 'gba', 'nds', 'segaGG', 'lynx', 'ngp', 'ws', 'vb', 'psvita']);
export const platformIcon = (id) => (DISC.has(id) ? 'disc' : HANDHELD.has(id) ? 'handheld' : id === 'unknown' ? 'warn' : 'cart');
