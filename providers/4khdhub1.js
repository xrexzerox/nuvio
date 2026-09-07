/**
 * 4KHDHub Nuvio Plugin - Ultimate Edition
 * Domain: 4khdhub.link
 * Supports: Movies & TV Shows
 * Resolvers: HubCloud, HubDrive, HubCDN, PixelDrain, Workers.dev, R2.dev, FSL, GDrive, Direct
 * Author: Enhanced by AI
 * Version: 3.0.0
 */

var cheerio = require("cheerio-without-node-native");

var PROVIDER_NAME = "4KHDHub";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var DEFAULT_DOMAIN = "https://4khdhub.link";

var FALLBACK_DOMAINS = [
  "https://4khdhub.link",
  "https://4khdhub.dad",
  "https://4khdhub.fans"
];

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1"
};

var cachedDomain = null;
var domainCacheTime = 0;
var DOMAIN_CACHE_TTL = 30 * 60 * 1000;

// ===== UTILITY FUNCTIONS =====

function merge(obj1, obj2) {
  var out = {};
  var k;
  for (k in obj1 || {}) out[k] = obj1[k];
  for (k in obj2 || {}) out[k] = obj2[k];
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
    if (!res.ok && res.status !== 301 && res.status !== 302) {
      throw new Error("HTTP " + res.status);
    }
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
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

function fetchResponse(url, options) {
  options = options || {};
  return fetch(url, {
    method: options.method || "GET",
    redirect: options.redirect || "follow",
    headers: merge(HEADERS, options.headers || {}),
    body: options.body
  });
}

function fixUrl(url, baseUrl) {
  if (!url) return "";
  if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  if (!baseUrl) return url;
  try {
    return new URL(url, baseUrl).toString();
  } catch (e) {
    return url;
  }
}

function normalizeTitle(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function decodeBase64(value) {
  try {
    return atob(value);
  } catch (e) {
    return "";
  }
}

function rot13(value) {
  return String(value || "").replace(/[A-Za-z]/g, function(char) {
    var base = char <= "Z" ? 65 : 97;
    return String.fromCharCode((char.charCodeAt(0) - base + 13) % 26 + base);
  });
}

function levenshteinDistance(s, t) {
  if (s === t) return 0;
  var n = s.length, m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;
  var d = [];
  var i, j, cost;
  for (i = 0; i <= n; i++) { d[i] = []; d[i][0] = i; }
  for (j = 0; j <= m; j++) d[0][j] = j;
  for (i = 1; i <= n; i++) {
    for (j = 1; j <= m; j++) {
      cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
      d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+cost);
    }
  }
  return d[n][m];
}

function parseQuality(text) {
  var value = String(text || "").toLowerCase();
  var m = value.match(/\b(2160p|1440p|1080p|720p|480p|360p)\b/);
  if (m) return m[1];
  if (/\b4k\b/.test(value) && !/\b1080p\b/.test(value)) return "2160p";
  if (/\buhd\b/.test(value)) return "2160p";
  return "Auto";
}

function inferLang(text) {
  var t = String(text || "").toLowerCase();
  var langs = [];
  if (t.indexOf("hindi") !== -1) langs.push("Hindi");
  if (t.indexOf("tamil") !== -1) langs.push("Tamil");
  if (t.indexOf("telugu") !== -1) langs.push("Telugu");
  if (t.indexOf("malayalam") !== -1) langs.push("Malayalam");
  if (t.indexOf("kannada") !== -1) langs.push("Kannada");
  if (t.indexOf("bengali") !== -1) langs.push("Bengali");
  if (t.indexOf("punjabi") !== -1) langs.push("Punjabi");
  if (t.indexOf("english") !== -1 || /\beng\b/.test(t)) langs.push("English");
  if (t.indexOf("spanish") !== -1 || t.indexOf("espanol") !== -1) langs.push("Spanish");
  if (t.indexOf("french") !== -1) langs.push("French");
  if (t.indexOf("german") !== -1) langs.push("German");
  if (t.indexOf("italian") !== -1) langs.push("Italian");
  if (t.indexOf("korean") !== -1) langs.push("Korean");
  if (t.indexOf("japanese") !== -1) langs.push("Japanese");
  if (t.indexOf("chinese") !== -1) langs.push("Chinese");
  if (t.indexOf("turkish") !== -1) langs.push("Turkish");
  if (t.indexOf("portuguese") !== -1) langs.push("Portuguese");
  if (t.indexOf("arabic") !== -1) langs.push("Arabic");
  langs = uniqueArray(langs);
  if (langs.length > 2) return "Multi Audio";
  if (langs.length === 2) return langs.join("-");
  if (langs.length === 1) return langs[0];
  if (t.indexOf("dual audio") !== -1 || t.indexOf("dual") !== -1) return "Dual Audio";
  return "EN";
}

function cleanTech(title) {
  var normalized = String(title || "")
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/WEB[-_. ]?DL/gi, "WEB-DL")
    .replace(/WEB[-_. ]?RIP/gi, "WEBRIP")
    .replace(/H[ .]?265/gi, "H265")
    .replace(/H[ .]?264/gi, "H264")
    .replace(/DDP[ .]?([0-9]\.[0-9])/gi, "DDP$1")
    .replace(/DTS[-_. ]?HD[-_. ]?MA/gi, "DTSHDMA")
    .replace(/DOLBY[-_. ]?VISION/gi, "DOLBYVISION");
  var allowed = {
    "WEB-DL":1,"WEBRIP":1,"BLURAY":1,"HDRIP":1,"DVDRIP":1,"HDTV":1,
    "CAM":1,"TS":1,"BRRIP":1,"BDRIP":1,"REMUX":1,
    "H264":1,"H265":1,"X264":1,"X265":1,"HEVC":1,"AVC":1,
    "AAC":1,"AC3":1,"DTS":1,"DTSHDMA":1,"TRUEHD":1,"ATMOS":1,
    "DD":1,"HDR":1,"HDR10":1,"HDR10+":1,"DV":1,"DOLBYVISION":1,
    "NF":1,"CR":1,"SDR":1,"IMAX":1,"REMUX":1
  };
  var parts = normalized.split(/[ ._()\[\]+-]+/);
  var out = [];
  var seen = {};
  var i, part;
  for (i = 0; i < parts.length; i++) {
    part = String(parts[i] || "").toUpperCase();
    if (!part) continue;
    if (allowed[part] || /^DDP\d\.\d$/.test(part)) {
      if (!seen[part]) { seen[part] = 1; out.push(part); }
    }
  }
  return out.join(" ");
}

