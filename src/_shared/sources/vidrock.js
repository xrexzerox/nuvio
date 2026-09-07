/**
 * Vidrock source. Uses the Nuvio/WebCrypto environment for AES-GCM.
 * The Node-only crypto fallback has been removed because NuvioMobile runs
 * providers inside its own QuickJS runtime and supplies the crypto bridge.
 */
import { UA, VIDROCK_API, VIDROCK_KEY_HEX } from '../constants.js';
import { b64DecodeToBytes, bytesToUtf8, fetchText, makeStream } from '../utils.js';

function enabled() {
    try {
        const s = globalThis.SCRAPER_SETTINGS || {};
        return s.vidrock !== false;
    } catch (e) {
        return true;
    }
}

function hexToBytes(hex) {
    const out = [];
    for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
    return out;
}

function subtle() {
    try {
        if (globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto.subtle;
    } catch (e) {
        // Nuvio runtime without WebCrypto: fail softly.
    }
    return null;
}

/** base64url -> nonce[12] + ciphertext/tag -> AES-GCM plaintext. */
export async function decryptVidrockUrl(payload) {
    try {
        const sub = subtle();
        if (!sub) return null;
        let std = String(payload).replace(/-/g, '+').replace(/_/g, '/');
        while (std.length % 4 !== 0) std += '=';
        const data = b64DecodeToBytes(std);
        if (data.length <= 12) return null;
        const nonce = new Uint8Array(data.slice(0, 12));
        const ct = new Uint8Array(data.slice(12));
        const keyBytes = new Uint8Array(hexToBytes(VIDROCK_KEY_HEX));
        const key = await sub.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
        const plain = await sub.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, ct);
        return bytesToUtf8(Array.from(new Uint8Array(plain)));
    } catch (e) {
        return null;
    }
}

export async function scrape(ctx) {
    if (!enabled() || !ctx.tmdbId) return [];
    const type = ctx.isTv ? 'tv' : 'movie';
    const query = ctx.isTv ? ctx.tmdbId + '_' + ctx.season + '_' + ctx.episode : String(ctx.tmdbId);

    let json;
    try {
        json = JSON.parse(await fetchText(VIDROCK_API + '/api/' + type + '/' + query + '/', {
            Origin: VIDROCK_API,
            Referer: VIDROCK_API + '/',
            'User-Agent': UA
        }, 20000));
    } catch (e) {
        console.log('[Streamline][vidrock] ' + e.message);
        return [];
    }

    const out = [];
    for (const server of Object.keys(json || {})) {
        const enc = json[server] && (json[server].url || json[server]);
        if (!enc || typeof enc !== 'string' || enc === 'error' || enc === 'null') continue;
        const url = await decryptVidrockUrl(enc);
        if (!url || url.indexOf('http') !== 0) continue;
        const s = makeStream(
            'Vidrock',
            'Vidrock [' + server + ']',
            url,
            'Auto',
            { Origin: VIDROCK_API, Referer: VIDROCK_API + '/', 'User-Agent': UA },
            []
        );
        if (s) out.push(s);
    }
    return out;
}
