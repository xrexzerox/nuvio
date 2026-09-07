/**
 * KissKH Nuvio Plugin - Auto-detect Movie/TV by TMDB ID
 * Domain: kisskh.ovh
 * Supports: Movies & TV Shows (Asian dramas)
 * 
 * Entry point signatures:
 *   Movie: getStreams("1007757")
 *   TV:    getStreams("287011", "1", "1")
 */

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
    var opts = { headers: headers || {}, skipSizeCheck: true };
    return fetch(url, opts)
        .then(function(response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.text();
        })
        .then(function(text) {
            return safeJsonParse(text);
        });
}

function levenshtein(a, b) {
    var matrix = [];
    for (var i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (var j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (var i = 1; i <= b.length; i++) {
        for (var j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) == a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function similarityScore(query, candidate) {
    var q = query.toLowerCase().trim();
    var c = candidate.toLowerCase().trim();

    if (q === c) return 10000;

    var qClean = "";
    var cClean = "";
    for (var i = 0; i < q.length; i++) {
        var ch = q.charAt(i);
        if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === " ") qClean += ch;
    }
    for (var i = 0; i < c.length; i++) {
        var ch = c.charAt(i);
        if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === " ") cClean += ch;
    }
    qClean = qClean.trim();
    cClean = cClean.trim();

    if (qClean === cClean) return 9500;

    var qWords = qClean.split(" ");
    var cWords = cClean.split(" ");

    if (qWords.length >= 2) {
        var allFound = true;
        for (var i = 0; i < qWords.length; i++) {
            var found = false;
            for (var j = 0; j < cWords.length; j++) {
                if (qWords[i] === cWords[j]) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                allFound = false;
                break;
            }
        }

        if (allFound) {
            if (cWords.length === qWords.length) {
                var totalDist = 0;
                for (var i = 0; i < qWords.length; i++) {
                    if (qWords[i] !== cWords[i]) {
                        if (qWords[i].indexOf(cWords[i]) !== -1 || cWords[i].indexOf(qWords[i]) !== -1) {
                            totalDist += Math.abs(qWords[i].length - cWords[i].length) * 2;
                        } else {
                            totalDist += Math.max(qWords[i].length, cWords[i].length);
                        }
                    }
                }
                if (totalDist <= 2) return 9000;
                if (totalDist <= 5) return 7000;
                return 5000;
            }
            var extraCount = cWords.length - qWords.length;
            if (extraCount <= 2) return 8000 - extraCount * 100;
            return 4000;
        }
        return 0;
    }

    if (qClean.indexOf(cClean) !== -1) return 6000;
    if (cClean.indexOf(qClean) !== -1) return 5500;

    var dist = levenshtein(qClean, cClean);
    var maxLen = Math.max(qClean.length, cClean.length);
    if (maxLen === 0) return 0;
    return Math.floor((1 - dist / maxLen) * 4000);
}

// ===== TMDB AUTO-DETECT (same logic as 4KHDHub) =====

function getTmdbInfoAuto(tmdbId) {
    var movieUrl = "https://api.themoviedb.org/3/movie/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    return fetchJson(movieUrl).then(function(data) {
        var title = data.title || "";
        var original = data.original_title || title;
        var year = (data.release_date || "").split("-")[0];
        return {
            type: "movie",
            title: title,
            original: original,
            year: year,
            raw: data
        };
    }).catch(function() {
        var tvUrl = "https://api.themoviedb.org/3/tv/" + tmdbId + "?api_key=" + TMDB_API_KEY;
        return fetchJson(tvUrl).then(function(data) {
            var title = data.name || "";
            var original = data.original_name || title;
            var year = (data.first_air_date || "").split("-")[0];
            return {
                type: "tv",
                title: title,
                original: original,
                year: year,
                raw: data
            };
        });
    }).catch(function() {
        return { type: "", title: "", original: "", year: "", raw: null };
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

// ===== KISSKH SPECIFIC =====

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

function searchKisskh(title) {
    var searchUrl = MAIN_URL + "/api/DramaList/Search?q=" + encodeURIComponent(title) + "&type=0";
    log("Searching KissKH: " + title);
    return fetchJson(searchUrl).then(function(searchList) {
        if (!searchList || !Array.isArray(searchList) || searchList.length === 0) {
            throw new Error("No KissKH results for: " + title);
        }

        var bestMatch = null;
        var bestScore = -1;

        for (var i = 0; i < searchList.length; i++) {
            var item = searchList[i];
            var itemTitle = item.title || "";
            // Strip year suffix like " (2026)" before scoring
            var itemTitleClean = itemTitle.replace(/\s*\(\d{4}\)\s*$/, "").trim();
            var score = similarityScore(title, itemTitleClean);

            log("Result " + (i + 1) + " : " + itemTitle + " - Score: " + score);

            if (score > bestScore) {
                bestScore = score;
                bestMatch = item;
            }
        }

        log("Best match: " + (bestMatch ? bestMatch.title : "None") + " Score: " + bestScore + " (threshold: 6000)");

        if (!bestMatch || bestScore < 6000) {
            throw new Error("No confident match found (score < 6000)");
        }

        log("Confirmed match: " + bestMatch.title + " (ID: " + bestMatch.id + ")");
        return bestMatch;
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
        log("Movie mode: using episode " + targetEp.number + " (ID: " + targetEp.id + ")");
        return targetEp;
    }

    // Debug: log all available episodes
    var epList = [];
    for (var i = 0; i < episodes.length; i++) {
        epList.push("#" + episodes[i].number + "(id=" + episodes[i].id + ")");
    }
    log("Available episodes: [" + epList.join(", ") + "]");

    var targetNum = parseInt(episodeNum, 10);

    // Strategy 1: Exact number match
    for (var i = 0; i < episodes.length; i++) {
        if (parseInt(episodes[i].number, 10) === targetNum) {
            targetEp = episodes[i];
            log("Exact match: episode " + targetEp.number + " (ID: " + targetEp.id + ")");
            return targetEp;
        }
    }

    // Strategy 2: Index-based fallback (episode 1 = index 0)
    var idx = targetNum - 1;
    if (idx >= 0 && idx < episodes.length) {
        targetEp = episodes[idx];
        log("Index fallback: requested ep " + targetNum + " -> index " + idx + " (number=" + targetEp.number + ", ID=" + targetEp.id + ")");
        return targetEp;
    }

    // Strategy 3: String contains match
    for (var i = 0; i < episodes.length; i++) {
        var numStr = String(episodes[i].number || "");
        if (numStr.indexOf(String(targetNum)) !== -1) {
            targetEp = episodes[i];
            log("String match: episode " + targetEp.number + " (ID: " + targetEp.id + ")");
            return targetEp;
        }
    }

    throw new Error("Episode " + episodeNum + " not found among " + episodes.length + " episodes");
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

// ===== ENTRY POINT (same signature as 4KHDHub) =====

function getStreams(tmdbId, season, episode) {
    // Backward compatibility: old signature was getStreams(tmdbId, mediaType, seasonNum, episodeNum)
    // Nuvio may still call with 4 args. Detect and remap.
    var mediaType = null;
    if (season === "movie" || season === "tv") {
        mediaType = season;
        season = episode;
        episode = arguments[3];
        log("Detected old signature (mediaType=" + mediaType + "), remapped to season=" + season + " episode=" + episode);
    }

    var seasonStr = season || "";
    var episodeStr = episode || "";
    log("getStreams called: " + tmdbId + " S" + seasonStr + "E" + episodeStr);

    // If season and episode are provided, force TV mode (avoids TMDB ID namespace collision)
    var forceTv = !!(season && episode);

    var tmdbPromise = forceTv
        ? fetchJson("https://api.themoviedb.org/3/tv/" + tmdbId + "?api_key=" + TMDB_API_KEY).then(function(data) {
            var title = data.name || "";
            var original = data.original_name || title;
            var year = (data.first_air_date || "").split("-")[0];
            return { type: "tv", title: title, original: original, year: year, raw: data };
        }).catch(function() {
            return { type: "", title: "", original: "", year: "", raw: null };
        })
        : getTmdbInfoAuto(tmdbId);

    return tmdbPromise.then(function(tmdbData) {
        if (!tmdbData.type) {
            log("Could not detect media type for TMDB ID: " + tmdbId);
            return [];
        }
        var mediaType = tmdbData.type;
        log("Detected type: " + mediaType + " | Title: " + tmdbData.title + " | Year: " + tmdbData.year);

        if (mediaType === "tv" && (!season || !episode)) {
            log("TV show requires season and episode parameters");
            return [];
        }

        var epPromise = (mediaType === "tv")
            ? getTmdbEpisodeTitle(tmdbId, season, episode)
            : Promise.resolve("");

        return epPromise.then(function(epTitle) {
            return searchKisskh(tmdbData.title).then(function(drama) {
                return getDramaDetail(drama.id).then(function(detail) {
                    return { drama: drama, detail: detail };
                });
            }).then(function(info) {
                var targetEp = findEpisode(info.detail.episodes, mediaType, episode);
                return { drama: info.drama, episode: targetEp };
            }).then(function(info) {
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
            }).then(function(streams) {
                log("Returning " + streams.length + " streams");
                return streams;
            });
        });
    }).catch(function(err) {
        log("Error: " + err.message);
        return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
} else if (typeof global !== "undefined") {
    global.getStreams = getStreams;
}