function extractSize(text) {
  var m = String(text || "").match(/\b(\d+(?:\.\d+)?)\s*(GB|MB)\b/i);
  return m ? (m[1] + " " + m[2].toUpperCase()) : "";
}

function cleanLabel(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/Download HubDrive/gi, "")
    .replace(/Download HubCloud/gi, "")
    .replace(/Download PixelDrain/gi, "")
    .replace(/Download BuzzServer/gi, "")
    .replace(/4kHDHub\.Com/gi, "")
    .replace(/4kHdHub\.com/gi, "")
    .trim();
}

function uniqueArray(arr) {
  var seen = {};
  var out = [];
  var i;
  for (i = 0; i < arr.length; i++) {
    if (!seen[arr[i]]) {
      seen[arr[i]] = 1;
      out.push(arr[i]);
    }
  }
  return out;
}

function uniqueBy(list, keyFn) {
  var seen = {};
  var out = [];
  var i, key;
  for (i = 0; i < list.length; i++) {
    key = keyFn(list[i]);
    if (seen[key]) continue;
    seen[key] = 1;
    out.push(list[i]);
  }
  return out;
}

function isPlayableUrl(url) {
  var u = String(url || "").toLowerCase();
  if (!u) return false;
  // gamerxyt URLs need POST resolution - don't treat as direct
  if (u.indexOf("gamerxyt.com") !== -1) return false;
  if (/\.(mkv|mp4|m3u8)(\?|#|$)/.test(u)) return true;
  if (u.indexOf("video-downloads.googleusercontent.com/") !== -1) return true;
  if (u.indexOf(".r2.dev/") !== -1) return true;
  if (u.indexOf(".workers.dev/") !== -1) return true;
  if (u.indexOf("hub.lotuscdn.club/") !== -1) return true;
  if (u.indexOf("hub.yummy.monster/") !== -1) return true;
  if (u.indexOf("hub.odyssey.surf/") !== -1) return true;
  if (u.indexOf("hub.maverick.lat/") !== -1) return true;
  if (u.indexOf("cdn.fukggl.buzz/") !== -1) return true;
  if (u.indexOf("hub.diskcdn.buzz/") !== -1) return true;
  if (u.indexOf("goldmines") !== -1 && u.indexOf(".workers.dev") !== -1) return true;
  if (u.indexOf("pub-") !== -1 && u.indexOf(".r2.dev/") !== -1) return true;
  return false;
}

function hostPriority(url) {
  var u = String(url || "").toLowerCase();
  if (u.indexOf("hub.lotuscdn.club") !== -1) return 95;
  if (u.indexOf("hub.yummy.monster") !== -1) return 95;
  if (u.indexOf("hub.odyssey.surf") !== -1) return 95;
  if (u.indexOf("hub.maverick.lat") !== -1) return 94;
  if (u.indexOf("cdn.fukggl.buzz") !== -1) return 93;
  if (u.indexOf("hub.diskcdn.buzz") !== -1) return 93;
  if (u.indexOf("hubcdn") !== -1) return 80;
  if (u.indexOf("hblinks") !== -1) return 60;
  if (u.indexOf("hubcloud") !== -1) return 50;
  if (u.indexOf("hubdrive") !== -1) return 30;
  if (u.indexOf("gamerxyt.com") !== -1) return 28;  // GDrive proxy
  if (u.indexOf(".workers.dev") !== -1) return 25;
  if (u.indexOf(".r2.dev") !== -1) return 22;
  if (u.indexOf("video-downloads.googleusercontent.com/") !== -1) return 10;
  if (u.indexOf("pixeldrain") !== -1) return 15;
  return 5;
}

function sortByPriority(streams) {
  return (streams || []).slice().sort(function(a, b) {
    return hostPriority(b.url) - hostPriority(a.url);
  });
}

// ===== DOMAIN MANAGEMENT =====

function probeDomain(domain) {
  return fetch(domain + "/", {
    method: "HEAD",
    redirect: "follow",
    headers: HEADERS
  }).then(function(res) {
    return res.ok || res.status === 200 || res.status === 301 || res.status === 302;
  }).catch(function() {
    return false;
  });
}

function getActiveDomain() {
  var now = Date.now();
  if (cachedDomain && now - domainCacheTime < DOMAIN_CACHE_TTL) {
    return Promise.resolve(cachedDomain);
  }
  return Promise.all(FALLBACK_DOMAINS.map(function(domain) {
    return probeDomain(domain).then(function(ok) {
      return { domain: domain, ok: ok };
    });
  })).then(function(results) {
    var i;
    for (i = 0; i < results.length; i++) {
      if (results[i].ok) {
        cachedDomain = results[i].domain;
        domainCacheTime = now;
        return cachedDomain;
      }
    }
    cachedDomain = DEFAULT_DOMAIN;
    domainCacheTime = now;
    return cachedDomain;
  });
}

// ===== TMDB =====

function getTmdbInfo(tmdbId, mediaType) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
  return fetchJson(url).then(function(data) {
    var title = data.name || data.title || "";
    var original = data.original_name || data.original_original || title;
    var year = (data.release_date || data.first_air_date || "").split("-")[0];
    return {
      title: title,
      original: original,
      year: year
    };
  }).catch(function() {
    return { title: "", original: "", year: "" };
  });
}

function getTmdbEpisodeTitle(tmdbId, season, episode) {
  if (!season || !episode) return Promise.resolve("");
  var url = "https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "?api_key=" + TMDB_API_KEY;
  return fetchJson(url).then(function(data) {
    return data.name || "";
  }).catch(function() {
    return "";
  });
}

// ===== SEARCH =====

function searchContent(query, year, mediaType) {
  return getActiveDomain().then(function(domain) {
    var searchQuery = query;
    if (year) searchQuery += " " + year;
    var searchUrl = domain + "/?s=" + encodeURIComponent(searchQuery);
    console.log("[4KHDHub] Searching:", searchUrl);
    return fetchText(searchUrl).then(function(html) {
      var $ = cheerio.load(html);
      var results = [];
      var selectors = [
        "div.card-grid a.movie-card",
        "a.movie-card",
        "div.card-grid a[href]",
        "div.result-item a",
        "article.post a.lnk-blk",
        "div.TPost a",
        "div.TPostMv a",
        "ul.MovieList li a",
        "div.card-grid-small a"
      ].join(", ");

      $(selectors).each(function(_, el) {
        var href = fixUrl($(el).attr("href"), domain);
        if (!href) return;
        if (/(\/category\/|\/tag\/|\/author\/|\/page\/|\/feed\/|\/wp-admin\/|\/wp-login\/|\/about\/|\/contact\/|\/dmca\/|\/privacy\/)/i.test(href)) return;
        if (href === domain + "/" || href === domain) return;
        try {
          if (new URL(href).hostname !== new URL(domain).hostname) return;
        } catch(e) {}

        var title = $(el).find(".movie-card-title, h2, h3, h4, .entry-title, .title").first().text().trim() ||
          $(el).attr("title") || $(el).attr("aria-label") ||
          $(el).find("img").attr("alt") || $(el).text().trim();
        if (!title || title.length < 2) return;

        var combinedText = (title + " " + href).toLowerCase();
        var isSeries = /\bseries\b/i.test(title) ||
          /-series-?\d*/i.test(href) ||
          /\/series\//i.test(href) ||
          /\bseason\s*\d+\b/i.test(combinedText);

        if (mediaType === "movie" && isSeries) return;
        if (mediaType !== "movie" && !isSeries) return;

        var cleanedTitle = String(title).replace(/\[.*?\[\]()\]/g, "").replace(/\s+details$/i, "").trim();
        var yearMatch = combinedText.match(/\b(19|20)\d{2}\b/);
        var itemYear = yearMatch ? parseInt(yearMatch[0], 10) : 0;
        var distance = levenshteinDistance(normalizeTitle(cleanedTitle), normalizeTitle(query));
        var yearDistance = year && itemYear ? Math.abs(itemYear - year) : 0;
        var exactBoost = normalizeTitle(cleanedTitle) === normalizeTitle(query) ? -100 : 0;
        var includesBoost = normalizeTitle(cleanedTitle).indexOf(normalizeTitle(query)) !== -1 ? -10 : 0;

        results.push({
          href: href,
          title: cleanedTitle,
          year: itemYear,
          score: distance + yearDistance + exactBoost + includesBoost
        });
      });

      if (!results.length) return null;
      results.sort(function(a, b) {
        return a.score - b.score;
      });
      console.log("[4KHDHub] Best match:", results[0].title, "->", results[0].href);
      return results[0].href;
    });
  });
}

// ===== REDIRECT DECODER =====

function getRedirectLinks(url) {
  var REDIRECT_REGEX = /s\('o','([A-Za-z0-9+/=]+)'\)|ck\('_wp_http_\d+','([^']+)'\)/g;
  return fetchText(url).then(function(html) {
    var combined = "";
    var match;
    while ((match = REDIRECT_REGEX.exec(html)) !== null) {
      combined += match[1] || match[2] || "";
    }
    if (!combined) return "";
    try {
      var decoded = decodeBase64(rot13(decodeBase64(decodeBase64(combined))));
      var json = JSON.parse(decoded);
      var direct = decodeBase64(json.o || "").trim();
      if (direct) return direct;
      var data = decodeBase64(json.data || "");
      var blogUrl = json.blog_url || "";
      if (!data || !blogUrl) return "";
      return fetchText(blogUrl + "?re=" + encodeURIComponent(data)).then(function(txt) {
        return String(txt || "").trim();
      }).catch(function() { return ""; });
    } catch(e) { return ""; }
  }).catch(function() { return ""; });
}

