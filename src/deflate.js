const pako = require('pako/dist/pako_deflate.js');

const purge = require('./purge.js');

self.onmessage = evt => {
  const compressed = pako.gzip(purge(evt.data)).buffer;
  self.postMessage({ compressed }, [compressed]);
};
