/**
 * 4KHDHub Nuvio Plugin - QuickJS Compatible Edition
 * Domain: 4khdhub.link
 * Supports: Movies & TV Shows
 * Constraints: No cheerio, No async/await, var only, skipSizeCheck on all fetch
 * QuickJS Fixes: Optional setTimeout, plain-object headers, URL polyfill, safe regex
 */

var PROVIDER_NAME = "4KHDHub";
var TMDB_API_KEY = "6dc830f9624b43261325bed3bf7d0dfa";
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

var SKIP_PATTERNS = ["/category/", "/about", "/contact", "/dmca", "/privacy", "/?s=", "/page/", "#"];
var NAV_LABELS = ["movies", "web series", "ott", "anime", "home", "about us", "contact us", "dmca", "privacy policy", "hdhub4u team", "fhd"];

var cachedDomain = null;
var domainCacheTime = 0;
var DOMAIN_CACHE_TTL = 30 * 60 * 1000;

// ===== QUICKJS COMPATIBILITY HELPERS =====

function hasSetTimeout() {
  return typeof setTimeout === "function";
}

function withTimeout(promise, ms) {
  if (!hasSetTimeout()) return promise;
  var timer = null;
  var timeoutPromise = new Promise(function(_, reject) {
    timer = setTimeout(function() {
      timer = null;
      reject(new Error("TIMEOUT"));
    }, ms);
  });
  return Promise.race([
    promise.then(function(result) {
      if (timer) { clearTimeout(timer); timer = null; }
      return result;
    }).catch(function(err) {
      if (timer) { clearTimeout(timer); timer = null; }
      throw err;
    }),
    timeoutPromise
  ]);
}

function getHeader(res, name) {
  var headers = res.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") {
    return headers.get(name) || "";
  }
  if (typeof headers.get === "function") {
    try { return headers.get(name) || ""; } catch(e) {}
  }
  if (headers[name]) return String(headers[name]);
  var lowerName = name.toLowerCase();
  if (headers[lowerName]) return String(headers[lowerName]);
  return "";
}

function safeUrlParse(url, base) {
  if (!url) return "";
  if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  if (!base) return url;
  try {
    if (typeof URL !== "undefined") {
      return new URL(url, base).toString();
    }
  } catch (e) {}
  // Manual URL resolution fallback
  if (url.indexOf("/") === 0) {
    var baseProto = base.indexOf("https://") === 0 ? "https://" : "http://";
    var baseRest = base.substring(baseProto.length);
    var baseHost = baseRest.split("/")[0];
    return baseProto + baseHost + url;
  }
  var basePath = base.substring(0, base.lastIndexOf("/") + 1);
  return basePath + url;
}

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
    body: options.body,
    skipSizeCheck: true
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
    body: options.body,
    skipSizeCheck: true
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
    body: options.body,
    skipSizeCheck: true
  });
}