// ===== LINK COLLECTION =====

function collectMovieLinks($, pageUrl) {
  var links = [];
  $("div.download-item, div[data-file-id]").each(function(_, el) {
    var root = $(el);
    var href = fixUrl(root.find("a[href]").first().attr("href"), pageUrl);
    var label = cleanLabel(root.text().trim() || "Movie");
    var fileTitle = cleanLabel(root.find(".file-title").first().text().trim() || "");
    if (!href) return;
    links.push({ url: href, label: label, fileTitle: fileTitle, rawHtml: root.html() || "" });
  });

  if (!links.length) {
    var ALT = [
      "div.download-links a[href]",
      "div.gdlink a[href]",
      "div.dllinks a[href]",
      "div.movie-download a[href]",
      "div.movie-card-content a[href]",
      "div.entry-content p a[href]",
      "div.thecontent p a[href]",
      "table.table a[href]",
      "div.box-content a[href]",
      "div.wp-block-buttons a[href]",
      "p > a[href]"
    ].join(", ");
    $(ALT).each(function(_, el) {
      var href = fixUrl($(el).attr("href"), pageUrl);
      if (!href) return;
      var lower = href.toLowerCase();
      var isHoster = lower.indexOf("hubcloud") !== -1 || lower.indexOf("hubdrive") !== -1 ||
        lower.indexOf("hubcdn") !== -1 || lower.indexOf("workers.dev") !== -1 ||
        lower.indexOf("r2.dev") !== -1 || /\.(mp4|mkv|m3u8)(\?|$)/i.test(lower);
      if (!isHoster) return;
      var label = cleanLabel(
        $(el).closest("p, div, li, tr, td").first().text().trim() ||
        $(el).text().trim() || "Movie"
      );
      links.push({ url: href, label: label, fileTitle: cleanLabel($(el).text().trim() || ""), rawHtml: $(el).parent().html() || "" });
    });
  }

  if (!links.length) {
    $("a[href]").each(function(_, el) {
      var href = fixUrl($(el).attr("href"), pageUrl);
      if (!href) return;
      var lower = href.toLowerCase();
      var isHoster = lower.indexOf("hubcloud") !== -1 || lower.indexOf("hubdrive") !== -1 ||
        lower.indexOf("hubcdn") !== -1 || lower.indexOf("workers.dev") !== -1 ||
        lower.indexOf("r2.dev") !== -1 || /\.(mp4|mkv|m3u8)(\?|$)/i.test(lower);
      if (!isHoster) return;
      var label = cleanLabel(
        $(el).closest("p, div, li").first().text().trim() ||
        $(el).text().trim() || "Movie"
      );
      links.push({ url: href, label: label, fileTitle: cleanLabel($(el).text().trim() || ""), rawHtml: $(el).parent().html() || "" });
    });
  }

  return uniqueBy(links, function(item) { return String(item.url || "").toLowerCase(); });
}

