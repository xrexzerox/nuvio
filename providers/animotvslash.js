// providers/animotvslash.js
let cheerio;
try {
  cheerio = require('cheerio-without-node-native');
} catch (e) {
  cheerio = require('cheerio');
}

const TMDB_API_KEY = '6dc830f9624b43261325bed3bf7d0dfa';

const ONE_PIECE_SEASON_OFFSET = {
  1: 1, 2: 62, 3: 93, 4: 131, 5: 159, 6: 196, 7: 207, 8: 230,
  9: 264, 10: 279, 11: 293, 12: 303, 13: 317, 14: 337, 15: 354,
  16: 382, 17: 391, 18: 409, 19: 419, 20: 430, 21: 446, 22: 460, 23: 1156,
};

const SLUG_OVERRIDES = {
  "303460": "the-strongest-occupation-is-not-a-hero-or-a-sage-but-an-appraiser-provisional",
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://animotvslash.org/',
};

const EMBED_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://tryembed.us.cc',
  'Referer': 'https://tryembed.us.cc/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

// Token cache to avoid repeated API calls
const tokenCache = {};

let cookieJar = {};

function extractCookies(response) {
  const cookies = {};
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    setCookie.split(',').forEach(cookie => {
      const match = cookie.match(/^([^=]+)=([^;]+)/);
      if (match) cookies[match[1].trim()] = match[2].trim();
    });
  }
  return cookies;
}

