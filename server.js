const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(cors());
const TMDB_KEY = '2564ea1dcd828935333abd8ad31decf9';
const TMDB = 'https://api.themoviedb.org/3';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
app.get('/api/stream', async (req, res) => {
  const { type, id, s, e } = req.query;
  if (!type || !id) return res.json({ success: false, error: 'type e id obrigatorios' });
  const season = s || '1';
  const episode = e || '1';
  let imdbId = null, title = '', year = '', poster = '', overview = '';
  try {
    const [infoR, extR] = await Promise.all([
      axios.get(`${TMDB}/${type}/${id}?api_key=${TMDB_KEY}&language=pt-BR`).catch(() => ({ data: {} })),
      axios.get(`${TMDB}/${type}/${id}/external_ids?api_key=${TMDB_KEY}`).catch(() => ({ data: {} }))
    ]);
    title = infoR.data.title || infoR.data.name || '';
    year = (infoR.data.release_date || infoR.data.first_air_date || '').substring(0, 4);
    poster = infoR.data.poster_path ? `https://image.tmdb.org/t/p/w500${infoR.data.poster_path}` : '';
    overview = infoR.data.overview || '';
    imdbId = extR.data.imdb_id;
  } catch (e) {}
  const providers = [
    { name: 'VidSrc', url: type === 'movie' ? `https://vidsrc.dev/embed/movie/${id}` : `https://vidsrc.dev/embed/tv/${id}/${season}/${episode}` },
    { name: 'Smashy', url: type === 'movie' ? `https://smashystream.autoembed.cc/embed/movie/${id}` : `https://smashystream.autoembed.cc/embed/tv/${id}/${season}/${episode}` },
    { name: 'VidSrcCC', url: type === 'movie' ? `https://vidsrc.cc