function collectEpisodeLinks($, pageUrl, season, episode) {
  var sNum = Number(season);
  var eNum = Number(episode);
  var label = "S" + sNum + " E" + eNum;
  var found = [];

  $("div.episodes-list div.season-item").each(function(_, seasonEl) {
    var seasonText = $(seasonEl).find("div.episode-number").first().text();
    var seasonMatch = seasonText.match(/S(?:eason)?\s*([0-9]+)/i);
    if (!seasonMatch || Number(seasonMatch[1]) !== sNum) return;
    $(seasonEl).find("div.episode-download-item").each(function(_, episodeEl) {
      var epText = $(episodeEl).text();
      var epMatch = epText.match(/Episode-?\s*0*([0-9]+)/i) || epText.match(/\bE\s*0*([0-9]+)/i);
      if (!epMatch || Number(epMatch[1]) !== eNum) return;
      $(episodeEl).find("a[href]").each(function(_, a) {
        var href = fixUrl($(a).attr("href"), pageUrl);
        if (!href) return;
        found.push({
          url: href,
          label: label,
          fileTitle: cleanLabel($(episodeEl).find(".file-title, .episode-file-title").first().text().trim() || ""),
          rawHtml: $(episodeEl).html() || ""
        });
      });
    });
  });

  if (!found.length) {
    $("div.episode-download-item").each(function(_, item) {
      var text = $(item).text();
      if (!new RegExp("Episode-?\s*0*" + eNum + "\b", "i").test(text) &&
          !new RegExp("\bE\s*0*" + eNum + "\b", "i").test(text)) return;
      $(item).find("a[href]").each(function(_, a) {
        var href = fixUrl($(a).attr("href"), pageUrl);
        if (!href) return;
        found.push({
          url: href,
          label: label,
          fileTitle: cleanLabel($(item).find(".file-title, .episode-file-title").first().text().trim() || ""),
          rawHtml: $(item).html() || ""
        });
      });
    });
  }

  return uniqueBy(found, function(item) { return String(item.url || "").toLowerCase(); });
}

