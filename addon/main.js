const webext = require("sdk/webextension");
const connectProfiler = require("./lib/profiler-port");

webext.startup().then(({browser}) => {
  browser.runtime.onConnect.addListener(connectProfiler);
});
