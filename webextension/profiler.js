class Profiler {

  constructor(port) {
    this.port = port;
    this.port.onMessage.addListener(this.handleEvent.bind(this));
    this.port.onDisconnect.addListener((msg) => {
      console.warn('Profiler: onDisconnect', msg.error);
    });
    this.resolvers = new Map();
  }

  handleEvent(msg) {
    const resolve = this.resolvers.get(msg.name);
    console.warn('Profiler: resolving', msg);
    if (!resolve) {
      console.warn('Profiler: Unhandled event', msg.name);
      return;
    }
    this.resolvers.delete(msg.name);
    resolve(msg.data);
  }

  resolveLater(name) {
    console.warn('Profiler: qeueing %s', name);
    return new Promise((resolve) => {
      this.resolvers.set(name, resolve);
    });
  }

  start(settings) {
    this.port.postMessage({ name: 'start', settings: settings });
    return this.resolveLater('start');
  }

  stop() {
    this.port.postMessage({ name: 'stop' });
    return this.resolveLater('stop');
  }

  getData() {
    this.port.postMessage({ name: 'getData' });
    return this.resolveLater('getData');
  }

  getStatus() {
    this.port.postMessage({ name: 'getStatus' });
    return this.resolveLater('getStatus');
  }
}

module.exports = Profiler;