// ===== STREAM BUILDER =====

function buildStream(label, url, quality, headers, size, tech, langHint, meta) {
  var cleanedLabel = cleanLabel(label);
  var lang = inferLang((langHint || "") + " " + cleanedLabel);
  var displayTitle = (meta && meta.title) ? meta.title : "Movie";
  var year = (meta && meta.year) ? " (" + meta.year + ")" : "";
  var isSeries = !!(meta && (meta.season || meta.episode));

  var line1, line2, line3;
  if (isSeries) {
    var epPart = meta.episodeTitle ? " - " + meta.episodeTitle : "";
    line1 = "📺 S" + meta.season + "E" + meta.episode + epPart + " | " + displayTitle + year;
  } else {
    line1 = "🎬 " + displayTitle + year;
  }

  var qIcon = (quality.indexOf("2160") !== -1 || quality.indexOf("4K") !== -1) ? "💎" : "📺";
  line2 = qIcon + " " + quality + " | 🌍 " + lang + (size ? " | 💾 " + size : "");

  var extMatch = cleanedLabel.match(/\.(mkv|mp4|m4v|avi|mov)$/i);
  var extension = extMatch ? extMatch[1].toUpperCase() : "MKV";
  line3 = "🎞️ " + extension + " | ℹ️ " + (tech || "WEB-DL");

  return {
    name: "4KHDHub | " + quality + (size ? " | " + size : ""),
    title: line1 + "\n" + line2 + "\n" + line3,
    url: url,
    quality: quality,
    headers: Object.keys(headers || {}).length ? headers : undefined,
    behaviorHints: {
      bingeGroup: "4khdhub-" + String(quality || "auto").toLowerCase()
    }
  };
}

