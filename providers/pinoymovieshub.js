/*
 * PinoyMoviesHub Nuvio Provider
 *
 * Purpose:
 *   - Resolve a TMDB movie/TV id to a title using Cinemeta's public metadata endpoint.
 *   - Search PinoyMoviesHub using its normal site search.
 *   - Match a result and parse its public detail page.
 *   - Return the public "Watch Online" source-page links exposed by the site.
 *
 * Important:
 *   - This provider does NOT bypass DRM, CAPTCHAs, login walls, tokens, or
 *     anti-bot protections on third-party hosts.
 *   - The returned URLs are the public source pages advertised by PinoyMoviesHub.
 *
 * Nuvio runtime notes:
 *   - Uses Promise chains for Hermes compatibility.
 *   - No Node-only APIs.
 */

var BASE = "https://pinoymovieshub.win";
var CINEMETA = "https://v3-cinemeta.strem.io/meta";

function log(msg) {
  try { console.log("[PinoyMoviesHub] " + msg); } catch (e) {}
}

function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[‘’“”"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(s) {
  return decodeHtml(String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function absUrl(href) {
  if (!href) return null;
  href = decodeHtml(href).trim();
  if (/^https?:\/\//i.test(href)) return href;
  if (href.charAt(0) === "/") return BASE + href;
  return BASE + "/" + href;
}

function fetchText(url, headers) {
  return fetch(url, {
    headers: Object.assign({
      "User-Agent": "Mozilla/5.0 (compatible; Nuvio PinoyMoviesHub Provider/1.0)",
      "Accept": "text/html,application/xhtml+xml"
    }, headers || {})
  }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
    return r.text();
  });
}

function getCinemetaMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "series" : "movie";
  return fetch(CINEMETA + "/" + kind + "/" + encodeURIComponent(String(tmdbId)) + ".json")
    .then(function (r) {
      if (!r.ok) throw new Error("Cinemeta HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.meta) throw new Error("No Cinemeta metadata");
      return data.meta;
    });
}

function extractResultCards(html) {
  var results = [];
  var seen = {};

  var re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,5000}?)<\/a>/gi;
  var m;

  while ((m = re.exec(html))) {
    var href = m[1];
    var block = m[2];

    if (!\/(movies|series)\//i.test(href)) continue;

    var titleMatch =
      block.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) ||
      block.match(/class=["'][^"']*(?:title|title-in)[^"']*["'][^>]*>([\s\S]*?)<\//i);

    var title = titleMatch ? stripTags(titleMatch[1]) : stripTags(block).slice(0, 160);
    title = title.replace(/\s+/g, " ").trim();

    if (!title) continue;

    var url = absUrl(href);
    if (!url || seen[url]) continue;
    seen[url] = true;

    results.push({ title: title, url: url });
  }

  return results;
}

function scoreTitle(target, candidate) {
  var a = normalizeTitle(target);
  var b = normalizeTitle(candidate);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.indexOf(a) >= 0 || a.indexOf(b) >= 0) return 85;

  var aw = a.split(" ");
  var bw = b.split(" ");
  var hit = 0;
  for (var i = 0; i < aw.length; i++) {
    if (aw[i].length >= 3 && bw.indexOf(aw[i]) >= 0) hit++;
  }
  return Math.round((hit / Math.max(aw.length, 1)) * 70);
}

function chooseResult(results, targetTitle, year) {
  var best = null;
  var bestScore = -1;

  results.forEach(function (r) {
    var score = scoreTitle(targetTitle, r.title);
    if (year && String(r.title).indexOf(String(year)) >= 0) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  });

  return bestScore >= 45 ? best : null;
}

function extractDetail(pageUrl, html, meta) {
  var sources = [];
  var sourceSeen = {};

  var sourceRe = /(?:Watch\s+Online|watch)[^<]{0,100}?(Doodstream|Mixdrop|Byse)[\s\S]{0,500}?<a[^>]+href=["']([^"']+)["']/gi;
  var m;

  while ((m = sourceRe.exec(html))) {
    var host = m[1];
    var href = absUrl(m[2]);
    if (!href || sourceSeen[href]) continue;
    sourceSeen[href] = true;

    sources.push({
      host: host,
      url: href
    });
  }

  if (!sources.length) {
    var anchorRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = anchorRe.exec(html))) {
      var label = stripTags(m[2]);
      if (!/watch online/i.test(label)) continue;

      var hostName = "";
      if (/doodstream/i.test(label)) hostName = "Doodstream";
      else if (/mixdrop/i.test(label)) hostName = "Mixdrop";
      else if (/byse/i.test(label)) hostName = "Byse";
      if (!hostName) continue;

      var u = absUrl(m[1]);
      if (!u || sourceSeen[u]) continue;
      sourceSeen[u] = true;
      sources.push({ host: hostName, url: u });
    }
  }

  var quality = "Unknown";
  if (/\b1080p\b/i.test(html)) quality = "1080p";
  else if (/\b720p\b/i.test(html)) quality = "720p";
  else if (/\b4k\b/i.test(html) || /\b2160p\b/i.test(html)) quality = "4K";

  return sources.map(function (s) {
    return {
      name: "PinoyMoviesHub",
      title: s.host + " source page" + (quality !== "Unknown" ? " • " + quality : ""),
      url: s.url,
      quality: quality
    };
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  log("Request: tmdbId=" + tmdbId + ", type=" + mediaType +
      ", season=" + season + ", episode=" + episode);

  return getCinemetaMeta(tmdbId, mediaType)
    .then(function (meta) {
      var title = meta.name || meta.title || "";
      var year = meta.year || (meta.releaseInfo ? String(meta.releaseInfo).slice(0, 4) : "");

      if (!title) throw new Error("Could not determine title from metadata");

      var searchTitle = title;
      if (mediaType === "tv" && season != null && episode != null) {
        searchTitle += " " +
          "S" + ("0" + season).slice(-2) +
          "E" + ("0" + episode).slice(-2);
      }

      log("Searching: " + searchTitle);

      var url = BASE + "/?s=" + encodeURIComponent(searchTitle);

      return fetchText(url).then(function (html) {
        var results = extractResultCards(html);
        log("Search results: " + results.length);

        var chosen = chooseResult(results, title, year);
        if (!chosen) chosen = results.length ? results[0] : null;
        if (!chosen) throw new Error("No PinoyMoviesHub match found for " + title);

        log("Selected: " + chosen.title + " -> " + chosen.url);

        return fetchText(chosen.url).then(function (detail) {
          var streams = extractDetail(chosen.url, detail, meta);
          log("Discovered " + streams.length + " public source link(s)");
          return streams;
        });
      });
    })
    .catch(function (err) {
      log("Error: " + (err && err.message ? err.message : String(err)));
      return [];
    });
}

module.exports = {
  getStreams: getStreams
};
