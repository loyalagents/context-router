// DOM dispatchEvent ignores async listener results. These tests need to await
// the application's handler, not merely Playwright's response-header event.
export async function observeSessionEvents(page) {
  await page.addInitScript(() => {
    const targetFor = type => type === 'visibilitychange' ? document : window;
    const types = new Set(['focus', 'pageshow', 'visibilitychange']);
    const registrations = new Map();
    const dispatched = new WeakMap();
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const keyFor = (type, options) =>
      `${type}:${Boolean(typeof options === 'boolean' ? options : options?.capture)}`;

    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (!types.has(type) || this !== targetFor(type) || typeof listener !== 'function')
        return add.call(this, type, listener, options);
      const key = keyFor(type, options);
      let listeners = registrations.get(key);
      if (!listeners) registrations.set(key, listeners = new Map());
      let wrapped = listeners.get(listener);
      if (!wrapped) {
        wrapped = function(event) {
          const result = listener.call(this, event);
          if (result && typeof result.then === 'function')
            dispatched.get(event)?.push(result);
          return result;
        };
        listeners.set(listener, wrapped);
      }
      return add.call(this, type, wrapped, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      if (!types.has(type) || this !== targetFor(type))
        return remove.call(this, type, listener, options);
      const listeners = registrations.get(keyFor(type, options));
      const wrapped = listeners?.get(listener);
      listeners?.delete(listener);
      return remove.call(this, type, wrapped ?? listener, options);
    };

    window.sessionEventTest = {
      ready(type) {
        return [false, true].some(capture => registrations.get(`${type}:${capture}`)?.size > 0);
      },
      async dispatch(type) {
        if (!types.has(type)) throw new Error('Unsupported session event');
        const event = new Event(type);
        const results = [];
        dispatched.set(event, results);
        targetFor(type).dispatchEvent(event);
        dispatched.delete(event);
        if (!results.length) throw new Error('No async session event handler observed');
        await Promise.all(results);
      },
    };
  });
}

export async function dispatchSessionEvent(page, type) {
  await page.waitForFunction(type => window.sessionEventTest?.ready(type), type);
  await page.evaluate(type => window.sessionEventTest.dispatch(type), type);
}
