/* Fixed cosmetic choices shared by the browser and authoritative server. No DOM or storage access. */
(function () {
  'use strict';
  var W = window.Warz;
  var PRESETS = [
    ['Sky blue', '#2f9bff'], ['Navy', '#26427f'], ['Cyan', '#35d5ed'], ['Teal', '#159b91'],
    ['Mint', '#7de5b1'], ['Green', '#45b95c'], ['Forest', '#247544'], ['Lime', '#b2db3f'],
    ['Yellow', '#ffda47'], ['Gold', '#e9aa27'], ['Orange', '#ff943d'], ['Coral', '#ff7866'],
    ['Red', '#ee4a4a'], ['Burgundy', '#963a58'], ['Pink', '#f58bc5'], ['Purple', '#995ddd'],
    ['Lavender', '#c0a5f2'], ['Brown', '#956849'], ['White', '#f2f1e8'], ['Charcoal', '#3c4149']
  ].map(function (row) { return Object.freeze({ name: row[0], color: row[1] }); });
  var FACES = [
    ['none', 'No face'], ['smile', 'Smiley face'], ['sad', 'Sad face'], ['angry', 'Angry face'],
    ['evil', 'Evil face'], ['laugh', 'Laughing face'], ['cry', 'Crying face']
  ].map(function (row) { return Object.freeze({ id: row[0], label: row[1] }); });
  var EMOTES = [
    ['smile', 'Smile', '\uD83D\uDE42'], ['sad', 'Sad', '\uD83D\uDE1E'], ['angry', 'Angry', '\uD83D\uDE20'],
    ['laugh', 'Laughing', '\uD83D\uDE02'], ['gg', 'GG', 'GG'], ['hi', 'Hi', 'Hi'], ['bye', 'Bye', 'Bye'],
    ['haha', 'HaHa!', 'HaHa!'], ['evil', 'Evil', '\uD83D\uDE08'], ['cry', 'Crying', '\uD83D\uDE2D'],
    ['fire', 'Fire', '\uD83D\uDD25'], ['rose', 'Withered rose', '\uD83E\uDD40'], ['cooked', 'Get Cooked!', 'Get Cooked!']
  ].map(function (row) { return Object.freeze({ id: row[0], label: row[1], glyph: row[2] }); });
  var DEFAULT = Object.freeze({ color: '#2f9bff', face: 'none', emotes: Object.freeze(EMOTES.slice(0, 9).map(function (e) { return e.id; })) });
  function validColor(color) { return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color); }
  function validFace(face) { return typeof face === 'string' && FACES.some(function (f) { return f.id === face; }); }
  function emote(id) { return typeof id === 'string' ? EMOTES.find(function (e) { return e.id === id; }) || null : null; }
  function normalize(value) {
    value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    var used = Object.create(null), supplied = Array.isArray(value.emotes) ? value.emotes : [], slots = new Array(9);
    // Reserve valid supplied slots first so repairing one invalid slot cannot displace a later valid choice.
    for (var i = 0; i < 9; i++) {
      var id = supplied[i];
      if (emote(id) && !used[id]) { slots[i] = id; used[id] = true; }
    }
    for (var j = 0; j < 9; j++) if (!slots[j]) {
      var replacement = EMOTES.find(function (e) { return !used[e.id]; }).id;
      slots[j] = replacement; used[replacement] = true;
    }
    return { color: validColor(value.color) ? value.color.toLowerCase() : DEFAULT.color,
      face: validFace(value.face) ? value.face : DEFAULT.face, emotes: slots };
  }
  W.Cosmetics = Object.freeze({ PRESETS: Object.freeze(PRESETS), FACES: Object.freeze(FACES), EMOTES: Object.freeze(EMOTES),
    DEFAULT: DEFAULT, normalize: normalize, validColor: validColor, validFace: validFace, emote: emote,
    EMOTE_DURATION: 3, EMOTE_COOLDOWN: 1.5 });
}());
