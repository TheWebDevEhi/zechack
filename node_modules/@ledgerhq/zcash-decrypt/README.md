# ZCash Decrypt

WebAssembly module for decrypting Zcash shielded transactions.

## Getting Started

### Installation
```bash
# npm
npm install -s @ledger/zcash-decrypt

# pnpm
pnpm add @ledger/zcash-decrypt
```

### Usage

```typescript
import { decrypt_tx } from "@ledgerhq/zcash-decrypt";

const decrypted = decrypt_tx(rawHexTransaction, viewingKey);
```

## Developing

### Requirements

```bash
# install rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# install wasm-pack
cargo install wasm-pack
```

### Build and Test for Node.js

```bash
# development build
pnpm run build:dev

# production build (optimized for size)
pnpm run build
```

This will generate files in `pkg/`.

### Building on a Mac?

You might want to try the following if you are having troubles building on Mac.

Update Clang via Homebrew:

```bash
brew install llvm
```

Use a newer version from Brew:

```bash
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
export CC=/opt/homebrew/opt/llvm/bin/clang
export AR=/opt/homebrew/opt/llvm/bin/llvm-ar
```

### Test

```bash
# test
pnpm run test
```
