const profiler = require('./profiler');

module.exports = (port) => {
  port.onMessage.addListener(async function(msg) {
    switch (msg.name) {
      case 'start':
        profiler.start(msg.settings);
        port.postMessage({ name: 'start' });
        break;
      case 'stop':
        profiler.stop();
        port.postMessage({ name: 'stop' });
        break;
      case 'getData':
        const data = await profiler.getData();
        console.log(`getData yielded ${JSON.stringify(data).length} bytes`);
        port.postMessage({
          name: 'getData',
          data: data
        });
        break;
      case 'getStatus':
        port.postMessage({
          name: 'getStatus',
          data: profiler.isActive() || false
        });
        break;
    }
  });
};
