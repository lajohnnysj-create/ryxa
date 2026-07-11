// Vercel serverless function - serves /course/<slug> with DYNAMIC OG tags.
//
// Unlike api/product.js (which renders the whole page server-side), this
// function takes the EXISTING static course/index.html and injects dynamic
// <title> + Open Graph / Twitter meta into its <head>, then serves it at the
// same URL. The course page UI and its client script (js/course-page.js) are
// left untouched - course-page.js still parses the slug from the path and
// fetches the course as before. We only fix what social scrapers read.
//
// Fails SAFE: any error (bad slug, DB down) still serves the static page with
// default tags, so the page never breaks - it just shows a generic preview.

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';
const DEFAULT_OG_IMAGE = 'https://www.ryxa.io/og-image.png';

let _templateCache = null;
function readTemplate() {
  if (_templateCache) return _templateCache;
  _templateCache = fs.readFileSync(path.join(process.cwd(), 'course', 'index.html'), 'utf8');
  return _templateCache;
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function metaDesc(html, fallback) {
  var text = String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 160 ? text.slice(0, 157).trimEnd() + '...' : text;
}

function coverUrl(coverPath) {
  if (!coverPath) return DEFAULT_OG_IMAGE;
  return SUPABASE_URL + '/storage/v1/object/public/course-covers/' + coverPath;
}

function buildOgBlock(t) {
  return '\n' +
    '<meta property="og:type" content="website">\n' +
    '<meta property="og:title" content="' + t.ogTitle + '">\n' +
    '<meta property="og:description" content="' + t.desc + '">\n' +
    '<meta property="og:image" content="' + t.image + '">\n' +
    '<meta property="og:url" content="' + t.url + '">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + t.ogTitle + '">\n' +
    '<meta name="twitter:description" content="' + t.desc + '">\n' +
    '<meta name="twitter:image" content="' + t.image + '">';
}

function injectTags(html, tags) {
  html = html.replace(/<title>[^<]*<\/title>/, '<title>' + tags.title + '</title>');
  html = html.replace(/<meta name="description" content="[^"]*">/,
    '<meta name="description" content="' + tags.desc + '">' + tags.og);
  return html;
}

function defaultTags() {
  return {
    title: 'Course - Ryxa',
    desc: 'Learn from creators on Ryxa.',
    og: buildOgBlock({
      ogTitle: 'Course - Ryxa',
      desc: 'Learn from creators on Ryxa.',
      image: DEFAULT_OG_IMAGE,
      url: 'https://www.ryxa.io/course'
    })
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  var template;
  try {
    template = readTemplate();
  } catch (e) {
    console.error('course SSR: template read failed:', e);
    res.status(500);
    return res.send('<!DOCTYPE html><title>Ryxa</title>Something went wrong. Please try again.');
  }

  var slug = (req.query && req.query.slug ? String(req.query.slug) : '').trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    res.status(200);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.send(injectTags(template, defaultTags()));
  }

  try {
    var cRes = await fetch(SUPABASE_URL + '/rest/v1/courses?slug=eq.' + encodeURIComponent(slug) + '&status=eq.published&select=user_id,slug,title,description,cover_image_path&limit=1', {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
    });
    if (!cRes.ok) throw new Error('Supabase ' + cRes.status);
    var rows = await cRes.json();
    if (!rows || rows.length === 0) {
      res.status(200);
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      return res.send(injectTags(template, defaultTags()));
    }
    var course = rows[0];
    var descText = metaDesc(course.description, 'A course on Ryxa.');
    var img = coverUrl(course.cover_image_path);
    var tags = {
      title: esc(course.title) + ' - Ryxa',
      desc: esc(descText),
      og: buildOgBlock({
        ogTitle: esc(course.title),
        desc: esc(descText),
        image: esc(img),
        url: 'https://www.ryxa.io/course/' + esc(course.slug)
      })
    };
    res.status(200);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.send(injectTags(template, tags));
  } catch (err) {
    console.error('course SSR error:', err);
    res.status(200);
    res.setHeader('Cache-Control', 'public, s-maxage=30');
    return res.send(injectTags(template, defaultTags()));
  }
};
