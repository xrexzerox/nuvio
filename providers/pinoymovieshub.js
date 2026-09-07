/**
 * PinoyMoviesHub Nuvio Provider
 * Ported from the working xrexzerox/nvv implementation.
 * Uses PinoyMoviesHub's DooPlayer metadata/API flow.
 */

var cheerio = require("cheerio-without-node-native");

var PROVIDER_NAME = "PinoyMoviesHub";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var BASE_URL = "https://pinoymovieshub.win";

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": BASE_URL
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
    body: options.body
  }).then(function(res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
    return res.text();
  });
}

function fetchJson(url, options) {
  options = options || {};
  return fetch(url, {
    method: options.method || "GET",
    redirect: options.redirect || "follow",
    headers: merge(HEADERS, options.headers || {}),
    body: options.body
  }).then(function(res) {
    if (!res.ok) return null;
    return res.json();
  }).catch(function() { return null; });
}

function slugify(title) {
  return String(title || "").toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseQuality(text) {
  var value = String(text || "").toLowerCase();
  var m = value.match(/\b(2160p|1440p|1080p|720p|480p|360p|4k|uhd|hd|sd|cam)\b/);
  if (!m) return "Auto";
  if (m[1] === "4k" || m[1] === "uhd") return "2160p";
  if (m[1] === "hd") return "720p";
  if (m[1] === "sd") return "480p";
  if (m[1] === "cam") return "CAM";
  return m[1];
}

function inferLang(text) {
  var t = String(text || "").toLowerCase();
  if (t.indexOf("tagalog") >= 0 || t.indexOf("filipino") >= 0) return "Tagalog";
  if (t.indexOf("english") >= 0 || /\beng\b/.test(t)) return "English";
  if (t.indexOf("spanish") >= 0) return "Spanish";
  if (t.indexOf("korean") >= 0) return "Korean";
  if (t.indexOf("japanese") >= 0) return "Japanese";
  if (t.indexOf("chinese") >= 0) return "Chinese";
  if (t.indexOf("hindi") >= 0) return "Hindi";
  return "Tagalog";
}

function getTmdbInfo(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
  return fetchJson(url).then(function(data) {
    if (!data) return null;
    return {
      type: type,
      title: type === "tv" ? (data.name || data.original_name || "") : (data.title || data.original_title || ""),
      original: data.original_title || data.original_name || "",
      year: String(data.release_date || data.first_air_date || "").slice(0, 4)
    };
  });
}

function getEpisodeTitle(tmdbId, season, episode) {
  if (!season || !episode) return Promise.resolve("");
  var url = "https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "?api_key=" + TMDB_API_KEY;
  return fetchJson(url).then(function(data) { return data && data.name || ""; }).catch(function() { return ""; });
}

function extractPlayerData(html) {
  var $ = cheerio.load(html);
  var players = [];

  $("[data-post][data-type][data-source], [data-post][data-type], #dooplay_player, .dooplay_player, .dooplay_player_response").each(function(_, el) {
    var postId = $(el).attr("data-post") || $(el).attr("data-id");
    var type = $(el).attr("data-type") || "movie";
    var source = $(el).attr("data-source") || $(el).attr("data-nume") || "1";
    if (postId) players.push({ postId: postId, type: type, source: source });
  });

  var scripts = $("script").map(function(_, el) { return $(el).html() || ""; }).get();
  scripts.forEach(function(script) {
    var post = script.match(/data-post[=:]\s*["'](\d+)["']/);
    if (!post) return;
    var type = script.match(/data-type[=:]\s*["']([^"']+)["']/);
    var source = script.match(/data-source[=:]\s*["']([^"']+)["']/);
    players.push({
      postId: post[1],
      type: type ? type[1] : "movie",
      source: source ? source[1] : "1"
    });
  });

  var seen = {}, unique = [];
  players.forEach(function(p) {
    var key = p.postId + "|" + p.type + "|" + p.source;
    if (!seen[key]) {
      seen[key] = true;
      unique.push(p);
    }
  });
  console.log("[PinoyMoviesHub] players=" + unique.length);
  return unique;
}

function callDooPlayerAPI(playerData) {
  var apiUrl = BASE_URL + "/wp-json/dooplayer/v2/" + playerData.postId + "/" + playerData.type + "/" + playerData.source;
  console.log("[PinoyMoviesHub] DooPlayer=" + apiUrl);
  return fetchJson(apiUrl, { headers: { "X-Requested-With": "XMLHttpRequest" } }).then(function(data) {
    if (!data) return null;

    var embed = data.embed_url || data.url || data.source || data.link || data.file || data.src;
    if (embed) return embed;

    if (data.data && typeof data.data === "object") {
      embed = data.data.embed_url || data.data.url || data.data.source || data.data.link || data.data.file || data.data.src;
      if (embed) return embed;
    }

    var html = data.html || data.iframe || data.embed || data.player;
    if (typeof html === "string") {
      var iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i) || html.match(/src=["']([^"']+)["']/i);
      if (iframe) return iframe[1];
    }
    return null;
  }).catch(function(e) {
    console.log("[PinoyMoviesHub] DooPlayer error=" + (e && e.message || e));
    return null;
  });
}

function buildStream(url, displayTitle, language, quality, isTv, season, episode, episodeTitle) {
  var host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch (e) {}
  var lang = inferLang(language);
  var isEmbed = !/\.(m3u8|mp4|mkv|webm|avi|mov)(\?|#|$)/i.test(url);
  var q = isEmbed ? "Browser" : parseQuality(quality);
  var title = isTv
    ? "S" + season + "E" + episode + (episodeTitle ? " - " + episodeTitle : "") + " | " + displayTitle
    : displayTitle;
  return {
    name: PROVIDER_NAME + " | Source " + (host || "embed"),
    title: title + "\n" + q + " | " + lang + (host ? " | " + host : ""),
    url: url,
    quality: q,
    language: lang,
    provider: "pinoymovieshub",
    headers: { Referer: BASE_URL },
    behaviorHints: {
      bingeGroup: "pinoymovieshub-" + (isEmbed ? "embed" : q.toLowerCase()),
      notWebReady: isEmbed
    }
  };
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[PinoyMoviesHub] start id=" + tmdbId + " type=" + mediaType + " s=" + season + " e=" + episode);

  return getTmdbInfo(tmdbId, mediaType).then(function(info) {
    if (!info || !info.title) return [];
    return getEpisodeTitle(tmdbId, season, episode).then(function(epTitle) {
      var slug = slugify(info.title);
      var pageUrl;
      if (mediaType === "tv") {
        if (!season || !episode) return [];
        pageUrl = BASE_URL + "/episodes/" + slug + "-" + season + "x" + episode + "/";
      } else {
        pageUrl = BASE_URL + "/movies/" + slug + "/";
      }

      console.log("[PinoyMoviesHub] page=" + pageUrl);
      return fetchText(pageUrl).then(function(html) {
        var players = extractPlayerData(html);
        if (!players.length) return [];

        return Promise.all(players.map(function(player) {
          return callDooPlayerAPI(player).then(function(embed) {
            if (!embed) return null;
            return buildStream(embed, info.title, "Tagalog", "Auto", mediaType === "tv", season, episode, epTitle);
          });
        })).then(function(items) {
          var seen = {}, out = [];
          items.forEach(function(item) {
            if (!item || !item.url || seen[item.url]) return;
            seen[item.url] = true;
            out.push(item);
          });
          console.log("[PinoyMoviesHub] streams=" + out.length);
          return out;
        });
      });
    });
  }).catch(function(err) {
    console.error("[PinoyMoviesHub] fatal=" + (err && err.message || err));
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
else globalThis.getStreams = getStreams;
