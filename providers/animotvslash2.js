// providers/animotvslash.js
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

const TMDB_API_KEY = '6dc830f9624b43261325bed3bf7d0dfa';

// ------------------------------------------------------------------
// ONE PIECE SEASON OFFSETS (adjust as needed)
// ------------------------------------------------------------------
const ONE_PIECE_SEASON_OFFSET = {
  1: 1,
  2: 62,
  3: 93,
  4: 131,
  5: 159,
  6: 196,
  7: 207,
  8: 230,
  9: 264,
  10: 279,
  11: 293,
  12: 303,
  13: 317,
  14: 337,
  15: 354,
  16: 382,
  17: 391,
  18: 409,
  19: 419,
  20: 430,
  21: 446,
  22: 460,
  23: 1156,
};

// ------------------------------------------------------------------
// MANUAL VIDEO MAPPING – for episodes that need a direct URL
// ------------------------------------------------------------------
const VIDEO_MAP = {
  // Example: "one-piece-episode-1161": "https://rumble.com/hls-vod/77h4iq/playlist.m3u8",
};

// ------------------------------------------------------------------
// SLUG OVERRIDES – for anime where the auto‑generated slug is wrong
// ------------------------------------------------------------------
const SLUG_OVERRIDES = {
  "303460": "the-strongest-occupation-is-not-a-hero-or-a-sage-but-an-appraiser-provisional",
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://animotvslash.org/',
};

const VIDEO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://animotvslash.org/',
  'Accept': 'video/webm,video/ogg,video/*;q=0.9,*/*;q=0.5',
};

// ------------------------------------------------------------------
// Helper functions
// ------------------------------------------------------------------
async function fetchHTMLWithRedirect(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    const finalUrl = res.url;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return { html, finalUrl };
  } catch (err) {
    console.error(`[animotvslash] fetch error ${url}:`, err.message);
    return { html: null, finalUrl: url };
  }
}

