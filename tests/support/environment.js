import { readFileSync } from "node:fs";
export function createEnvironment() {
  let now = 1000,
    frame;
  const nodes = new Map(),
    buttons = [],
    windowEvents = new EventTarget();
  const context = {
    fillRect() {},
    fillText() {},
    clearRect() {},
    beginPath() {},
    closePath() {},
    lineTo() {},
    moveTo() {},
    stroke() {},
    fill() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    createRadialGradient() {
      return { addColorStop() {} };
    },
  };
  class Element extends EventTarget {
    constructor(tag = "div", id = "", attrs = "") {
      super();
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.dataset = {};
      this.style = {};
      this.disabled = /\sdisabled/.test(attrs);
      this.values = new Set(
        (attrs.match(/class="([^"]*)"/)?.[1] || "").split(" "),
      );
      this.classList = {
        add: (v) => this.values.add(v),
        remove: (v) => this.values.delete(v),
        contains: (v) => this.values.has(v),
        toggle: (v, on) => {
          on ??= !this.values.has(v);
          on ? this.values.add(v) : this.values.delete(v);
        },
      };
      for (const [, k, v] of attrs.matchAll(/data-(\w+)="([^"]*)"/g))
        this.dataset[k] = v;
      if (id) nodes.set(id, this);
      if (tag === "button") buttons.push(this);
    }
    set innerHTML(value) {
      this.html = value;
      if (this.id === "dialog-body") {
        nodes.delete("return-menu");
        if (value.includes('id="return-menu"'))
          new Element("button", "return-menu");
      }
    }
    get innerHTML() {
      return this.html || "";
    }
    setAttribute(k, v) {
      this[k] = v;
    }
    focus() {
      document.activeElement = this;
    }
    closest(selector) {
      return selector.includes(this.tagName.toLowerCase()) ? this : null;
    }
    querySelectorAll() {
      return ["return-menu", "dialog-action"]
        .map((id) => nodes.get(id))
        .filter(Boolean);
    }
    setPointerCapture() {}
    getContext() {
      return context;
    }
    click() {
      if (!this.disabled) this.onclick?.();
    }
  }
  const document = new EventTarget();
  document.body = new Element("body");
  document.activeElement = document.body;
  document.hidden = false;
  document.createElement = (tag) => new Element(tag);
  document.getElementById = (id) => nodes.get(id);
  document.querySelectorAll = (selector) =>
    buttons.filter((b) =>
      selector === "[data-key]"
        ? b.dataset.key
        : selector === "[data-mode]"
          ? b.dataset.mode
          : selector === "[data-color]"
            ? b.dataset.color
            : false,
    );
  const html = readFileSync(
    new URL("../../index.html", import.meta.url),
    "utf8",
  );
  for (const [, tag, attrs] of html.matchAll(/<(\w+)(\s[^>]*?)?>/g)) {
    const id = attrs?.match(/\bid="([^"]*)"/)?.[1];
    if (id || tag === "button") new Element(tag, id, attrs || "");
  }
  const media = new EventTarget();
  media.matches = true;
  Object.assign(globalThis, {
    document,
    window: {},
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    performance: { now: () => now },
    localStorage: { getItem: () => "Infinity", setItem() {} },
    matchMedia: () => media,
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    requestAnimationFrame: (callback) => {
      frame = callback;
    },
  });
  function dispatch(target, type, props = {}) {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, props);
    target.dispatchEvent(e);
    return e;
  }
  return {
    nodes,
    buttons,
    document,
    key(code, type = "keydown", target = document.body, modifiers = {}) {
      const e = new Event(type, { cancelable: true });
      Object.defineProperty(e, "target", { value: target });
      Object.assign(e, { code, repeat: false, ...modifiers });
      windowEvents.dispatchEvent(e);
      return e;
    },
    event: dispatch,
    blur: () => dispatch(windowEvents, "blur"),
    tick(seconds) {
      now += seconds * 1000;
      frame(now);
    },
    click: (id) => nodes.get(id).click(),
  };
}
