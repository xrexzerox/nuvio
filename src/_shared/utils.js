/** Shared Nuvio-safe helpers. */

export function normalizeTitle(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/&amp;/g, "&")
        .replace(/[‘’“”"]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function dedupe(streams) {
    const seen = {};
    const out = [];
    (streams || []).forEach(function (s) {
        if (!s || !s.url || seen[s.url]) return;
        seen[s.url] = true;
        out.push(s);
    });
    return out;
}

export function makeStream(source, title, url, quality, extra) {
    if (!url || String(url).indexOf("http") !== 0) return null;
    const stream = {
        name: source,
        title: title || source,
        url: String(url),
        quality: quality || "Auto",
        headers: {}
    };
    Object.keys(extra || {}).forEach(function (k) {
        if (extra[k] !== undefined && extra[k] !== null && extra[k] !== "") stream[k] = extra[k];
    });
    return stream;
}

export async function fetchText(url, headers) {
    const res = await fetch(url, {
        headers: Object.assign({
            "User-Agent": "Mozilla/5.0 (compatible; Nuvio PinoyMoviesHub Provider/1.0)",
            "Accept": "text/html,application/xhtml+xml"
        }, headers || {})
    });
    if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
    return await res.text();
}

export async function fetchJson(url, headers) {
    const text = await fetchText(url, headers);
    return JSON.parse(text);
}

export async function safeRun(label, fn) {
    try {
        const out = await fn();
        return Array.isArray(out) ? out : [];
    } catch (e) {
        console.log("[PinoyMoviesHub][" + label + "] " + (e && e.message));
        return [];
    }
}

export function absUrl(base, href) {
    if (!href) return null;
    const s = String(href).trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (s.charAt(0) === "/") return base + s;
    return base + "/" + s;
}

export function stripTags(s) {
    return String(s || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
}

export function parseQuality(raw) {
    const text = String(raw || "").toLowerCase();
    const m = text.match(/(\d{3,4})\s*p/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 4000) return "8K";
        if (n >= 2000) return "4K";
        if (n >= 1000) return "1080p";
        if (n >= 700) return "720p";
        if (n >= 400) return "480p";
    }
    if (/\b4k\b|2160|uhd/.test(text)) return "4K";
    if (/\b1080\b/.test(text)) return "1080p";
    if (/\b720\b/.test(text)) return "720p";
    return "Auto";
}