function buildCookieHeader() {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function mergeCookies(newCookies) {
  cookieJar = { ...cookieJar, ...newCookies };
}

async function fetchWithCookies(url, options = {}) {
  const cookieHeader = buildCookieHeader();
  const headers = {
    ...(options.headers || HEADERS),
    ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
  };

  const res = await fetch(url, {
    ...options,
    headers,
    redirect: 'follow',
  });

  const newCookies = extractCookies(res);
  if (Object.keys(newCookies).length > 0) {
    mergeCookies(newCookies);
  }

  return res;
}

async function fetchHTMLWithCookies(url) {
  try {
    const res = await fetchWithCookies(url, { headers: HEADERS });
    const finalUrl = res.url;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return { html, finalUrl };
  } catch (err) {
    console.error(`[animotvslash] fetch error ${url}:`, err.message);
    return { html: null, finalUrl: url };
  }
}

async function fetchJSONWithCookies(url, customHeaders) {
  try {
    const res = await fetchWithCookies(url, { headers: customHeaders || HEADERS });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function slugify(title) {
  return title.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getTmdbInfoAuto(tmdbId) {
    var movieUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
    return fetchJSONWithCookies(movieUrl).then(function(data) {
        var title = data.title || "";
        var original = data.original_title || title;
        var year = (data.release_date || "").split("-")[0];
        return { type: "movie", title: title, original: original, year: year, raw: data };
    }).catch(function() {
        var tvUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
        return fetchJSONWithCookies(tvUrl).then(function(data) {
            var title = data.name || "";
            var original = data.original_name || title;
            var year = (data.first_air_date || "").split("-")[0];
            return { type: "tv", title: title, original: original, year: year, raw: data };
        });
    }).catch(function() {
        return { type: "", title: "", original: "", year: "", raw: null };
    });
}

async function getPostId(pageHtml, slug) {
  let match = pageHtml.match(/<link rel="shortlink" href="[^"]*\?p=(\d+)"/);
  if (match) return match[1];
  match = pageHtml.match(/"post_id":"(\d+)"/);
  if (match) return match[1];
  match = pageHtml.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/);
  if (match) return match[1];
  match = pageHtml.match(/data-post-id="(\d+)"/);
  if (match) return match[1];
  match = pageHtml.match(/\?p=(\d+)/);
  if (match) return match[1];

  const apiUrl = `https://animotvslash.org/wp-json/wp/v2/posts?slug=${slug}`;
  const data = await fetchJSONWithCookies(apiUrl);
  if (data && data.length > 0) return data[0].id;

  return null;
}

function extractAnimeId(html, postId) {
  const embedMatch = html.match(/tryembed\.us\.cc\/embed\/anime\/(\d+)/);
  if (embedMatch) return embedMatch[1];

  const dataMatch = html.match(/data-anime-id=["'](\d+)["']/i);
  if (dataMatch) return dataMatch[1];

  const jsMatch = html.match(/anime[_-]?id\s*[:=]\s*["']?(\d+)["']?/i);
  if (jsMatch) return jsMatch[1];

  const jsonMatch = html.match(/"animeId"\s*:\s*(\d+)/);
  if (jsonMatch) return jsonMatch[1];

  const anyEmbed = html.match(/tryembed[^\d]*(\d{3,})/i);
  if (anyEmbed) return anyEmbed[1];

  if (postId) {
    console.log(`[animotvslash] Fallback: post_id=${postId} as anime_id`);
    return postId;
  }

  return null;
}

async function getEmbedUrl(postId, pageHtml, episodeNum) {
  const htmlEmbed = scrapeEmbedFromHtml(pageHtml);
  if (htmlEmbed) {
    console.log(`[animotvslash] HTML scrape: ${htmlEmbed}`);
    return htmlEmbed;
  }

  const animeId = extractAnimeId(pageHtml, postId);
  if (animeId) {
    const constructed = `https://tryembed.us.cc/embed/anime/${animeId}/${episodeNum}/sub`;
    console.log(`[animotvslash] Constructed: ${constructed}`);
    return constructed;
  }

  const ajaxActions = ['dynamic_view_ajax', 'dooplay_player', 'get_player', 'load_embed', 'doo_player'];
  for (const action of ajaxActions) {
    const result = await tryAdminAjax(postId, action, episodeNum);
    if (result) return result;
  }

  return null;
}

function scrapeEmbedFromHtml(html) {
  const iframeMatch = html.match(/<iframe[^>]*src=["']([^"']*tryembed[^"']*)["']/i);
  if (iframeMatch) return iframeMatch[1];

  const matches = html.match(/https:\/\/tryembed\.us\.cc\/[^"'\s<>]+/gi);
  if (matches) {
    const embed = matches.find(u => u.includes('/embed/'));
    if (embed) return embed;
  }

  const dataMatch = html.match(/data-embed=["']([^"']+)["']/i);
  if (dataMatch) return dataMatch[1];

  return null;
}

async function tryAdminAjax(postId, action, episodeNum) {
  const formData = new URLSearchParams();
  formData.append('action', action);
  formData.append('post_id', postId);
  formData.append('nume', episodeNum);
  formData.append('type', 'tv');

  try {
    const res = await fetchWithCookies('https://animotvslash.org/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://animotvslash.org',
        'Referer': `https://animotvslash.org/`,
      },
      body: formData.toString(),
    });

    if (!res.ok) return null;

    const text = await res.text();

    if (text.includes('"views"') && !text.includes('iframe') && !text.includes('embed') && !text.includes('tryembed')) {
      console.log(`[animotvslash] action=${action} returned views only`);
      return null;
    }

    console.log(`[animotvslash] action=${action} raw: ${text.substring(0, 300)}`);

    const iframeMatch = text.match(/<iframe[^>]*src=["']([^"']+)["']/i);
    if (iframeMatch) return iframeMatch[1];

    try {
      const json = JSON.parse(text);
      if (json.data) {
        const html = json.data.replace(/\\"/g, '"').replace(/\\\//g, '/');
        const match = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
        if (match) return match[1];
      }
      if (json.embed_url) return json.embed_url;
      if (json.url) return json.url;
      if (json.iframe) return json.iframe;
    } catch (e) {}

    return null;
  } catch (err) {
    return null;
  }
}

// ------------------------------------------------------------------
// TOKEN TO STREAM URL — With rate limit handling
// ------------------------------------------------------------------

/**
 * Converts a provider token to a signed m3u8 URL
 * Handles 429 rate limits with retry
 */
async function resolveToken(token, embedUrl, retryCount = 0) {
  const cacheKey = `${token}`;
  if (tokenCache[cacheKey]) {
    console.log(`[animotvslash] [token] Cache hit`);
    return tokenCache[cacheKey];
  }

  const signedUrl = `https://tryembed.us.cc/s/${token}.m3u8`;
  console.log(`[animotvslash] [token] Resolving: ${signedUrl.substring(0, 80)}...`);

  try {
    const getRes = await fetchWithCookies(signedUrl, {
      method: 'GET',
      headers: {
        ...EMBED_HEADERS,
        'Referer': embedUrl,
      },
      redirect: 'follow',
    });

    console.log(`[animotvslash] [token] GET status: ${getRes.status}`);

    if (getRes.status === 429 && retryCount < 3) {
      // Rate limited — wait and retry
      const delay = Math.pow(2, retryCount) * 1000;
      console.log(`[animotvslash] [token] 429, retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return resolveToken(token, embedUrl, retryCount + 1);
    }

    if (getRes.ok) {
      const finalUrl = getRes.url;
      console.log(`[animotvslash] [token] Final URL: ${finalUrl.substring(0, 100)}...`);

      // Cache the result
      tokenCache[cacheKey] = finalUrl;

      return finalUrl;
    }

    console.log(`[animotvslash] [token] GET failed: ${getRes.status}`);
    return null;

  } catch (err) {
    console.error(`[animotvslash] [token] Error: ${err.message}`);
    return null;
  }
}

// ------------------------------------------------------------------
// STREAM DATA API
// ------------------------------------------------------------------
async function extractTryEmbed(embedUrl) {
  console.log(`[animotvslash] [tryembed] Extracting: ${embedUrl}`);

  const match = embedUrl.match(/\/embed\/anime\/(\d+)\/(\d+)\/(sub|dub)/);
  if (!match) {
    console.log(`[animotvslash] [tryembed] URL format mismatch`);
    return [];
  }

  const [, animeId, episode, audio] = match;
  console.log(`[animotvslash] [tryembed] animeId=${animeId}, ep=${episode}, audio=${audio}`);

  const apiUrl = `https://tryembed.us.cc/api/stream_data?id=${animeId}&episode=${episode}&audio=${audio}`;
  console.log(`[animotvslash] [tryembed] API: ${apiUrl}`);

  const streamData = await fetchJSONWithCookies(apiUrl, {
    ...EMBED_HEADERS,
    'Referer': embedUrl,
  });

  if (!streamData) {
    console.log(`[animotvslash] [tryembed] API no response`);
    return [];
  }

  console.log(`[animotvslash] [tryembed] API keys: ${Object.keys(streamData).join(', ')}`);

  const providers = streamData.providers || streamData.sources || streamData.streams;

  if (providers && Array.isArray(providers) && providers.length > 0) {
    console.log(`[animotvslash] [tryembed] Found ${providers.length} provider(s)`);

    const results = [];

    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      const providerName = provider.name || provider.server || provider.id || `Server ${i + 1}`;
      const providerType = provider.type || 'hls';

      console.log(`[animotvslash] [tryembed] Provider ${i}: ${providerName} (type=${providerType})`);

      const qualities = provider.qualities || provider.sources || [{ name: 'Auto', token: provider.token || provider.url }];

      if (!qualities || !Array.isArray(qualities)) {
        console.log(`[animotvslash] [tryembed] Provider ${i} has no qualities`);
        continue;
      }

      for (let j = 0; j < qualities.length; j++) {
        const quality = qualities[j];
        const qualityName = quality.name || quality.label || `Quality ${j + 1}`;
        const token = quality.token || quality.url || quality.file || quality.src;
        const fallbackToken = quality.fallbackToken;

        if (!token) {
          console.log(`[animotvslash] [tryembed] Quality ${j} has no token`);
          continue;
        }

        console.log(`[animotvslash] [tryembed] Quality ${j}: ${qualityName}`);

        // Resolve token to stream URL
        let streamUrl = await resolveToken(token, embedUrl);

        // If primary fails, try fallback
        if (!streamUrl && fallbackToken) {
          console.log(`[animotvslash] [tryembed] Trying fallback token`);
          streamUrl = await resolveToken(fallbackToken, embedUrl);
        }

        if (streamUrl) {
          results.push({
            url: streamUrl,
            name: `${providerName} - ${qualityName}`,
            type: providerType,
          });
        }
      }
    }

    return results;
  }

  // Fallback: single url field
  const signedUrl = streamData.url || streamData.source || streamData.stream || streamData.m3u8;
  if (signedUrl) {
    console.log(`[animotvslash] [tryembed] Single URL: ${signedUrl.substring(0, 80)}...`);

    try {
      const getRes = await fetchWithCookies(signedUrl, {
        method: 'GET',
        headers: {
          ...EMBED_HEADERS,
          'Referer': embedUrl,
        },
        redirect: 'follow',
      });

      if (getRes.ok) {
        return [{ url: getRes.url, name: 'Auto', type: 'hls' }];
      }
      return [];
    } catch (err) {
      console.error(`[animotvslash] [tryembed] redirect error: ${err.message}`);
      return [];
    }
  }

  console.log(`[animotvslash] [tryembed] No stream URL found`);
  return [];
}

// ------------------------------------------------------------------
// URL fallback resolver
// ------------------------------------------------------------------
async function resolvePageWithFallbacks(candidateUrls) {
    for (let i = 0; i < candidateUrls.length; i++) {
        const url = candidateUrls[i];
        console.log(`[animotvslash] Trying URL (${i + 1}/${candidateUrls.length}): ${url}`);
        const result = await fetchHTMLWithCookies(url);
        if (result.html) {
            const hasPostId = result.html.match(/<link rel="shortlink" href="[^"]*\?p=(\d+)"/) ||
                              result.html.match(/"post_id":"(\d+)"/) ||
                              result.html.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/);
            if (hasPostId) {
                console.log(`[animotvslash] Valid page: ${url}`);
                return { html: result.html, finalUrl: result.finalUrl, pageUrl: url };
            }
        }
    }
    return { html: null, finalUrl: null, pageUrl: null };
}

// ------------------------------------------------------------------
// Main exported function
// ------------------------------------------------------------------
async function getStreams(tmdbId, season, episode) {
    cookieJar = {};

    var mediaType = null;
    if (season === "movie" || season === "tv") {
        mediaType = season;
        season = episode;
        episode = arguments[3];
    }

    var seasonStr = season || "";
    var episodeStr = episode || "";
    var seasonNum = parseInt(season, 10) || 1;
    var episodeNum = parseInt(episode, 10) || 1;
    console.log(`[animotvslash] === START TMDB:${tmdbId} S${seasonStr}E${episodeStr} ===`);

    var forceTv = !!(season && episode);
    var tmdbPromise = forceTv
        ? fetchJSONWithCookies(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`).then(function(data) {
            if (!data) throw new Error("TV not found");
            return { type: "tv", title: data.name || "", original: data.original_name || "", year: (data.first_air_date || "").split("-")[0], raw: data };
        }).catch(function() { return { type: "", title: "", original: "", year: "", raw: null }; })
        : getTmdbInfoAuto(tmdbId);

    var tmdbData = await tmdbPromise;
    if (!tmdbData.type) {
        console.log(`[animotvslash] Could not detect type for TMDB:${tmdbId}`);
        return [];
    }
    mediaType = tmdbData.type;
    console.log(`[animotvslash] Type: ${mediaType} | Title: "${tmdbData.title}"`);

    if (mediaType === "tv" && (!season || !episode)) {
        console.log("[animotvslash] TV requires season+episode");
        return [];
    }

    try {
        const title = tmdbData.title;
        if (!title) {
            console.log('[animotvslash] No TMDB title');
            return [];
        }

        let baseSlug = slugify(title);
        if (SLUG_OVERRIDES[tmdbId]) {
            baseSlug = SLUG_OVERRIDES[tmdbId];
            console.log(`[animotvslash] Override slug: ${baseSlug}`);
        }

        let candidateUrls = [];
        if (mediaType === 'tv') {
            if (seasonNum > 1) {
                candidateUrls.push(`https://animotvslash.org/${baseSlug}-season-${seasonNum}-episode-${episodeNum}/`);
            }
            candidateUrls.push(`https://animotvslash.org/${baseSlug}-episode-${episodeNum}/`);
        } else {
            candidateUrls.push(`https://animotvslash.org/${baseSlug}/`);
            candidateUrls.push(`https://animotvslash.org/${baseSlug}-episode-1/`);
        }

        const pageResult = await resolvePageWithFallbacks(candidateUrls);
        if (!pageResult.html) {
            console.log('[animotvslash] All URLs failed');
            return [];
        }

        const { html, pageUrl } = pageResult;

        const postId = await getPostId(html, baseSlug);
        if (!postId) {
            console.log('[animotvslash] No post_id found');
            return [];
        }
        console.log(`[animotvslash] post_id: ${postId}`);

        const embedUrl = await getEmbedUrl(postId, html, episodeNum);

        const streams = [];

        if (embedUrl) {
            console.log(`[animotvslash] embed URL: ${embedUrl}`);

            // Try native HLS extraction
            const providerResults = await extractTryEmbed(embedUrl);

            if (providerResults.length > 0) {
                for (let i = 0; i < providerResults.length; i++) {
                    const result = providerResults[i];
                    console.log(`[animotvslash] Stream ${i + 1}: ${result.url.substring(0, 100)}...`);
                    streams.push({
                        name: `ANIMOTVSLASH - ${result.name}`,
                        title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
                        url: result.url,
                        quality: 'Auto',
                        headers: EMBED_HEADERS,
                        provider: 'animotvslash',
                    });
                }
            }

            // ALWAYS add WebView fallback — this is the guaranteed working option
            streams.push({
                name: `ANIMOTVSLASH - WebView`,
                title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
                url: embedUrl,
                quality: 'Auto',
                provider: 'animotvslash',
                behaviorHints: { notWebReady: true }
            });
        } else {
            console.log(`[animotvslash] No embed found, page WebView fallback`);
            streams.push({
                name: `ANIMOTVSLASH - Page`,
                title: mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : 'Movie',
                url: pageUrl,
                quality: 'Auto',
                provider: 'animotvslash',
                behaviorHints: { notWebReady: true }
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
