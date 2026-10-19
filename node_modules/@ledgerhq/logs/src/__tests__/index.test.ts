import { log, trace, listen, LocalTracer } from "..";

describe("log / listen", () => {
  it("delivers a log to a subscriber", () => {
    const received: unknown[] = [];
    const unsub = listen(l => received.push(l));

    log("test", "hello");

    unsub();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "test", message: "hello" });
  });

  it("unsubscribe stops delivery", () => {
    const received: unknown[] = [];
    const unsub = listen(l => received.push(l));
    unsub();

    log("test", "should not arrive");

    expect(received).toHaveLength(0);
  });

  it("includes optional data", () => {
    const received: unknown[] = [];
    const unsub = listen(l => received.push(l));

    log("test", "with data", { foo: 42 });

    unsub();
    expect(received[0]).toMatchObject({ data: { foo: 42 } });
  });
});

describe("trace", () => {
  it("delivers a trace with context", () => {
    const received: unknown[] = [];
    const unsub = listen(l => received.push(l));

    trace({ type: "hw", message: "connecting", context: { deviceId: "abc" } });

    unsub();
    expect(received[0]).toMatchObject({
      type: "hw",
      message: "connecting",
      context: { deviceId: "abc" },
    });
  });
});

describe("LocalTracer", () => {
  it("traces with its type and context", () => {
    const received: unknown[] = [];
    const unsub = listen(l => received.push(l));

    const tracer = new LocalTracer("apdu", { sessionId: "s1" });
    tracer.trace("sending");

    unsub();
    expect(received[0]).toMatchObject({
      type: "apdu",
      message: "sending",
      context: { sessionId: "s1" },
    });
  });

  it("withType creates a new tracer with different type", () => {
    const t = new LocalTracer("a", { x: 1 });
    const t2 = t.withType("b");

    expect(t2.getType()).toBe("b");
    expect(t2.getContext()).toEqual({ x: 1 });
    expect(t.getType()).toBe("a");
  });

  it("withContext creates a new tracer with different context", () => {
    const t = new LocalTracer("a", { x: 1 });
    const t2 = t.withContext({ y: 2 });

    expect(t2.getContext()).toEqual({ y: 2 });
    expect(t.getContext()).toEqual({ x: 1 });
  });

  it("withUpdatedContext merges contexts", () => {
    const t = new LocalTracer("a", { x: 1 });
    const t2 = t.withUpdatedContext({ y: 2 });

    expect(t2.getContext()).toEqual({ x: 1, y: 2 });
  });

  it("updateContext mutates context in place", () => {
    const t = new LocalTracer("a", { x: 1 });
    t.updateContext({ y: 2 });

    expect(t.getContext()).toEqual({ x: 1, y: 2 });
  });
});
