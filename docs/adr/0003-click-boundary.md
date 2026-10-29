# ADR 0003: Mark the click boundary with a `debugger;` pause in our own first listener

- Status: accepted (revised after spikes on Chrome 156, October 28, 2026)
- Date: 2026-10-28

## Context

To separate a click's code from background code (timers, animation frames, hot reload), the browser collector must take coverage after the user presses the mouse but **before** any page handler runs. Anything that runs between the press and the take is filed as background and lost from the click.

## Options tried

| Option                                                                                          | Result (measured)                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Init script adds a capture-phase `pointerdown` listener that calls a Playwright `exposeBinding` | **Fails.** The binding is asynchronous, so the click handler (`checkout`) ran before the take and landed in the background delta                                  |
| `DOMDebugger.setEventListenerBreakpoint('pointerdown')`                                         | **Works but is fragile.** It pauses before _every_ pointerdown listener: ours, the app's, and Playwright's isolated-world listener. Each pause costs a round trip |
| **An init script whose first capture listener records the target and runs `debugger;`**         | **Works.** One pause per click, in our own frame. Paused for 4.7 to 7.1 ms per click across four runs; the click handler lands in the action delta                |

## Decision

- The init script registers the first window capture `pointerdown` listener. It stores a description of the target on `window`, then runs `debugger;`. Its source ends with `//# sourceURL=lightpath://hook.js`.
- `Debugger.paused` handler: `CallFrame.url` is empty for init scripts, so the collector resolves the frame's `scriptId` through `Debugger.scriptParsed` to identify the hook. Any other pause (a `debugger;` in app code) is resumed at once.
- While paused: take coverage and read the target in parallel, open the trace (so the click's requests are tagged), resume. Everything else (sending messages) happens after resuming.

## Consequences and limits

- **Chrome drops `pointerup`, `mouseup`, and `click` if they arrive while the page is paused (measured).** A human press lasts 50 to 150 ms, so a 5 ms pause is safe. Synthetic instant clicks (Playwright `page.mouse.click()` with no hold) lose the click event. Tests use press, hold 80 ms, release.
- Lightpath can't be used together with breakpoints in DevTools on the same page: app `debugger;` statements are resumed automatically.
- Keyboard activation is a boundary too (M3): a capture `keydown` listener pauses the same way for Enter (anywhere except a textarea or contenteditable) and Space (on buttons, links, checkboxes, radios, and ARIA widgets, never while typing in a text field). Held keys, IME composition, and shortcuts with Ctrl, Alt, or Meta are ignored. Unlike pointer events, key events aren't dropped during a pause: Enter and Space still activated a button, a link, a form field, a checkbox, and a `role="button"` element after a 70 ms pause (measured). Traces are labelled with the key, like `button: Checkout (Enter)`.
- Full page loads (M3): a link, a form post, or `location.href = …` replaces the document, and its scripts and coverage go with it. A third listener, on `beforeunload`, pauses once more while the old document still exists; the collector takes coverage there and files it under the active trace (or as background if no action is open). The new page's startup code lands in the same trace through the closing take, and the page request is tagged with the trace header. Taking coverage from a request interception handler instead deadlocks: the renderer waits for the held navigation request (measured, 3 s timeout). The listener never sets `returnValue`, so no "leave site?" prompt appears.
- Budget: the pause must stay under 20 ms p99. Measure on the example shop in M3.