// ===== RESOLVERS =====

function resolveHubcdn(url, label, quality, size, tech, langHint, meta) {
  return fetchText(url, { headers: { Referer: url } }).then(function(html) {
    var encoded = "";
    var match1 = html.match(/r=([A-Za-z0-9+/=]+)/);
    var match2 = html.match(/reurl\s*=\s*"([^"]+)"/);
    if (match1 && match1[1]) encoded = match1[1];
    else if (match2 && match2[1]) encoded = match2[1].split("?r=").pop();
    if (!encoded) return [];
    var decoded = decodeBase64(encoded);
    if (!decoded) return [];
    var finalUrl = decoded.split("link=").pop();
    if (!finalUrl || finalUrl === encoded) return [];
    return [buildStream(label + " HUBCDN", finalUrl, quality, { Referer: url }, size, tech, langHint, meta)];
  }).catch(function() { return []; });
}

function resolveHubdrive(url, label, quality, meta) {
  var lower = String(url || "").toLowerCase();
  if (lower.indexOf("hubdrive.space") !== -1) {
    console.log("[4KHDHub] HubDrive.space requires login - skipping");
    return Promise.resolve([]);
  }

  return fetchText(url, { headers: { Referer: url } }).then(function(html) {
    var $ = cheerio.load(html);
    var title = $("title").first().text().trim();

    if (title.indexOf("Sign in - Google") !== -1 ||
        title.indexOf("accounts.google.com") !== -1 ||
        html.indexOf("accounts.google.com/signin") !== -1) {
      console.log("[4KHDHub] Google login wall on HubDrive");
      return [];
    }

    if (/hubdrive.*G-Drive File Sharing/i.test(title) &&
        html.indexOf("logout") !== -1 &&
        html.indexOf("download") === -1) {
      console.log("[4KHDHub] HubDrive login redirect");
      return [];
    }

    var candidates = [];
    $("a[href]").each(function(_, el) {
      var href = fixUrl($(el).attr("href"), url);
      var text = $(el).text().trim().toLowerCase();
      if (!href) return;
      var lowerHref = href.toLowerCase();
      if (lowerHref.indexOf("drive.google") !== -1 ||
          lowerHref.indexOf("googleusercontent") !== -1 ||
          lowerHref.indexOf("hubcloud") !== -1 ||
          lowerHref.indexOf("workers.dev") !== -1 ||
          lowerHref.indexOf(".r2.dev") !== -1 ||
          lowerHref.indexOf("/download") !== -1 ||
          /\.(mkv|mp4|m3u8)(\?|#|$)/i.test(lowerHref) ||
          text.indexOf("download") !== -1) {
        if (lowerHref.indexOf("/login") !== -1 ||
            lowerHref.indexOf("/register") !== -1 ||
            lowerHref.indexOf("javascript") !== -1 ||
            href === url) return;
        candidates.push(href);
      }
    });

    if (!candidates.length) {
      var downloadBtn = $("form[action]").attr("action") || $("a.btn[href]").first().attr("href");
      if (downloadBtn) {
        return resolveLink(fixUrl(downloadBtn, url), label, url, quality, "", meta);
      }
      return [];
    }

    candidates.sort(function(a, b) { return hostPriority(b) - hostPriority(a); });
    var best = candidates[0];

    if (best.toLowerCase().indexOf("hubdrive") !== -1 && best !== url) {
      return resolveHubdrive(best, label, quality, meta);
    }
    return resolveLink(best, label, url, quality, "", meta);
  }).catch(function(e) {
    console.log("[4KHDHub] HubDrive error:", e.message);
    return [];
  });
}

function resolve10Gbps(url, label, quality, size, tech, langHint, meta) {
  function step(current, depth) {
    if (depth >= 6) return Promise.resolve([]);
    return fetchResponse(current, {
      redirect: "manual",
      headers: { Referer: current }
    }).then(function(res) {
      var finalUrl = res.url || current;
      var contentType = String(res.headers.get("content-type") || "").toLowerCase();
      var location = res.headers.get("location") || "";
      if (location) {
        return step(fixUrl(location, current), depth + 1);
      }
      if (isPlayableUrl(finalUrl) || contentType.indexOf("video/") !== -1) {
        return [buildStream(label + " 10Gbps", finalUrl, quality, { Referer: current }, size, tech, langHint, meta)];
      }
      return [];
    }).catch(function() { return []; });
  }
  return step(url, 0);
}

function resolveHubcloud(url, label, referer, quality, langHint, meta) {
  var baseHeaders = referer ? { Referer: referer } : {};
  return fetchText(url, { headers: baseHeaders }).then(function(html) {
    var $ = cheerio.load(html);
    var raw = $("#download").attr("href") || $("a[href*='hubcloud']").attr("href") || $("iframe[src*='hubcloud']").attr("src");
    var entryUrl = fixUrl(raw, url);
    if (!entryUrl) return [];

    return fetchText(entryUrl, { headers: { Referer: url } }).then(function(eHtml) {
      var e$ = cheerio.load(eHtml);
      var size = e$("#size").text().trim() || "";
      var header = e$(".card-header").text().trim() || "";
      var tech = cleanTech(header);
      var finalQuality = parseQuality(header + " " + quality);

      var asyncTasks = [];
      var directStreams = [];

      e$("a.btn").each(function(_, el) {
        var link = fixUrl(e$(el).attr("href"), entryUrl);
        var text = e$(el).text().toLowerCase();
        if (!link) return;

        if (text.indexOf("buzzserver") !== -1) {
          asyncTasks.push(
            fetchResponse(link + "/download", { headers: { Referer: link }, redirect: "manual" })
            .then(function(res) {
              var redir = res.headers.get("location");
              return redir ? [buildStream(label + " Buzz", redir, finalQuality, { Referer: link }, size, tech, langHint, meta)] : [];
            }).catch(function() { return []; })
          );
        } else if (text.indexOf("10gbps") !== -1 || link.indexOf("gpdl.hubcloud") !== -1) {
          asyncTasks.push(resolve10Gbps(link, label, finalQuality, size, tech, langHint, meta));
        } else if (isPlayableUrl(link) || /\.(mkv|mp4|m3u8)(\?|#|$)/i.test(link.toLowerCase())) {
          directStreams.push(buildStream(label, link, finalQuality, { Referer: entryUrl }, size, tech, langHint, meta));
        }
      });

      return Promise.all(asyncTasks).then(function(results) {
        var all = directStreams.slice();
        var i;
        for (i = 0; i < results.length; i++) all = all.concat(results[i] || []);
        return all;
      });
    });
  }).catch(function() { return []; });
}

function resolveGamerxyt(url, label, quality, langHint, meta) {
  // gamerxyt.com/dl.php?link=... requires a POST to resolve the actual redirect
  return fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: merge(HEADERS, {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": url
    })
  }).then(function(res) {
    var location = res.headers.get("location") || "";
    if (location) {
      // Follow the redirect chain
      return fetchResponse(location, { redirect: "manual", headers: { Referer: url } }).then(function(r2) {
        var loc2 = r2.headers.get("location") || "";
        if (loc2) return loc2;
        return r2.url || location;
      }).catch(function() {
        return location;
      });
    }
    // If no redirect, try to extract from response body or URL
    return res.url || url;
  }).then(function(finalUrl) {
    if (isPlayableUrl(finalUrl)) {
      return [buildStream(label + " GDrive", finalUrl, quality, { Referer: url }, "", "", langHint, meta)];
    }
    return [];
  }).catch(function(e) {
    console.log("[4KHDHub] gamerxyt error:", e.message);
    return [];
  });
}