async function fetchHTML(url) {
  const { html } = await fetchHTMLWithRedirect(url);
  return html;
}

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function getTmdbInfoAuto(tmdbId) {
    var movieUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
    return fetchJSON(movieUrl).then(function(data) {
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
        var tvUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
        return fetchJSON(tvUrl).then(function(data) {
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
    var url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}`;
    return fetchJSON(url).then(function(data) {
        return data.name || "";
    }).catch(function() {
        return "";
    });
}

function slugify(title) {
  return title.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getAllPlayerUrls(html, baseUrl) {
  const $ = cheerio.load(html);
  const urls = new Set();

  $('iframe').each((i, el) => {
    let src = $(el).attr('src');
    if (src) urls.add(src);
  });

  $('source').each((i, el) => {
    let src = $(el).attr('src');
    if (src) urls.add(src);
  });

  $('[data-src], [data-url], [data-video]').each((i, el) => {
    let src = $(el).attr('data-src') || $(el).attr('data-url') || $(el).attr('data-video');
    if (src) urls.add(src);
  });

  $('script').each((i, el) => {
    const script = $(el).html();
    if (!script) return;
    let match = script.match(/["'](?:file|source)["']\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"]*)["']/i);
    if (match) urls.add(match[1]);
    match = script.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/gi);
    if (match) match.forEach(u => urls.add(u));
  });

  const directMatches = html.match(/(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/gi);
  if (directMatches) directMatches.forEach(u => urls.add(u));

  const absolute = new Set();
  for (let url of urls) {
    if (url.startsWith('http')) absolute.add(url);
    else if (url.startsWith('/')) absolute.add(baseUrl.replace(/\/$/, '') + url);
    else if (url.startsWith('//')) absolute.add('https:' + url);
  }
  return Array.from(absolute);
}

async function getPostId(pageHtml, slug) {
  let match = pageHtml.match(/<link rel="shortlink" href="[^"]*\?p=(\d+)"/);
  if (match) return match[1];
  match = pageHtml.match(/"post_id":"(\d+)"/);
  if (match) return match[1];
  match = pageHtml.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/);
  if (match) return match[1];

  const apiUrl = `https://animotvslash.org/wp-json/wp/v2/posts?slug=${slug}`;
  const data = await fetchJSON(apiUrl);
  if (data && data.length > 0) return data[0].id;
  return null;
}

async function fetchDooplayerUrl(postId, mediaType, episode) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const apiUrl = `https://animotvslash.org/wp-json/dooplayer/v2/${postId}/${type}/${episode}`;
  const data = await fetchJSON(apiUrl);
  if (data && data.embed_url) return data.embed_url;
  if (data && data.source) return data.source;
  return null;
}

function decodeJwPlayerUrl(url) {
  const match = url.match(/\/jw-player\/([^/?&#]+)/);
  if (!match) return url;
  let b64 = match[1];
  while (b64.length % 4) b64 += '=';
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const decoded = atob(b64);
    const data = JSON.parse(decoded);
    if (data.url) return data.url;
  } catch (e) {}
  return url;
}

// ------------------------------------------------------------------
// URL fallback resolver
// ------------------------------------------------------------------
async function resolvePageWithFallbacks(candidateUrls) {
    for (let i = 0; i < candidateUrls.length; i++) {
        const url = candidateUrls[i];
        console.log(`[animotvslash] Trying URL (${i + 1}/${candidateUrls.length}): ${url}`);
        const result = await fetchHTMLWithRedirect(url);
        if (result.html) {
            // Check if page actually has player data (avoid 404 soft pages)
            const players = getAllPlayerUrls(result.html, url);
            const hasPostId = result.html.match(/<link rel="shortlink" href="[^"]*\?p=(\d+)"/) ||
                              result.html.match(/"post_id":"(\d+)"/) ||
                              result.html.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/);
            if (players.length > 0 || hasPostId) {
                console.log(`[animotvslash] Valid page found at: ${url}`);
                return { html: result.html, finalUrl: result.finalUrl, pageUrl: url };
            }
            // If html exists but no players/postId, keep trying
            console.log(`[animotvslash] Page loaded but no players found, continuing...`);
        }
    }
    return { html: null, finalUrl: null, pageUrl: null };
}

// ------------------------------------------------------------------
// Main exported function
// ------------------------------------------------------------------
async function getStreams(tmdbId, season, episode) {
    // Backward compatibility: old signature was getStreams(tmdbId, mediaType, seasonNum, episodeNum)
    var mediaType = null;
    if (season === "movie" || season === "tv") {
        mediaType = season;
        season = episode;
        episode = arguments[3];
        console.log(`[animotvslash] Detected old signature (mediaType=${mediaType}), remapped to season=${season} episode=${episode}`);
    }

    var seasonStr = season || "";
    var episodeStr = episode || "";
    var seasonNum = parseInt(season, 10) || 1;
    var episodeNum = parseInt(episode, 10) || 1;
    console.log(`[animotvslash] === START for TMDB ID:${tmdbId} S${seasonStr}E${episodeStr} ===`);

    // ==========================================================================
    // SPECIAL CASE: One Piece (TMDB ID 37854) – absolute episode numbers
    // ==========================================================================
    if (Number(tmdbId) === 37854) {
        const offset = ONE_PIECE_SEASON_OFFSET[seasonNum];
        if (offset !== undefined) {
            const absoluteEp = offset + (episodeNum - 1);
            const absoluteUrl = `https://animotvslash.org/one-piece-episode-${absoluteEp}/`;
            console.log(`[animotvslash] One Piece: S${seasonNum}E${episodeNum} → absolute episode ${absoluteEp} → ${absoluteUrl}`);

            const { html, finalUrl } = await fetchHTMLWithRedirect(absoluteUrl);
            if (html) {
                if (finalUrl && (finalUrl.includes('p2pplay.pro') || finalUrl.includes('.p2pplay.pro'))) {
                    return [{
                        name: `ANIMOTVSLASH - P2P Stream (Open in Browser)`,
                        title: `Episode ${absoluteEp}`,
                        url: finalUrl,
                        quality: 'Auto',
                        headers: VIDEO_HEADERS,
                        provider: 'animotvslash',
                        behaviorHints: { notWebReady: true }
                    }];
                }

                let playerUrls = getAllPlayerUrls(html, absoluteUrl);
                if (playerUrls.length === 0) {
                    const postId = await getPostId(html, 'one-piece');
                    if (postId) {
                        const apiUrl = await fetchDooplayerUrl(postId, 'tv', absoluteEp);
                        if (apiUrl) playerUrls.push(apiUrl);
                    }
                }

                const streams = [];
                const seen = new Set();
                for (let url of playerUrls) {
                    if (seen.has(url)) continue;
                    seen.add(url);
                    const videoUrl = decodeJwPlayerUrl(url);
                    streams.push({
                        name: `ANIMOTVSLASH - Stream ${streams.length + 1}`,
                        title: `Episode ${absoluteEp}`,
                        url: videoUrl,
                        quality: 'Auto',
                        headers: VIDEO_HEADERS,
                        provider: 'animotvslash'
                    });
                }
                return streams;
            }
        }
        // fall through to normal extraction
    }

    // ==========================================================================
    // TMDB AUTO-DETECT
    // ==========================================================================
    var forceTv = !!(season && episode);
    var tmdbPromise = forceTv
        ? fetchJSON(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`).then(function(data) {
            if (!data) throw new Error("TV not found");
            var title = data.name || "";
            var original = data.original_name || title;
            var year = (data.first_air_date || "").split("-")[0];
            return { type: "tv", title: title, original: original, year: year, raw: data };
        }).catch(function() {
            return { type: "", title: "", original: "", year: "", raw: null };
        })
        : getTmdbInfoAuto(tmdbId);

    var tmdbData = await tmdbPromise;
    if (!tmdbData.type) {
        console.log(`[animotvslash] Could not detect media type for TMDB ID: ${tmdbId}`);
        return [];
    }
    mediaType = tmdbData.type;
    console.log(`[animotvslash] Detected type: ${mediaType} | Title: ${tmdbData.title} | Year: ${tmdbData.year}`);

    if (mediaType === "tv" && (!season || !episode)) {
        console.log("[animotvslash] TV show requires season and episode parameters");
        return [];
    }

    // ==========================================================================
    // NORMAL EXTRACTION (all other anime, including One Piece fallback)
    // ==========================================================================
    try {
        const title = tmdbData.title;
        if (!title) {
            console.log('[animotvslash] TMDB title not found');
            return [];
        }
        console.log(`[animotvslash] TMDB title: "${title}"`);

        let baseSlug = slugify(title);
        if (SLUG_OVERRIDES[tmdbId]) {
            baseSlug = SLUG_OVERRIDES[tmdbId];
            console.log(`[animotvslash] using override slug: ${baseSlug}`);
        }

        const episodeKey = `${baseSlug}-episode-${episodeNum}`;
        if (VIDEO_MAP[episodeKey]) {
            console.log(`[animotvslash] Using manual mapping for ${episodeKey}`);
            return [{
                name: `ANIMOTVSLASH - Manual`,
                title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
                url: VIDEO_MAP[episodeKey],
                quality: 'Auto',
                headers: VIDEO_HEADERS,
                provider: 'animotvslash',
                behaviorHints: { notWebReady: !VIDEO_MAP[episodeKey].match(/\.(mp4|m3u8)$/i) }
            }];
        }

        // Build candidate URLs with fallbacks
        let candidateUrls = [];
        if (mediaType === 'tv') {
            if (seasonNum > 1) {
                candidateUrls.push(`https://animotvslash.org/${baseSlug}-season-${seasonNum}-episode-${episodeNum}/`);
            }
            candidateUrls.push(`https://animotvslash.org/${baseSlug}-episode-${episodeNum}/`);
        } else {
            // Movie: try bare slug first, then episode-1 fallback
            candidateUrls.push(`https://animotvslash.org/${baseSlug}/`);
            candidateUrls.push(`https://animotvslash.org/${baseSlug}-episode-1/`);
        }

        const pageResult = await resolvePageWithFallbacks(candidateUrls);
        if (!pageResult.html) {
            console.log('[animotvslash] All candidate URLs failed');
            return [];
        }

        const { html, finalUrl, pageUrl } = pageResult;

        if (finalUrl && (finalUrl.includes('p2pplay.pro') || finalUrl.includes('.p2pplay.pro'))) {
            return [{
                name: `ANIMOTVSLASH - P2P Stream (Open in Browser)`,
                title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
                url: finalUrl,
                quality: 'Auto',
                headers: VIDEO_HEADERS,
                provider: 'animotvslash',
                behaviorHints: { notWebReady: true }
            }];
        }

        let playerUrls = getAllPlayerUrls(html, pageUrl);
        console.log(`[animotvslash] Found ${playerUrls.length} URLs from HTML`);

        if (playerUrls.length === 0) {
            // Determine episode number for dooplayer: movies use 1 if we fell back to episode-1 URL
            const dooEpisode = (mediaType === 'movie' && pageUrl.includes('-episode-1')) ? 1 : episodeNum;
            const postId = await getPostId(html, baseSlug);
            if (postId) {
                const apiUrl = await fetchDooplayerUrl(postId, mediaType, dooEpisode);
                if (apiUrl) playerUrls.push(apiUrl);
            }
        }

        const streams = [];
        const seen = new Set();
        for (let url of playerUrls) {
            if (seen.has(url)) continue;
            seen.add(url);
            const videoUrl = decodeJwPlayerUrl(url);
            streams.push({
                name: `ANIMOTVSLASH - Stream ${streams.length + 1}`,
                title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
                url: videoUrl,
                quality: 'Auto',
                headers: VIDEO_HEADERS,
                provider: 'animotvslash'
            });
        }

        console.log(`[animotvslash] Returning ${streams.length} stream(s)`);
        return streams;
    } catch (err) {
        console.error('[animotvslash] error:', err.message);
        return [];
    }
}

module.exports = { getStreams };
