/**
 * NetMirror - stable Nuvio provider
 *
 * Uses the currently reported NetMirror browser mirrors and falls back when
 * a mirror is unavailable. It does not attempt to solve or bypass CAPTCHA,
 * login, DRM, or other access controls.
 */

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var CANDIDATE_BASES = [
  "https://net27.cc",
  "https://net77.cc",
  "https://net52.cc"
];

var COMMON_HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0 Mobile Safari/537.36",
  "X-Requested-With": "XMLHttpRequest"
};

var PLATFORM_MAP = {
  netflix: {
    ott: "nf",
    search: "/mobile/search.php",
    post: "/mobile/post.php",
    episodes: "/mobile/episodes.php",
    playlist: "/mobile/playlist.php"
  },
  primevideo: {
    ott: "pv",
    search: "/mobile/pv/search.php",
    post: "/mobile/pv/post.php",
    episodes: "/mobile/pv/episodes.php",
    playlist: "/mobile/pv/playlist.php"
  },
  hotstar: {
    ott: "hs",
    search: "/mobile/hs/search.php",
    post: "/mobile/hs/post.php",
    episodes: "/mobile/hs/episodes.php",
    playlist: "/mobile/hs/playlist.php"
  },
  disney: {
    ott: "hs",
    search: "/mobile/hs/search.php",
    post: "/mobile/hs/post.php",
    episodes: "/mobile/hs/episodes.php",
    playlist: "/mobile/hs/playlist.php"
  }
};

function settings() {
  return typeof globalThis !== "undefined" && globalThis.SCRAPER_SETTINGS
    ? globalThis.SCRAPER_SETTINGS
    : {};
}

function getBases() {
  var configured = settings().baseUrl || settings().NETMIRROR_BASE;
  var bases = [];
  if (configured) bases.push(String(configured).replace(/\/$/, ""));
  for (var i = 0; i < CANDIDATE_BASES.length; i++) {
    if (bases.indexOf(CANDIDATE_BASES[i]) < 0) bases.push(CANDIDATE_BASES[i]);
  }
  return bases;
}

function unixTime() {
  return Math.floor(Date.now() / 1000);
}

function fetchJson(url, headers) {
  return fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: Object.assign({}, COMMON_HEADERS, headers || {}),
    skipSizeCheck: true
  }).then(function (response) {
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  });
}

function fetchText(url, headers) {
  return fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: Object.assign({}, COMMON_HEADERS, headers || {}),
    skipSizeCheck: true
  }).then(function (response) {
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.text();
  });
}

function tmdbMeta(tmdbId, mediaType) {
  var kind = mediaType === "tv" ? "tv" : "movie";
  return fetchJson(
    "https://api.themoviedb.org/3/" + kind + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_API_KEY
  ).then(function (data) {
    var title = mediaType === "tv" ? data.name : data.title;
    if (!title) throw new Error("TMDB title not found");
    return {
      title: title,
      year: String(mediaType === "tv" ? (data.first_air_date || "") : (data.release_date || "")).slice(0, 4)
    };
  });
}

function probeBase(base) {
  return fetchText(base + "/", { "Accept": "text/html,application/xhtml+xml" })
    .then(function () { return base; });
}

function resolveBase() {
  var bases = getBases();
  var chain = Promise.reject(new Error("no mirror"));
  for (var i = 0; i < bases.length; i++) {
    (function (base) {
      chain = chain.catch(function () { return probeBase(base); });
    })(bases[i]);
  }
  return chain;
}

function searchPlatform(base, platformKey, title) {
  var p = PLATFORM_MAP[platformKey];
  var url = base + p.search + "?s=" + encodeURIComponent(title) + "&t=" + unixTime();
  return fetchJson(url, { "Ott": p.ott })
    .then(function (data) {
      if (!data || !Array.isArray(data.searchResult) || !data.searchResult.length) return null;
      return data.searchResult[0];
    });
}

function loadPost(base, platformKey, id) {
  var p = PLATFORM_MAP[platformKey];
  return fetchJson(
    base + p.post + "?id=" + encodeURIComponent(id) + "&t=" + unixTime(),
    { "Ott": p.ott }
  );
}

