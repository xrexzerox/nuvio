/** PinoyMoviesHub - Nuvio bundle; robust search/detail/source discovery. */
var BASE = "https://pinoymovieshub.win";
var TMDB_BASE = "https://api.themoviedb.org/3";
var TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";

function normalizeTitle(s) {
  return String(s || "").toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[‘’“”"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
function stripTags(s) {
  return String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}
function absUrl(href) {
  if (!href) return null;
  var s = String(href).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/\//.test(s)) return "https:" + s;
  if (s.charAt(0) === "/") return BASE + s;
  return BASE + "/" + s;
}
function fetchText(url, extraHeaders) {
  return fetch(url, { headers: Object.assign({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml"
  }, extraHeaders || {}) }).then(function(r) {
    if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
    return r.text();
  });
}
function fetchJson(url) {
  return fetch(url, { headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json"
  }}).then(function(r) {
    if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
    return r.json();
  });
}
function titleScore(target, candidate) {
  var a = normalizeTitle(target), b = normalizeTitle(candidate);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.indexOf(a) >= 0 || a.indexOf(b) >= 0) return 92;
  var aw = a.split(" "), bw = b.split(" "), hit = 0;
  aw.forEach(function(w) { if (w.length >= 3 && bw.indexOf(w) >= 0) hit++; });
  return Math.round(hit / Math.max(aw.length, 1) * 80);
}
function extractAnchors(html) {
  var out = [], seen = {}, re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html))) {
    var url = absUrl(m[1]);
    if (!url || seen[url]) continue;
    seen[url] = true;
    out.push({ url: url, text: stripTags(m[2]) });
  }
  return out;
}
function extractResults(html) {
  return extractAnchors(html).filter(function(x) {
    return /\/(movies|episodes|series)\//i.test(x.url);
  });
}
function choose(results, ctx) {
  var best = null, bestScore = -1;
  results.forEach(function(r) {
    var s = titleScore(ctx.title, r.text || r.url);
    if (ctx.year && String(r.text).indexOf(String(ctx.year)) >= 0) s += 5;
    if (s > bestScore) { bestScore = s; best = r; }
  });
  return bestScore >= 40 ? best : null;
}
function externalHost(url, label) {
  var x = String(url || "").toLowerCase(), t = String(label || "").toLowerCase();
  if (/doodstream|dood\./.test(x) || /doodstream/.test(t)) return "Doodstream";
  if (/mixdrop/.test(x) || /mixdrop/.test(t)) return "Mixdrop";
  if (/byse/.test(x) || /byse/.test(t)) return "Byse";
  if (/streamhide/.test(x) || /streamhide/.test(t)) return "StreamHide";
  if (/streamlare/.test(x) || /streamlare/.test(t)) return "Streamlare";
  return "";
}
function extractSources(html) {
  var out = [], seen = {};
  extractAnchors(html).forEach(function(x) {
    var host = externalHost(x.url, x.text);
    if (!host || seen[x.url]) return;
    seen[x.url] = true;
    out.push({ host: host, url: x.url });
  });
  // Also inspect raw HTML/JS for source URLs that are not anchors.
  var re = /(https?:\\/\\/[^\"'<>\\s]+|\\/\\/[^\"'<>\\s]+)/gi, m;
  while ((m = re.exec(String(html || "")))) {
    var raw = m[1].replace(/&amp;/g, "&");
    var host = externalHost(raw, "");
    if (!host) continue;
    var url = /^https?:/i.test(raw) ? raw : "https:" + raw;
    if (seen[url]) continue;
    seen[url] = true;
    out.push({ host: host, url: url });
  }
  return out;
}
function makeStream(host, url, quality, referer) {
  return {
    name: "PinoyMoviesHub",
    title: host + (quality !== "Auto" ? " • " + quality : ""),
    url: url,
    quality: quality || "Auto",
    headers: { Referer: referer || BASE },
    subtitles: []
  };
}
function metaFor(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  return fetchJson(TMDB_BASE + "/" + type + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_KEY + "&append_to_response=external_ids")
    .then(function(d) {
      var title = type === "tv" ? (d.name || d.original_name || "") : (d.title || d.original_title || "");
      var originalTitle = d.original_title || d.original_name || title;
      var date = d.release_date || d.first_air_date || "";
      return { title: title, originalTitle: originalTitle, year: date ? parseInt(String(date).slice(0,4), 10) : null };
    });
}
function scrape(ctx) {
  return metaFor(ctx.tmdbId, ctx.mediaType).then(function(meta) {
    if (!meta.title) return [];
    var query = meta.title;
    var searchUrls = [];
    if (ctx.isTv && ctx.season != null && ctx.episode != null) {
      query += " S" + String(ctx.season).padStart(2, "0") + "E" + String(ctx.episode).padStart(2, "0");
    }
    searchUrls.push(BASE + "/?s=" + encodeURIComponent(query));
    searchUrls.push(BASE + "/?s=" + encodeURIComponent(meta.title));

    var results = [];
    var i = 0;
    function searchNext() {
      if (results.length || i >= searchUrls.length) return Promise.resolve();
      return fetchText(searchUrls[i++]).then(function(html) {
        results = extractResults(html);
      }).catch(function() {}).then(searchNext);
    }
    return searchNext().then(function() {
      var chosen = choose(results, { title: meta.title, year: meta.year });
      var detailPromise;
      if (chosen) detailPromise = fetchText(chosen.url).then(function(h) { return { html: h, referer: chosen.url }; });
      else {
        var slug = normalizeTitle(meta.title).replace(/\s+/g, "-");
        detailPromise = fetchText(BASE + "/movies/" + slug).then(function(h) {
          return { html: h, referer: BASE + "/movies/" + slug };
        }).catch(function() {
          return fetchText(BASE + "/series/" + slug).then(function(h) {
            return { html: h, referer: BASE + "/series/" + slug };
          });
        });
      }
      return detailPromise.then(function(page) {
        var quality = /\b1080p\b/i.test(page.html) ? "1080p" : /\b720p\b/i.test(page.html) ? "720p" : /\b(2160p|4k)\b/i.test(page.html) ? "4K" : "Auto";
        var streams = extractSources(page.html).map(function(s) {
          return makeStream(s.host, s.url, quality, page.referer);
        });
        var unique = {}, out = [];
        streams.forEach(function(s) { if (s && s.url && !unique[s.url]) { unique[s.url] = true; out.push(s); } });
        return out;
      });
    });
  });
}
function getStreams(tmdbId, mediaType, season, episode) {
  return scrape({
    tmdbId: String(tmdbId),
    mediaType: mediaType === "tv" ? "tv" : "movie",
    season: season == null ? null : season,
    episode: episode == null ? null : episode
  }).catch(function(e) {
    try { console.log("[PinoyMoviesHub] " + (e && e.message ? e.message : e)); } catch (_) {}
    return [];
  });
}
module.exports = { getStreams: getStreams };
