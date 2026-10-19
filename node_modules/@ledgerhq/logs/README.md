# @ledgerhq/logs

> [!NOTE]
> **Status: STABLE**

Utility library used by all Ledger libraries to dispatch logs in a unified way.

## Install

```sh
pnpm add @ledgerhq/logs
```

## Usage

```ts
import { log, trace, listen, LocalTracer } from "@ledgerhq/logs";

// Subscribe to all log events
const unsubscribe = listen((log) => {
  console.log(log.type, log.message, log.data);
});

// Emit a log
log("apdu-in", "sending command", { data: "..." });

// Emit a structured trace with context
trace({ type: "hw", message: "opening device", context: { deviceId: "abc" } });

// Use a local tracer to avoid repeating type/context
const tracer = new LocalTracer("hw", { deviceId: "abc" });
tracer.trace("opening device");

unsubscribe();
```

## API

### `log(type, message?, data?)`

Emits a log event.

### `trace({ type, message?, data?, context? })`

Emits a structured trace with optional context.

### `listen(subscriber): Unsubscribe`

Subscribes to log events. Returns an unsubscribe function.

### `LocalTracer`

A class that holds a fixed `type` and `context`, making it convenient to emit multiple traces in one scope without repeating them.

## License

Apache-2.0
