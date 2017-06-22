const pako = require('pako/dist/pako_deflate.js');

const purge = require('./purge.js');

self.onmessage = evt => {
  console.time('deflating');
  const compressed = pako.gzip(purge(evt.data)).buffer;
  console.timeEnd('deflating');
  self.postMessage({ compressed }, [compressed]);
};
