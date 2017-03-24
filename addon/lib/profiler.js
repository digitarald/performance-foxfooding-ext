const { Cc, Ci } = require("chrome");

class Profiler {
  constructor() {
    this.service = Cc["@mozilla.org/tools/profiler;1"].getService(Ci.nsIProfiler);
  }

  start({entries = 10000000, interval = 1, features = ['stackwalk'], threads = []}) {
    this.service.StartProfiler(entries, interval, features, features.length, threads, threads.length);
  }

  stop() {
    this.service.StopProfiler();
  }

  getData() {
    return this.service.getProfileDataAsync();
  }

  isActive() {
    return this.service.IsActive();
  }
}

module.exports = new Profiler();
