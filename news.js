'use strict';

const https = require('node:https');

const CACHE_DURATION = 5 * 60 * 1000;
const REQUEST_TIMEOUT = 8000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
let newsCache = null;
let cacheTime = 0;

function fetchText(url, timeout = REQUEST_TIMEOUT, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout,
      headers: {
        'User-Agent': 'HacksitoneCyberNews/1.0 (public feed reader)',
        Accept: 'application/json, application/atom+xml, application/rss+xml, application/xml, text/xml, */*',
        ...headers
      }
    }, (res) => {
      let data = '';
      let size = 0;
      res.setEncoding('utf8');
      res.on('data', chunk => {
        size += Buffer.byteLength(chunk);
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Source response exceeded size limit'));
          return;
        }
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Source returned HTTP ${res.statusCode}`));
        }
        resolve(data);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
  });
}

async function fetchJson(url, headers) {
  return JSON.parse(await fetchText(url, REQUEST_TIMEOUT, headers));
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .trim();
}

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function parseFeed(xml, source, maxItems = 12) {
  return [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .slice(0, maxItems)
    .map(([, kind, item]) => {
      const atom = kind.toLowerCase() === 'entry';
      const title = tagValue(item, 'title');
      let url = tagValue(item, atom ? 'id' : 'link');
      if (atom) {
        const link = item.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
        if (link) url = decodeXml(link[1]);
      }
      const description = tagValue(item, 'description') || tagValue(item, 'summary') || tagValue(item, 'content');
      const rawDate = tagValue(item, 'pubDate') || tagValue(item, 'published') || tagValue(item, 'updated');
      const date = rawDate ? new Date(rawDate) : new Date();
      if (!title || !/^https?:\/\//i.test(url)) return null;
      return {
        title,
        url,
        excerpt: description.slice(0, 240) + (description.length > 240 ? '…' : ''),
        source,
        date: Number.isNaN(date.getTime()) ? new Date() : date
      };
    })
    .filter(Boolean);
}

async function fetchFeed({ url, source }) {
  return parseFeed(await fetchText(url), source);
}

async function fetchReddit(subreddit, limit = 15) {
  const data = await fetchJson(`https://www.reddit.com/r/${subreddit}/new.json?limit=${limit}&raw_json=1`);
  return (data?.data?.children || []).map(({ data: post }) => ({
    title: post.title,
    url: post.is_self ? `https://www.reddit.com${post.permalink}` : post.url,
    excerpt: (post.selftext || post.link_flair_text || '').replace(/<[^>]*>/g, '').slice(0, 240),
    source: `r/${subreddit}`,
    date: new Date((post.created_utc || 0) * 1000)
  })).filter(post => post.title && /^https?:\/\//i.test(post.url));
}

async function fetchGitHubAdvisories() {
  const advisories = await fetchJson('https://api.github.com/advisories?per_page=15', {
    'X-GitHub-Api-Version': '2022-11-28'
  });
  return (Array.isArray(advisories) ? advisories : []).map(item => ({
    title: item.summary || item.ghsa_id,
    url: item.html_url,
    excerpt: `${item.severity || 'Security advisory'}${item.cve_id ? ` · ${item.cve_id}` : ''}`,
    source: 'GitHub Security Advisories',
    date: new Date(item.published_at || item.updated_at || Date.now())
  })).filter(item => item.title && /^https:\/\//i.test(item.url));
}

const feeds = [
  { source: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews' },
  { source: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/' },
  { source: 'Dark Reading', url: 'https://www.darkreading.com/rss.xml' },
  { source: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/' },
  { source: 'SecurityWeek', url: 'https://www.securityweek.com/feed/' },
  { source: 'CISA Advisories', url: 'https://www.cisa.gov/news-events/cybersecurity-advisories.xml' },
  { source: 'NIST Cybersecurity Insights', url: 'https://www.nist.gov/blogs/cybersecurity-insights/rss.xml' },
  { source: 'Google Project Zero', url: 'https://googleprojectzero.blogspot.com/feeds/posts/default?alt=rss' },
  { source: 'Cisco Talos', url: 'https://blog.talosintelligence.com/rss/' },
  { source: 'Microsoft Security Response Center', url: 'https://msrc.microsoft.com/blog/feed/' },
  { source: 'SANS Internet Storm Center', url: 'https://isc.sans.edu/rssfeed.xml' },
  { source: 'The Record', url: 'https://therecord.media/feed' },
  { source: 'Schneier on Security', url: 'https://www.schneier.com/feed/atom/' }
];

async function fetchCyberNews() {
  if (newsCache && Date.now() - cacheTime < CACHE_DURATION) return newsCache;

  const sources = [
    ...feeds.map(feed => ({ name: feed.source, fetch: () => fetchFeed(feed) })),
    { name: 'r/netsec', fetch: () => fetchReddit('netsec') },
    { name: 'r/cybersecurity', fetch: () => fetchReddit('cybersecurity') },
    { name: 'r/Malware', fetch: () => fetchReddit('Malware') },
    { name: 'r/blueteamsec', fetch: () => fetchReddit('blueteamsec') },
    { name: 'r/ReverseEngineering', fetch: () => fetchReddit('ReverseEngineering') },
    { name: 'GitHub Security Advisories', fetch: fetchGitHubAdvisories }
  ];
  const results = await Promise.allSettled(sources.map(source => source.fetch()));
  const articles = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    console.warn(`Cyber news source ${sources[index].name} unavailable: ${result.reason.message}`);
    return [];
  });

  const seen = new Set();
  const unique = articles.filter(article => {
    const key = article.url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.date - a.date).slice(0, 40);

  if (unique.length) {
    newsCache = unique;
    cacheTime = Date.now();
  }
  return unique.length ? unique : (newsCache || []);
}

module.exports = { fetchCyberNews };
