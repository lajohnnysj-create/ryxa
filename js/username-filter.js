// /js/username-filter.js
// =============================================================================
// Username content filter - blocks slurs and offensive terms in usernames.
//
// Source: dsojevic/profanity-list (en.json), compiled to the categories and
// severities chosen for Ryxa:
//   racial   - all severities
//   shock    - all severities
//   lgbtq    - all severities (slurs only; neutral identity terms excluded)
//   sexual   - severity 3-4 only
//   religious- severity 3-4 only
//   general  - severity 3-4 only
//
// Manually excluded as miscategorized neutral identity terms: "enby", "bicon".
//
// Matching strategy:
//   - LONG terms (5+ chars, or multi-word): substring match after normalization.
//   - SHORT terms (<=4 chars, single token): whole-username match ONLY, to
//     avoid the Scunthorpe problem (e.g. "sex" must not block "essexgirl").
//   - REGEX terms: wildcard-expanded from the source (e.g. ni*gg*er catches
//     stretched evasions like "niiigger").
//
// Normalization collapses common leetspeak and strips separators so that
// "n_i_g_g_e_r" / "n1gg3r" style evasions are caught.
//
// Works in BOTH environments:
//   - Node (api/check-username.js): require('./username-filter') style via
//     module.exports.
//   - Browser (bio.js, dashboard-shell.js): exposes window.RyxaUsernameFilter.
//
// PUBLIC API:  isUsernameClean(username)  ->  true if OK, false if blocked.
// =============================================================================

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // Node / api routes
  }
  if (typeof window !== 'undefined') {
    window.RyxaUsernameFilter = api; // Browser / dashboard
  }
})(this, function () {
  'use strict';

  // --- Compiled blocklists ---
  var SHORT = ["1m1j", "2g1c", "bdsm", "clit", "coon", "cum", "ddlg", "dyke", "gook", "haji", "jap", "jizz", "leso", "mdlb", "nude", "paki", "poof", "poon", "quim", "rape", "sex", "spic", "wog", "wogs", "xnxx"];
  var LONG = ["1 man 1 jar", "1man1jar", "2 girls 1 cup", "2girls1cup", "acrotomophile", "acrotomophilia", "alabama hot pocket", "alabama tuna melt", "alaskan pipeline", "algophile", "algophilia", "anal assassin", "anal astronaut", "anilingus", "apotemnophile", "apotemnophilia", "arse bandit", "ass bandit", "auto erotic", "autoerotic", "babeland", "baby batter", "baby gravy", "baby juice", "ball batter", "ball gag", "ball gravy", "ball kicking", "ball licking", "ball sack", "ball sucking", "ball-gag", "ball-kicking", "ball-licking", "ball-sucking", "ballcuzi", "ballgag", "bang bros", "bang bus", "bangbros", "bangbus", "bareback", "barely legal", "bastinado", "batty boi", "batty boy", "battyboi", "battyboy", "bean flicker", "bean queen", "bean-flicker", "beaner", "beaners", "beanflicker", "beastiality", "beaver cleaver", "beaver lips", "beestiality", "bellesa", "bestiality", "big boobs", "big breasts", "big cock", "big knockers", "big tits", "birdlock", "black cock", "blow job", "blow your load", "blow-job", "blowjob", "blue waffle", "bluewaffle", "blumpkin", "bone smuggler", "bone-smuggler", "boner", "bonesmuggler", "booty buffer", "booty call", "booty-buffer", "boston george", "brown piper", "brown shower", "brown showers", "brown-piper", "brownie king", "brownie queen", "brownpiper", "buddha head", "buddha-head", "buddhahead", "bufter", "bufty", "bukkake", "bulldyke", "bullet vibe", "bullet vibrator", "bum boy", "bum chum", "bum driller", "bum pilot", "bum pirate", "bum rider", "bum robber", "bum rustler", "bum-boy", "bum-chum", "bum-driller", "bum-pirate", "bum-robber", "bumboy", "bumchum", "bumdriller", "bumhole engineer", "bumrider", "bumrobber", "butt boy", "butt pilot", "butt pirate", "butt rider", "butt robber", "butt rustler", "butt-boy", "butt-pirate", "butt-robber", "buttboy", "butthole engineer", "buttrider", "buttrobber", "camel jockey", "camel jockies", "camel toe", "cameljockey", "cameljockies", "canadian porch swing", "carpet muncher", "carpetmuncher", "cheese eating surrender monkey", "cheese-eating surrender monkey", "chi chi man", "chi-chi man", "chicken queen", "china man", "china men", "chinaman", "chinamen", "ching chong", "ching-chong", "chink", "chinks", "chinky", "chocolate rosebud", "chocolate rosebuds", "cholerophile", "cholerophilia", "cialis", "circle-jerk", "circlejerk", "cishet", "cissie", "cissy", "claustrophile", "claustrophilia", "cleveland accordion", "cleveland hot waffle", "cleveland steamer", "clover clamp", "clover clamps", "cluster fuck", "cluster-fuck", "clusterfuck", "cockpipe cosmonaut", "cockstruction worker", "coimetrophile", "coimetrophilia", "collared", "collaring", "coons", "coprolagnia", "coprophile", "coprophilia", "cornhole", "crafty butcher", "cream-pie", "creampie", "cum shot", "cum shots", "cumming", "cumshot", "cumshots", "cunnilingus", "cunt boy", "cunt-boy", "cuntboy", "cunts", "curry muncher", "curry-muncher", "currymuncher", "darkey", "darkie", "darkies", "darky", "date rape", "daterape", "deep throat", "deep-throat", "deepthroat", "dendrophile", "dendrophilia", "dick girl", "dick-girl", "dickgirl", "dildo", "dildos", "dipsea", "dirty pillows", "dirty sanchez", "dishabiliophile", "dishabiliophilia", "dog style", "doggie style", "doggie-style", "doggiestyle", "doggy style", "doggy-style", "doggystyle", "dolcett", "domination", "dominatrix", "domme", "dommes", "donkey punch", "donut muncher", "donut puncher", "doon coon", "dooncoon", "double penetration", "dp action", "dry hump", "dune coon", "dune-coon", "dutch rudder", "dystychiphile", "dystychiphilia", "edge play", "edgeplay", "ejaculate", "ejaculated", "ejaculating", "ejaculation", "electro-play", "electroplay", "emetophile", "emetophilia", "eskimo trebuchet", "eye-tie", "eyetie", "fag bomb", "fag-bomb", "fagbomb", "fagot", "felch", "felching", "fellating", "fellatio", "female squirting", "figging", "finger bang", "fingerbang", "fingerbanging", "fingered", "fingering", "finocchio", "finoccio", "finochio", "fisted", "fisting", "foot job", "foot-job", "footjob", "french rudder", "frog eater", "frog-eater", "frogeater", "frolic me", "frolicme", "frottage", "frotting", "fuck-wit", "fuckhead", "fuckheads", "fucks", "fucktard", "fucktards", "fuckwad", "fuckwads", "fuckwhit", "fuckwit", "fuckwits", "fudge packer", "fudge-packer", "fudgepacker", "futanari", "g-spot", "gang bang", "gangbang", "gay sex", "gaysian", "genitorture", "gerontophile", "gerontophilia", "giant cock", "gin jockey", "gin jocky", "girl on top", "go-kun", "goatcx", "goatse", "gokkun", "golden shower", "golden showers", "golliwog", "gollywog", "gook-eye", "gookie", "gooks", "gooky", "goregasm", "gray queen", "greaseball", "grey queen", "grope", "group sex", "gym bunny", "gymbunny", "hadji", "hand job", "hand-job", "handjob", "heimie", "hermie", "hickory switch", "hippophile", "hippophilia", "homoerotic", "honkey", "honkeys", "honkies", "honky", "horny", "hot carl", "hot richard", "huge cock", "humping", "hymie", "impact play", "impact-play", "incest", "intercourse", "jail bait", "jailbait", "jelly donut", "jerk mate", "jerkmate", "juggs", "jungle bunny", "junglebunny", "kennebunkport surprise", "kentucky klondike", "kentucky tractor puller", "kinbaku", "kitty puncher", "kitty-puncher", "kittypuncher", "knobbing", "kraut", "krauts", "kunts", "kynophile", "kynophilia", "lady boy", "lady-boy", "ladyboy", "leather restraint", "leather straight jacket", "lemon party", "lemonparty", "leningrad steamer", "lesbo", "lezzie", "lezzies", "light in the fedora", "light in the loafers", "light in the pants", "limp wristed", "limp-wristed", "literotica", "lovemaking", "male squirting", "male-squirting", "massive cock", "mayonnaise monkey", "mayonnaise monkies", "meat masseuse", "meat spin", "meatspin", "menage a trois", "menage-a-trois", "menages a trois", "menages-a-trois", "menophile", "menophilia", "mexican pancake", "milwaukee blizzard", "missionary position", "mississippi birdbath", "mr hands", "mr. hands", "mrhands", "muff diver", "muff diving", "muff-diver", "muffdiver", "muffdiving", "muscle mary", "mvtube", "nambla", "necrophile", "necrophilia", "negro", "neo nazi", "neo-nazi", "neonazi", "nig nog", "nigerian hurricane", "nignog", "nimpho", "nimphomania", "nimphomaniac", "nipple clamp", "nipple clamps", "nudity", "nutten", "nympho", "nymphomania", "nymphomaniac", "octopussy", "oklahomo", "omorashi", "one cup two girls", "one jar one man", "one man one jar", "only fans", "onlyfans", "orgasm", "orgasmic", "orgasms", "paedo bear", "paedobear", "paedophile", "paedophilia", "pain slut", "painslut", "panamanian petting zoo", "pansy", "panties", "parthenophile", "parthenophilia", "pedo bear", "pedobear", "pedophile", "pedophilia", "pegging", "peter puffer", "peter-puffer", "peterpuffer", "petrol sniffer", "petrol-sniffer", "petrolsniffer", "phagophile", "phagophilia", "pikey", "pikeys", "piss pig", "pissing", "pisspig", "playboy", "pleasure chest", "pnigerophile", "pnigerophilia", "pnigophile", "pnigophilia", "poinephile", "poinephilia", "pony boy", "pony girl", "pony-boy", "pony-girl", "pony-play", "ponyboy", "ponygirl", "ponyplay", "poontang", "poop chute", "poopchute", "porn hub", "pornhub", "potato queen", "prince albert piercing", "proctophile", "proctophilia", "punany", "pussy puncher", "pussy-puncher", "pussypuncher", "queaf", "queef", "rag head", "rag heads", "raghead", "ragheads", "raging boner", "ramen yarmulke", "raping", "rapist", "reverse cowgirl", "rhabdophile", "rhabdophilia", "rhypophile", "rhypophilia", "rice queen", "rimjob", "rimming", "ring raider", "ringraider", "rusty trombone", "santorum", "scatophile", "scatophilia", "schlong", "scissoring", "seplophile", "seplophilia", "shaved beaver", "shaved pussy", "she male", "she-male", "sheep shagger", "sheepshagger", "shemale", "shibari", "shit head", "shithead", "shlong", "shota", "shrimping", "sissy", "skeet", "skittle harvest", "skittles harvest", "slant eye", "slant-eye", "slanteye", "snowballing", "sodomise", "sodomist", "sodomize", "sodomy", "spearchucker", "spick", "spicks", "spics", "spicy gringo", "splooge", "splooge moose", "spooge", "spunk", "strap on", "strap-on", "strapon", "strappado", "suastika", "svastika", "swamp guinea", "swamp-guinea", "swastika", "switch hitter", "t-girl", "taphephile", "taphephilia", "tea bagged", "tea bagging", "tea-bagged", "tea-bagging", "tgirl", "thanatophile", "thanatophilia", "threesome", "throating", "throbbing boner", "throbbing cock", "thumbzilla", "topless", "towel head", "towel-head", "towelhead", "trannie", "tranny", "transbian", "traumatophile", "traumatophilia", "tribadism", "tribbing", "tub girl", "tubgirl", "twink", "two girls one cup", "urethra play", "urophile", "urophilia", "viagra", "vibrator", "violet wand", "vorarephile", "vorarephilia", "voyeurweb", "wagon burner", "wagon-burner", "wax play", "wax-play", "wet back", "wet dream", "wet-back", "wetback", "whigger", "white power", "white-power", "whitepower", "wigga", "wigger", "wiitwd", "wolfbagging", "worldsex", "wrapping men", "wrinkled starfish", "xhamster", "xtube", "xvideos", "xyrophile", "xyrophilia", "yellow shower", "yellow showers", "zipper head", "zipper-head", "zipperhead", "zippo cat", "zippo-cat", "zippocat", "zoophile", "zoophilia"];
  var REGEX_SRC = ["arseho+le", "ass+ho+le", "ba+sta+rd", "bell+end", "bi+tch", "bi+tches", "cli+tori+s", "clu+nge", "cu+n+t", "fa+g", "fa+gg+o+t", "fu+c+k", "fu+c+ken", "fu+c+ker", "fu+c+kin", "fu+c+king", "fu+ckers", "hajj+i", "jig+aboo+", "jig+gerboo+", "ki+ke", "ku+nt", "ni+gg+a", "ni+gg+e+r", "ni+gg+s", "pu+na+ni", "pu+ss+y", "sand ni+gg+e+r", "sand-ni+gg+e+r", "sandni+gg+e+r", "timber ni+gg+e+r", "timber-ni+gg+e+r", "timberni+gg+e+r", "twa+t", "who+re"];

  var SHORT_SET = {};
  for (var i = 0; i < SHORT.length; i++) { SHORT_SET[SHORT[i]] = true; }

  // EXTRA - terms blocked by explicit Ryxa decision, beyond what the source
  // severity policy selected. Substring-matched like LONG terms. Add future
  // manual entries here.
  //   "retard" family: source rates it severity 2 (general), which our policy
  //   would allow, but it functions as a slur - blocked by explicit decision.
  var EXTRA = ['retard', 'retarded', 'retarted'];

  // Whitelist - innocent words that contain a flagged substring (the
  // "Scunthorpe problem"). If the normalized username exactly equals one
  // of these, it is always allowed. Checked before any blocklist.
  var WHITELIST = {
    'therapist': true, 'therapists': true, 'therapy': true,
    'therapeutic': true, 'scunthorpe': true, 'specialist': true,
    'specialists': true
  };

  // Compile wildcard terms to RegExp once at load.
  var REGEXES = [];
  for (var r = 0; r < REGEX_SRC.length; r++) {
    try { REGEXES.push(new RegExp(REGEX_SRC[r])); } catch (e) { /* skip bad pattern */ }
  }

  // Leetspeak / lookalike map for normalization.
  var LEET = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
    '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i'
  };

  // Normalize a username for matching:
  //   lowercase, strip anything not a-z0-9, then de-leet to letters.
  // Returns the normalized string.
  function normalize(input) {
    var s = String(input || '').toLowerCase();
    // strip separators / non-alphanumerics
    s = s.replace(/[^a-z0-9]/g, '');
    // de-leet
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      out += LEET[ch] || ch;
    }
    return out;
  }

  // Main check. Returns true if the username is CLEAN (allowed),
  // false if it matches a blocked term.
  function isUsernameClean(username) {
    var norm = normalize(username);
    if (!norm) return true; // empty / nonsense - let other validation handle it

    // 0. Whitelist: known-innocent words that contain a flagged substring.
    if (WHITELIST[norm]) return true;

    // 1. SHORT terms: whole-string match only (no substring).
    if (SHORT_SET[norm]) return false;

    // 2. LONG terms: substring match.
    for (var i = 0; i < LONG.length; i++) {
      var term = LONG[i];
      // multi-word source terms had spaces stripped during normalize,
      // so compare against a space-stripped version of the term.
      var t = term.replace(/[^a-z0-9]/g, '');
      if (t && norm.indexOf(t) !== -1) return false;
    }

    // 2b. EXTRA terms: explicit Ryxa additions, substring match.
    for (var k = 0; k < EXTRA.length; k++) {
      if (norm.indexOf(EXTRA[k]) !== -1) return false;
    }

    // 3. REGEX terms: wildcard-expanded patterns.
    for (var j = 0; j < REGEXES.length; j++) {
      if (REGEXES[j].test(norm)) return false;
    }

    return true;
  }

  return { isUsernameClean: isUsernameClean, normalize: normalize };
});
