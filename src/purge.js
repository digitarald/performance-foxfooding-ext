const { generate } = require('shortid');

const whitelist = new Set([
  'google.com',
  'google.de',
  'google.fr',
  'youtube.com',
  'facebook.com',
  'twitter.com',
  'web.whatsapp.com',
  'messenger.com',
  'wikipedia.org',
  'yahoo.com',
  'bing.com',
  'pinterest.com',
  'reddit.com',
  'imgur.com',
  'live.com',
  'msn.com',
  'tumblr.com',
  'ask.com',
  'wikia.com',
  'yelp.com',
  'espn.com',
  'nytimes.com',
  'washingtonpost.com',
  'cnn.com',
  'huffingtonpost.com',
  'buzzfeed.com',
  'foxnews.com',
  'techcrunch.com',
  'lifehacker.com',
  'theverge.com',
  'gizmodo.com',
  'www.businessinsider.com',
  'www.economist.com',
  'bbc.com',
  'dailymail.co.uk',
  'instagram.com',
  'linkedin.com',
  'ebay.com',
  'amazon.com',
  'amazon.de',
  'amazon.fr',
  'booking.com',
  'walmart.com',
  'web.de',
  'ebay-kleinanzeigen.de',
  'gmx.net',
  'bild.de',
  'lemonde.fr',
  'flipkart.com',
  'globo.com',
  'uol.com.br',
  'yandex.ru',
  'ok.ru',
  'netflix.com',
  'hulu.com',
  'office.com',
  'slack.com',
  'trello.com',
  'github.com',
  'dropbox.com',
  'salesforce.com',
  'stackoverflow.com',
  'medium.com',
]);

const purgedHashes = new Map();
const purgeSlice = slice => {
  if (purgedHashes.has(slice)) {
    return purgedHashes.get(slice);
  }
  const hash = generate();
  purgedHashes.set(slice, hash);
  return hash;
};

const purgeString = containsUrl => {
  return containsUrl.replace(
    /https?:\/\/(?:www\.)?([^/\s]+)([^\s):"']*)/g,
    (full, domain, path) => {
      const cleaned = [];
      if (whitelist.has(domain)) {
        cleaned.push(domain);
      } else {
        cleaned.push(purgeSlice(domain));
      }
      if (path && path !== '/') {
        cleaned.push(purgeSlice(path));
      }
      return `//${cleaned.join('/')}`;
    }
  );
};

const purge = dirty => {
  if (!dirty) {
    return dirty;
  }
  if (Array.isArray(dirty)) {
    return dirty.map(purge);
  }
  const type = typeof dirty;
  if (type === 'string') {
    return purgeString(dirty);
  }
  if (type === 'object') {
    for (const key in dirty) {
      dirty[key] = purge(dirty[key]);
    }
  }
  return dirty;
};

module.exports = purge;
