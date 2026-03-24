# Traggo — Stream Deck Plugin

A [Stream Deck](https://www.elgato.com/stream-deck) plugin that connects to a self-hosted [Traggo](https://traggo.net/) time-tracking server, letting you start and stop timers from your deck without opening a browser.

---

## Overview

The plugin provides two actions:

### Timer Toggle (key button)

Placed on any key button. Each action is bound to one Traggo account and one tag.

| Button state | Meaning |
|---|---|
| Clock outline (idle) | No timer is running |
| Clock filled (running) | A timer is running for this action's tag |
| Dashed clock (other) | A timer is running, but for a different tag |
| Warning triangle | The configured tag no longer exists on the server |

**Press behaviour:**
- *Idle* → starts a new timer with the configured tag and note.
- *Running* → stops the current timer.
- *Other* → stops the current timer, then immediately starts a new one with this action's tag.

Each button can optionally display the tag name and/or the elapsed time. The elapsed counter updates every second independently of the server poll interval.

### Timer Dial (Stream Deck + encoder)

Placed on an encoder dial (Stream Deck+). The touch display shows the currently selected tag name, its colour, and the running elapsed time.

- **Rotate** — cycle through the tag list.
- **Press or tap** — start or stop the timer (same toggle logic as the key button).
- **Touch tap while a different timer is running** — jumps the dial to that timer's tag.

The tag list order and which tags are included in the rotation can be configured per-action in the Property Inspector.

### Accounts

Accounts are shared across all actions via Stream Deck's global settings. You can add as many Traggo servers as you like and assign a different account to each action. The plugin authenticates with a long-lived device token (no expiry) and can revoke it on logout.

---

## Installation

1. Go to the [Releases](../../releases) page and download the latest `.streamDeckPlugin` file.
2. Double-click the downloaded file. Stream Deck software will open and prompt you to install it.
3. Once installed, the **Traggo** category appears in the Stream Deck action list.
4. Drag **Timer Toggle** or **Timer Dial** onto a button or encoder slot.
5. In the Property Inspector (right panel), click **Add account**, enter your Traggo server URL, username, and password, then click **Login**.
6. Select an account, choose a tag, and optionally adjust the poll interval and display options.

> **Requirements:** Stream Deck software 6.4 or later. For Timer Dial you need a Stream Deck+ (or any device with encoder support).

---

## Build

### Requirements

| Tool | Version |
|---|---|
| Node.js | 20 LTS or later |
| npm | Bundled with Node |
| Stream Deck software | 6.4+ (for live reload) |
| [@elgato/cli](https://github.com/elgatosf/cli) | Installed as a dev dependency |

### Setup

```sh
npm install
```

### Build (single pass)

```sh
npm run build
```

Rollup bundles `src/plugin.ts` and all its dependencies into a single minified CommonJS file at `de.grey-scaled.time-tracker-remote.sdPlugin/bin/plugin.js`. This is the only file the Stream Deck runtime executes.

### Watch mode (with live reload)

```sh
npm run watch
```

Rollup watches for source changes, rebuilds on every save, and calls `streamdeck restart de.grey-scaled.time-tracker-remote` automatically so the running plugin picks up the new bundle without restarting Stream Deck software.

### Tests

```sh
npm test          # single run
npm run test:watch  # interactive watch
```

The test suite uses [Vitest](https://vitest.dev/) and covers the GraphQL layer, account management, timer queries, tag fetching, and the bus registry. No Stream Deck software is required.

### TypeScript check (no emit)

```sh
npx tsc --noEmit
```

### Configuration

| File | Purpose |
|---|---|
| `tsconfig.json` | TypeScript — `ES2022` modules, `Bundler` module resolution, `noImplicitOverride` |
| `rollup.config.mjs` | Bundle entry point, output path, source-map toggle (watch only) |
| `de.grey-scaled.time-tracker-remote.sdPlugin/manifest.json` | Stream Deck manifest — action UUIDs, icons, Property Inspector paths |

---

## Extend

This plugin is designed so that new time-tracking backends can be added without touching the shared action or core layers.

### Architecture

```
src/
├── core/                    # Pure, backend-agnostic shared code
│   ├── types.ts             # TagDefinition, TimerInfo, BusData
│   ├── account-bus.ts       # IAccountBus interface
│   ├── format.ts            # formatElapsed()
│   ├── icons.ts             # TimerState type + SVG icon strings
│   ├── image.ts             # buildImage()  — key button SVG
│   └── dial-image.ts        # buildDialImage() — touch display SVG
│
├── actions/                 # Stream Deck action classes
│   ├── timer-toggle.ts      # Key button action (injected bus factory + PI handler)
│   └── timer-dial.ts        # Encoder dial action (same injection)
│
├── endpoints/
│   └── traggo/              # All Traggo-specific network code
│       ├── graphql.ts       # Raw fetch wrapper
│       ├── accounts.ts      # Login/logout, global-settings persistence
│       ├── timer.ts         # getRunningTimer()
│       ├── timer-actions.ts # startTimer(), stopTimer()
│       ├── tags.ts          # fetchTags()
│       ├── pi-bridge.ts     # Handles PI→plugin messages (accounts, login, tags)
│       └── traggo-bus.ts    # IAccountBus implementation + getBus() registry
│
└── plugin.ts                # Wires everything together, calls streamDeck.connect()
```

### Key contracts

**`IAccountBus`** (`src/core/account-bus.ts`) — the boundary between an action and a backend. An action only calls:

```ts
bus.subscribe(token, intervalMs, (data: BusData) => { /* render */ });
bus.unsubscribe(token);
bus.stopTimer(id);
bus.startTimer(tagKey, note);
```

**`BusData`** (`src/core/types.ts`) — the payload delivered to every subscriber after each poll:

```ts
type BusData = {
  timer: TimerInfo;   // { running: false } | { running: true; id; tagKey; color; startTime }
  tags:  TagDefinition[];  // [{ key, color }, ...]
};
```

### Adding a new endpoint

1. **Create `src/endpoints/<name>/`** and add the following files (mirroring the Traggo folder):

   - **`accounts.ts`** — persists and retrieves credentials from Stream Deck global settings.
   - **`<name>-bus.ts`** — implements `IAccountBus`. The `getBus(accountKey)` factory keeps a module-level `Map<string, YourBus>` and removes entries when the last subscriber unsubscribes. Implement `_poll()` to fill a `BusData` object and notify subscribers.
   - **`pi-bridge.ts`** — exports `handleCommonPIMessage(payload)` for messages sent from the Property Inspector (at minimum `getAccounts`, `login`, `removeAccount`, `fetchTags`).

2. **Register the actions** in `src/plugin.ts`:

   ```ts
   import { getBus }                  from "./endpoints/<name>/<name>-bus.js";
   import { handleCommonPIMessage }   from "./endpoints/<name>/pi-bridge.js";

   streamDeck.actions.registerAction(new TimerToggle(getBus, handleCommonPIMessage));
   streamDeck.actions.registerAction(new TimerDial(getBus, handleCommonPIMessage));
   ```

   Because `TimerToggle` and `TimerDial` accept `getBus` and `handleCommonPIMessage` as constructor arguments, the action classes need no modification.

3. **Add Property Inspector HTML** (`de.grey-scaled.time-tracker-remote.sdPlugin/ui/`) with matching UI for account management, tag selection, and interval settings. Refer to the existing `timer-toggle.html` for the expected message protocol.

4. **Update `manifest.json`** with the new action UUIDs, icons, and `PropertyInspectorPath` entries.

5. **Write tests** in `src/endpoints/<name>/` alongside the source, using the same Vitest + `vi.resetModules()` + `vi.doMock()` pattern found in `traggo-bus.test.ts`.
