const pako = require('pako/dist/pako_deflate.js');

self.onmessage = evt => {
  console.time('gzip');
  const compressed = pako.gzip(evt.data).buffer;
  console.timeEnd('gzip');
  self.postMessage({ compressed }, [compressed]);
};
