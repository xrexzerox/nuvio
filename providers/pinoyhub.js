/**
 * PinoyMoviesHub Nuvio Plugin - Nuvio-compatible embed handling
 * Domain: pinoymovieshub.win
 * Supports: Movies & TV Shows
 *
 * Embed pages are NOT native media URLs. NuvioMobile's current StreamItem
 * contract sends `url` to the native player, while `externalUrl` is opened
 * externally when `url` is absent. Therefore this provider returns direct
 * media URLs only when the source actually exposes one; otherwise it uses
 * externalUrl for the public embed page instead of passing the webpage to
 * Media3.
 */

var cheerio = require("cheerio-without-node-native");
var PROVIDER_NAME = "PinoyMoviesHub";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var BASE_URL = "https://pinoymovieshub.win";

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": BASE_URL + "/"
};

function merge(a, b) {
  var out = {}, k;
  for (k in a || {}) out[k] = a[k];
  for (k in b || {}) out[k] = b[k];
  return out;
}

function fetchText(url, options) {
  options = options || {};
  return fetch(url, {
    method: options.method || "GET",
    redirect: options.redirect || "follow",
    headers: merge(HEADERS, options.headers || {}),
    body: options.body,
    skipSizeCheck: true
  }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  });
}

function fetchJson(url, options) {
  options = options || {};
  return fetch(url, {
    method: options.method || "GET",
    redirect: options.redirect || "follow",
    headers: merge(HEADERS, options.headers || {}),
    body: options.body,
    skipSizeCheck: true
  }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

function slugify(title) {
  return String(title || "").toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseQuality(text) {
  var m = String(text || "").match(/\b(2160p|1440p|1080p|720p|480p|360p|4k|uhd|hd|sd|cam)\b/i);
  if (!m) return "Auto";
  var q = m[1].toLowerCase();
  if (q === "4k" || q === "uhd") return "2160p";
  if (q === "hd") return "720p";
  if (q === "sd") return "480p";
  if (q === "cam") return "CAM";
  return q;
}

function inferLang(text) {
  var t = String(text || "").toLowerCase();
  if (t.indexOf("tagalog") >= 0 || t.indexOf("filipino") >= 0) return "Tagalog";
  if (t.indexOf("english") >= 0 || /\beng\b/.test(t)) return "English";
  return "Tagalog";
}

function getTmdbInfo(tmdbId, forceTv) {
  var url;
  if (forceTv) {
    url = "https://api.themoviedb.org/3/tv/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    return fetchJson(url).then(function (d) {
      return { type: "tv", title: d.name || "", year: (d.first_air_date || "").split("-")[0] };
    });
  }
  url = "https://api.themoviedb.org/3/movie/" + tmdbId + "?api_key=" + TMDB_API_KEY;
  return fetchJson(url).then(function (d) {
    return { type: "movie", title: d.title || "", year: (d.release_date || "").split("-")[0] };
  }).catch(function () {
    return getTmdbInfo(tmdbId, true);
  });
}

function getEpisodeTitle(tmdbId, season, episode) {
  if (!season || !episode) return Promise.resolve("");
  return fetchJson("https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "?api_key=" + TMDB_API_KEY)
    .then(function (d) { return d.name || ""; })
    .catch(function () { return ""; });
}

function extractPlayerData(html) {
  var $ = cheerio.load(html);
  var players = [];
  var seen = {};

  $("[data-post][data-type][data-source], [data-post][data-type], #dooplay_player, .dooplay_player, .dooplay_player_response").each(function (_, el) {
    var postId = $(el).attr("data-post") || $(el).attr("data-id");
    if (!postId) return;
    var source = $(el).attr("data-source") || $(el).attr("data-nume") || "1";
    var type = $(el).attr("data-type") || "movie";
    var key = postId + "|" + type + "|" + source;
    if (!seen[key]) {
      seen[key] = 1;
      players.push({ postId: postId, type: type, source: source });
    }
  });

  return players;
}

function getEmbedUrl(player) {
  var apiUrl = BASE_URL + "/wp-json/dooplayer/v2/" + player.postId + "/" + player.type + "/" + player.source;
  return fetchJson(apiUrl, { headers: { "X-Requested-With": "XMLHttpRequest" } }).then(function (data) {
    if (!data) return null;

    var candidates = [];
    function add(v) { if (typeof v === "string" && v.trim()) candidates.push(v.trim()); }
    add(data.embed_url);
    add(data.url);
    add(data.source);
    add(data.link);
    add(data.file);
    add(data.src);

    if (data.data) {
      add(data.data.embed_url);
      add(data.data.url);
      add(data.data.source);
      add(data.data.link);
      add(data.data.file);
      add(data.data.src);
    }

    var html = data.html || data.iframe || data.embed || data.player;
    if (typeof html === "string") {
      var m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i) || html.match(/src=["']([^"']+)["']/i);
      if (m) add(m[1]);
    }

    return candidates.length ? candidates[0] : null;
  }).catch(function () { return null; });
}

function isDirectMedia(url) {
  return /\.(m3u8|mp4|mkv|webm|mov|avi)(?:[?#]|$)/i.test(String(url || ""));
}

function makeStream(url, displayTitle, season, episode, episodeTitle) {
  if (!url) return null;
  var lang = inferLang(displayTitle);
  var direct = isDirectMedia(url);
  var title = displayTitle;
  if (season && episode) title += " S" + season + "E" + episode + (episodeTitle ? " - " + episodeTitle : "");

  if (direct) {
    return {
      name: PROVIDER_NAME,
      title: title + " | " + parseQuality(displayTitle) + " | " + lang,
      url: url,
      quality: parseQuality(displayTitle),
      provider: "pinoymovieshub",
      headers: { Referer: BASE_URL + "/" }
    };
  }

  // NuvioMobile's external URL path is the correct contract for an ordinary
  // public webpage/embed. Do not pass the HTML page to Media3 as `url`.
  return {
    name: PROVIDER_NAME + " | Embed",
    title: title + " | Browser Embed | " + lang,
    externalUrl: url,
    provider: "pinoymovieshub",
    behaviorHints: {
      bingeGroup: "pinoymovieshub-embed"
    }
  };
}

function getStreams(tmdbId, season, episode) {
  // Supports both Nuvio's current 3/4-argument calls:
  // getStreams(tmdbId, season, episode)
  // getStreams(tmdbId, mediaType, season, episode)
  var mediaType = null;
  if (season === "movie" || season === "tv") {
    mediaType = season;
    season = episode;
    episode = arguments[3];
  }

  var forceTv = !!(mediaType === "tv" || (season && episode));

  return getTmdbInfo(tmdbId, forceTv).then(function (tmdb) {
    if (!tmdb || !tmdb.title) return [];
    if (tmdb.type === "tv" && (!season || !episode)) return [];

    return getEpisodeTitle(tmdbId, season, episode).then(function (episodeTitle) {
      var slug = slugify(tmdb.title);
      var pageUrl;

      if (tmdb.type === "movie") {
        pageUrl = BASE_URL + "/movies/" + slug + "/";
      } else {
        pageUrl = BASE_URL + "/episodes/" + slug + "-" + season + "x" + episode + "/";
      }

      return fetchText(pageUrl).then(function (html) {
        var players = extractPlayerData(html);
        if (!players.length) return [];

        return Promise.all(players.map(function (p) {
          return getEmbedUrl(p).then(function (url) {
            return makeStream(url, tmdb.title, season, episode, episodeTitle);
          });
        })).then(function (items) {
          var out = [];
          var seen = {};
          for (var i = 0; i < items.length; i++) {
            if (!items[i]) continue;
            var key = (items[i].url || items[i].externalUrl || "").toLowerCase();
            if (!key || seen[key]) continue;
            seen[key] = 1;
            out.push(items[i]);
          }
          return out;
        });
      });
    });
  }).catch(function (e) {
    try { console.log("[PinoyMoviesHub] " + (e && e.message ? e.message : e)); } catch (_) {}
    return [];
  });
}

module.exports = { getStreams: getStreams };