function fixUrl(url, baseUrl) {
  return safeUrlParse(url, baseUrl);
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

function similarityScore(query, candidate) {
  var q = normalizeTitle(query);
  var c = normalizeTitle(candidate);
  if (q === c) return 10000;
  if (q.indexOf(" ") !== -1) {
    var qWords = q.split(" ");
    var allFound = true;
    var i;
    for (i = 0; i < qWords.length; i++) {
      if (qWords[i].length > 2 && c.indexOf(qWords[i]) === -1) {
        allFound = false;
        break;
      }
    }
    if (!allFound) return 0;
  }
  var dist = levenshteinDistance(q, c);
  var score = Math.max(0, 10000 - dist * 100);
  if (c.indexOf(q) !== -1) score += 500;
  return score;
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
  if (u.indexOf("gamerxyt.com") !== -1) return 28;
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
    headers: HEADERS,
    skipSizeCheck: true
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
    var original = data.original_name || data.original_title || title;
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

function extractAllAnchors(html) {
  var anchors = [];
  var pos = 0;
  while (true) {
    var start = html.indexOf("<a ", pos);
    if (start === -1) start = html.indexOf("<a>", pos);
    if (start === -1) break;
    var end = html.indexOf("</a>", start);
    if (end === -1) break;
    var block = html.substring(start, end + 4);
    var hrefMatch = block.match(/href="([^"]+)"/);
    if (hrefMatch) {
      anchors.push({ block: block, href: hrefMatch[1] });
    }
    pos = end + 4;
  }
  return anchors;
}

function extractBestTitle(block) {
  var ariaMatch = block.match(/aria-label="([^"]+)"/);
  if (ariaMatch) {
    var aria = ariaMatch[1].replace(/\s+details$/i, "").trim();
    if (aria.length > 1) return aria;
  }
  var altMatch = block.match(/alt="([^"]+)"/);
  if (altMatch) {
    var alt = altMatch[1].trim();
    if (alt.length > 1 && alt.toLowerCase().indexOf("http") !== 0) return alt;
  }
  var hMatch = block.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i);
  if (hMatch) {
    var h = hMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (h.length > 1) return h;
  }
  var titleMatch = block.match(/class="movie-card-title"[^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (titleMatch) {
    var t = titleMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (t.length > 1) return t;
  }
  var text = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text;
}

function searchContent(query, year, mediaType) {
  return getActiveDomain().then(function(domain) {
    var searchQuery = query;
    if (year) searchQuery += " " + year;
    var searchUrl = domain + "/?s=" + encodeURIComponent(searchQuery);
    console.log("[4KHDHub] Searching:", searchUrl);
    return fetchText(searchUrl).then(function(html) {
      var anchors = extractAllAnchors(html);
      var results = [];
      var i;
      for (i = 0; i < anchors.length; i++) {
        var anchor = anchors[i];
        var href = fixUrl(anchor.href, domain);
        if (!href) continue;
        var lowerHref = href.toLowerCase();
        var skip = false;
        var j;
        for (j = 0; j < SKIP_PATTERNS.length; j++) {
          if (lowerHref.indexOf(SKIP_PATTERNS[j]) !== -1) { skip = true; break; }
        }
        if (skip) continue;
        try {
          if (typeof URL !== "undefined") {
            if (new URL(href).hostname !== new URL(domain).hostname) continue;
          } else {
            var hrefHost = href.replace(/^https?:\/\//, "").split("/")[0];
            var domainHost = domain.replace(/^https?:\/\//, "").split("/")[0];
            if (hrefHost !== domainHost) continue;
          }
        } catch(e) { continue; }
        var title = extractBestTitle(anchor.block);
        if (!title || title.length < 2) continue;
        var lowerTitle = title.toLowerCase();
        var isNav = false;
        for (j = 0; j < NAV_LABELS.length; j++) {
          if (lowerTitle === NAV_LABELS[j] || lowerTitle.indexOf(NAV_LABELS[j] + " ") === 0) { isNav = true; break; }
        }
        if (isNav) continue;
        var combinedText = (title + " " + href).toLowerCase();
        var isSeries = /\bseries\b/i.test(title) || /-series-?\d*/i.test(href) || /\/series\//i.test(href) || /\bseason\s*\d+\b/i.test(combinedText);
        if (mediaType === "movie" && isSeries) continue;
        if (mediaType !== "movie" && !isSeries) continue;
        var cleanedTitle = title.replace(/\[.*?\[\]()\]/g, "").replace(/\s+details$/i, "").trim();
        var yearMatch = combinedText.match(/\b(19|20)\d{2}\b/);
        var itemYear = yearMatch ? parseInt(yearMatch[0], 10) : 0;
        var score = similarityScore(query, cleanedTitle);
        if (year && itemYear && Math.abs(itemYear - year) > 1) score -= 500;
        console.log("[4KHDHub] Result " + (i + 1) + " : " + cleanedTitle + " - Score: " + score);
        results.push({ href: href, title: cleanedTitle, score: score });
        if (score >= 10000) break;
      }
      if (!results.length) return null;
      results.sort(function(a, b) { return b.score - a.score; });
      var best = results[0];
      if (best.score < 6000) {
        console.log("[4KHDHub] No confident match (score < 6000), aborting");
        return null;
      }
      console.log("[4KHDHub] Best match:", best.title, "->", best.href, "(Score:", best.score + ")");
      return best.href;
    });
  });
}

// ===== PAGE EXTRACTION =====

function extractMovieLinks(html, pageUrl) {
  var links = [];
  var pos = 0;
  var blockCount = 0;

  while (true) {
    var start = html.indexOf('class="download-item"', pos);
    if (start === -1) {
      var dataStart = html.indexOf("data-file-id", pos);
      if (dataStart !== -1) {
        start = html.lastIndexOf("<div", dataStart);
        if (start === -1 || start < pos) start = dataStart;
      }
    }
    if (start === -1) break;
    var end = html.indexOf('class="download-item"', start + 20);
    if (end === -1) end = html.indexOf('class="uploader-notes"', start);
    if (end === -1) end = start + 8000;
    var block = html.substring(start, end);
    var aMatch = block.match(/<a[^>]*href="([^"]+)"[^>]*>/);
    if (aMatch) {
      var href = fixUrl(aMatch[1], pageUrl);
      var label = cleanLabel(block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      var fileTitleMatch = block.match(/class="file-title"[^>]*>([\s\S]*?)<\/div>/i);
      var fileTitle = fileTitleMatch ? cleanLabel(fileTitleMatch[1].replace(/<[^>]+>/g, " ").trim()) : "";
      if (href) {
        links.push({ url: href, label: label, fileTitle: fileTitle, rawHtml: block });
        blockCount++;
      }
    }
    pos = start + 20;
    if (blockCount > 50) break;
  }
  console.log("[4KHDHub] Movie: found " + blockCount + " download-item blocks");

  if (!links.length) {
    var containers = [
      'class="download-links"', 'class="gdlink"', 'class="dllinks"',
      'class="movie-download"', 'class="box-content"', 'class="wp-block-buttons"',
      'class="thecontent"', 'class="entry-content"'
    ];
    var c, containerStart, containerEnd, containerHtml;
    for (c = 0; c < containers.length; c++) {
      containerStart = html.indexOf(containers[c]);
      while (containerStart !== -1) {
        containerEnd = html.indexOf("</div>", containerStart);
        if (containerEnd === -1) containerEnd = containerStart + 3000;
        containerHtml = html.substring(containerStart, containerEnd + 6);
        var caRegex = /<a[^>]*href="([^"]+)"[^>]*>/gi;
        var caMatch;
        while ((caMatch = caRegex.exec(containerHtml)) !== null) {
          var href = fixUrl(caMatch[1], pageUrl);
          if (!href) continue;
          var lower = href.toLowerCase();
          var isHoster = lower.indexOf("hubcloud") !== -1 || lower.indexOf("hubdrive") !== -1 ||
            lower.indexOf("hubcdn") !== -1 || lower.indexOf("workers.dev") !== -1 ||
            lower.indexOf("r2.dev") !== -1 || lower.indexOf("pixeldrain") !== -1 ||
            lower.indexOf("gamerxyt") !== -1 || /\.(mp4|mkv|m3u8)(\?|#|$)/i.test(lower);
          if (!isHoster) continue;
          links.push({ url: href, label: "Movie", fileTitle: "", rawHtml: containerHtml });
        }
        containerStart = html.indexOf(containers[c], containerStart + 10);
      }
    }
    console.log("[4KHDHub] Movie: fallback 1 found " + links.length + " links");
  }

  if (!links.length) {
    var allRegex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var allMatch;
    while ((allMatch = allRegex.exec(html)) !== null) {
      var href = fixUrl(allMatch[1], pageUrl);
      var text = allMatch[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      var lower = href.toLowerCase();
      var isHoster = lower.indexOf("hubcloud") !== -1 || lower.indexOf("hubdrive") !== -1 ||
        lower.indexOf("hubcdn") !== -1 || lower.indexOf("workers.dev") !== -1 ||
        lower.indexOf("r2.dev") !== -1 || lower.indexOf("pixeldrain") !== -1 ||
        lower.indexOf("gamerxyt") !== -1 || /\.(mp4|mkv|m3u8)(\?|#|$)/i.test(lower);
      if (!isHoster) continue;
      var contextStart = Math.max(0, allMatch.index - 300);
      var context = html.substring(contextStart, allMatch.index + 200);
      var inDownload = context.indexOf("download") !== -1 || context.indexOf("Download") !== -1 ||
                       context.indexOf('class="download') !== -1 || context.indexOf("download-item") !== -1 ||
                       context.indexOf("gdlink") !== -1 || context.indexOf("dllinks") !== -1;
      if (!inDownload) continue;
      links.push({ url: href, label: cleanLabel(text), fileTitle: cleanLabel(text), rawHtml: context });
    }
    console.log("[4KHDHub] Movie: fallback 2 found " + links.length + " links");
  }

  return uniqueBy(links, function(item) { return String(item.url || "").toLowerCase(); });
}

function extractEpisodeLinks(html, pageUrl, season, episode) {
  var sNum = Number(season);
  var eNum = Number(episode);
  var epPattern1 = "S" + (sNum < 10 ? "0" + sNum : sNum) + "E" + (eNum < 10 ? "0" + eNum : eNum);
  var epPattern2 = "Episode-" + (eNum < 10 ? "0" + eNum : eNum);
  var epPattern3 = "Episode-" + eNum;
  var epPattern4 = "E" + (eNum < 10 ? "0" + eNum : eNum);
  var found = [];

  var seasonPos = 0;
  var seasonCount = 0;
  while (true) {
    var seasonStart = html.indexOf('class="season-item', seasonPos);
    if (seasonStart === -1) break;
    var seasonEnd = html.indexOf('class="season-item', seasonStart + 20);
    if (seasonEnd === -1) seasonEnd = html.indexOf('class="uploader-notes"', seasonStart);
    if (seasonEnd === -1) seasonEnd = seasonStart + 15000;
    var seasonHtml = html.substring(seasonStart, seasonEnd);

    var seasonNumMatch = seasonHtml.match(/class="episode-number"[^>]*>([^<]+)/);
    var seasonNumText = seasonNumMatch ? seasonNumMatch[1].trim() : "";
    var seasonNumExtracted = 0;
    var snMatch = seasonNumText.match(/S(?:eason)?\s*([0-9]+)/i);
    if (snMatch) seasonNumExtracted = parseInt(snMatch[1], 10);
    else if (seasonNumText.indexOf("S") === 0) {
      var snNum = parseInt(seasonNumText.substring(1), 10);
      if (!isNaN(snNum)) seasonNumExtracted = snNum;
    }

    if (seasonNumExtracted === sNum) {
      var qualityMatch = seasonHtml.match(/class="episode-title"[^>]*>([\s\S]*?)<\/h3>/i);
      var qualityText = qualityMatch ? qualityMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";

      var itemPos = 0;
      var itemCount = 0;
      while (true) {
        var itemStart = seasonHtml.indexOf('class="episode-download-item"', itemPos);
        if (itemStart === -1) break;
        var nextItem = seasonHtml.indexOf('class="episode-download-item"', itemStart + 30);
        var itemEnd = nextItem !== -1 ? nextItem : seasonHtml.length;
        var itemHtml = seasonHtml.substring(itemStart, itemEnd);

        var ftMatch = itemHtml.match(/class="episode-file-title"[^>]*>([\s\S]*?)<\/div>/i);
        var fileTitle = ftMatch ? ftMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";

        var badgeMatch = itemHtml.match(/class="badge-psa"[^>]*>([^<]+)/);
        var badgeText = badgeMatch ? badgeMatch[1].trim() : "";

        var itemText = itemHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        var epRegexMatch = itemText.match(/Episode-?\s*0*([0-9]+)/i) || itemText.match(/\bE\s*0*([0-9]+)/i);

        var isMatch = fileTitle.indexOf(epPattern1) !== -1 ||
                      fileTitle.indexOf(epPattern2) !== -1 ||
                      fileTitle.indexOf(epPattern3) !== -1 ||
                      fileTitle.indexOf(epPattern4) !== -1 ||
                      badgeText.indexOf(epPattern2) !== -1 ||
                      badgeText.indexOf(epPattern3) !== -1 ||
                      badgeText.indexOf(epPattern4) !== -1 ||
                      (epRegexMatch && parseInt(epRegexMatch[1], 10) === eNum);

        if (isMatch) {
          var linksStart = itemHtml.indexOf('class="episode-links"');
          var linksEnd = itemHtml.indexOf('</div>', linksStart);
          if (linksStart !== -1 && linksEnd !== -1) {
            var linksHtml = itemHtml.substring(linksStart, linksEnd + 6);
            var aRegex = /<a[^>]*href="([^"]+)"[^>]*>/gi;
            var aMatch;
            while ((aMatch = aRegex.exec(linksHtml)) !== null) {
              var href = fixUrl(aMatch[1], pageUrl);
              if (href) {
                found.push({
                  url: href,
                  label: "S" + sNum + "E" + eNum,
                  fileTitle: fileTitle,
                  qualityText: qualityText,
                  rawHtml: itemHtml
                });
              }
            }
          }
        }

        itemPos = itemStart + 30;
        itemCount++;
        if (itemCount > 100) break;
      }
    }

    seasonPos = seasonStart + 20;
    seasonCount++;
    if (seasonCount > 20) break;
  }

  return uniqueBy(found, function(item) { return String(item.url || "").toLowerCase(); });
}

// ===== REDIRECT DECODER (Gadgetsweb) =====

function resolveGadgetsweb(url) {
  return withTimeout(fetchText(url), 15000).then(function(html) {
    var combined = "";
    // Safe regex extraction without global flag issues
    var pos = 0;
    while (true) {
      var sMatch = html.indexOf("s('o','", pos);
      if (sMatch === -1) break;
      var endQuote = html.indexOf("')", sMatch + 6);
      if (endQuote === -1) break;
      var encoded = html.substring(sMatch + 6, endQuote);
      if (encoded && /^[A-Za-z0-9+/=]+$/.test(encoded)) {
        combined += encoded;
      }
      pos = endQuote + 2;
    }
    if (!combined) {
      // Try ck pattern
      pos = 0;
      while (true) {
        var ckMatch = html.indexOf("ck('_wp_http_", pos);
        if (ckMatch === -1) break;
        var quoteStart = html.indexOf("','", ckMatch);
        if (quoteStart === -1) break;
        var quoteEnd = html.indexOf("')", quoteStart + 3);
        if (quoteEnd === -1) break;
        var ckEncoded = html.substring(quoteStart + 3, quoteEnd);
        if (ckEncoded) combined += ckEncoded;
        pos = quoteEnd + 2;
      }
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
      return withTimeout(fetchText(blogUrl + "?re=" + encodeURIComponent(data)), 15000).then(function(txt) {
        var txtStr = String(txt || "").trim();
        var reurlMatch = txtStr.match(/var\s+reurl\s*=\s*"([^"]+)"/);
        if (reurlMatch) return reurlMatch[1];
        if (txtStr.indexOf("http") === 0) return txtStr;
        return "";
      }).catch(function() { return ""; });
    } catch(e) { return ""; }
  }).catch(function() { return ""; });
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
    line1 = "S" + meta.season + "E" + meta.episode + epPart + " | " + displayTitle + year;
  } else {
    line1 = displayTitle + year;
  }
  line2 = quality + " | " + lang + (size ? " | " + size : "");
  var extMatch = cleanedLabel.match(/\.(mkv|mp4|m4v|avi|mov)$/i);
  var extension = extMatch ? extMatch[1].toUpperCase() : "MKV";
  line3 = extension + " | " + (tech || "WEB-DL");
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
  return withTimeout(fetchText(url, { headers: { Referer: url } }), 20000).then(function(html) {
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
  }).catch(function(e) {
    return [];
  });
}

