// OK.ru (Odnoklassniki) Plugin for Nuvio
// Extracts direct MP4/HLS URLs from video embed pages
// Tested and working - returns 6 streams (HLS + 5 MP4 qualities)

var MAIN_URL = "https://ok.ru";
var EMBED_URL = "https://ok.ru/videoembed";

function log(msg) {
    console.log("[OKru] " + msg);
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

function unescapeHtml(text) {
    if (!text) return text;
    return text
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

function fetchHtml(url, headers) {
    var opts = { headers: headers || {} };
    return fetch(url, opts)
        .then(function(response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.text();
        });
}

function extractDataOptions(html) {
    log("Extracting data-options from embed page...");

    var match = html.match(/data-options=(['"])(\{.+?\})\1/);
    if (match && match[2]) {
        log("Found data-options (pattern 1)");
        return unescapeHtml(match[2]);
    }

    match = html.match(/data-options='(\{.+?\})'/);
    if (match && match[1]) {
        log("Found data-options (pattern 2)");
        return unescapeHtml(match[1]);
    }

    match = html.match(/data-options=([^\s>]+)/);
    if (match && match[1]) {
        log("Found data-options (pattern 3)");
        return unescapeHtml(match[1]);
    }

    log("Could not find data-options in HTML");
    return null;
}

function parseMetadata(dataOptionsStr) {
    var data = safeJsonParse(dataOptionsStr);
    if (!data) {
        log("Failed to parse data-options JSON");
        return null;
    }

    log("data-options keys: " + Object.keys(data).join(", "));

    var flashvars = data.flashvars || data;
    if (!flashvars) {
        log("No flashvars found");
        return null;
    }

    var metadata = flashvars.metadata;
    if (!metadata && typeof flashvars === "string") {
        try {
            metadata = JSON.parse(flashvars);
        } catch (e) {
            log("flashvars is not valid JSON string");
        }
    }

    if (!metadata) {
        log("No metadata found");
        return null;
    }

    if (typeof metadata === "string") {
        try {
            metadata = JSON.parse(metadata);
        } catch (e) {
            log("metadata is not valid JSON string");
            return null;
        }
    }

    log("Metadata keys: " + Object.keys(metadata).join(", "));
    return metadata;
}

function extractVideoUrls(metadata) {
    var streams = [];

    if (!metadata) {
        log("No metadata to extract from");
        return streams;
    }

    var movie = metadata.movie || {};
    var videos = metadata.videos || movie.videos || [];

    if (!Array.isArray(videos) || videos.length === 0) {
        log("No videos array found");
        if (metadata.url) {
            videos = [{ name: "default", url: metadata.url }];
        } else {
            return streams;
        }
    }

    log("Found " + videos.length + " quality variants");

    var qualityMap = {
        "mobile":  { label: "144p",  height: 144,  order: 1 },
        "lowest":  { label: "240p",  height: 240,  order: 2 },
        "low":     { label: "360p",  height: 360,  order: 3 },
        "sd":      { label: "480p",  height: 480,  order: 4 },
        "hd":      { label: "720p",  height: 720,  order: 5 },
        "full":    { label: "1080p", height: 1080, order: 6 },
        "quad":    { label: "1440p", height: 1440, order: 7 },
        "ultra":   { label: "4K",    height: 2160, order: 8 }
    };

    for (var i = 0; i < videos.length; i++) {
        var video = videos[i];
        if (!video || !video.url || video.disallowed) continue;

        var name = video.name || "unknown";
        var quality = qualityMap[name] || { label: name.toUpperCase(), height: 0, order: 99 };

        streams.push({
            name: name,
            label: quality.label,
            height: quality.height,
            order: quality.order,
            url: video.url
        });
    }

    streams.sort(function(a, b) { return b.order - a.order; });
    return streams;
}

function extractHlsUrl(metadata) {
    if (!metadata) return null;

    var hlsFields = ["hlsManifestUrl", "hlsUrl", "manifestUrl", "m3u8Url"];
    for (var i = 0; i < hlsFields.length; i++) {
        if (metadata[hlsFields[i]]) {
            log("Found HLS URL: " + metadata[hlsFields[i]].substring(0, 60));
            return metadata[hlsFields[i]];
        }
    }
    return null;
}

function getVideoInfo(videoId) {
    var embedUrl = EMBED_URL + "/" + videoId;
    log("Fetching embed page: " + embedUrl);

    return fetchHtml(embedUrl, {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": MAIN_URL + "/"
    }).then(function(html) {
        if (!html || html.length === 0) {
            throw new Error("Empty embed page");
        }

        log("Embed page length: " + html.length);

        if (html.indexOf("vp_video_stub_txt") !== -1 || html.indexOf("not available") !== -1) {
            throw new Error("Video not available (region locked or removed)");
        }

        var dataOptionsStr = extractDataOptions(html);
        if (!dataOptionsStr) {
            throw new Error("Could not extract data-options");
        }

        var metadata = parseMetadata(dataOptionsStr);
        if (!metadata) {
            throw new Error("Could not parse metadata");
        }

        var movie = metadata.movie || {};

        return {
            id: videoId,
            title: movie.title || "OK.ru Video",
            duration: movie.duration || "0",
            poster: movie.poster || "",
            videos: extractVideoUrls(metadata),
            hlsUrl: extractHlsUrl(metadata),
            metadata: metadata
        };
    });
}

function toNuvioStreams(videoInfo) {
    var streams = [];

    if (!videoInfo) {
        log("No video info to convert");
        return streams;
    }

    var title = videoInfo.title || "OK.ru Video";
    var baseHeaders = {
        "Origin": MAIN_URL,
        "Referer": EMBED_URL + "/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    };

    // HLS stream
    if (videoInfo.hlsUrl) {
        streams.push({
            name: "OKru | Auto | HLS",
            title: title + " | Auto | OK.ru",
            url: videoInfo.hlsUrl,
            quality: "Auto",
            provider: "okru",
            headers: baseHeaders
        });
        log("Added HLS stream");
    }

    // MP4 streams
    var videos = videoInfo.videos || [];
    for (var i = 0; i < videos.length; i++) {
        var video = videos[i];
        if (!video || !video.url) continue;

        streams.push({
            name: "OKru | " + video.label + " | MP4",
            title: title + " | " + video.label + " | OK.ru",
            url: video.url,
            quality: video.label,
            provider: "okru",
            headers: baseHeaders
        });
        log("Added MP4 stream: " + video.label);
    }

    return streams;
}

// Main entry point - uses OK.ru video ID directly
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    log("Starting for OK.ru video ID: " + tmdbId);

    var videoId = String(tmdbId);

    return getVideoInfo(videoId)
        .then(function(videoInfo) {
            var streams = toNuvioStreams(videoInfo);
            log("Returning " + streams.length + " streams");
            return streams;
        })
        .catch(function(err) {
            log("Error: " + err.message);
            return [];
        });
}

// Export
if (typeof module !== "undefined" && module.exports) {
    module.exports = { 
        getStreams: getStreams,
        getVideoInfo: getVideoInfo
    };
} else if (typeof global !== "undefined") {
    global.getStreams = getStreams;
    global.getVideoInfo = getVideoInfo;
}
