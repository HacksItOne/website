'use strict';
const SITE = (process.env.SITE_URL || 'https://www.hacksitone.com').replace(/\/$/, '');
const esc = (s) => {
  if (s == null) return '';
  s = String(s);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

const TEAM = [['Vibhu Yadav', 'Founder and CIO'], ['Chirag Solanki', 'Co-founder and CTO'], ['Tanmay Jha', 'Co-founder and CEO'], ['Harshit Goswami', 'Co-founder and COO'], ['Prem Singh', 'Co-founder and CMO'], ['Dushyant Nagal', 'Co-founder and CFO']];

const NAV = [['/', 'Home'], ['/about', 'About Us'], ['/services', 'Services'], ['/upcoming-products', 'Upcoming Products'], ['/news', 'News'], ['/careers', 'Careers']];

const PAGES = {
  '/': { title: 'Hacksitone | Cybersecurity, Innovation & Defense', desc: 'Hacksitone secures what matters: penetration testing, managed detection, secure code review and incident response for modern organizations.', pri: '1.0' },
  '/about': { title: 'About Us and Founding Team | Hacksitone Cybersecurity', desc: 'Meet the Hacksitone founding team: Vibhu Yadav, Chirag Solanki, Tanmay Jha, Harshit Goswami, Prem Singh and Dushyant Nagal, building defense-first cybersecurity.', pri: '0.8' },
  '/services': { title: 'Cybersecurity Services | Hacksitone', desc: 'Penetration testing, managed detection and response, secure code review, incident response, cloud security and compliance support from Hacksitone.', pri: '0.9' },
  '/upcoming-products': { title: 'Upcoming Products: StealthPhisher and Crypt_dir Pro | Hacksitone', desc: 'Upcoming Hacksione products: StealthPhisher, a hybrid deep learning and GenAI defense against phishing, and Crypt_dir Pro, a drive encryption tool with a GUI.', pri: '0.7' },
  '/news': { title: 'Cybersecurity News | Hacksitone', desc: 'Latest cybersecurity news, threat intelligence, and security research from across the industry.', pri: '0.7' },
  '/careers': { title: 'Careers | Join Hacksitone', desc: 'Build defensive security at Hacksitone. See open roles in security engineering, research and operations.', pri: '0.7' },
};

function layout({ path, title, desc, body, user, csrf, noindex }) {
  const p = PAGES[path] || {};
  title = title || p.title; desc = desc || p.desc;
  const url = SITE + path;
  const nav = NAV.map(([h, t]) => `<a href="${h}"${h === path ? ' aria-current="page"' : ''}>${t}</a>`).join('');
  const acct = user
    ? `<a href="/dashboard">${esc(user)}</a><form method="post" action="/logout"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="link">Log out</button></form>`
    : '<a href="/login">Log in</a><a class="btn sm" href="/register">Register</a>';
  const ld = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Hacksitone', url: SITE, logo: SITE + '/img/logo.png?v=3', slogan: 'Securing what matters.', founder: TEAM.map(([name, jobTitle]) => ({ '@type': 'Person', name, jobTitle })) };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${noindex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large'}">
${noindex ? '' : `<link rel="canonical" href="${url}">`}
<meta name="theme-color" content="#25292d">
<meta property="og:type" content="website"><meta property="og:site_name" content="Hacksitone">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/img/banner.jpg?v=3">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/img/favicon.png?v=3" type="image/png">
<link rel="stylesheet" href="/css/style.css?v=3">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><a class="brand" href="/" aria-label="Hacksitone home"><img src="/img/mark.png?v=3" alt="" width="44" height="44"><span>Hacksitone</span></a>
<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav"><span class="menu-icon" aria-hidden="true"></span><span class="menu-label">Menu</span></button>
<nav id="site-nav" aria-label="Primary">${nav}</nav><div class="acct">${acct}</div></header>
<main id="main">${body}</main>
<footer><img src="/img/logo.png?v=3" alt="Hacksitone" width="150" height="110"><p>Cybersecurity. Innovation. Defense.<br>&copy; ${new Date().getFullYear()} Hacksitone. All rights reserved.</p>
<p>${NAV.map(([h, t]) => `<a href="${h}">${t}</a>`).join(' ')}</p></footer>
<script src="/js/app.js?v=1" defer></script></body></html>`;
}

const services = [
  ['Penetration testing', 'Manual, scoped attacks on web apps, APIs, networks and mobile apps, with reproducible findings and fix guidance.'],
  ['Managed detection and response', 'Round-the-clock monitoring, triage and containment so real threats are handled before they spread.'],
  ['Secure code review', 'Line-by-line review of your code and dependencies for injection, broken access control and secrets exposure.'],
  ['Incident response', 'On-call responders for containment, forensics and recovery, plus a post-incident plan that prevents a repeat.'],
  ['Cloud security', 'Hardening of AWS, Azure and GCP accounts, identity policies and CI/CD pipelines.'],
  ['Compliance support', 'Gap assessments and evidence preparation for ISO 27001, SOC 2 and CERT-In requirements.'],
];

const body = {
  '/': () => `<section class="hero" aria-labelledby="hero-title"><div class="hero-art" role="img" aria-label="Abstract network of secure connections"><div class="hero-grid"></div><div class="orbit orbit-a"></div><div class="orbit orbit-b"></div><span class="signal signal-a"></span><span class="signal signal-b"></span><span class="signal signal-c"></span><div class="hero-copy"><p class="eyebrow"><span class="pulse"></span> INDEPENDENT CYBER DEFENSE</p><h1 id="hero-title">The edge belongs to those who <span>see clearly.</span></h1><p class="lead">Find the gaps. Strengthen the systems. Stay ready for what comes next.</p><div class="hero-actions"><a class="btn" href="/services">Explore our services <span aria-hidden="true">↗</span></a><a class="text-link" href="/about">Meet the team <span aria-hidden="true">→</span></a></div></div><div class="hero-stamp" aria-hidden="true"><span>H</span><small>DEFENSE<br>IN DEPTH</small></div></div></section>
<section class="intro wrap"><p class="eyebrow">BUILT FOR THE REAL WORLD</p><h2>Clarity under pressure.<br><span>Confidence by design.</span></h2><p class="lead">Hacksitone helps organizations find weaknesses before attackers do, detect threats as they happen, and recover quickly when something goes wrong.</p></section>
<section class="services-section wrap"><div class="section-head"><div><p class="eyebrow">CAPABILITIES</p><h2>Security that moves<br>with your business.</h2></div><a class="text-link" href="/services">All services <span aria-hidden="true">↗</span></a></div><div class="service-grid">${services.slice(0, 4).map(([t, d], i) => `<article class="service-card"><span class="card-index">0${i + 1}</span><span class="card-mark" aria-hidden="true">${['⌁', '◉', '⌘', '↗'][i]}</span><h3>${t}</h3><p>${d}</p><a href="/services" aria-label="Learn more about ${t}">Learn more <span aria-hidden="true">→</span></a></article>`).join('')}</div></section>
<section class="closing wrap"><p class="eyebrow">READY WHEN YOU ARE</p><h2>Make your next move<br>your strongest one.</h2><a class="btn" href="/register">Start a conversation <span aria-hidden="true">↗</span></a></section>`,
  '/about': () => `<section class="wrap"><h1>About Hacksitone</h1>
<p class="lead">We are a security team that treats defense as an engineering discipline: measurable, repeatable and honest about risk.</p>
<h2>How we work</h2><dl class="rules">
<div><dt>Defense first</dt><dd>Every finding ships with a fix your team can apply, not only a description of the problem.</dd></div>
<div><dt>Plain reporting</dt><dd>Reports are written for engineers and executives alike, ranked by real business impact.</dd></div>
<div><dt>Continuous innovation</dt><dd>We build our own detection tooling so our clients are protected by current techniques.</dd></div>
<div><dt>Confidentiality</dt><dd>Client data is encrypted, access-controlled and deleted when an engagement ends.</dd></div></dl>
<h2>Founding team</h2><p>Hacksitone is led by six co-founders who share responsibility for technology, operations, growth and finance.</p>
<div class="team-grid">${TEAM.map(([n, r], i) => `<article class="team-card"><div class="team-photo team-photo-${i + 1}" role="img" aria-label="Photo placeholder for ${esc(n)}"><span class="team-photo-mark" aria-hidden="true">${esc(n.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase())}</span><span class="team-photo-note">PHOTO COMING SOON</span></div><div class="team-info"><h3>${esc(n)}</h3><p>${esc(r)}</p><div class="team-social-placeholder" aria-label="Social links to be added later"><span>in</span><span>𝕏</span></div></div></article>`).join('')}</div></section>`,
  '/services': () => `<section class="wrap"><h1>Cybersecurity services</h1><p class="lead">End-to-end protection, from the first assessment to round-the-clock response.</p>
<dl class="rules">${services.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')}</dl>
<p><a class="btn" href="/register">Get started</a></p></section>`,
  '/upcoming-products': () => `<section class="wrap"><h1>Upcoming products</h1><p class="lead">Two tools our team is building next. Create an account to hear first when they launch.</p>
<dl class="rules">
<div><dt>StealthPhisher <span class="tag">Upcoming</span></dt><dd>A defensive framework against phishing attacks, using hybrid deep learning and generative AI to detect and stop them.</dd></div>
<div><dt>Crypt_dir Pro <span class="tag">Upcoming</span></dt><dd>The upgraded, GUI version of Crypt_dir. It encrypts data on hard drives and decrypts it safely with a secret key, combining three encryption algorithms.</dd></div></dl>
<p><a class="btn" href="/register">Join the waitlist</a></p></section>`,
  '/careers': () => `<section class="wrap"><h1>Careers at Hacksitone</h1><p class="lead">Help us secure what matters. We hire people who like understanding how things break and building them so they don't.</p>
<dl class="rules">
<div><dt>Security engineer</dt><dd>Design and build detection tooling. Remote-friendly, full time.</dd></div>
<div><dt>Penetration tester</dt><dd>Run web, API and cloud assessments for clients. Full time.</dd></div>
<div><dt>Security analyst, SOC</dt><dd>Triage alerts and lead response in our monitoring team. Shift based.</dd></div>
<div><dt>Security research intern</dt><dd>Six-month placement on vulnerability research. Students welcome.</dd></div></dl>
<p>To apply, <a href="/register">create an account</a> and your profile will be reviewed by our hiring team.</p></section>`,
};

function formPage({ path, heading, action, fields, cta, alt, csrf, error, info, user }) {
  const f = fields.map(([n, l, t, ac, extra = '', v = '']) => `<label for="${n}">${l}</label><input id="${n}" name="${n}" type="${t}" autocomplete="${ac}" required ${extra} value="${esc(v)}">`).join('');
  return layout({ path, user: null, csrf, noindex: true, title: heading + ' | Hacksitone', desc: heading + ' to your Hacksitone account.',
    body: `<section class="wrap narrow"><h1>${heading}</h1>
${error ? `<p class="msg err" role="alert">${esc(error)}</p>` : ''}${info ? `<p class="msg ok" role="status">${esc(info)}</p>` : ''}
<form method="post" action="${action}"><input type="hidden" name="_csrf" value="${esc(csrf)}">${f}<button class="btn" type="submit">${cta}</button></form>
<p class="alt">${alt}</p></section>` });
}

module.exports = { layout, body, formPage, PAGES, SITE, esc };