function resolveHubdrive(url, label, quality, meta) {
  var lower = String(url || "").toLowerCase();
  if (lower.indexOf("hubdrive.space") !== -1) {
    return Promise.resolve([]);
  }
  return withTimeout(fetchText(url, { headers: { Referer: url } }), 20000).then(function(html) {
    if (html.indexOf("Sign in - Google") !== -1 || 
        html.indexOf("accounts.google.com/signin") !== -1 ||
        html.indexOf("accounts.google.com") !== -1) {
      return [];
    }
    var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    var title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, " ").trim() : "";
    if (/hubdrive.*G-Drive File Sharing/i.test(title) &&
        html.indexOf("logout") !== -1 &&
        html.indexOf("download") === -1) {
      return [];
    }
    var candidates = [];
    var aRegex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var aMatch;
    while ((aMatch = aRegex.exec(html)) !== null) {
      var href = fixUrl(aMatch[1], url);
      var text = aMatch[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      if (!href) continue;
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
            href === url) continue;
        candidates.push(href);
      }
    }
    if (!candidates.length) {
      var formMatch = html.match(/<form[^>]*action="([^"]+)"/i);
      var btnMatch = html.match(/<a[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*href="([^"]+)"/i);
      var downloadBtn = formMatch ? formMatch[1] : (btnMatch ? btnMatch[1] : "");
      if (downloadBtn) {
        return resolveLink(fixUrl(downloadBtn, url), label, url, quality, "", meta, 0);
      }
      return [];
    }
    candidates.sort(function(a, b) { return hostPriority(b) - hostPriority(a); });
    var best = candidates[0];
    if (best.toLowerCase().indexOf("hubdrive") !== -1 && best !== url) {
      return resolveHubdrive(best, label, quality, meta);
    }
    return resolveLink(best, label, url, quality, "", meta, 0);
  }).catch(function(e) {
    return [];
  });
}