function loadEpisodes(base, platformKey, contentId, postData, season, episode) {
  var p = PLATFORM_MAP[platformKey];
  var initial = Array.isArray(postData && postData.episodes) ? postData.episodes.filter(Boolean) : [];
  var target = null;

  for (var i = 0; i < initial.length; i++) {
    var item = initial[i];
    if (item && String(item.s).replace("S", "") == String(season) && String(item.ep).replace("E", "") == String(episode)) {
      target = item;
      break;
    }
  }

  if (target) return Promise.resolve(target);

  var seasons = Array.isArray(postData && postData.season) ? postData.season : [];
  var chain = Promise.resolve(null);

  seasons.forEach(function (seasonInfo) {
    chain = chain.then(function (found) {
      if (found || !seasonInfo || !seasonInfo.id) return found;
      var page = 1;
      function nextPage() {
        return fetchJson(
          base + p.episodes + "?s=" + encodeURIComponent(seasonInfo.id) + "&series=" + encodeURIComponent(contentId) + "&t=" + unixTime() + "&page=" + page,
          { "Ott": p.ott }
        ).then(function (data) {
          var eps = Array.isArray(data && data.episodes) ? data.episodes.filter(Boolean) : [];
          for (var j = 0; j < eps.length; j++) {
            var ep = eps[j];
            if (ep && String(ep.s).replace("S", "") == String(season) && String(ep.ep).replace("E", "") == String(episode)) return ep;
          }
          if (data && data.nextPageShow && page < 20) {
            page++;
            return nextPage();
          }
          return null;
        });
      }
      return nextPage().catch(function () { return null; });
    });
  });

  return chain;
}

function getPlaylist(base, platformKey, id, title) {
  var p = PLATFORM_MAP[platformKey];
  return fetchJson(
    base + p.playlist + "?id=" + encodeURIComponent(id) + "&t=" + encodeURIComponent(title) + "&tm=" + unixTime(),
    { "Ott": p.ott }
  );
}

function toStreams(playlist, base, platformKey, title) {
  if (!Array.isArray(playlist)) return [];
  var streams = [];
  var label = platformKey === "primevideo" ? "PrimeVideo" :
              platformKey === "hotstar" ? "Hotstar" :
              platformKey === "disney" ? "Disney" : "Netflix";

  playlist.forEach(function (entry) {
    if (!entry || !Array.isArray(entry.sources)) return;
    entry.sources.forEach(function (source) {
      if (!source || !source.file) return;
      var file = String(source.file);
      var url = /^https?:\/\//i.test(file) ? file : base + (file.charAt(0) === "/" ? file : "/" + file);
      streams.push({
        name: "NetMirror (" + label + ")",
        title: title + (source.label ? " " + source.label : ""),
        url: url,
        quality: source.label || "Auto",
        headers: {
          Referer: base + "/home"
        },
        provider: "netmirror"
      });
    });
  });

  return streams;
}

function fetchFromPlatform(base, platformKey, title, mediaType, season, episode) {
  return searchPlatform(base, platformKey, title).then(function (result) {
    if (!result || !result.id) return [];
    return loadPost(base, platformKey, result.id).then(function (postData) {
      var targetId = result.id;
      if (mediaType === "tv") {
        return loadEpisodes(base, platformKey, result.id, postData, season, episode)
          .then(function (target) {
            if (!target || !target.id) return [];
            return getPlaylist(base, platformKey, target.id, title).then(function (playlist) {
              return toStreams(playlist, base, platformKey, title);
            });
          });
      }
      return getPlaylist(base, platformKey, targetId, title).then(function (playlist) {
        return toStreams(playlist, base, platformKey, title);
      });
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[NetMirror] start " + mediaType + " " + tmdbId);

  return tmdbMeta(tmdbId, mediaType)
    .then(function (meta) {
      return resolveBase().then(function (base) {
        console.log("[NetMirror] mirror " + base);
        var platforms = ["netflix", "primevideo", "hotstar", "disney"];
        var configured = settings().platform;
        if (configured && PLATFORM_MAP[configured]) {
          platforms = [configured].concat(platforms.filter(function (p) { return p !== configured; }));
        }

        var chain = Promise.reject([]);
        platforms.forEach(function (platformKey) {
          chain = chain.then(function (existing) {
            if (existing && existing.length) return existing;
            return fetchFromPlatform(base, platformKey, meta.title, mediaType, season, episode)
              .catch(function (error) {
                console.log("[NetMirror] " + platformKey + " failed: " + (error && error.message ? error.message : error));
                return [];
              });
          });
        });
        return chain;
      });
    })
    .catch(function (error) {
      console.log("[NetMirror] failed: " + (error && error.message ? error.message : error));
      return [];
    });
}

function onSettings() {
  return Promise.resolve([
    {
      key: "baseUrl",
      title: "NetMirror base URL (optional)",
      type: "text",
      default: "",
      description: "Leave blank to use automatic mirror fallback."
    },
    {
      key: "platform",
      title: "Preferred platform",
      type: "select",
      options: ["netflix", "primevideo", "hotstar", "disney"],
      default: "netflix"
    }
  ]);
}

module.exports = {
  getStreams: getStreams,
  onSettings: onSettings
};
