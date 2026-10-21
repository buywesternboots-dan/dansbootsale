import { SITE, bootPath, materialName, ogTitle, ogDescription, money, sizeLine } from './catalog.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fillHead(html, meta) {
  const tags = [
    `<meta property="og:type" content="${esc(meta.type || 'website')}">`,
    `<meta property="og:site_name" content="Dan's Boot Sale">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:url" content="${esc(meta.canonical)}">`,
    `<meta property="og:image" content="${esc(meta.image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(meta.title)}">`,
    `<meta name="twitter:description" content="${esc(meta.description)}">`,
    `<meta name="twitter:image" content="${esc(meta.image)}">`,
    meta.robots ? `<meta name="robots" content="${esc(meta.robots)}">` : '',
    meta.jsonld ? `<script type="application/ld+json">${meta.jsonld}</script>` : ''
  ].filter(Boolean).join('\n');
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(meta.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(meta.description)}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(meta.canonical)}">`)
    .replace(/<!--META:START-->[\s\S]*?<!--META:END-->/, `<!--META:START-->\n${tags}\n<!--META:END-->`)
    .replace(/<body[^>]*>/, `<body data-route="${esc(meta.route || 'home')}">`);
}

export function homeMeta() {
  return {
    route: 'home',
    type: 'website',
    title: "Dan's Boot Sale · Vintage & exotic western boots",
    description: 'Hand-picked vintage and exotic western boots. One pair of each, inspected and measured by hand. Text Dan to claim a pair. Free US shipping and returns.',
    canonical: SITE + '/',
    image: SITE + '/assets/hero-1344.webp',
    jsonld: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Store',
      name: "Dan's Boot Sale",
      url: SITE + '/',
      image: SITE + '/assets/hero-1344.webp',
      telephone: '+1-404-488-0174',
      email: 'dansbootsale@gmail.com',
      paymentAccepted: 'Zelle, PayPal, Venmo, Cash App',
      priceRange: '$$-$$$'
    })
  };
}

export function bootMeta(p) {
  const path = bootPath(p);
  const image = (p.photos && p.photos[0]) || (SITE + '/assets/hero-1344.webp');
  const sold = p.status === 'sold';
  return {
    route: 'boot',
    type: 'product',
    title: `${ogTitle(p)} | Dan's Boot Sale`,
    description: ogDescription(p),
    canonical: SITE + path,
    image,
    jsonld: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: `${p.brand} ${materialName(p)}`.trim(),
      image: (p.photos || []).slice(0, 6),
      brand: { '@type': 'Brand', name: p.brand },
      description: ogDescription(p),
      material: p.material || undefined,
      offers: {
        '@type': 'Offer',
        price: Number(p.price),
        priceCurrency: 'USD',
        url: SITE + path,
        availability: sold ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
        itemCondition: 'https://schema.org/UsedCondition'
      }
    })
  };
}

export function bootLabel(p) {
  return `${p.brand} ${materialName(p)} · ${sizeLine(p)} · ${money(p.price)}`;
}
