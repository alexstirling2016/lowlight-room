/* Alio Die Mood Explorer \u2014 recommendation engine.
   Pure functions, no DOM. Shared by the artifact page, the GitHub Pages listening room and the Node tests.

   EVIDENCE LAYERS (weighted differently, shown separately in every explanation)
   1. sound      \u2013 documented sonic features: instruments, field recordings, voices, rainfall, percussion, track lengths.
                   Only from Bandcamp credits, official text with a literal recording cue, or verified metadata.
                   A listener's report counts, at lower weight, and is labelled as a listener report.
   2. atmosphere \u2013 described atmospheres and imagery: medieval, sacred, watery, mysterious, cosmic.
   3. mood       \u2013 subjective interpretations: comforting, cosy, unsettling, drowsy.
   Catalogue mood tags count as classification evidence in the atmosphere or mood layer; AI-provisional
   classifications count least and are always labelled. The engine never states that an album contains a sound
   unless layer 1 supports it. */
(function (root) {
  'use strict';

  var MOOD_VOCAB = ['immersive', 'meditative', 'earthy / organic', 'mystical', 'watery', 'primordial', 'luminous',
    'dark', 'dreamlike', 'serene', 'cosmic', 'ethereal', 'melancholic', 'ominous'];

  // ---------- Text helpers ----------
  function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2019\u2018`]/g, "'").replace(/[\u201c\u201d\u00ab\u00bb]/g, '"'); }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function sentences(text) { return (String(text || '').replace(/\n+/g, ' \n ').match(/[^.!?\n]+[.!?]*["\u201d)]?/g) || []).map(function (s) { return s.trim(); }).filter(Boolean); }
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + ' \u2026' : s; }
  function list(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  // ---------- Layer 1: documented sonic features ----------
  var SIMILE = /\b(like|as if|as though|evok\w*|reminisc\w*|imagin\w*|suggest\w*|recall\w*|resembl\w*|seems? to|akin to|as a|recalling|conjur\w*)\s+(an?\s+|the\s+)?([a-z-]+\s+){0,2}$/;
  var RECORDING_CUE = /\b(field[- ]?record\w*|record(ed|ing|ings)|samples?|sampled|sounds? of|noises?|can be heard|heard|background track|captured|soundscapes? of|atmospherics|street sounds|sound ?field)\b/;
  var CREDIT_LINE = /^([^:]{2,80}:\s|(released|recorded|mixed|mastered|composed|played|performed|artwork|edited|photos?|music|produced|arranged|all music|special thanks|cover|design|written|guest|additional)\b)/;
  var QUALITY_AFTER = /^["']?\s*(quality|feel|character|mood|atmosphere|-like|like|tones?\b)/;
  var HEAVY_RE = /\b(heavy|gust\w*|torrent\w*|downpour|pouring|thunder(storm)?s?|storms?|lashing|roar\w*|deluge|monsoon|pounding)\b/;
  var GENTLE_RE = /\b(gentle|soft|light|delicate|trickl\w*|drip\w*|droplets?|dew\w*|bubbl\w*|murmur\w*|lapping|whisper\w*|quiet|tinkl\w*)\b/;
  var SOUND_FEATURES = [
    { id: 'rain', label: 'rain recordings', env: true, re: /\b(rain(?!bow|forest|stick|maker)[a-z-]*|raindrops?|rainfall|downpour)\b/g, supports: { rain: 1, water: 0.8 } },
    { id: 'rainInstrument', label: 'rainstick / rainmaker (an instrument that imitates rain)', re: /\b(rain[- ]?sticks?|rain[- ]?makers?)\b/g, supports: { rain: 0.3, gentleWater: 0.4, water: 0.3 } },
    { id: 'water', label: 'water sounds', env: true, re: /\b(water|streams?|rivers?|brooks?|sea|ocean|waves|bubbles?|fountains?|waterfalls?|droplets?|lake|creek|surf)\b/g, supports: { water: 1 } },
    { id: 'birds', label: 'birdsong or insects', env: true, re: /\b(birds?|birdsong|bird[- ]song|cicadas?|crickets?|insects?|frogs?)\b/g, supports: { nature: 1 } },
    { id: 'wind', label: 'wind', env: true, re: /\bwind(?![- ]?(instrument|chime))\b/g, supports: { nature: 0.4 } },
    { id: 'field', label: 'field recordings', re: /\b(field[- ]?record\w*|nature[- ]?(sound|record)\w*|environmental (sound|record)\w*|soundfield[- ]?record\w*|jungle recording)\b/g, supports: { nature: 0.6 } },
    { id: 'chant', label: 'chant or choir', re: /\b(gregorian|chants?|chanting|chanted|choirs?|choral|plainsong|plainchant)\b/g, supports: { medieval: 1, sacred: 0.8, voices: 1 } },
    { id: 'voice', label: 'voices', re: /\b(voices?|vocals?|vocal improvisations?|singing|singer|sung|soprano|throat[- ]singing|overtone singing)\b/g, supports: { voices: 0.8, sacred: 0.15 } },
    { id: 'early', label: 'early or traditional instruments', re: /\b(psalter(y|io|ies)|hurdy[- ]?gurdy|lutes?|rebab|rebec|vielle|shawm|crumhorn|dulcimer|monochord|monocord|organistrum|bagpipes?)\b/g, supports: { medieval: 0.6 } },
    { id: 'percussion', label: 'percussion', re: /\b(drums?|drumming|percussions?|percussive|percussion-loops|tabla|nagara|frame[- ]drums?|darbuka|djembe|bongos?|congas?|rhythms?|rhythmic|beats|pulse|pulsing|tam[- ]?tam|rototom|woodblock)\b/g, supports: { energy: 1 } },
    { id: 'bells', label: 'bells, gongs or singing bowls', re: /\b(bells?|gongs?|(singing |tibetan )?bowls|chimes?|bow chime)\b/g, supports: { sacred: 0.4 } },
    { id: 'flute', label: 'flutes', re: /\b(flutes?|bansuri|shakuhachi|khen|dreampipe|ney)\b/g, supports: {} },
    { id: 'strings', label: 'zithers or plucked strings', re: /\b(zithers?|santoor|guzheng|tamb?ura|tampura|swarmandal|esraj|sitar|surbahar|harps?|cither|guitar|koto)\b/g, supports: {} },
    { id: 'piano', label: 'piano', re: /\b(piano|pianoforte)\b/g, supports: {} },
    { id: 'synth', label: 'synthesizers / electronics', re: /\b(synth\w*|electronics)\b/g, supports: { cosmic: 0.2 } },
    { id: 'beatless', label: 'described as beatless', re: /\b(beatless|no beats|without beats|beats are (totally )?absent|absence of beats|no percussion)\b/g, supports: {} }
  ];
  var FEATURE_BY_ID = {}; SOUND_FEATURES.forEach(function (f) { FEATURE_BY_ID[f.id] = f; });

  // Scan one album's texts. Returns { features: {id: [{words, source, text}]}, imagery: {rain:[], heavy:[], gentle:[]} }.
  function extractSounds(sources) {
    var feats = {}, imagery = { rain: [], heavy: [], gentle: [] };
    sources.forEach(function (src) {
      sentences(src.text).forEach(function (sent) {
        var n = norm(sent);
        // The catalogue's credits block also holds editorial reviews and quoted lyrics: only personnel-style lines count as credits.
        var kind = src.kind;
        if (kind === 'credits' && !CREDIT_LINE.test(n) && !(n.length < 130 && !/\b(is|are|was|were|has|have|seems|gives|becomes|falling|fall)\b/.test(n))) kind = 'official';
        // Environmental sounds (rain, water, birds, wind) need an explicit recording cue in the same sentence, even in credits.
        var literalSentence = RECORDING_CUE.test(n);
        var foundWaterLiteral = false;
        SOUND_FEATURES.forEach(function (f) {
          if (src.kind === 'title') return;
          f.re.lastIndex = 0; var m, words = [];
          while ((m = f.re.exec(n))) {
            var before = n.slice(Math.max(0, m.index - 40), m.index);
            var after = n.slice(m.index + m[0].length, m.index + m[0].length + 16);
            if (SIMILE.test(before) || QUALITY_AFTER.test(after)) { if (f.id === 'rain') imagery.rain.push({ text: sent, source: kind }); continue; }
            if (f.env && !literalSentence) { if (f.id === 'rain') imagery.rain.push({ text: sent, source: kind }); continue; }
            words.push(m[0]);
          }
          if (words.length) {
            (feats[f.id] = feats[f.id] || []).push({ words: uniq(words), source: kind, text: sent });
            if (f.id === 'rain' || f.id === 'water') foundWaterLiteral = true;
          }
        });
        if (foundWaterLiteral) {
          if (HEAVY_RE.test(n)) (feats.heavyWater = feats.heavyWater || []).push({ words: [n.match(HEAVY_RE)[0]], source: kind, text: sent });
          if (GENTLE_RE.test(n)) (feats.gentleWater = feats.gentleWater || []).push({ words: [n.match(GENTLE_RE)[0]], source: kind, text: sent });
        } else if (/\b(rain\w*|storm\w*|thunder\w*|water\w*|stream\w*|aquatic|drops?)\b/.test(n) && !/\bthunderous\b/.test(n)) {
          if (HEAVY_RE.test(n) && /\b(rain|storm|thunder|downpour|monsoon)/.test(n)) imagery.heavy.push({ text: sent, source: kind });
          if (GENTLE_RE.test(n)) imagery.gentle.push({ text: sent, source: kind });
        }
      });
    });
    if (feats.beatless && feats.percussion) {
      // "beats are totally absent" must not count as percussion.
      feats.percussion = feats.percussion.filter(function (p) { return !/\b(beatless|no beats|without beats|absent)\b/.test(norm(p.text)); });
      if (!feats.percussion.length) delete feats.percussion;
    }
    return { features: feats, imagery: imagery };
  }
  FEATURE_BY_ID.heavyWater = { id: 'heavyWater', label: 'heavy rain, storm or rushing water', supports: { heavyWater: 1 } };
  FEATURE_BY_ID.gentleWater = { id: 'gentleWater', label: 'gentle water: drops, trickles, bubbles', supports: { gentleWater: 1 } };

  // ---------- Concepts: what a request can ask for ----------
  // atmos / mood: word stems for layers 2 and 3. tags: catalogue mood labels with their layer and weight.
  // query: extra words that only matter when they appear in a request.
  var CONCEPTS = {
    warm: { label: 'warmth', mood: ['warm', 'cosy', 'cosie', 'cozy', 'cozie', 'comfort', 'tender', 'gentle', 'soft', 'sooth', 'reassur', 'kindly', 'embrac', 'intimat', 'caress', 'sweet', 'velvet', 'nurtur'], atmos: ['candle', 'hearth', 'golden', 'glow', 'amber', 'honey', 'fragran', 'incense'], tags: { serene: ['mood', 0.6], luminous: ['mood', 0.3], 'earthy / organic': ['mood', 0.3] } },
    dark: { label: 'darkness', atmos: ['dark', 'shadow', 'abyss', 'black', 'crypt', 'underworld', 'tenebr', 'nocturn', 'gloom', 'sombre', 'somber'], tags: { dark: ['atmos', 1], ominous: ['atmos', 0.4] } },
    menace: { label: 'menace or unease', mood: ['ominous', 'sinister', 'eerie', 'menac', 'disquiet', 'unsettl', 'grim', 'brood', 'haunt', 'dread', 'threat', 'scary', 'creepy', 'foreboding', 'tense'], tags: { ominous: ['mood', 1] } },
    medieval: { label: 'medieval or monastic character', atmos: ['mediev', 'monast', 'monk', 'abbey', 'cloister', 'liturg', 'troubadour', 'archaic', 'renaissance', 'cathedral', 'gothic', 'chapel', 'hymn', 'votive', 'organum', 'laude', 'antiqu', 'early music', 'church', 'basilica', 'convent', 'castle', 'pilgrim', 'manuscript', 'templar', 'byzant', 'crusad', 'gregorian', 'chant'], query: ['chant', 'gregorian', 'choir', 'psaltery'] },
    sacred: { label: 'sacred or ritual atmosphere', atmos: ['sacred', 'ritual', 'spiritual', 'prayer', 'pray', 'devot', 'temple', 'shaman', 'mantra', 'transcend', 'numinous', 'initiat', 'alchem', 'divine', 'holy', 'ceremon', 'esoteric', 'invocat', 'incense', 'mystic'], tags: { mystical: ['atmos', 0.8] } },
    nature: { label: 'natural, pastoral setting', atmos: ['forest', 'wood', 'leaf', 'leaves', 'meadow', 'garden', 'moss', 'pastoral', 'landscape', 'earth', 'organic', 'tree', 'flower', 'bloom', 'blossom', 'grass', 'hill', 'mountain', 'valley', 'botanic', 'corolla', 'birds'], tags: { 'earthy / organic': ['atmos', 0.9] }, query: ['field recording', 'birdsong'] },
    water: { label: 'water', atmos: ['water', 'stream', 'river', 'sea', 'ocean', 'lake', 'wave', 'flow', 'liquid', 'fountain', 'tide', 'aqua', 'brook', 'pond', 'marsh', 'lagoon', 'dew'], tags: { watery: ['atmos', 0.9] } },
    rain: { label: 'rain', soundLed: true, atmos: ['rain', 'raindrop', 'rainfall', 'rainy', 'drizzl', 'downpour', 'storm', 'thunder', 'monsoon'], exclude: /^(rain(bow|forest)|thunderous)/ },
    heavyWater: { label: 'heavy rain or storm', soundLed: true, atmos: ['storm', 'thunder', 'torrent', 'downpour', 'monsoon', 'deluge', 'tempest'], exclude: /^thunderous/ },
    gentleWater: { label: 'gentle water sounds', soundLed: true, atmos: ['trickl', 'drip', 'droplet', 'bubbl', 'murmur'] },
    cosmic: { label: 'cosmic expanse', atmos: ['cosmic', 'cosmos', 'space', 'star', 'galax', 'planet', 'astral', 'orbit', 'celestial', 'universe', 'nebul', 'moon', 'lunar', 'solar', 'interstellar'], tags: { cosmic: ['atmos', 1] } },
    light: { label: 'luminosity', atmos: ['light', 'luminous', 'lumin', 'bright', 'radian', 'shimmer', 'sun', 'dawn', 'clarity', 'glitter', 'sparkl', 'crystal', 'heaven', 'angel', 'airy', 'ethereal'], tags: { luminous: ['atmos', 0.9], ethereal: ['atmos', 0.8] } },
    sleep: { label: 'drowsiness', mood: ['sleep', 'slumber', 'lull', 'drows', 'doze', 'somn', 'lullab', 'hypno', 'bedtime', 'sedat', 'torpor', 'soporific'], atmos: ['dream', 'oneiric', 'hypnag', 'trance'], tags: { dreamlike: ['mood', 0.8] } },
    calm: { label: 'calm and stillness', mood: ['meditat', 'calm', 'tranquil', 'peace', 'still', 'serene', 'serenity', 'quiet', 'contemplat', 'rest', 'relax', 'balm', 'unwind'], tags: { meditative: ['mood', 0.9], serene: ['mood', 0.9] } },
    melancholy: { label: 'melancholy', mood: ['melanchol', 'sad', 'sorrow', 'longing', 'nostalg', 'mourn', 'elegi', 'lament', 'grief', 'wistful', 'regret', 'bittersweet'], tags: { melancholic: ['mood', 1] } },
    primordial: { label: 'primordial, ancient-earth character', atmos: ['primordial', 'primev', 'ancestr', 'tribal', 'archaic', 'origin', 'cave', 'stone', 'ancient', 'prehist', 'fossil', 'ruin', 'archetyp', 'mythic', 'myth', 'legend'], tags: { primordial: ['atmos', 1] } },
    mysterious: { label: 'mystery', atmos: ['myster', 'enigma', 'secret', 'hidden', 'arcane', 'occult', 'cryptic', 'veil', 'labyrinth', 'unknown', 'riddle', 'fog', 'mist', 'vault', 'nocturn', 'crypt', 'shadow'], mood: ['uncanny', 'strange'], tags: { mystical: ['atmos', 0.5] } },
    enchanted: { label: 'fairy-tale enchantment', atmos: ['enchant', 'magic', 'fairy', 'fairies', 'fable', 'fairytale', 'whimsic', 'elf', 'elves', 'spell'] },
    energy: { label: 'rhythmic energy', mood: ['energ', 'dynamic', 'vital', 'lively', 'vibran', 'kinetic', 'propul', 'invigor', 'uplift', 'awake', 'alert'], query: ['rhythm', 'percussion', 'drum', 'beat', 'pulse', 'groove'] },
    voices: { label: 'voices', soundLed: true, atmos: [], query: ['voice', 'vocal', 'choir', 'chant', 'singing', 'sung'] },
    immersive: { label: 'immersive depth', mood: ['immers', 'envelop', 'absorb', 'submerg', 'engulf'], atmos: ['deep', 'depth', 'vast', 'endless', 'boundless'], tags: { immersive: ['mood', 0.9] } },
    autumn: { label: 'autumnal colour', atmos: ['autumn', 'harvest', 'amber', 'dusk', 'fog', 'mist', 'twilight', 'decay', 'russet', 'chestnut', 'smoke', 'fallen leaves'] },
    long: { label: 'long-form pacing', atmos: ['unfold', 'slowly', 'sustain', 'continuous', 'evolv'], query: ['long', 'extended', 'lengthy'] }
  };
  var W = { // evidence weights per layer and source
    sound: { credits: 1.3, official: 1.1, metadata: 1.3, listener: 0.5 },
    atmos: { official: 0.6, title: 0.35, listener: 0.3, tag: 1 },
    mood: { official: 0.45, listener: 0.35, tag: 1 },
    reviewed: 1.0, ai: 0.3
  };
  var CORE = {warm: /^(warm|comfort|cos[iy]|coz[iy])/, dark: /^(dark|gloom)/, menace: /^(ominous|sinister|menac|dread)/, medieval: /^(mediev|monast|gregorian|liturg)/, sacred: /^(sacred|spiritual|ritual|devot|holy|divine)/, nature: /^(forest|wood|nature|garden|pastoral)/, water: /^(water|aqua|liquid)/, rain: /^rain/, cosmic: /^(cosmic|cosmos|astral|celestial)/, light: /^(lumin|light|radian|bright)/, sleep: /^(sleep|slumber|drows|lullab)/, calm: /^(calm|meditat|tranquil|serene|serenity|peace)/, melancholy: /^(melanchol|sorrow|nostalg|lament)/, primordial: /^(primordial|primev|ancestr|ancient)/, mysterious: /^(myster|enigma|arcane|occult)/, enchanted: /^(enchant|magic|fair)/, energy: /^(energ|dynamic|vital|lively)/, immersive: /^(immers|envelop|deep)/, autumn: /^(autumn|harvest)/};
  function stemRe(stems) { return stems.length ? new RegExp('\\b(' + stems.map(function (t) { return esc(t).replace(/ /g, '[\\s-]+'); }).join('|') + ')[a-z]*', 'g') : null; }
  Object.keys(CONCEPTS).forEach(function (k) {
    var c = CONCEPTS[k]; c.key = k; c.mood = c.mood || []; c.atmos = c.atmos || []; c.tags = c.tags || {};
    c.reAtmos = stemRe(c.atmos); c.reMood = stemRe(c.mood); c.reCore = CORE[k] || null;
    c.reQuery = stemRe(uniq(c.atmos.concat(c.mood, c.query || [])));
    c.sounds = SOUND_FEATURES.concat([FEATURE_BY_ID.heavyWater, FEATURE_BY_ID.gentleWater]).filter(function (f) { return f.supports && f.supports[k]; }).map(function (f) { return f.id; });
  });
  // raw: the same text before lower-casing. A capitalised match in mid-sentence is a name ("Don't think Enigma or
  // Delerium", "Hic Sunt Leones") and is skipped \u2014 except in titles, where capitals are normal.
  function matchWords(re, text, exclude, raw) {
    if (!re) return [];
    re.lastIndex = 0; var m, out = [];
    while ((m = re.exec(text)) && out.length < 40) {
      if (exclude && exclude.test(m[0])) continue;
      if (raw && /[A-Z]/.test(raw.charAt(m.index)) && !CAPITAL_OK.test(m[0])) {
        var prev = raw.slice(Math.max(0, m.index - 3), m.index);
        if (!/(^|[.!?:;\n"\u201c(]\s*)$/.test(prev) && m.index > 0) continue;
      }
      out.push(m[0]);
    }
    return out;
  }
  // Words English capitalises anyway: still evidence when capitalised mid-sentence.
  var CAPITAL_OK = /^(renaissance|gregorian|gothic|byzant|templar|mediev|baroque|orphic|celtic|latin|tibet|indian|christian|buddhist|sufi|vedic|pagan|druid|middle ages)/;
  function rawText(s) { return String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2019\u2018`]/g, "'").replace(/[\u201c\u201d\u00ab\u00bb]/g, '"'); }
  // Evidence from words: distinct words count fully, repeats add little; a head term naming the concept counts double.
  function wordScore(words, w, cap, core) {
    var d = uniq(words), n = 0;
    d.slice(0, cap).forEach(function (x) { n += core && core.test(x) ? 2 : 1; });
    return w * (n + 0.15 * Math.min(4, words.length - d.length));
  }

  // ---------- Durations ----------
  function parseDuration(s) {
    if (typeof s === 'number') return s;
    var p = String(s || '').trim().split(':').map(Number);
    if (!p.length || p.some(isNaN)) return 0;
    return p.reduce(function (acc, v) { return acc * 60 + v; }, 0);
  }
  function fmtMinutes(sec) { return Math.round(sec / 60) + ' min'; }
  // Track-length evidence from text when no track metadata exists.
  function durationEvidence(text) {
    var n = norm(text), out = { trackMin: 0, albumMin: 0, singleTrack: false, text: '' };
    var stamps = (n.match(/(?<![\d:])\d{1,2}:\d{2}(?::\d{2})?(?![\d:])/g) || []).map(parseDuration);
    if (stamps.length >= 2) { out.trackMin = Math.max.apply(null, stamps) / 60; out.listed = stamps.length; }
    else if (stamps.length === 1) out.albumMin = stamps[0] / 60;
    var m;
    var trackPats = [/\b(\d{2,3})[- ]?(?:minutes?|min\.?)(?:[- ]long)?\s+(?:[a-z/-]+\s+){0,3}(?:track|piece|composition|soundscape|suite|movement)/, /(?:track|piece|composition|soundscape)[^.]{0,40}\((\d{2,3}) ?min/, /\bone (\d{2,3})[- ]minute/];
    trackPats.forEach(function (re) { if ((m = n.match(re))) { out.trackMin = Math.max(out.trackMin, Number(m[1])); out.text = m[0]; } });
    if (/\b(two|three)?,?\s*half[- ]hour[- ]long pieces?/.test(n)) { out.trackMin = Math.max(out.trackMin, 30); out.text = n.match(/half[- ]hour[- ]long pieces?/)[0]; }
    if (/\bsingle (long )?(track|piece|composition)\b|\bone long (track|piece)\b/.test(n)) out.singleTrack = true;
    var albumPats = [/\b(\d{2,3})[- ]?minutes?(?: long)? (?:album|series|cd|journey|work)/, /\b(\d{2,3})[- ]minute series/, /album[^.]{0,30}?(\d{2,3}) minutes/];
    albumPats.forEach(function (re) { if ((m = n.match(re))) { out.albumMin = Math.max(out.albumMin, Number(m[1])); out.text = out.text || m[0]; } });
    if (/(?<!half )\ban hour\b|\bhour[- ]long\b/.test(n.replace(/half an hour/g, '')) && !out.albumMin) { out.albumMin = 60; out.text = out.text || 'about an hour'; }
    return out;
  }

  // ---------- Normalising albums ----------
  function yearOf(d) { var m = String(d || '').match(/(19|20)\d{2}/); return m ? Number(m[0]) : null; }
  function slugOf(url) { return String(url || '').replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop(); }
  function canonicalUrl(url) { return String(url || '').trim().replace(/^http:/, 'https:').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase(); }
  function tracksFrom(arr) { return (arr || []).map(function (t) { return { title: t[0] || t.title, seconds: parseDuration(t[1] != null ? t[1] : t.duration) }; }); }

  function fromCurated(a, enrich, review) {
    enrich = enrich || {};
    return finish({
      id: a.id, title: a.title, url: a.url, artist: enrich.artist || '', releaseDate: a.releaseDate, provenance: 'curated', status: 'verified',
      official: { primary: a.officialPrimaryMood, tags: a.officialMoodTags || [], bcTags: a.bandcampTags || [], about: a.officialAbout || '', credits: a.officialCredits || '' },
      listener: { primary: a.listenerPrimaryMood, tags: a.listenerMoodTags || [], comments: a.listenerComments || '', favorite: a.favoriteTracks || '', reviews: a.listenerReviewCount || 0 },
      ai: null, reviewed: review && (review.status === 'approved' || (review.moodTags && review.moodTags.length)) ? review : null,
      tracks: tracksFrom(enrich.tracks), tracksSource: enrich.tracks ? 'Bandcamp track list' : '', bandcampId: enrich.itemId || null, artUrl: enrich.artUrl || null, artAsset: enrich.artAsset || null
    });
  }
  function fromDiscovery(d) {
    var src = d.source || {}, review = d.review || {};
    var tracks = tracksFrom(src.tracks);
    return finish({
      id: d.slug || slugOf(d.url), title: d.title, url: d.url, artist: d.artist || '', releaseDate: d.releaseDate || '', provenance: 'discovered',
      status: review.status === 'approved' ? 'approved' : (review.status === 'rejected' ? 'rejected' : 'provisional'),
      official: { primary: '', tags: [], bcTags: src.tags || [], about: src.about || src.aboutExcerpt || '', aboutIsExcerpt: !src.about && !!src.aboutExcerpt, credits: [].concat(src.credits ? [src.credits] : [], src.performers || []).join('\n'), trackTitles: tracks.map(function (t) { return t.title; }).join('; ') },
      listener: { primary: '', tags: [], comments: '', favorite: '', reviews: 0 },
      ai: d.ai || null, reviewed: review.status === 'approved' || (review.moodTags && review.moodTags.length) ? review : null,
      tracks: tracks, tracksSource: tracks.length ? 'Bandcamp track list' : '', bandcampId: d.itemId || src.itemId || null, artUrl: src.artUrl || null, artAsset: d.artAsset || null,
      firstDiscovered: d.firstDiscovered || null, flags: d.flags || [], discoveredBy: d.discoveredBy || ''
    });
  }

  function finish(a) {
    a.year = yearOf(a.releaseDate);
    a.canonical = canonicalUrl(a.url);
    var o = a.official, l = a.listener;
    var srcs = [
      { kind: 'credits', label: 'Bandcamp credits', text: o.credits },
      { kind: 'official', label: a.official.aboutIsExcerpt ? 'official description (opening words)' : 'official description', text: o.about },
      { kind: 'listener', label: 'listener comment', text: l.comments },
      { kind: 'title', label: 'titles', text: a.title + '. ' + (o.trackTitles || '') }
    ];
    a.sound = extractSounds(srcs);
    var f = {
      offTags: [o.primary].concat(o.tags).filter(function (t) { return t && t !== 'unclassified'; }).map(norm),
      lisTags: [l.primary].concat(l.tags).filter(function (t) { return t && t !== 'unclassified'; }).map(norm),
      revTags: a.reviewed ? uniq([a.reviewed.primaryMood].concat(a.reviewed.moodTags || []).filter(Boolean).map(norm)) : [],
      aiTags: a.ai && !a.reviewed ? uniq([a.ai.primaryMood].concat(a.ai.moodTags || []).filter(Boolean).map(norm)) : [],
      // The label name "Hic Sunt Leones" appears in many credits and must not read as "sun" or "lions".
      off: norm(o.about + ' \n ' + o.credits).replace(/hic sunt leones/g, '               '), lis: norm(l.comments + ' ' + l.favorite).replace(/hic sunt leones/g, '               '),
      offRaw: rawText(o.about + ' \n ' + o.credits), lisRaw: rawText(l.comments + ' ' + l.favorite), title: norm(a.title + ' ' + (o.trackTitles || '')),
      rev: norm(a.reviewed ? (a.reviewed.note || '') + ' ' + (a.reviewed.descriptors || []).join(' ') : ''),
      ai: norm(a.ai && !a.reviewed ? (a.ai.summary || '') + ' ' + (a.ai.descriptors || []).join(' ') : '')
    };
    a._f = f;
    a.aff = {}; a.affLiteral = {}; a.ev = {};
    Object.keys(CONCEPTS).forEach(function (k) {
      var c = CONCEPTS[k], ev = { sound: [], atmos: [], mood: [], tags: [], lisTags: [], reviewed: [], ai: [] };
      // Layer 1
      var soundRaw = 0;
      c.sounds.forEach(function (id) {
        var hits = a.sound.features[id]; if (!hits) return;
        var wt = FEATURE_BY_ID[id].supports[k];
        var best = hits.reduce(function (b, h) { return Math.max(b, W.sound[h.source] || 0); }, 0);
        soundRaw += wt * best * Math.min(1.5, 0.75 + 0.25 * hits.length);
        ev.sound.push({ id: id, label: FEATURE_BY_ID[id].label, hits: hits });
      });
      // Layers 2 and 3 from words
      var atO = matchWords(c.reAtmos, f.off, c.exclude, f.offRaw), atT = matchWords(c.reAtmos, f.title, c.exclude), atL = matchWords(c.reAtmos, f.lis, c.exclude, f.lisRaw);
      var moO = matchWords(c.reMood, f.off, null, f.offRaw), moL = matchWords(c.reMood, f.lis, null, f.lisRaw);
      var atmosRaw = wordScore(atO, W.atmos.official, 4, c.reCore) + wordScore(atT, W.atmos.title, 2, c.reCore) + wordScore(atL, W.atmos.listener, 3, c.reCore);
      var moodRaw = wordScore(moO, W.mood.official, 4, c.reCore) + wordScore(moL, W.mood.listener, 3, c.reCore);
      if (atO.length) ev.atmos.push({ source: 'official text', words: uniq(atO).slice(0, 4) });
      if (atT.length) ev.atmos.push({ source: 'titles', words: uniq(atT).slice(0, 3) });
      if (atL.length) ev.atmos.push({ source: 'listener comments', words: uniq(atL).slice(0, 3) });
      if (moO.length) ev.mood.push({ source: 'official text', words: uniq(moO).slice(0, 4) });
      if (moL.length) ev.mood.push({ source: 'listener comments', words: uniq(moL).slice(0, 3) });
      // Catalogue tags
      Object.keys(c.tags).forEach(function (t) {
        var layer = c.tags[t][0], wt = c.tags[t][1];
        if (f.offTags.indexOf(t) >= 0) { if (layer === 'atmos') atmosRaw += W.atmos.tag * wt; else moodRaw += W.mood.tag * wt; ev.tags.push(t); }
        if (f.lisTags.indexOf(t) >= 0) { moodRaw += 0.5 * wt; ev.lisTags.push(t); }
        if (f.revTags.indexOf(t) >= 0) { moodRaw += W.reviewed * wt; ev.reviewed.push(t); }
        if (f.aiTags.indexOf(t) >= 0) { moodRaw += W.ai * wt; ev.ai.push(t); }
      });
      var revW = matchWords(c.reQuery, f.rev); if (revW.length) { moodRaw += 0.6 * Math.min(2, revW.length); ev.reviewed = uniq(ev.reviewed.concat(revW)); }
      var aiW = matchWords(c.reQuery, f.ai); if (aiW.length) { moodRaw += W.ai * Math.min(3, aiW.length); ev.ai = uniq(ev.ai.concat(aiW)).slice(0, 5); }
      // For concepts that name a sound (rain, voices\u2026), imagery counts half: documented sound should lead.
      if (c.soundLed) { atmosRaw *= 0.5; moodRaw *= 0.5; }
      var raw = soundRaw + atmosRaw + moodRaw;
      // Documented absence: "beatless" sharply lowers rhythmic energy.
      if (k === 'energy' && a.sound.features.beatless) { raw *= 0.25; ev.absent = 'described as beatless'; }
      a.aff[k] = 1 - Math.exp(-raw / 2);
      a.affLiteral[k] = 1 - Math.exp(-soundRaw / 1.6);
      ev.raw = { sound: soundRaw, atmos: atmosRaw, mood: moodRaw };
      a.ev[k] = ev;
    });
    // Track lengths: verified metadata first, then lengths printed in the catalogue text, then text hints.
    var dur = durationEvidence(o.about + '\n' + o.credits + '\n' + l.comments);
    a.durationText = dur;
    if (!a.tracks.length && dur.listed >= 2) { a.tracksSource = 'track times printed in the catalogue credits'; }
    a.totalSeconds = a.tracks.reduce(function (s, t) { return s + (t.seconds || 0); }, 0);
    a.longestSeconds = a.tracks.reduce(function (s, t) { return Math.max(s, t.seconds || 0); }, 0);
    var trackMin = a.longestSeconds ? a.longestSeconds / 60 : dur.trackMin;
    if (trackMin) {
      a.longScore = trackMin >= 40 ? 1 : trackMin >= 25 ? 0.85 : trackMin >= 15 ? 0.6 : trackMin >= 10 ? 0.35 : 0.1;
      a.longBasis = { kind: a.longestSeconds ? 'tracks' : 'track-text', minutes: Math.round(trackMin), source: a.longestSeconds ? a.tracksSource : (dur.listed ? 'track times printed in the catalogue credits' : 'catalogue text: "' + dur.text + '"') };
    } else if (dur.singleTrack) {
      a.longScore = 0.7; a.longBasis = { kind: 'track-text', minutes: 0, source: 'catalogue text describes a single long track' };
    } else if (dur.albumMin) {
      a.longScore = Math.min(0.45, dur.albumMin / 150); a.longBasis = { kind: 'album-text', minutes: Math.round(dur.albumMin), source: 'catalogue text gives the album length (' + Math.round(dur.albumMin) + ' min), not track lengths' };
    } else {
      a.longScore = 0.25 * a.aff.long; a.longBasis = a.aff.long > 0.2 ? { kind: 'words', minutes: 0, source: 'only descriptive words such as "unfolding" or "sustained"' } : null;
    }
    // Obscurity from catalogue listener activity (review count and number of quoted listeners).
    var commenters = uniq((l.comments.match(/(?:^|\n)([^\n:]{2,40}):\s/g) || []).map(function (s) { return s.trim(); })).length;
    a.commenters = commenters;
    a.obscurity = a.provenance === 'discovered' ? 0.8 : Math.max(0.05, 1 - 0.14 * l.reviews - 0.08 * commenters);
    a.hasOfficialText = !!(o.about || o.credits);
    // How much the catalogue says about this album: absence of evidence means less when little is written.
    var docChars = (o.about || '').length + (o.credits || '').replace(/released [a-z]+ \d+, \d{4}/i, '').length + (l.comments || '').length;
    var nTags = f.offTags.length + f.lisTags.length + (a.reviewed ? 1 : 0);
    a.documentation = docChars + 150 * nTags >= 1500 ? 'rich' : docChars + 150 * nTags >= 450 ? 'moderate' : 'sparse';
    // Who and what this album is connected to (collaborators, series) \u2014 used for personal novelty.
    var circle = [];
    (o.credits + '\n' + (a.artist || '')).split(/\n|\|/).forEach(function (line) {
      var m = line.match(/^\s*([A-Z][\w'\u2019.-]+(?:\s[A-Z(][\w'\u2019.()-]+){0,3})\s*:/);
      if (m && !/^(alio die|stefano musso|artwork|mastered|mixed|recorded|photos?|cover|design|music|released|all|edited|produced|special|additional|guest)/i.test(m[1])) circle.push(norm(m[1]).replace(/\s*\(.*\)/, '').trim());
    });
    var byRe = /\b(?:composed|played|performed|music|created|recorded)(?: and (?:played|performed|recorded))? by ([A-Z][\w.'\u2019-]+(?: [A-Z][\w.'\u2019-]+){0,2})/g, bm;
    while ((bm = byRe.exec(o.credits + '\n' + o.about))) if (!/stefano musso|alio die/i.test(bm[1])) circle.push(norm(bm[1]));
    String(a.artist || '').split(/&|,| and /).forEach(function (n) { n = norm(n).trim(); if (n && !/alio die/.test(n)) circle.push(n); });
    var series = a.title.split(/\s+/)[0]; if (series && series.length >= 4) a.seriesKey = norm(series);
    // Project names and the people behind them, as stated in the catalogue credits (e.g. "Arborescence (Jean Patier)").
    var ALIAS = { 'aglaia': 'gino fioravanti', 'arborescence': 'jean patier' };
    a.circle = uniq(circle.map(function (x) { x = x.replace(/[.,;:]+$/, '').trim(); return ALIAS[x] || x; })
      .filter(function (x) { return x.length >= 3 && !/^(tracks?|recorder?ed|recorded|track \d+|on track|vocals?|voice|guitar|piano)$/.test(x); }));
    return a;
  }

  // ---------- Lexical index (BM25) for words that are not concepts ----------
  var STOP = new Set('a an and as at be by can could do for from has have i in is it me my of on or the this to very want with you something one that feels feel music album albums some like please almost into would more than but just really bit little kind sort maybe also while when where which who what how its so if all any make makes made get give let lets us our your without putting probably havent heard before not too ever never already been better best good great nice perfect lovely beautiful beautifully the type kind ideal'.split(' '));
  function tokenize(s) { return (norm(s).replace(/'/g, '').match(/[a-z][a-z-]{2,}/g) || []).filter(function (w) { return !STOP.has(w); }); }
  function buildIndex(albums) {
    var df = {}, docs = albums.map(function (a) {
      var f = a._f;
      var toks = [].concat(tokenize(f.title), tokenize(f.title), tokenize(f.offTags.join(' ')), tokenize(f.off), tokenize(f.off), tokenize(f.lisTags.join(' ') + ' ' + f.lis), tokenize(f.ai + ' ' + f.rev));
      var tf = {}; toks.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
      Object.keys(tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      return { tf: tf, len: toks.length };
    });
    var avg = docs.reduce(function (s, d) { return s + d.len; }, 0) / Math.max(1, docs.length);
    var sc = {}; albums.forEach(function (a) { if (a.seriesKey) sc[a.seriesKey] = (sc[a.seriesKey] || 0) + 1; });
    // A series needs three titles sharing a first word (e.g. Vimana), or two that both say "part/vol/chapter".
    albums.forEach(function (a) {
      var k = a.seriesKey, marked = function (t) { return /\b(part|vol\.?|volume|chapter|book)\b|\b(i|ii|iii|iv)$/i.test(t); };
      var ok = k && !/^(the|il|la|le|lo|una|from|into|with|between)$/.test(k) && (sc[k] >= 3 || (sc[k] >= 2 && marked(a.title) && albums.filter(function (b) { return b.seriesKey === k && marked(b.title); }).length >= 2));
      a.series = ok ? k : null;
    });
    var means = {}; Object.keys(CONCEPTS).forEach(function (k) { means[k] = albums.reduce(function (s, a) { return s + a.aff[k]; }, 0) / Math.max(1, albums.length); });
    return { albums: albums, docs: docs, df: df, N: albums.length, avg: avg, means: means };
  }
  function bm25(index, i, terms) {
    var d = index.docs[i], s = 0, k1 = 1.2, b = 0.75;
    terms.forEach(function (t) {
      var f = d.tf[t] || 0;
      if (!f) return;
      var n = index.df[t] || 1;
      if (n > 0.3 * index.N) return; // too common in this catalogue to tell albums apart
      var idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / index.avg));
    });
    return s;
  }

  // ---------- Interpreting a request: central, explicit and inferred preferences ----------
  // CENTRAL   what the listener named (or a direct reading of a named word, e.g. "incense-like" \u2192 sacred).
  //           An album must satisfy the central preferences together.
  // EXPLICIT  stated constraints: track length, "not \u2026"/"without \u2026", lesser-known.
  // CONTEXT   inferences from the setting or activity ("Gothic" \u2192 some darkness, "ambient" \u2192 rhythmic stillness,
  //           "reading" \u2192 not drowsy). They can only nudge the ranking within a small, capped range.
  var NEG_CUES = /\b(not|no|without|avoid|avoiding|never|less|nothing|isn'?t|aren'?t|don'?t|doesn'?t|won'?t|instead of|rather than|free of|minus|except|too much)\b/;
  var LITERAL_CUES = /\b(actual|real|recorded|recordings? of|field[- ]recordings? of|sounds? of|with (the )?sounds? of|genuine|audible)\b/;
  var OBSCURE_RE = /\b(haven'?t heard|have not heard|probably not heard|never heard|lesser[- ]known|less[- ]known|obscure|deep[- ]?cuts?|hidden gems?|overlooked|underrated|unfamiliar|new to me|forgotten|rare|surprise me)\b/;
  var LONG_RE = /\b(long[- ]?form|long pieces|long tracks?|longer|extended|hour[- ]long|epic length|single[- ]track|lengthy|long)\b/;
  var CONTEXT_CAP = 0.45, CONTEXT_NEG_CAP = 0.25;


  // ---------- Negation scope ----------
  // A negation cue applies to the next concept it reaches (allowing a few words such as "putting me to"),
  // continues through "or"/"nor" lists, and stops at "but", "and", "yet", commas and sentence punctuation.
  // "not just/only X" is not a negation. "X-free" negates X.
  var CUE_G = /\b(not just|not only|not merely|anything but|not|no|without|avoid(?:ing)?|never|less|fewer|nothing|neither|nor|isn'?t|aren'?t|don'?t|doesn'?t|won'?t|instead of|rather than|free of|minus|except|too much)\b/g;
  var BOUNDARY_G = /[.;:!?,]|\b(but|and|yet|though|although|while|whereas|plus|with|also)\b/g;
  var CONT_G = /\b(or|nor)\b/g;
  function allMatches(re, q, type) { var out = [], m; re.lastIndex = 0; while ((m = re.exec(q))) { out.push({ type: type, start: m.index, end: m.index + m[0].length, text: m[0] }); if (!m[0].length) re.lastIndex++; } return out; }
  function scopeConcepts(q) {
    var concepts = [];
    Object.keys(CONCEPTS).forEach(function (k) {
      var c = CONCEPTS[k], re = c.reQuery; if (!re || k === 'long') return; re.lastIndex = 0; var m;
      while ((m = re.exec(q))) { if (c.exclude && c.exclude.test(m[0])) continue; concepts.push({ type: 'concept', k: k, start: m.index, end: m.index + m[0].length, word: m[0] }); }
    });
    var cues = allMatches(CUE_G, q, 'cue');
    var inSpan = function (x, spans) { return spans.some(function (s) { return x.start >= s.start && x.end <= s.end && s !== x; }); };
    var boundaries = allMatches(BOUNDARY_G, q, 'boundary').filter(function (b) { return !inSpan(b, cues); });
    var conts = allMatches(CONT_G, q, 'cont');
    var taken = concepts.concat(cues, boundaries, conts);
    var words = allMatches(/[a-z][a-z'-]*/g, q, 'word').filter(function (w) { return !taken.some(function (t) { return w.start < t.end && w.end > t.start; }); });
    var ev = taken.concat(words).sort(function (a, b) { return a.start - b.start || (a.type === 'concept' ? 1 : -1); });
    var active = false, spent = false, gap = 0, lastConceptEnd = -1;
    ev.forEach(function (e) {
      if (e.type === 'cue') {
        if (/^not (just|only|merely)$/.test(e.text)) { active = false; return; }
        if (e.text === 'nor' && active) { spent = false; gap = 0; return; }
        active = true; spent = false; gap = 0; return;
      }
      if (e.type === 'boundary') { active = false; return; }
      if (e.type === 'cont') { if (active && spent) { spent = false; gap = 0; } return; }
      if (e.type === 'concept') {
        var postfixFree = /^-?free\b/.test(q.slice(e.end, e.end + 6));
        e.negated = active || postfixFree;
        if (e.start >= lastConceptEnd) spent = spent || active;
        lastConceptEnd = Math.max(lastConceptEnd, e.end);
        return;
      }
      if (active) { if (spent) active = false; else if (++gap > 4) active = false; }
    });
    return concepts;
  }

  function emptyIt(query) {
    return { query: query || '', central: {}, explicitNeg: {}, ctxPos: {}, ctxNeg: {}, from: {}, literal: {}, long: 0, obscure: 0, surprise: false, seed: 0, free: [], hits: {} };
  }
  function interpret(query, mods) {
    mods = mods || {};
    var q = norm(query), it = emptyIt(query);
    function note(map, k, w, word) {
      map[k] = Math.max(map[k] || 0, 0) + w;
      if (word) { var key = (map === it.central ? 'c:' : map === it.explicitNeg ? 'n:' : map === it.ctxPos ? 'p:' : 'q:') + k; (it.from[key] = it.from[key] || []).indexOf(word) < 0 && it.from[key].push(word); }
    }
    var central = function (k, w, word) { note(it.central, k, w, word); };
    var avoid = function (k, w, word) { it.explicitNeg[k] = Math.max(it.explicitNeg[k] || 0, w); if (word) (it.from['n:' + k] = it.from['n:' + k] || []).push(word); };
    var ctxP = function (k, w, word) { if (it.central[k] || it.explicitNeg[k]) return; it.ctxPos[k] = Math.max(it.ctxPos[k] || 0, w); if (word) (it.from['p:' + k] = it.from['p:' + k] || []).indexOf(word) < 0 && it.from['p:' + k].push(word); };
    var ctxN = function (k, w, word) { if (it.central[k] || it.explicitNeg[k]) return; it.ctxNeg[k] = Math.max(it.ctxNeg[k] || 0, w); if (word) (it.from['q:' + k] = it.from['q:' + k] || []).indexOf(word) < 0 && it.from['q:' + k].push(word); };

    // 1. Words the listener used, with negation scope resolved by negationScope().
    scopeConcepts(q).forEach(function (m) {
      if (m.negated) avoid(m.k, 1, m.word); else central(m.k, 1, m.word);
      if (!m.negated && LITERAL_CUES.test(q.slice(Math.max(0, m.start - 30), m.end + 25))) it.literal[m.k] = true;
      (it.hits[m.k] = it.hits[m.k] || []).push(m.word);
    });
    Object.keys(it.explicitNeg).forEach(function (k) { if (it.explicitNeg[k] >= 1) delete it.central[k]; });

    // 2. Direct readings of named words and phrases (still central: they interpret what was said).
    if (/\b(tension|stress|anxi|unwind|decompress)/.test(q)) central('calm', 1, (q.match(/\b(tension|stress\w*|anxi\w*|unwind|decompress)/) || [])[0]);
    if (/\bincense\b/.test(q)) { central('sacred', 0.8, 'incense'); central('warm', 0.4, 'incense'); }
    if (/\b(for (sleep|sleeping|bed)|fall asleep|to sleep)\b/.test(q) && !it.explicitNeg.sleep) central('sleep', 1, 'sleep');
    if (/\b(heavy|pouring|torrential|lashing|pounding) (rain|storm|downpour|water)|\b(thunder ?storms?|downpour|monsoon)\b/.test(q) && !it.explicitNeg.rain) { central('heavyWater', 1.4, (q.match(/\b(heavy|pouring|torrential|lashing|pounding) \w+|thunder ?storms?|downpour|monsoon/) || [])[0]); avoid('gentleWater', 0.4); }
    if (/\b(gentle|soft|light|quiet|delicate) (rain|water|stream|drops|drizzle)|\b(trickl\w*|drip\w*|drizzl\w*)/.test(q)) { central('gentleWater', 1.4, (q.match(/\b(gentle|soft|light|quiet|delicate) \w+|trickl\w*|drip\w*|drizzl\w*/) || [])[0]); avoid('heavyWater', 0.8); }

    // 3. Buttons are explicit requests.
    if (mods.warmer) { central('warm', 1.2, 'Warmer'); }
    if (mods.medieval) { central('medieval', 1.3, 'More medieval'); central('sacred', 0.4, 'More medieval'); }
    if (mods.lessSleepy) { avoid('sleep', 1, 'Less sleepy'); delete it.central.sleep; }

    // 4. Inferences from the setting or activity: context only.
    // Gothic suggests some shadow and sacred architecture, but Gothic sacred music can also be luminous: no opposition is inferred.
    if (/\bgothic\b/.test(q)) { ctxP('dark', 0.3, 'Gothic'); ctxP('sacred', 0.3, 'Gothic'); ctxP('mysterious', 0.4, 'Gothic'); }
    var place = q.match(/\b(prague|old town|old city|cobbled streets?|alleys?|cathedral city)\b/);
    if (place) { var pw = place[1].charAt(0).toUpperCase() + place[1].slice(1); ctxP('medieval', 0.4, pw); ctxP('mysterious', 0.3, pw); }
    if (/\b(at night|late|nocturnal|midnight|evening)\b/.test(q)) ctxP('calm', 0.2, (q.match(/\b(at night|late|nocturnal|midnight|evening)\b/) || [])[0]);
    if (/\b(read|reading|writ\w*|work|study|studying|focus\w*|concentrat\w*)\b/.test(q)) { var act = q.match(/\b(read|reading|writ\w*|work|study|studying|focus\w*|concentrat\w*)\b/)[0]; ctxN('sleep', 0.5, act); }
    if (/\b(writ\w*|work|study|focus\w*|concentrat\w*)\b/.test(q)) ctxP('energy', 0.3, q.match(/\b(writ\w*|work|study|focus\w*|concentrat\w*)\b/)[0]);
    if (/\b(ambient|drift\w*|meditat\w*|stillness)\b/.test(q)) ctxN('energy', 0.3, q.match(/\b(ambient|drift\w*|meditat\w*|stillness)\b/)[0]);
    // Warmth does not imply avoiding darkness (candlelit night music can be both); darkness is avoided only when asked.
    if (mods.warmer && !it.central.dark) ctxN('dark', 0.3, 'Warmer');
    if (/\bautumn(al)?\b/.test(q)) ctxP('melancholy', 0.2, 'autumn');
    if (it.central.rain) ctxP('water', 0.3, 'rain');
    if (it.central.sleep) ctxP('calm', 0.3, 'sleep');

    // 5. Explicit constraints.
    it.obscure = (OBSCURE_RE.test(q) ? 1 : 0) + (mods.obscure || 0);
    it.long = (LONG_RE.test(q) && !/\blonging\b/.test(q) ? 1 : 0) + (/\b(the longer the better|as long as possible|longest)\b/.test(q) ? 0.5 : 0) + (mods.longer || 0);
    it.surprise = !!mods.surprise; it.seed = mods.seed || 0;
    var conceptWords = new Set([].concat.apply([], Object.keys(it.hits).map(function (k) { return it.hits[k]; })));
    it.free = tokenize(query).filter(function (w) { return !conceptWords.has(w) && !/^(warm|dark|long|sleep|night|late|reading|read|atmosphere|ambient|alio|die|mood|listen|listening|sound|sounds|tracks?|pieces?|form|heavy|gentle|soft|real|actual|recordings?|gothic|prague|incense|like|wandering|through|evening|morning|writing|focused|work|study|tension|removes?|autumnal|autumn|longer|extended)/.test(w); });
    // Compatibility views used by rooms and older callers.
    it.pos = Object.assign({}, it.central); it.neg = Object.assign({}, it.explicitNeg);
    return it;
  }

  function fromWords(it, prefix, k) { return (it.from[prefix + k] || []).filter(Boolean); }
  function interpretationSummary(it) {
    var lab = function (k) { return (it.literal[k] ? 'documented ' : '') + CONCEPTS[k].label; };
    var central = Object.keys(it.central).sort(function (a, b) { return it.central[b] - it.central[a]; }).map(function (k) { return { key: k, label: lab(k), words: fromWords(it, 'c:', k).map(function (w) { return w === 'gothic' ? 'Gothic' : w; }) }; });
    var explicit = [];
    if (it.long) explicit.push({ key: 'length', label: 'long tracks' + (it.long > 1 ? ' (strongly)' : '') });
    Object.keys(it.explicitNeg).filter(function (k) { return it.explicitNeg[k] >= 0.5; }).forEach(function (k) { var ws = fromWords(it, 'n:', k); explicit.push({ key: 'not-' + k, label: 'no ' + CONCEPTS[k].label + (ws.length ? ' (from "' + ws.join('", "') + '")' : ''), words: ws }); });
    if (it.obscure) explicit.push({ key: 'obscure', label: 'lesser-known releases' });
    var inferred = Object.keys(it.ctxPos).map(function (k) { return { key: k, sign: 1, label: CONCEPTS[k].label, words: fromWords(it, 'p:', k) }; })
      .concat(Object.keys(it.ctxNeg).map(function (k) { return { key: k, sign: -1, label: k === 'energy' ? 'rhythmic stillness' : 'less ' + CONCEPTS[k].label, words: fromWords(it, 'q:', k) }; }));
    return { central: central, explicit: explicit, inferred: inferred };
  }
  function describeInterpretation(it) {
    var s = interpretationSummary(it), out = [];
    var q = function (ws) { return ws && ws.length ? ' (from "' + ws.join('", "') + '")' : ''; };
    if (s.central.length) out.push('Central: ' + list(s.central.map(function (c) { return c.label + (c.words.length && c.words.join(' ') !== c.label ? q(c.words) : ''); })) + '.');
    if (s.explicit.length) out.push('Explicit: ' + list(s.explicit.map(function (e) { return e.label; })) + '.');
    if (s.inferred.length) out.push('Inferred from the setting, weighted lightly: ' + list(s.inferred.map(function (e) { return e.label + q(e.words); })) + '.');
    return out.length ? out.join(' ') : 'Searching the catalogue text for your words.';
  }

  // ---------- Ranking ----------
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }


  var LONG_PRIOR = 0.45; // typical Alio Die track lengths are long; unknown \u2260 short
  function personalHistory(index, heard, familiar) {
    var names = {}, series = {}, size = {}, ssize = {}, n = 0;
    index.albums.forEach(function (a) {
      a.circle.forEach(function (c) { size[c] = (size[c] || 0) + 1; });
      if (a.series) ssize[a.series] = (ssize[a.series] || 0) + 1;
      var w = heard[a.id] ? 1 : familiar[a.id] ? 0.6 : 0; if (!w) return; n++;
      a.circle.forEach(function (c) { names[c] = (names[c] || 0) + w; });
      if (a.series) series[a.series] = (series[a.series] || 0) + w;
    });
    return { names: names, series: series, size: size, ssize: ssize, n: n, weight: Math.min(0.75, n / 8) };
  }
  // How new an album is to you: 1 = nothing connected to it is known; lower when you know much of its circle or series.
  function novelty(a, hist, heard, familiar) {
    if (heard[a.id]) return { score: 0, overlaps: ['marked heard'] };
    if (familiar[a.id]) return { score: 0.15, overlaps: ['marked familiar'] };
    var strength = 0, ov = [];
    a.circle.forEach(function (c) { if (!hist.names[c]) return; var st = Math.min(1, hist.names[c] / Math.max(2, hist.size[c] * 0.5)); if (st >= 0.15) ov.push(c.replace(/\b\w/g, function (m) { return m.toUpperCase(); })); strength = Math.max(strength, st); });
    if (a.series && hist.series[a.series]) { var st2 = Math.min(1, hist.series[a.series] / Math.max(2, hist.ssize[a.series] * 0.5)); if (st2 >= 0.15) ov.push(a.series.charAt(0).toUpperCase() + a.series.slice(1) + ' series'); strength = Math.max(strength, st2); }
    return { score: 1 - 0.55 * strength, overlaps: ov };
  }
  function scoreAll(index, it, opts) {
    opts = opts || {};
    var heard = opts.heard || {}, familiar = opts.familiar || {}, preferUnheard = opts.preferUnheard !== false;
    var terms = it.free || [];
    var lex = index.albums.map(function (a, i) { return terms.length ? bm25(index, i, terms) : 0; });
    var maxLex = Math.max.apply(null, lex.concat([1e-9]));
    var cKeys = Object.keys(it.central);
    it._means = index.means;
    var rows = index.albums.map(function (a, i) {
      if (a.status === 'rejected') return null;
      var parts = {}, ctx = {};
      // Central preferences (plus explicit length) are satisfied jointly: 65% average, 35% weakest dimension.
      var dims = cKeys.map(function (k) { return { k: k, w: it.central[k], a: it.literal[k] ? a.affLiteral[k] : a.aff[k] }; });
      // Explicit length. Undocumented lengths are neutral (a prior), never treated as short.
      var effLong = a.longBasis && a.longBasis.kind !== 'words' ? a.longScore : null;
      if (it.long && !cKeys.length) dims.push({ k: 'length', w: 1, a: effLong == null ? 0.3 : effLong });
      var generic = !dims.length && !terms.length;
      if (generic) dims = [{ k: 'immersive', w: 0.6, a: a.aff.immersive }, { k: 'calm', w: 0.4, a: a.aff.calm }];
      var fit = 0;
      if (dims.length) {
        var W2 = dims.reduce(function (s, d) { return s + d.w; }, 0);
        var mean = dims.reduce(function (s, d) { return s + d.w * d.a; }, 0) / W2;
        var weakest = dims.length > 1 ? Math.min.apply(null, dims.map(function (d) { return d.a; })) : mean;
        fit = 3 * (0.65 * mean + 0.35 * weakest);
        dims.forEach(function (d) { parts[(generic ? '' : '\u2605 ') + d.k] = 3 * 0.65 * d.w * d.a / W2; });
        if (dims.length > 1) parts['joint fit (weakest: ' + dims.reduce(function (m, d) { return d.a < m.a ? d : m; }).k + ')'] = 3 * 0.35 * weakest;
      }
      if (it.long && cKeys.length) { var lv = 1.4 * Math.min(2, it.long) * ((effLong == null ? LONG_PRIOR : Math.max(effLong, a.longBasis.kind === 'album-text' ? LONG_PRIOR * 0.9 : 0)) - LONG_PRIOR); fit += lv; parts.length = lv; }
      if (terms.length) { var lx = (cKeys.length ? 0.5 : 1.2) * (lex[i] / maxLex); fit += lx; parts.words = lx; }
      Object.keys(it.explicitNeg).forEach(function (k) {
        var v = it.explicitNeg[k] * 1.5 * a.aff[k]; fit -= v; if (v > 0.01) parts['not ' + k] = -v;
        // Silence in a thin description is weak reassurance.
        var u = it.explicitNeg[k] >= 0.5 && a.aff[k] < 0.2 ? it.explicitNeg[k] * (a.documentation === 'sparse' ? 0.2 : a.documentation === 'moderate' ? 0.07 : 0) : 0;
        if (u) { fit -= u; parts['uncertain: not ' + k] = -u; }
      });
      // Context: deviation from the catalogue average, capped so it can only nudge.
      var c = 0;
      // Only evidence moves context: an inferred affinity rewards albums that show it (above the catalogue average);
      // an inferred opposition only costs albums that positively show the opposed quality. Silence is neutral.
      Object.keys(it.ctxPos).forEach(function (k) { var v = it.ctxPos[k] * Math.max(0, a.aff[k] - index.means[k]); if (v) { ctx[k] = v; c += v; } });
      Object.keys(it.ctxNeg).forEach(function (k) { var v = -it.ctxNeg[k] * Math.max(0, a.aff[k] - index.means[k]); if (v) { ctx[(k === 'energy' ? 'stillness' : 'less ' + k)] = v; c += v; } });
      // Inferred affinities may nudge up to +CONTEXT_CAP; inferred oppositions are weaker, at most -CONTEXT_NEG_CAP.
      c = Math.max(-CONTEXT_NEG_CAP, Math.min(CONTEXT_CAP, c));
      if (Math.abs(c) > 0.005) parts.context = c;
      fit += c;
      if (!a.hasOfficialText) { fit -= 0.25; parts.thinEvidence = -0.25; }
      if (a.status === 'provisional') { fit -= 0.1; parts.provisional = -0.1; }
      return { album: a, fit: fit, parts: parts, ctx: ctx };
    }).filter(Boolean);
    var maxFit = rows.reduce(function (m, r) { return Math.max(m, r.fit); }, 0.01);
    var hist = personalHistory(index, heard, familiar);
    rows.forEach(function (r) {
      var a = r.album, s = r.fit;
      // Obscurity only lifts albums that already fit well (at least 65% of the best fit): less obvious, not random.
      // The catalogue's listener activity is a proxy; your own heard/familiar marks take over as they accumulate.
      if (it.obscure && r.fit >= 0.65 * maxFit) {
        var nv = novelty(a, hist, heard, familiar), wP = hist.weight;
        var obsc = (1 - wP) * a.obscurity + wP * nv.score;
        var ob = Math.min(2, it.obscure) * obsc * 0.4 * maxFit; s += ob; r.parts.obscurity = ob;
        r.deepCut = { catalogue: a.obscurity, personal: nv.score, personalWeight: wP, overlaps: nv.overlaps, historySize: hist.n };
      }
      // Albums already suggested earlier in this conversation step aside a little, so refinements bring fresh options.
      if (opts.recent && opts.recent[a.id]) { s -= 0.35 * opts.recent[a.id]; r.parts.alreadySuggested = -0.35 * opts.recent[a.id]; }
      if (heard[a.id]) { s -= preferUnheard ? 3 : 0.3; r.parts.heard = preferUnheard ? -3 : -0.3; }
      else if (familiar[a.id]) { s -= preferUnheard ? 0.6 : 0.1; r.parts.familiar = preferUnheard ? -0.6 : -0.1; }
      s += (hash(a.id + ':' + it.seed) - 0.5) * 0.04;
      r.score = s;
    });
    return rows.sort(function (x, y) { return y.score - x.score; });
  }

  function recommend(index, it, opts) {
    var ranked = scoreAll(index, it, opts), picks = [], n = (opts && opts.n) || 3;
    if (it.surprise) {
      // Draw (seeded, so it can be repeated) from candidates that fit at least 60% as well as the best one.
      var top = ranked[0] ? ranked[0].score : 0;
      var pool = ranked.filter(function (r) { return r.score >= 0.6 * top; }).slice(0, 30);
      var rnd = mulberry(Math.floor(hash(String(it.seed) + it.query) * 4294967295));
      while (picks.length < n && pool.length) {
        var tot = pool.reduce(function (s, r) { return s + Math.max(0.05, r.score); }, 0), x = rnd() * tot, j = 0;
        for (; j < pool.length - 1; j++) { x -= Math.max(0.05, pool[j].score); if (x <= 0) break; }
        picks.push(pool.splice(j, 1)[0]);
      }
      return { picks: picks, ranked: ranked };
    }
    for (var i = 0; i < ranked.length && picks.length < n; i++) picks.push(ranked[i]);
    return { picks: picks, ranked: ranked };
  }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------- Explanations: evidence layer \u00d7 preference role ----------
  var LAYER_NAMES = { sound: 'Documented sound', atmosphere: 'Described atmosphere', mood: 'Mood impression', length: 'Track length', reviewed: 'Your review', ai: 'AI provisional', absence: 'Avoided', context: 'Inferred from your setting', info: 'Note' };
  var ROLE_NAMES = { central: 'Central', explicit: 'Explicit', context: 'Inferred', info: '' };
  function soundLine(e) {
    var best = e.hits.slice().sort(function (x, y) { return (W.sound[y.source] || 0) - (W.sound[x.source] || 0); })[0];
    var srcLabel = best.source === 'credits' ? 'Bandcamp credits' : best.source === 'official' ? 'official description' : 'a listener reports';
    return { layer: 'sound', id: e.id, text: cap(e.label) + (best.words.length ? ' (' + best.words.slice(0, 3).join(', ') + ')' : ''), source: srcLabel, quote: clip(best.text, 220), listenerOnly: best.source === 'listener' };
  }
  function conceptLines(a, k, it, role) {
    var e = a.ev[k], c = CONCEPTS[k], lines = [];
    e.sound.forEach(function (s) { var l = soundLine(s); l.concept = c.label; l.role = role; lines.push(l); });
    if (it.literal[k]) return lines;
    var atm = e.atmos.map(function (x) { return '"' + x.words.join('", "') + '" in ' + x.source; });
    var atmTags = e.tags.filter(function (t) { return c.tags[t][0] === 'atmos'; });
    if (atmTags.length) atm.unshift('catalogue mood tag ' + atmTags.join(', '));
    if (atm.length) lines.push({ layer: 'atmosphere', role: role, concept: c.label, text: cap(c.label) + ': ' + list(atm.slice(0, 3)) });
    var md = e.mood.map(function (x) { return '"' + x.words.join('", "') + '" in ' + x.source; });
    var moodTags = e.tags.filter(function (t) { return c.tags[t][0] === 'mood'; });
    if (moodTags.length) md.unshift('catalogue mood tag ' + moodTags.join(', '));
    if (e.lisTags.length) md.push('listener tag ' + e.lisTags.join(', '));
    if (md.length) lines.push({ layer: 'mood', role: role, concept: c.label, text: cap(c.label) + ': ' + list(md.slice(0, 3)) });
    if (e.reviewed.length) lines.push({ layer: 'reviewed', role: role, concept: c.label, text: cap(c.label) + ': ' + e.reviewed.join(', ') });
    if (e.ai.length && !e.sound.length && !atm.length && !md.length) lines.push({ layer: 'ai', role: role, concept: c.label, text: cap(c.label) + ' suggested only by the unverified AI analysis (' + e.ai.slice(0, 3).join(', ') + ')' });
    return lines;
  }
  function explainLines(a, it, row) {
    var lines = [], seenSound = {};
    var push = function (l) { if (l.layer === 'sound') { if (seenSound[l.id]) return; seenSound[l.id] = 1; } lines.push(l); };
    // Central preferences, strongest first.
    Object.keys(it.central).filter(function (k) { return (it.literal[k] ? a.affLiteral[k] : a.aff[k]) > 0.12; })
      .sort(function (x, y) { return a.aff[y] * it.central[y] - a.aff[x] * it.central[x]; }).slice(0, 4)
      .forEach(function (k) { conceptLines(a, k, it, 'central').forEach(push); });
    Object.keys(it.central).forEach(function (k) {
      if ((it.literal[k] ? a.affLiteral[k] : a.aff[k]) <= 0.12) lines.push({ layer: 'info', role: 'central', concept: CONCEPTS[k].label, text: 'Little catalogue evidence of ' + (it.literal[k] ? 'documented ' : '') + CONCEPTS[k].label + ', one of your central preferences' + (a.documentation === 'sparse' ? ' (the album is sparsely documented, so this is uncertain).' : '.'), caveat: true });
    });
    // Explicit constraints.
    if (it.long && a.longBasis && a.longBasis.kind !== 'words') lines.push({ layer: 'length', role: 'explicit', text: a.longBasis.kind === 'tracks' || (a.longBasis.kind === 'track-text' && a.longBasis.minutes) ? 'Longest track about ' + a.longBasis.minutes + ' min' + (a.totalSeconds ? ' (album ' + fmtMinutes(a.totalSeconds) + ')' : '') : a.longBasis.kind === 'album-text' ? 'Album length about ' + a.longBasis.minutes + ' min; track lengths not documented' : a.longBasis.kind === 'track-text' ? 'Described as a single long track' : 'No documented track lengths; only descriptive hints', source: a.longBasis.source });
    else if (it.long) lines.push({ layer: 'length', role: 'explicit', text: 'Track lengths are not documented for this album, so length was treated as neutral rather than short', caveat: true });
    Object.keys(it.explicitNeg).forEach(function (k) {
      if (it.explicitNeg[k] < 0.5) return;
      if (a.aff[k] < 0.2) lines.push({ layer: 'absence', role: 'explicit', concept: CONCEPTS[k].label, caveat: a.documentation === 'sparse', text: a.documentation === 'rich' ? 'Its fairly detailed catalogue text and tags don\'t mention ' + CONCEPTS[k].label + '.' : a.documentation === 'moderate' ? 'Its catalogue text doesn\'t mention ' + CONCEPTS[k].label + ', though the description is fairly short.' : 'Sparsely documented: nothing mentions ' + CONCEPTS[k].label + ', but that may only mean little has been written about it.' });
      else lines.push({ layer: 'absence', role: 'explicit', concept: CONCEPTS[k].label, caveat: true, text: 'Some ' + CONCEPTS[k].label + ' is mentioned, so it may not fully avoid it.' });
    });
    // Context: only where this album clearly differs from the catalogue on an inferred preference.
    var ctxRow = row && row.ctx ? row.ctx : null;
    var ctxItems = Object.keys(it.ctxPos).map(function (k) { return { k: k, sign: 1, w: it.ctxPos[k], from: fromWords(it, 'p:', k) }; })
      .concat(Object.keys(it.ctxNeg).map(function (k) { return { k: k, sign: -1, w: it.ctxNeg[k], from: fromWords(it, 'q:', k) }; }));
    ctxItems.forEach(function (ci) {
      var dev = a.aff[ci.k] - (it._means ? it._means[ci.k] : 0.15);
      if (dev < 0.2) return; // no evidence either way: say nothing
      var agrees = ci.sign > 0, label = ci.sign < 0 && ci.k === 'energy' ? 'rhythmic stillness' : (ci.sign < 0 ? 'preference for less ' : '') + CONCEPTS[ci.k].label;
      var fromTxt = ci.from.length ? ' from "' + ci.from.join('", "') + '"' : '';
      var ev = conceptLines(a, ci.k, it, 'context');
      var evTxt = ev.length ? ev[0].text.replace(/^[^:]+: /, '').replace(/^(.)/, function (m) { return m; }) : '';
      if (ci.k === 'energy' && ci.sign < 0 && a.ev.energy.absent) evTxt = 'described as beatless';
      lines.push({ layer: 'context', role: 'context', concept: CONCEPTS[ci.k].label, agrees: agrees,
        text: (agrees ? 'Fits ' : 'Goes against ') + 'the inferred ' + label + fromTxt + (evTxt ? ' (' + evTxt + ')' : '') + (agrees ? '; a light bonus.' : '; this was only inferred, so it counts little.') });
    });
    if (it.obscure) {
      var dc = row && row.deepCut;
      var cat = a.provenance === 'curated' ? (a.listener.reviews === 0 ? 'no listener reviews in the catalogue' : a.listener.reviews + ' listener review' + (a.listener.reviews > 1 ? 's' : '') + ' in the catalogue') : 'a recent release';
      var txt = !dc || dc.historySize === 0 ? 'Deep-cut estimate from catalogue activity (' + cat + '). This is a proxy; marking albums you have heard makes it personal.'
        : dc.overlaps.length ? 'Deep-cut estimate: ' + cat + ', but you know other albums connected to it (' + dc.overlaps.slice(0, 3).join(', ') + '), so it is less of a deep cut for you.'
        : 'Deep-cut estimate: ' + cat + ', and nothing you have marked shares its collaborators or series' + (dc.personalWeight >= 0.5 ? ' (based mostly on your listening history).' : '.');
      lines.push({ layer: 'info', role: 'explicit', text: txt });
    }
    if (a.provenance === 'discovered') lines.push({ layer: 'info', role: 'info', text: a.status === 'approved' ? 'Recently added; you approved its classification.' : 'Recently discovered; its mood classification is provisional and AI-generated.' });
    return lines;
  }
  function explain(a, it, row) {
    var lines = explainLines(a, it, row), out = [];
    var cen = lines.filter(function (l) { return l.role === 'central' && !l.caveat; });
    var snd = cen.filter(function (l) { return l.layer === 'sound'; });
    var cc = uniq(cen.filter(function (l) { return l.layer !== 'sound'; }).map(function (l) { return l.concept; }));
    if (cc.length) out.push('Central fit: ' + list(cc.slice(0, 3)) + ' in its ' + (cen.some(function (l) { return l.layer === 'atmosphere'; }) ? 'described atmosphere' : 'mood descriptions') + '.');
    if (snd.length) out.push('Documented: ' + list(snd.slice(0, 3).map(function (s) { return s.text.toLowerCase() + (s.listenerOnly ? ' (per a listener)' : ''); })) + '.');
    lines.filter(function (l) { return l.role === 'central' && l.caveat; }).forEach(function (l) { out.push(l.text); });
    lines.filter(function (l) { return l.role === 'explicit' && (l.layer === 'length' || l.layer === 'absence'); }).forEach(function (l) { out.push(l.text + (/[.]$/.test(l.text) ? '' : '.')); });
    lines.filter(function (l) { return l.role === 'context'; }).slice(0, 2).forEach(function (l) { out.push(l.text); });
    if (!out.length) out.push('Matched mainly on words in its catalogue text, so treat it as a looser fit.');
    return out.join(' ');
  }

  // One readable sentence for the listener. Built only from explainLines, so it inherits every evidence rule:
  // sounds are named only when documented, and each claim says where it comes from.
  var SHORT_LABEL = { 'medieval or monastic character': 'a medieval, monastic character', 'sacred or ritual atmosphere': 'a sacred atmosphere', 'natural, pastoral setting': 'a pastoral setting', 'primordial, ancient-earth character': 'a primordial character', 'calm and stillness': 'calm' };
  function summary(a, it, row) {
    var lines = explainLines(a, it, row), out = [];
    var cen = lines.filter(function (l) { return l.role === 'central' && !l.caveat && l.layer !== 'sound'; });
    var bySrc = { desc: [], listeners: [], review: [], ai: [] };
    uniq(cen.map(function (l) { return l.concept; })).forEach(function (c) {
      var cs = SHORT_LABEL[c] || c;
      var ls = cen.filter(function (l) { return l.concept === c; });
      var txt = ls.map(function (l) { return l.text; }).join(' ');
      var src = ls.some(function (l) { return l.layer === 'reviewed'; }) ? 'review' : /official text|catalogue mood tag|titles/.test(txt) ? 'desc' : /listener/.test(txt) ? 'listeners' : 'ai';
      bySrc[src].push(cs);
    });
    var phr = [];
    if (bySrc.desc.length) phr.push(list(bySrc.desc) + ' in its own description');
    if (bySrc.review.length) phr.push(list(bySrc.review) + ' in your review');
    if (bySrc.listeners.length) phr.push(list(bySrc.listeners) + ' in listeners\' words');
    if (bySrc.ai.length) phr.push(list(bySrc.ai) + ' according to a provisional AI reading');
    var snd = lines.filter(function (l) { return l.layer === 'sound' && l.role === 'central'; }).slice(0, 2).map(function (l) {
      var m = l.text.match(/\(([^)]*)\)\s*$/), useWords = /^(early|strings|flute|percussion|bells|voice|chant|piano)$/.test(l.id);
      var what = useWords && m ? m[1].split(', ').slice(0, 2).join(' and ') : FEATURE_BY_ID[l.id].label.replace(/ \(.*\)$/, '');
      return what + (l.source === 'Bandcamp credits' ? ' named in the credits' : l.source === 'official description' ? ' described in its notes' : ' mentioned by a listener');
    });
    var first = phr.length ? cap(phr.join('; ')) : '';
    if (snd.length) first = first ? first + ', with ' + list(snd) : cap(list(snd));
    if (first) out.push(first + '.');
    lines.filter(function (l) { return l.role === 'central' && l.caveat; }).slice(0, 1).forEach(function (l) { out.push(l.text); });
    var len = lines.find(function (l) { return l.layer === 'length' && l.role === 'explicit'; });
    if (len) out.push(len.caveat ? 'Track lengths aren\'t documented.' : len.text.replace(/ \(album [^)]*\)/, '') + '.');
    var av = lines.filter(function (l) { return l.layer === 'absence'; });
    if (av.length && av.some(function (l) { return l.caveat; })) out.push(av.find(function (l) { return l.caveat; }).text);
    if (it.obscure && a.provenance === 'curated' && a.listener.reviews <= 1) out.push(a.listener.reviews ? 'Reviewed only once in the catalogue.' : 'Never reviewed in the catalogue.');
    if (!out.length) out.push('A looser match, found through the words of its description.');
    return out.join(' ');
  }

  // Best supporting quotation: a documented-sound sentence for a central preference first, then a description sentence.
  function evidenceFor(a, it, max) {
    max = max || 2; var out = [];
    explainLines(a, it).forEach(function (l) { if (l.layer === 'sound' && l.role === 'central' && l.quote && out.length < max && !out.some(function (o) { return o.text === l.quote; })) out.push({ text: l.quote, layer: 'sound', label: l.source === 'a listener reports' ? 'Listener comment' : (l.source === 'Bandcamp credits' ? 'Bandcamp credits' : 'Official Bandcamp description') }); });
    if (out.length >= max) return out;
    var res = Object.keys(it.central).map(function (k) { return [CONCEPTS[k].reAtmos, CONCEPTS[k].reMood]; }).reduce(function (x, y) { return x.concat(y); }, []).filter(Boolean);
    var pools = [{ label: a.official.aboutIsExcerpt ? 'Official description (opening words)' : 'Official Bandcamp description', text: a.official.about, w: 1.35 }, { label: 'Bandcamp credits & editorial text', text: a.official.credits, w: 1.1 }, { label: 'Listener comment', text: a.listener.comments, w: 1 }];
    var cands = [];
    pools.forEach(function (p) {
      sentences(p.text).forEach(function (t) {
        if (t.length < 35 || t.length > 340 || /^released [a-z]+ \d/i.test(t)) return;
        var n = norm(t), pts = 0;
        res.forEach(function (re) { re.lastIndex = 0; if (re.test(n)) pts += 1; });
        (it.free || []).forEach(function (w) { if (n.indexOf(w) >= 0) pts += 0.5; });
        if (pts) cands.push({ text: t, layer: 'description', label: p.label, score: pts * p.w });
      });
    });
    cands.sort(function (x, y) { return y.score - x.score; });
    for (var i = 0; i < cands.length && out.length < max; i++) if (!out.some(function (o) { return o.text === cands[i].text; })) out.push(cands[i]);
    return out;
  }

  // ---------- Mood rooms (browse without a prompt) ----------
  var ROOMS = [
    { id: 'candlelit', name: 'Candlelit warmth', blurb: 'Gentle, enveloping, reassuring.', w: { warm: 1, calm: 0.3 }, neg: { dark: 0.6 } },
    { id: 'cloister', name: 'Cloister & chant', blurb: 'Medieval and monastic, with documented chant where it exists.', w: { medieval: 1, sacred: 0.5 } },
    { id: 'ritual', name: 'Ritual & incense', blurb: 'Sacred, ceremonial, devotional.', w: { sacred: 1 }, ctx: { mysterious: 0.3 } },
    { id: 'forest', name: 'Forest floor', blurb: 'Field recordings, birds, leaves and earth.', w: { nature: 1 } },
    { id: 'rain', name: 'Rain', blurb: 'Documented rain recordings first, then rain imagery.', w: { rain: 1 }, soundFirst: 'rain' },
    { id: 'water', name: 'River & sea', blurb: 'Water sounds and watery textures.', w: { water: 1 } },
    { id: 'stillness', name: 'Stillness', blurb: 'Meditative calm without heaviness.', w: { calm: 1 }, neg: { dark: 0.4 } },
    { id: 'night', name: 'Toward sleep', blurb: 'Dreamlike and drowsy.', w: { sleep: 1 }, ctx: { calm: 0.4 } },
    { id: 'shadow', name: 'Shadowed mysteries', blurb: 'Dark, nocturnal, enigmatic.', w: { dark: 0.8, mysterious: 0.8 } },
    { id: 'enchanted', name: 'Enchanted', blurb: 'Fairy-tale, magical, spellbound.', w: { enchanted: 1 } },
    { id: 'radiance', name: 'Radiance', blurb: 'Luminous, airy, ethereal.', w: { light: 1 } },
    { id: 'starfield', name: 'Starfields', blurb: 'Cosmic and vast.', w: { cosmic: 1 } },
    { id: 'origins', name: 'Primordial origins', blurb: 'Ancient earth, caves and myth.', w: { primordial: 1 } },
    { id: 'pulse', name: 'Pulse & percussion', blurb: 'Documented drums and rhythm.', w: { energy: 1 }, literal: { energy: true } },
    { id: 'voices', name: 'Voices', blurb: 'Documented chant, choir or vocals.', w: { voices: 1 }, literal: { voices: true } },
    { id: 'melancholy', name: 'Melancholy', blurb: 'Longing, memory, lament.', w: { melancholy: 1 } },
    { id: 'longform', name: 'Long-form immersion', blurb: 'Documented long tracks first.', w: { immersive: 0.3 }, long: 1.5 }
  ];
  function roomIt(r, opts) {
    var it = emptyIt('');
    it.central = Object.assign({}, r.w); it.explicitNeg = Object.assign({}, r.neg || {}); it.ctxPos = Object.assign({}, r.ctx || {});
    it.literal = Object.assign({}, r.literal || {}); it.long = r.long || 0; it.obscure = (opts && opts.obscure) || 0;
    it.pos = it.central; it.neg = it.explicitNeg;
    return it;
  }
  function room(index, r, opts) {
    var it = roomIt(r, opts); it._means = index.means;
    var rows = scoreAll(index, it, opts).filter(function (x) { return x.fit > 0.5; });
    if (r.soundFirst) rows.sort(function (x, y) { return (y.album.affLiteral[r.soundFirst] > 0.2) - (x.album.affLiteral[r.soundFirst] > 0.2) || y.score - x.score; });
    return { it: it, rows: rows };
  }

  // ---------- Claude prompts, and validation of what comes back ----------
  function soundSummary(a) {
    var ids = Object.keys(a.sound.features).filter(function (id) { return id !== 'beatless'; });
    var parts = ids.map(function (id) { var h = a.sound.features[id]; var src = h.some(function (x) { return x.source !== 'listener'; }) ? (h.some(function (x) { return x.source === 'credits'; }) ? 'credits' : 'official text') : 'listener report only'; return FEATURE_BY_ID[id].label + ' [' + src + ']'; });
    if (a.sound.features.beatless) parts.push('BEATLESS per official text');
    return parts.length ? parts.join('; ') : 'none documented';
  }
  function candidateBlock(a) {
    var lines = ['### id=' + a.id + ' | ' + a.title + (a.year ? ' (' + a.year + ')' : '') + (a.artist ? ' | ' + a.artist : '') + ' | ' + (a.provenance === 'curated' ? 'curated catalogue' : 'recently discovered, ' + a.status)];
    lines.push('DOCUMENTED SOUNDS: ' + soundSummary(a));
    if (a.longBasis && (a.longBasis.kind === 'tracks' || a.longBasis.kind === 'track-text')) lines.push('TRACK LENGTH: ' + (a.longBasis.minutes ? 'longest about ' + a.longBasis.minutes + ' min' : 'single long track') + ' (' + a.longBasis.source + ')');
    else if (a.longBasis && a.longBasis.kind === 'album-text') lines.push('TRACK LENGTH: not documented; ' + a.longBasis.source);
    var off = [a.official.primary, a.official.tags.join(', ')].filter(function (x) { return x && x !== 'unclassified'; }).join('; ');
    if (off) lines.push('Catalogue mood tags: ' + off);
    var lis = [a.listener.primary, a.listener.tags.join(', ')].filter(function (x) { return x && x !== 'unclassified'; }).join('; ');
    if (lis) lines.push('Listener mood tags: ' + lis + ' (' + a.listener.reviews + ' reviews)');
    if (a.reviewed) lines.push('Owner-reviewed moods: ' + [a.reviewed.primaryMood].concat(a.reviewed.moodTags || []).filter(Boolean).join(', ') + (a.reviewed.note ? ' \u2014 note: ' + a.reviewed.note : ''));
    if (a.official.about) lines.push('OFFICIAL' + (a.official.aboutIsExcerpt ? ' (opening words only)' : '') + ': ' + clip(a.official.about.replace(/\s*\n+\s*/g, ' '), 900));
    if (a.official.credits) lines.push('CREDITS: ' + clip(a.official.credits.replace(/\s*\n+\s*/g, ' '), 450));
    if (a.official.trackTitles) lines.push('Track titles (imagery only, not sounds): ' + clip(a.official.trackTitles, 300));
    if (a.listener.comments) lines.push('LISTENER: ' + clip(a.listener.comments.replace(/\s*\n+\s*/g, ' '), 450));
    if (a.ai && !a.reviewed) lines.push('AI-PROVISIONAL (unverified): ' + [a.ai.primaryMood].concat(a.ai.moodTags || []).join(', ') + ' \u2014 ' + clip(a.ai.summary, 250));
    return lines.join('\n');
  }
  function recommendPrompt(it, candidates, opts) {
    opts = opts || {};
    return [
      'You are the listening companion inside a private app about the Italian ambient musician Alio Die (Stefano Musso). Choose exactly 3 albums for the listener from the CANDIDATES below and explain each choice.',
      '', 'LISTENER REQUEST: "' + it.query + '"',
      'HOW THE APP READ IT (correct it if the request clearly means otherwise): ' + describeInterpretation(it),
      'Rank by the CENTRAL preferences first, then explicit constraints. Inferred preferences are only light tie-breakers: an album may go against them (e.g. subtle percussion when stillness was only inferred) and still be the best choice.',
      opts.modifiers && opts.modifiers.length ? 'ADJUSTMENTS THE LISTENER ASKED FOR: ' + opts.modifiers.join(', ') : '',
      opts.preferUnheard ? 'The listener prefers albums they have not heard; prefer lesser-known candidates when the fit is close.' : '',
      opts.heardTitles && opts.heardTitles.length ? 'Already heard (avoid unless nothing else fits): ' + opts.heardTitles.slice(0, 40).join('; ') : '',
      '', 'HOW TO JUDGE',
      '- Read the request for fine distinctions: warmth vs darkness, tranquillity vs drowsiness, medieval/monastic vs pastoral, contemplative vs melancholic, actual sounds (rain, chant, percussion) vs imagery, long tracks vs short pieces, and every "not"/"without". Respect negative constraints strictly.',
      '- Keep three kinds of evidence apart and say which you rely on: DOCUMENTED SOUNDS (instruments, recordings, voices, percussion, track lengths), DESCRIBED ATMOSPHERE (medieval, sacred, watery, mysterious), and MOOD IMPRESSIONS (comforting, cosy, unsettling).',
      '- NEVER say an album contains or features a sound unless it appears under that candidate\'s DOCUMENTED SOUNDS. If the description only evokes something (for example rain imagery), say "the description evokes \u2026". Treat place or scene words in the request (e.g. a city) as atmosphere, not as tempo or energy.',
      '- Official text and tags are the strongest evidence; owner-reviewed moods next; listener text is subjective; AI-PROVISIONAL lines are unverified and must never be your only reason.',
      '- Use ONLY what the candidate text says. Do not invent instruments, track names, lengths or places. If the evidence is thin, say so briefly.',
      '- The 3 picks should differ from one another in a useful way.',
      '', 'OUTPUT: reply with only JSON of this shape:',
      '{"reading":"one sentence on how you understood the request","picks":[{"id":"<candidate id>","why":"2-3 sentences tying specific evidence to the request","quote":"a short EXACT excerpt (8-30 words) copied character-for-character from that candidate\'s OFFICIAL, CREDITS or LISTENER text","quoteSource":"official|listener","caveat":"optional short note"}]}',
      '', 'CANDIDATES', candidates.map(candidateBlock).join('\n\n')
    ].filter(function (x) { return x !== ''; }).join('\n');
  }
  function quoteFound(q, text) {
    var a = norm(q).replace(/[^a-z0-9]+/g, ' ').trim(), b = norm(text).replace(/[^a-z0-9]+/g, ' ');
    return a.length >= 20 && b.indexOf(a) >= 0;
  }
  // Remove any sentence that asserts a sound the album's documentation does not support.
  var IMAGERY_CUE = /\b(evok\w*|suggest\w*|imager\w*|title\w*|named|describ\w*|calls?|called|feel\w*|like|as if|reminisc\w*|atmosphere|sense of|conjur\w*|hint\w*|metaphor\w*|image\w*|impression)\b/;
  function guardSoundClaims(text, a) {
    var removed = [], kept = [];
    sentences(text).forEach(function (s) {
      var n = norm(s), bad = null;
      SOUND_FEATURES.forEach(function (f) {
        if (bad || f.id === 'beatless' || f.id === 'synth') return;
        f.re.lastIndex = 0;
        if (f.re.test(n) && !a.sound.features[f.id] && !(f.id === 'rain' && a.sound.features.rainInstrument && /rain[- ]?stick|rain[- ]?maker/.test(n))) {
          if (!IMAGERY_CUE.test(n)) bad = f.label;
        }
      });
      if (bad) removed.push({ sentence: s, feature: bad }); else kept.push(s);
    });
    return { text: kept.join(' '), removed: removed };
  }
  function validateAi(resp, candidates) {
    var byId = {}; candidates.forEach(function (a) { byId[a.id] = a; });
    var seen = {}, picks = [];
    (resp && Array.isArray(resp.picks) ? resp.picks : []).forEach(function (p) {
      if (!p || typeof p.id !== 'string' || !byId[p.id] || seen[p.id] || picks.length >= 3) return;
      seen[p.id] = 1;
      var a = byId[p.id], quote = null;
      if (typeof p.quote === 'string' && p.quote.trim()) {
        if (quoteFound(p.quote, a.official.about + ' ' + a.official.credits)) quote = { text: p.quote.trim(), kind: 'official', label: 'Official Bandcamp text' };
        else if (quoteFound(p.quote, a.listener.comments)) quote = { text: p.quote.trim(), kind: 'listener', label: 'Listener comment' };
      }
      var g = guardSoundClaims(String(p.why || '').slice(0, 900), a);
      picks.push({ album: a, why: g.text, removedClaims: g.removed, quote: quote, quoteRejected: !!p.quote && !quote, caveat: typeof p.caveat === 'string' ? p.caveat.slice(0, 200) : '' });
    });
    return { reading: typeof (resp && resp.reading) === 'string' ? resp.reading.slice(0, 400) : '', picks: picks };
  }

  function classifyPrompt(d) {
    var src = d.source || {};
    return [
      'Classify the mood of a newly released Alio Die album for a private listening app. Ground every statement in the material below; it is the only information you have.',
      'Keep three kinds of statement apart: documented sounds (only instruments, recordings or voices named in the credits or description), described atmosphere (imagery in the text and titles), and your own mood interpretation. Never say the album contains a sound that the material does not name. If the material is thin, say so and lower confidence.',
      '', 'TITLE: ' + d.title + (d.artist ? ' \u2014 ' + d.artist : ''),
      d.releaseDate ? 'RELEASED: ' + d.releaseDate : '',
      src.about ? 'OFFICIAL DESCRIPTION: ' + clip(src.about, 3000) : (src.aboutExcerpt ? 'OFFICIAL DESCRIPTION (opening words only): ' + src.aboutExcerpt : 'OFFICIAL DESCRIPTION: not available'),
      src.credits ? 'CREDITS: ' + clip(src.credits, 1200) : '',
      src.performers && src.performers.length ? 'PERFORMERS / CREDITS: ' + src.performers.join(' | ') : '',
      src.tracks && src.tracks.length ? 'TRACKS: ' + src.tracks.map(function (t) { return (t[0] || t.title) + ' (' + (t[1] || t.duration || '?') + ')'; }).join('; ') : '',
      src.tags && src.tags.length ? 'BANDCAMP TAGS (often generic artist-level tags): ' + src.tags.join(', ') : '',
      '', 'Use only these mood labels for primaryMood and moodTags: ' + MOOD_VOCAB.join(', ') + '.',
      'Reply with only JSON: {"primaryMood":"<label>","moodTags":["<label>", "... up to 4"],"descriptors":["up to 6 short words"],"warmth":<-2 cold/dark .. 2 warm>,"alertness":<-2 drowsy .. 2 alert>,"summary":"2-3 sentences: documented sounds first, then described atmosphere, then your interpretation, saying which is which","basis":"which inputs you relied on","confidence":"low|medium|high"}'
    ].filter(Boolean).join('\n');
  }
  function validateClassification(c) {
    if (!c || typeof c !== 'object') return null;
    var vocab = new Set(MOOD_VOCAB);
    var tags = (Array.isArray(c.moodTags) ? c.moodTags : []).map(String).map(function (t) { return t.toLowerCase().trim(); }).filter(function (t) { return vocab.has(t); }).slice(0, 4);
    var primary = vocab.has(String(c.primaryMood || '').toLowerCase().trim()) ? String(c.primaryMood).toLowerCase().trim() : (tags[0] || null);
    if (!primary) return null;
    var num = function (v) { v = Number(v); return isFinite(v) ? Math.max(-2, Math.min(2, Math.round(v))) : 0; };
    return {
      primaryMood: primary, moodTags: tags.filter(function (t) { return t !== primary; }),
      descriptors: (Array.isArray(c.descriptors) ? c.descriptors : []).map(String).map(function (s) { return s.slice(0, 30); }).slice(0, 6),
      warmth: num(c.warmth), alertness: num(c.alertness), summary: String(c.summary || '').slice(0, 700), basis: String(c.basis || '').slice(0, 200),
      confidence: /^(low|medium|high)$/.test(c.confidence) ? c.confidence : 'low'
    };
  }

  function normTitle(t) { return norm(t).replace(/\b(remaster(ed)?|reissue|expanded|deluxe|edition|version|anniversary)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function findDuplicate(candidate, albums) {
    var cu = canonicalUrl(candidate.url), cs = slugOf(cu), ct = normTitle(candidate.title || '');
    for (var i = 0; i < albums.length; i++) {
      var a = albums[i];
      if (a.canonical === cu || slugOf(a.canonical) === cs) return { album: a, reason: 'same Bandcamp address' };
      if (candidate.itemId && a.bandcampId && String(candidate.itemId) === String(a.bandcampId)) return { album: a, reason: 'same Bandcamp album id' };
    }
    for (var j = 0; j < albums.length; j++) if (ct && normTitle(albums[j].title) === ct) return { album: albums[j], reason: 'same title (possible reissue)', soft: true };
    return null;
  }

  var api = {
    MOOD_VOCAB: MOOD_VOCAB, CONCEPTS: CONCEPTS, ROOMS: ROOMS, SOUND_FEATURES: SOUND_FEATURES, LAYER_NAMES: LAYER_NAMES, WEIGHTS: W,
    norm: norm, parseDuration: parseDuration, fmtMinutes: fmtMinutes, canonicalUrl: canonicalUrl, slugOf: slugOf,
    fromCurated: fromCurated, fromDiscovery: fromDiscovery, buildIndex: buildIndex, extractSounds: extractSounds, durationEvidence: durationEvidence,
    interpret: interpret, describeInterpretation: describeInterpretation, scoreAll: scoreAll, recommend: recommend,
    explain: explain, summary: summary, explainLines: explainLines, interpretationSummary: interpretationSummary, ROLE_NAMES: ROLE_NAMES, CONTEXT_CAP: CONTEXT_CAP, CONTEXT_NEG_CAP: CONTEXT_NEG_CAP, evidenceFor: evidenceFor, soundSummary: soundSummary, room: room,
    recommendPrompt: recommendPrompt, validateAi: validateAi, guardSoundClaims: guardSoundClaims, quoteFound: quoteFound,
    classifyPrompt: classifyPrompt, validateClassification: validateClassification, findDuplicate: findDuplicate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AlioEngine = api;
})(typeof self !== 'undefined' ? self : this);
