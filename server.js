// ============================================
// CineZo+ Stream Resolver Server
// Gratuito - Render.com
// ============================================

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const TMDB_KEY = '2564ea1dcd828935333abd8ad31decf9';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// Headers para simular navegador
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Referer': 'https://www.google.com/'
};

// === ROTA PRINCIPAL ===
app.get('/api/stream', async (req, res) => {
  try {
    const { type, id } = req.query;
    
    if (!type || !id) {
      return res.json({ success: false, error: 'Parametros type e id obrigatorios' });
    }

    console.log(`[CineZo+] Buscando: ${type} ID ${id}`);

    // Step 1: Busca IMDb ID + Titulo
    let imdbId = null;
    let title = '';
    let year = '';
    let poster = '';
    
    try {
      const [infoRes, extRes] = await Promise.all([
        axios.get(`${TMDB_BASE}/${type}/${id}?api_key=${TMDB_KEY}&language=pt-BR`),
        axios.get(`${TMDB_BASE}/${type}/${id}/external_ids?api_key=${TMDB_KEY}`)
      ]);
      
      title = infoRes.data.title || infoRes.data.name || '';
      year = (infoRes.data.release_date || infoRes.data.first_air_date || '').substring(0, 4);
      poster = infoRes.data.poster_path ? IMAGE_BASE + infoRes.data.poster_path : '';
      imdbId = extRes.data.imdb_id;
    } catch (e) {
      console.log('[CineZo+] Erro ao buscar info TMDB:', e.message);
    }

    // Step 2: Buscar streams de todas as fontes
    const streams = [];
    
    // Fonte 1: VidSrc.dev
    await tryExtract(
      streams, 'VidSrc',
      type === 'movie' 
        ? `https://vidsrc.dev/embed/movie/${id}`
        : `https://vidsrc.dev/embed/tv/${id}/1/1`
    );

    // Fonte 2: VidSrc.cc
    await tryExtract(
      streams, 'VidSrcCC',
      type === 'movie'
        ? `https://vidsrc.cc/v2/embed/movie/${id}`
        : `https://vidsrc.cc/v2/embed/tv/${id}/1/1`
    );

    // Fonte 3: Embed.su
    await tryExtract(
      streams, 'EmbedSu',
      type === 'movie'
        ? `https://embed.su/embed/movie/${id}`
        : `https://embed.su/embed/tv/${id}/1/1`
    );

    // Fonte 4: VidSrc.xyz
    await tryExtract(
      streams, 'VidSrcXYZ',
      type === 'movie'
        ? `https://vidsrc.xyz/embed/movie?tmdb=${id}`
        : `https://vidsrc.xyz/embed/tv?tmdb=${id}&season=1&episode=1`
    );

    // Fonte 5: SmashyStream
    await tryExtract(
      streams, 'Smashy',
      type === 'movie'
        ? `https://smashystream.autoembed.cc/embed/movie/${id}`
        : `https://smashystream.autoembed.cc/embed/tv/${id}/1/1`
    );

    // Fonte 6: 2Embed
    await tryExtract(
      streams, '2Embed',
      `https://2embed.cc/embed/${id}`
    );

    // Separar diretos de embeds
    const directStreams = streams.filter(s => !s.isEmbed);
    const embedStreams = streams.filter(s => s.isEmbed);
    
    // Priorizar diretos, depois embeds
    const allStreams = [...directStreams, ...embedStreams];

    console.log(`[CineZo+] Encontrados: ${directStreams.length} diretos, ${embedStreams.length} embeds`);

    res.json({
      success: true,
      title,
      year,
      poster,
      imdbId,
      tmdbId: id,
      type,
      total: allStreams.length,
      direct: directStreams.length,
      streams: allStreams
    });

  } catch (error) {
    console.error('[CineZo+] Erro:', error.message);
    res.json({ success: false, error: error.message, streams: [] });
  }
});

