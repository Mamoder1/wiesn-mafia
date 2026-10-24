// Transport layer. Two implementations with the same interface:
//   MqttBus  – public MQTT brokers over secure WebSocket (production)
//   LocalBus – BroadcastChannel + localStorage (tests, ?bus=local)
// Interface: publish(topic, obj|null, {retain}), subscribe(topic, cb), onStatus(cb), end()

export const BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://broker.hivemq.com:8884/mqtt"
];

export const topic = (room, part) => `wm1/${room}/${part}`;

class MqttBus {
  constructor(index) {
    this.index = index;
    this.handlers = new Map();
    this.statusCbs = [];
    this.online = false;
  }
  connect(timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
      const clientId = "wm_" + Math.random().toString(36).slice(2, 12);
      const c = window.mqtt.connect(BROKERS[this.index], {
        clientId, clean: true, keepalive: 30, reconnectPeriod: 2000, connectTimeout: timeoutMs, resubscribe: true
      });
      this.client = c;
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; c.end(true); reject(new Error("timeout")); } }, timeoutMs + 500);
      c.on("connect", () => {
        this.setOnline(true);
        if (!settled) { settled = true; clearTimeout(timer); resolve(this); }
      });
      c.on("close", () => this.setOnline(false));
      c.on("offline", () => this.setOnline(false));
      c.on("error", () => {});
      c.on("message", (t, payload) => {
        const cb = this.handlers.get(t);
        if (!cb) return;
        let obj = null;
        if (payload && payload.length) { try { obj = JSON.parse(payload.toString()); } catch (e) { return; } }
        cb(obj);
      });
    });
  }
  setOnline(v) { if (this.online !== v) { this.online = v; this.statusCbs.forEach(f => f(v)); } }
  onStatus(cb) { this.statusCbs.push(cb); }
  publish(t, obj, { retain = false } = {}) {
    this.client.publish(t, obj == null ? "" : JSON.stringify(obj), { qos: 1, retain });
  }
  subscribe(t, cb) { this.handlers.set(t, cb); this.client.subscribe(t, { qos: 1 }); }
  unsubscribe(t) { this.handlers.delete(t); this.client.unsubscribe(t); }
  end() { try { this.client.end(true); } catch (e) {} }
}

class LocalBus {
  constructor() {
    this.index = 0;
    this.handlers = new Map();
    this.online = true;
    this.ch = new BroadcastChannel("wm-bus");
    this.ch.onmessage = e => this.deliver(e.data.topic, e.data.payload);
  }
  connect() { return Promise.resolve(this); }
  retained() { try { return JSON.parse(localStorage.getItem("wm-retained") || "{}"); } catch (e) { return {}; } }
  deliver(t, payload) {
    const cb = this.handlers.get(t);
    if (cb) setTimeout(() => cb(payload == null ? null : JSON.parse(payload)), 0);
  }
  onStatus() {}
  publish(t, obj, { retain = false } = {}) {
    const payload = obj == null ? null : JSON.stringify(obj);
    if (retain) {
      const r = this.retained();
      if (payload == null) delete r[t]; else r[t] = payload;
      localStorage.setItem("wm-retained", JSON.stringify(r));
    }
    this.ch.postMessage({ topic: t, payload });
    this.deliver(t, payload);
  }
  subscribe(t, cb) {
    this.handlers.set(t, cb);
    const r = this.retained()[t];
    if (r) setTimeout(() => cb(JSON.parse(r)), 0);
  }
  unsubscribe(t) { this.handlers.delete(t); }
  end() { this.ch.close(); }
}

export const useLocalBus = () => new URLSearchParams(location.search).get("bus") === "local";

// Connect to a specific broker, or the first one that answers.
export async function connectBus(preferred = null) {
  if (useLocalBus()) return new LocalBus().connect();
  const order = preferred != null ? [preferred, ...BROKERS.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...BROKERS.keys()];
  let lastErr;
  for (const i of order) {
    try { return await new MqttBus(i).connect(); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no broker");
}

// Find which broker holds a room: connect to each and wait for its retained state.
export async function findRoom(room, preferred = null, waitMs = 3500) {
  if (useLocalBus()) {
    const bus = await new LocalBus().connect();
    const st = bus.retained()[topic(room, "s")];
    return st ? { bus, state: JSON.parse(st) } : (bus.end(), null);
  }
  const order = preferred != null ? [preferred, ...BROKERS.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...BROKERS.keys()];
  for (const i of order) {
    let bus;
    try { bus = await new MqttBus(i).connect(); } catch (e) { continue; }
    const state = await new Promise(res => {
      const t = setTimeout(() => res(null), waitMs);
      bus.subscribe(topic(room, "s"), s => { if (s) { clearTimeout(t); res(s); } });
    });
    if (state) return { bus, state };
    bus.end();
  }
  return null;
}
