const BASE_API = 'http://194.233.72.38:3000';
const TMDB_API_KEY = '6dc830f9624b43261325bed3d0dfa';

// TMDB helper (still useful for titles)
async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchTitleFromTMDB(tmdbId, mediaType) {
  const url = mediaType === 'tv'
    ? `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`
    : `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const data = await fetchJSON(url);
  if (!data) return null;
  return mediaType === 'tv' ? (data.name || data.original_name) : (data.title || data.original_title);
}

// ------------------------------------------------------------------
// Main exported function
// ------------------------------------------------------------------
async function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[vidrock] === START for ${mediaType} TMDB ID:${tmdbId} S${season}E${episode} ===`);

  const apiUrl = `${BASE_API}/vidrock/${tmdbId}/${season}/${episode}?type=${mediaType}`;

  try {
    console.log(`[vidrock] Fetching from API: ${apiUrl}`);
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const streams = await res.json();

    // Optionally enrich with TMDB title
    const title = await fetchTitleFromTMDB(tmdbId, mediaType);
    if (title) {
      streams.forEach(s => {
        s.title = mediaType === 'tv'
          ? `${title} S${season}E${episode}`
          : title;
      });
    }

    console.log(`[vidrock] Returning ${streams.length} stream(s) from API`);
    return streams;
  } catch (err) {
    console.error('[vidrock] API error:', err.message);
    return [];
  }
}

module.exports = { getStreams };