// === FUNCAO DE EXTRAÇAO ===
async function tryExtract(streams, serverName, url) {
  try {
    const response = await axios.get(url, {
      headers: BROWSER_HEADERS,
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: (status) => status < 400
    });

    const html = response.data;
    if (typeof html !== 'string') return;

    const found = new Set();

    // Pattern 1: .m3u8 diretos
    const m3u8 = html.match(/https?:\/\/[^\s"'<>,;\\)}\]]+\.m3u8[^\s"'<>,;\\)}\]]*/g) || [];
    m3u8.forEach(u => found.add(cleanUrl(u)));

    // Pattern 2: .mp4 diretos
    const mp4 = html.match(/https?:\/\/[^\s"'<>,;\\)}\]]+\.mp4[^\s"'<>,;\\)}\]]*/g) || [];
    mp4.forEach(u => found.add(cleanUrl(u)));

    // Pattern 3: file/source/src/url patterns em JS
    const filePatterns = html.match(/(?:file|source|src|url|stream|video_url|playlist|hls|dash)\s*[:=]\s*["']([^"']+)["']/gi) || [];
    filePatterns.forEach(p => {
      const match = p.match(/["']([^"']+)["']/);
      if (match) {
        const val = match[1];
        if (val.startsWith('http') && (val.includes('.m3u8') || val.includes('.mp4') || val.includes('stream'))) {
          found.add(cleanUrl(val));
        }
      }
    });

    // Pattern 4: URLs em objetos JSON
    const jsonBlocks = html.match(/\{[^{}]{0,500}(?:file|source|url|stream|src)[^{}]{0,500}\}/gi) || [];
    jsonBlocks.forEach(block => {
      try {
        const obj = JSON.parse(block);
        const u = obj.file || obj.source || obj.url || obj.stream || obj.src || obj.playlist;
        if (u && typeof u === 'string' && u.startsWith('http')) {
          found.add(cleanUrl(u));
        }
        // Se for array (qualidades)
        if (Array.isArray(u)) {
          u.forEach(item => {
            if (typeof item === 'string' && item.startsWith('http')) found.add(cleanUrl(item));
            if (item && item.file && item.file.startsWith('http')) found.add(cleanUrl(item.file));
            if (item && item.url && item.url.startsWith('http')) found.add(cleanUrl(item.url));
          });
        }
      } catch (e) {}
    });

    // Pattern 5: Base64 encoded URLs
    const b64Patterns = html.match(/atob\s*\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/g) || [];
    b64Patterns.forEach(p => {
      try {
        const b64 = p.match(/["']([A-Za-z0-9+/=]+)["']/)[1];
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        if (decoded.startsWith('http') && (decoded.includes('.m3u8') || decoded.includes('.mp4'))) {
          found.add(cleanUrl(decoded));
        }
      } catch (e) {}
    });

    // Pattern 6: URLs dentro de variaveis JS
    const jsVars = html.match(/(?:var|let|const)\s+\w+\s*=\s*["'](https?:\/\/[^"']+)["']/g) || [];
    jsVars.forEach(v => {
      const match = v.match(/["'](https?:\/\/[^"']+)["']/);
      if (match && (match[1].includes('.m3u8') || match[1].includes('.mp4') || match[1].includes('stream'))) {
        found.add(cleanUrl(match[1]));
      }
    });

    // Filtrar URLs invalidas
    const valid = [...found].filter(u => {
      return u && u.startsWith('http') &&
        !u.includes('doubleclick') &&
        !u.includes('google') &&
        !u.includes('facebook') &&
        !u.includes('analytics') &&
        !u.includes('adservice') &&
        !u.includes('adserver') &&
        !u.includes('pixel') &&
        !u.includes('.js') &&
        !u.includes('.css') &&
        !u.includes('.png') &&
        !u.includes('.jpg') &&
        !u.includes('.svg') &&
        !u.includes('.ico') &&
        !u.includes('.woff');
    });

    // Adicionar streams diretos
    valid.forEach(streamUrl => {
      streams.push({
        url: streamUrl,
        server: serverName,
        quality: detectQuality(streamUrl),
        isEmbed: false
      });
    });

    // Sempre adicionar embed como fallback
    streams.push({
      url: url,
      server: serverName,
      quality: 'embed',
      isEmbed: true
    });

  } catch (error) {
    // Servidor offline - adicionar embed mesmo assim
    streams.push({
      url: url,
      server: serverName,
      quality: 'embed',
      isEmbed: true
    });
  }
}

function cleanUrl(url) {
  return url.replace(/['"\\]/g, '').replace(/[\s].*$/, '');
}

function detectQuality(url) {
  if (url.includes('2160') || url.includes('4k') || url.includes('4K')) return '4K';
  if (url.includes('1080')) return '1080p';
  if (url.includes('720')) return '720p';
  if (url.includes('480')) return '480p';
  if (url.includes('360')) return '360p';
  return 'HD';
}

// === ROTA DE STATUS ===
app.get('/api/status', (req, res) => {
  res.json({ status: 'online', version: '1.0.0', uptime: process.uptime() });
});

// === ROTA DE BUSCA ===
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ success: false, error: 'Parametro q obrigatorio' });
    
    const response = await axios.get(`${TMDB_BASE}/search/multi?api_key=${TMDB_KEY}&language=pt-BR&query=${encodeURIComponent(q)}`);
    const results = (response.data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv');
    
    res.json({ success: true, results });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// === INICIAR SERVIDOR ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[CineZo+] Servidor rodando na porta ${PORT}`);
});