function resolveLink(rawUrl, label, referer, quality, langHint, meta) {
  if (!rawUrl) return Promise.resolve([]);
  var lower = String(rawUrl).toLowerCase();

  if (lower.indexOf("gamerxyt.com") !== -1) {
    return resolveGamerxyt(rawUrl, label, quality, langHint, meta);
  }
  if (lower.indexOf("hubcloud") !== -1) {
    return resolveHubcloud(rawUrl, label, referer, quality, langHint, meta);
  }
  if (lower.indexOf("hubcdn") !== -1) {
    return resolveHubcdn(rawUrl, label, quality, "", "", langHint, meta);
  }
  if (lower.indexOf("hubdrive") !== -1) {
    return resolveHubdrive(rawUrl, label, quality, meta);
  }
  if (lower.indexOf("pixeldrain") !== -1) {
    var pdId = rawUrl.split("/").pop();
    var pdUrl = "https://pixeldrain.com/api/file/" + pdId + "?download";
    return Promise.resolve([buildStream(label + " PixelDrain", pdUrl, quality, { Referer: referer }, "", "", langHint, meta)]);
  }
  if (isPlayableUrl(rawUrl) || /\.(mkv|mp4|m3u8)(\?|#|$)/i.test(lower)) {
    return Promise.resolve([buildStream(label, rawUrl, quality, { Referer: referer }, "", "", langHint, meta)]);
  }

  return Promise.resolve([]);
}

// ===== MAIN EXTRACTION =====

function extractFromPage(contentUrl, mediaType, season, episode, meta) {
  return fetchText(contentUrl).then(function(html) {
    var $ = cheerio.load(html);
    var hasEpisodeList = $("div.episodes-list, div.episodelist, ul.episodios, div.season-item").length > 0;
    var isMoviePage = !hasEpisodeList;

    var links = (mediaType === "movie" || isMoviePage)
      ? collectMovieLinks($, contentUrl)
      : collectEpisodeLinks($, contentUrl, season, episode);

    if (!links.length) return [];

    return Promise.all(links.map(function(item) {
      var quality = parseQuality((item.fileTitle || "") + " " + (item.label || "") + " " + (item.rawHtml || ""));
      var label = cleanLabel(item.fileTitle || item.label || PROVIDER_NAME);
      var langHint = (item.fileTitle || "") + " " + (item.label || "") + " " + (item.rawHtml || "");
      return resolveLink(item.url, label, contentUrl, quality, langHint, meta).catch(function(e) {
        console.log("[4KHDHub] resolveLink failed:", item.url, e.message || e);
        return [];
      });
    })).then(function(groups) {
      var streams = [];
      var i;
      for (i = 0; i < groups.length; i++) streams = streams.concat(groups[i] || []);
      streams = uniqueBy(streams, function(s) {
        var titleKey = String(s.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        var qualKey = String(s.quality || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        var urlKey = String(s.url || "").slice(0, 60).replace(/[^a-z0-9]/g, "");
        return titleKey + "|" + qualKey + "|" + urlKey;
      });
      streams = sortByPriority(streams);
      return streams;
    });
  });
}

function findContentUrl(tmdbId, mediaType) {
  return getTmdbInfo(tmdbId, mediaType).then(function(names) {
    if (!names.title && !names.original) return null;
    return searchContent(names.title, names.year, mediaType).then(function(found) {
      if (found) return found;
      if (names.original && names.original !== names.title) {
        return searchContent(names.original, names.year, mediaType);
      }
      return null;
    });
  });
}

// ===== ENTRY POINT =====

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[4KHDHub] getStreams called:", tmdbId, mediaType, season, episode);
  return getTmdbInfo(tmdbId, mediaType).then(function(tmdbData) {
    var epPromise = (mediaType === "tv")
      ? getTmdbEpisodeTitle(tmdbId, season, episode)
      : Promise.resolve("");

    return epPromise.then(function(epTitle) {
      return findContentUrl(tmdbId, mediaType).then(function(contentUrl) {
        if (!contentUrl) {
          console.log("[4KHDHub] No content URL found");
          return [];
        }
        console.log("[4KHDHub] Content URL:", contentUrl);

        var meta = {
          title: tmdbData.title || "Movie",
          year: tmdbData.year || "",
          season: season,
          episode: episode,
          episodeTitle: epTitle
        };

        return extractFromPage(contentUrl, mediaType, season, episode, meta);
      });
    });
  }).catch(function(err) {
    console.error("[4KHDHub] Error:", err.message || err);
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