function resolve10Gbps(url, label, quality, size, tech, langHint, meta) {
  function step(current, depth) {
    if (depth >= 6) return Promise.resolve([]);
    return withTimeout(fetchResponse(current, {
      redirect: "follow",
      headers: { Referer: current },
      skipSizeCheck: true
    }), 15000).then(function(res) {
      var finalUrl = res.url || current;
      var contentType = getHeader(res, "content-type").toLowerCase();
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
  return withTimeout(fetchText(url, { headers: baseHeaders }), 20000).then(function(html) {
    var entryUrl = "";
    var downloadMatch = html.match(/id="download"[^>]*href="([^"]+)"/);
    if (downloadMatch) entryUrl = downloadMatch[1];
    if (!entryUrl) {
      var hubcloudAMatch = html.match(/<a[^>]*href="([^"]*hubcloud[^"]*)"[^>]*>/i);
      if (hubcloudAMatch) entryUrl = hubcloudAMatch[1];
    }
    if (!entryUrl) {
      var iframeMatch = html.match(/<iframe[^>]*src="([^"]*hubcloud[^"]*)"[^>]*>/i);
      if (iframeMatch) entryUrl = iframeMatch[1];
    }
    if (!entryUrl) {
      var varUrlMatch = html.match(/var\s+url\s*=\s*['"]([^'"]+)['"]/);
      if (varUrlMatch) entryUrl = varUrlMatch[1];
    }
    if (!entryUrl) {
      var reurlMatch = html.match(/var\s+reurl\s*=\s*['"]([^'"]+)['"]/);
      if (reurlMatch) entryUrl = reurlMatch[1];
    }
    entryUrl = fixUrl(entryUrl, url);
    if (!entryUrl) {
      return [];
    }

    return withTimeout(fetchText(entryUrl, { headers: { Referer: url } }), 20000).then(function(eHtml) {
      var sizeMatch = eHtml.match(/id="size"[^>]*>([^<]+)/);
      var size = sizeMatch ? sizeMatch[1].trim() : "";

      var headerMatch = eHtml.match(/class="card-header"[^>]*>([\s\S]*?)<\/div>/i);
      var header = headerMatch ? headerMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
      var tech = cleanTech(header);
      var finalQuality = parseQuality(header + " " + quality);

      var directStreams = [];
      var asyncTasks = [];
      var btnRegex = /<a[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      var btnMatch;
      while ((btnMatch = btnRegex.exec(eHtml)) !== null) {
        var link = fixUrl(btnMatch[1], entryUrl);
        var text = btnMatch[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
        if (!link) continue;

        if (text.indexOf("buzzserver") !== -1) {
          asyncTasks.push(
            withTimeout(fetchResponse(link + "/download", { 
              headers: { Referer: link }, 
              redirect: "follow",
              skipSizeCheck: true 
            }), 15000).then(function(res) {
              var redir = getHeader(res, "location");
              return redir ? [buildStream(label + " Buzz", redir, finalQuality, { Referer: link }, size, tech, langHint, meta)] : [];
            }).catch(function() { return []; })
          );
        } else if (text.indexOf("10gbps") !== -1 || link.indexOf("gpdl.hubcloud") !== -1) {
          asyncTasks.push(resolve10Gbps(link, label, finalQuality, size, tech, langHint, meta));
        } else if (isPlayableUrl(link) || /\.(mkv|mp4|m3u8)(\?|#|$)/i.test(link.toLowerCase())) {
          directStreams.push(buildStream(label, link, finalQuality, { Referer: entryUrl }, size, tech, langHint, meta));
        }
      }

      if (!directStreams.length && !asyncTasks.length) {
        var fallbackRegex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        var fbMatch;
        while ((fbMatch = fallbackRegex.exec(eHtml)) !== null) {
          var fbLink = fixUrl(fbMatch[1], entryUrl);
          if (!fbLink) continue;
          if (isPlayableUrl(fbLink) || /\.(mkv|mp4|m3u8)(\?|#|$)/i.test(fbLink.toLowerCase())) {
            directStreams.push(buildStream(label, fbLink, finalQuality, { Referer: entryUrl }, size, tech, langHint, meta));
          }
        }
      }

      return Promise.all(asyncTasks).then(function(results) {
        var all = directStreams.slice();
        var i;
        for (i = 0; i < results.length; i++) all = all.concat(results[i] || []);
        return all;
      });
    });
  }).catch(function(e) {
    return [];
  });
}

function resolveGamerxyt(url, label, quality, langHint, meta) {
  return withTimeout(fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: merge(HEADERS, {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": url
    }),
    skipSizeCheck: true
  }), 20000).then(function(res) {
    var location = getHeader(res, "location");
    if (location) {
      return withTimeout(fetchResponse(location, { redirect: "follow", headers: { Referer: url }, skipSizeCheck: true }), 15000).then(function(r2) {
        var loc2 = getHeader(r2, "location");
        if (loc2) return loc2;
        return r2.url || location;
      }).catch(function() {
        return location;
      });
    }
    return res.url || url;
  }).then(function(finalUrl) {
    if (isPlayableUrl(finalUrl)) {
      return [buildStream(label + " GDrive", finalUrl, quality, { Referer: url }, "", "", langHint, meta)];
    }
    return [];
  }).catch(function(e) {
    return [];
  });
}

function resolveLink(rawUrl, label, referer, quality, langHint, meta, depth) {
  depth = depth || 0;
  if (depth > 3 || !rawUrl) return Promise.resolve([]);
  var lower = String(rawUrl).toLowerCase();

  if (isPlayableUrl(rawUrl) || /\.(mkv|mp4|m3u8)(\?|#|$)/i.test(lower)) {
    return Promise.resolve([buildStream(label, rawUrl, quality, { Referer: referer }, "", "", langHint, meta)]);
  }
  if (lower.indexOf("pixeldrain") !== -1) {
    var pdId = rawUrl.split("/").pop();
    var pdUrl = "https://pixeldrain.com/api/file/" + pdId + "?download";
    return Promise.resolve([buildStream(label + " PixelDrain", pdUrl, quality, { Referer: referer }, "", "", langHint, meta)]);
  }
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

  return resolveGadgetsweb(rawUrl).then(function(resolved) {
    if (resolved) {
      return resolveLink(resolved, label, referer, quality, langHint, meta, depth + 1);
    }
    return withTimeout(fetchResponse(rawUrl, { redirect: "follow", headers: { Referer: referer }, skipSizeCheck: true }), 15000).then(function(res) {
      var finalUrl = res.url || rawUrl;
      if (finalUrl !== rawUrl && finalUrl.indexOf("http") === 0) {
        return resolveLink(finalUrl, label, referer, quality, langHint, meta, depth + 1);
      }
      return [];
    }).catch(function() { return []; });
  });
}

// ===== BATCH PROCESSING =====

function resolveLinksInBatches(links, contentUrl, meta) {
  var maxConcurrent = 3;
  var allStreams = [];

  function processBatch(startIdx) {
    if (startIdx >= links.length) {
      return Promise.resolve(allStreams);
    }
    var batch = links.slice(startIdx, startIdx + maxConcurrent);

    var batchPromises = batch.map(function(item) {
      var quality = parseQuality((item.fileTitle || "") + " " + (item.qualityText || "") + " " + (item.label || "") + " " + (item.rawHtml || ""));
      var label = cleanLabel(item.fileTitle || item.label || PROVIDER_NAME);
      var langHint = (item.fileTitle || "") + " " + (item.label || "") + " " + (item.rawHtml || "");
      return withTimeout(resolveLink(item.url, label, contentUrl, quality, langHint, meta, 0), 60000).catch(function(e) {
        return [];
      });
    });

    return Promise.all(batchPromises).then(function(groups) {
      var i;
      for (i = 0; i < groups.length; i++) allStreams = allStreams.concat(groups[i] || []);
      return processBatch(startIdx + maxConcurrent);
    });
  }

  return processBatch(0);
}

// ===== MAIN EXTRACTION =====

function extractFromPage(contentUrl, mediaType, season, episode, meta) {
  return fetchText(contentUrl).then(function(html) {
    var hasEpisodeList = html.indexOf('class="episodes-list"') !== -1 || 
                         html.indexOf('class="season-item"') !== -1 ||
                         html.indexOf('class="episode-download-item"') !== -1;
    var isMoviePage = !hasEpisodeList;

    var links = (mediaType === "movie" || isMoviePage)
      ? extractMovieLinks(html, contentUrl)
      : extractEpisodeLinks(html, contentUrl, season, episode);

    console.log("[4KHDHub] Found " + links.length + " raw links for " + (mediaType === "movie" ? "movie" : "S" + season + "E" + episode));
    if (!links.length) {
      console.log("[4KHDHub] No download links found on page");
      return [];
    }

    return resolveLinksInBatches(links, contentUrl, meta).then(function(streams) {
      streams = uniqueBy(streams, function(s) {
        var titleKey = String(s.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        var qualKey = String(s.quality || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        var urlKey = String(s.url || "").slice(0, 60).replace(/[^a-z0-9]/g, "");
        return titleKey + "|" + qualKey + "|" + urlKey;
      });
      streams = sortByPriority(streams);
      console.log("[4KHDHub] Total streams:", streams.length);
      return streams;
    });
  }).catch(function(err) {
    console.log("[4KHDHub] extractFromPage error:", err.message || err);
    return [];
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
