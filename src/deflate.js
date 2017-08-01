const pako = require('pako/dist/pako_deflate.js');

const purge = require('./purge.js');

self.onmessage = evt => {
  const compressed = pako.gzip(JSON.stringify(purge(JSON.parse(evt.data)))).buffer;
  self.postMessage({ compressed }, [compressed]);
};
