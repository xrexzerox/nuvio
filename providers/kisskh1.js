// KissKH.ovh Plugin for Nuvio
// Korean dramas and Asian TV shows
// Pure JSON APIs - No cheerio needed

var MAIN_URL = "https://kisskh.ovh";
var GOOGLE_SCRIPT_API = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec";
var TMDB_API_KEY = "b030404650f279792a8d3287232358e3";

function log(msg) {
    console.log("[KissKH] " + msg);
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

function fetchJson(url, headers) {
    var opts = { headers: headers || {} };
    return fetch(url, opts)
        .then(function(response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.text();
        })
        .then(function(text) {
            return safeJsonParse(text);
        });
}

function generateKey(epsId) {
    var keyUrl = GOOGLE_SCRIPT_API + "?id=" + epsId + "&version=2.8.10";
    log("Generating key for episode: " + epsId);
    return fetchJson(keyUrl).then(function(keyData) {
        if (keyData && keyData.key) {
            log("Key generated successfully");
            return keyData.key;
        }
        throw new Error("Google Script returned no key");
    });
}

function getVideoSources(epsId, key) {
    var videoApi = MAIN_URL + "/api/DramaList/Episode/" + epsId + ".png?err=false&ts=&time=&kkey=" + key;
    log("Fetching video sources");
    return fetchJson(videoApi).then(function(sources) {
        if (!sources) throw new Error("Empty response from video API");
        log("Video API keys: " + Object.keys(sources).join(", "));
        return sources;
    });
}

function getTmdbTitle(tmdbId, mediaType) {
    var tmdbUrl = "https://api.themoviedb.org/3/" + mediaType + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    log("Fetching TMDB: " + tmdbId);
    return fetchJson(tmdbUrl).then(function(data) {
        if (!data) throw new Error("TMDB fetch failed");
        var title = data.title || data.name || data.original_title || data.original_name;
        var year = (data.release_date || data.first_air_date || "").substring(0, 4);
        log("TMDB: " + title + " (" + year + ")");
        return { title: title, year: year, data: data };
    });
}

function searchKisskh(title) {
    var searchUrl = MAIN_URL + "/api/DramaList/Search?q=" + encodeURIComponent(title) + "&type=0";
    log("Searching KissKH: " + title);
    return fetchJson(searchUrl).then(function(searchList) {
        if (!searchList || !Array.isArray(searchList) || searchList.length === 0) {
            throw new Error("No KissKH results for: " + title);
        }
        var matched = null;
        var lowerTitle = title.toLowerCase();
        for (var i = 0; i < searchList.length; i++) {
            if (searchList[i].title && searchList[i].title.toLowerCase() === lowerTitle) {
                matched = searchList[i];
                break;
            }
        }
        if (!matched) matched = searchList[0];
        log("Match: " + matched.title + " (ID: " + matched.id + ")");
        return matched;
    });
}

function getDramaDetail(dramaId) {
    var url = MAIN_URL + "/api/DramaList/Drama/" + dramaId + "?isq=false";
    return fetchJson(url).then(function(detail) {
        if (!detail || !detail.episodes || detail.episodes.length === 0) {
            throw new Error("No episodes found for drama " + dramaId);
        }
        log("Found " + detail.episodes.length + " episodes");
        return detail;
    });
}

function findEpisode(episodes, mediaType, episodeNum) {
    var targetEp = null;
    if (mediaType === "movie") {
        targetEp = episodes[episodes.length - 1];
        log("Movie mode: using episode " + targetEp.number);
    } else {
        for (var i = 0; i < episodes.length; i++) {
            if (parseInt(episodes[i].number) === parseInt(episodeNum)) {
                targetEp = episodes[i];
                break;
            }
        }
        if (!targetEp) throw new Error("Episode " + episodeNum + " not found");
        log("Found TV episode " + targetEp.number + " (ID: " + targetEp.id + ")");
    }
    return targetEp;
}

function extractQuality(url) {
    if (!url) return "Auto";
    var qMatch = url.match(/_(\d+p)_/i);
    if (qMatch) return qMatch[1];
    if (url.match(/1080p/i)) return "1080p";
    if (url.match(/720p/i)) return "720p";
    if (url.match(/480p/i)) return "480p";
    if (url.match(/360p/i)) return "360p";
    return "Auto";
}

function sourcesToStreams(sources, dramaTitle, epTitle, epNumber) {
    var streams = [];
    var links = [];

    if (sources.Video) links.push(sources.Video);
    if (sources.Video_tmp) links.push(sources.Video_tmp);
    if (sources.ThirdParty) links.push(sources.ThirdParty);

    if (links.length === 0) {
        log("No video links found");
        return streams;
    }

    var displayTitle = dramaTitle || "KissKH";
    var displayEp = epTitle || ("Episode " + epNumber);
    var baseHeaders = {
        "Origin": MAIN_URL,
        "Referer": MAIN_URL + "/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    for (var i = 0; i < links.length; i++) {
        var link = links[i];
        if (!link) continue;

        var isM3u8 = link.indexOf(".m3u8") !== -1;
        var isMp4 = link.indexOf(".mp4") !== -1;

        if (isM3u8 || isMp4) {
            var quality = extractQuality(link);
            var typeLabel = isM3u8 ? "HLS" : "MP4";

            streams.push({
                name: "KissKH | " + quality + " | " + typeLabel,
                title: displayEp + " | " + displayTitle + " | " + quality + " | KissKH",
                url: link,
                quality: quality,
                provider: "kisskh",
                headers: baseHeaders
            });
            log("Added stream: " + typeLabel + " " + quality);
        }
    }

    return streams;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    log("Starting TMDB: " + tmdbId + " Type: " + mediaType + " S" + seasonNum + "E" + episodeNum);

    return getTmdbTitle(tmdbId, mediaType)
        .then(function(tmdbInfo) {
            return searchKisskh(tmdbInfo.title);
        })
        .then(function(drama) {
            return getDramaDetail(drama.id).then(function(detail) {
                return { drama: drama, detail: detail };
            });
        })
        .then(function(info) {
            var targetEp = findEpisode(info.detail.episodes, mediaType, episodeNum);
            return { drama: info.drama, episode: targetEp };
        })
        .then(function(info) {
            return generateKey(info.episode.id).then(function(key) {
                return getVideoSources(info.episode.id, key).then(function(sources) {
                    return sourcesToStreams(
                        sources,
                        info.drama.title,
                        info.episode.title,
                        info.episode.number
                    );
                });
            });
        })
        .then(function(streams) {
            log("Returning " + streams.length + " streams");
            return streams;
        })
        .catch(function(err) {
            log("Error: " + err.message);
            return [];
        });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
} else if (typeof global !== "undefined") {
    global.getStreams = getStreams;
}
