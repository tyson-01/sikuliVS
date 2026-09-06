# sikuliVS

A VS Code extension designed to completely replace the external Sikuli IDE by embedding visual automation tools directly into your standard code editor.

*Note: This extension is in **early** development.*

## What/Why

This extension provides an inline VS Code/VSCodium workflow for writing SikuliX visual automation scripts; aiming to allow the key functionalities of the Sikuli IDE within VS Code/VSCodium. It hooks into your active text window and sidebar, split into region tools, location tools and image tools.

### Location

| Feature | Description |
|---------|-------------|
| **Pick** | Click anywhere on your display to inject a native `Location(x, y)` snippet at your cursor. A magnifier follows the pointer so you can see the individual pixels you are aiming at; a click pins the point, the arrow keys walk it a pixel at a time, a right click unpins it again, and Enter commits. A **Retake** link floats above every existing call and reopens the picker already pinned to that point. |
| **Show** | Dims a freeze-frame of the whole screen, leaves the point's own surroundings at full brightness, and runs rails through it across the full width and height, for a couple of seconds. Confirms both the pixel and where on screen it sits. |

### Region

| Feature | Description |
|---------|-------------|
| **Capture** | Click and drag anywhere on your display to inject a native `Region(x, y, w, h)` snippet at your cursor. A **Retake** link floats above every existing call so you can reselect its bounds without deleting the line. |
| **Highlight** | Flashes a dimmed, green-bordered snapshot of a region's bounds on screen for two seconds, so you can confirm it still lines up with the target UI without leaving the editor. |

### Image

| Feature | Description |
|---------|-------------|
| **Capture** | Take an on-screen snapshot. The tool looks backward on your current line for a variable assignment (e.g. `target_img =`) and titles the file dynamically (`scriptName_target_login.png`) before inserting the string filename at the cursor. If no variable is found, it falls back to a Unix timestamp for the image name. |
| **Offset** | Parses an existing image reference and offset from your active code line, launching an interactive crosshair over the asset to calculate mouse `[dx, dy]` targets. Confirming a point updates your line configuration in-place. |
| **Match Preview** | Scans your display using OpenCV to visually preview template matching performance using the asset path and similarity float parsed directly from your active text line, overwriting the code with your tuned value on exit. Every hit is boxed and labelled with its true score; the strongest hit is boxed in green (though this is not guaranteed to be the one Sikuli returns, this feature is more for tuning similarities in development). |

### Run

| Feature | Description |
|---------|-------------|
| **Run** | A ▶ button in the editor title bar, and a row in the sidebar, hands the enclosing `.sikuli` bundle to SikuliX and streams its output into the **SikuliVS** output channel as it arrives. While a script runs the button becomes ⏹, which kills the JVM; SikuliX also registers its own **Alt+Shift+C** abort hotkey, which is the one that still reaches you once a script has taken over the mouse. |
| **Errors** | A failed run is parsed back out of SikuliX's output. The reported line is underlined in the editor with the exception and its cause and listed in the Problems panel. |

The log itself lands in the **SikuliVS** channel of the OUTPUT panel — pick it from the
dropdown, which defaults to something else such as Tasks. It is not the Terminal, since
java is spawned directly rather than through a shell.

Not every logging call is visible by default:

| Call | Default (`sikuliVS.debugLevel: 0`) | Shows as |
|---|---|---|
| `print "..."` | yes | the text itself |
| `Debug.user("...")` | yes | `[user (date, time)] ...` |
| `Debug.info("...")` | yes | `[info] ...` |
| `Debug.log("...")` | **no** | `[debug] ...`, only at `debugLevel` 1 or above |

`Debug.log` is gated on SikuliX's `Settings.DebugLogs`, which starts out `false` and is only
enabled once a debug level is set. `Debug.user` is gated on `Settings.UserLogs`, which
starts out `true` — so **`Debug.user` is the one to reach for** when logging from a script.

## Differences from the Sikuli IDE / Quality of Life Features

This extension is opinionated. A few things that fit my workflow have been implemented.

### Image display

Rather than a toggle for displaying image in-line within the code or the image path text; this instead shows text with hover for image display.

### Dynamic image naming

Dynamic image names resolve to every file they could stand for, so hover, Set Offset and
Preview Match all work on templated filenames. Match Preview overlays every variant at
once, colour coded with a hit count per file, and '<' '>' isolates one at a time. All three
formatting styles are covered:

| Style | Example | Resolves |
|---|---|---|
| `%` formatting | `"btn_%s.png" % state` | any suffix |
| | `"btn_%03d.png" % n` | digits only |
| | `"btn_%(name)s.png" % d` | any suffix |
| `.format()` | `"btn_{}.png".format(state)` | any suffix |
| | `"btn_{n:03d}.png".format(n=1)` | digits only |
| f-string | `f"btn_{state}.png"` | any suffix |

Integer conversions narrow the search to digits, so `btn_%d.png` will not pick up
`btn_cancel.png`. `%%`, `{{` and `}}` are treated as literals.

> **Note:** Jython 2.7 has no f-strings. Use `%` or `.format()` unless you run your
> scripts on some Python 3 execution path.

### Region highlight

Sikuli IDE's regions let you click them but only to retake. The only way to see where they were, was to temporarily add a
.hightlight(3) after your regions and right click the sidebar to run line. This extension has a built in highlight feature.

## Configuration

Running scripts needs a SikuliX jar and a Java runtime; neither is bundled with the extension.
Use the **API** jar (`sikulixapi-<version>.jar`).

| Setting | Default | Description |
|---|---|---|
| `sikuliVS.jarPath` | *(empty)* | Absolute path to the jar. When empty, a `sikulix*.jar` sitting in a workspace root is used; failing that you are prompted once and the choice is saved. |
| `sikuliVS.javaPath` | *(empty)* | Java runtime used to launch SikuliX. When empty, one is discovered (see below); failing that you are prompted once and the choice is saved. |
| `sikuliVS.pythonPath` | *(empty)* | Interpreter for the visual tools. When empty, a `.venv` beside the extension is tried, then one in a workspace root, then `python3` on `PATH` — the first that can import `cv2`, `numpy`, `PIL`, `tkinter` and `dbus_fast` wins. A packaged install has no bundled virtualenv, so this usually needs setting. |
| `sikuliVS.debugLevel` | `0` | SikuliX's `-d` level. `0` omits the option; `3` logs everything, including where startup fails. |
| `sikuliVS.jvmArgs` | `[]` | Extra JVM arguments, e.g. `--enable-native-access=ALL-UNNAMED`. |

### Java has to be headful

SikuliX reaches the screen through `java.awt.Robot`, so a headless-only JRE cannot run
anything at all.

You do not have to configure it if a usable runtime is installed. With `sikuliVS.javaPath`
empty the extension takes the first headful runtime it finds, in this order:

1. `$JAVA_HOME/bin/java`
2. `java` on `PATH`
3. JVMs installed under `/usr/lib/jvm`, `/usr/java` or `/opt/java`

If nothing usable is found, or `sikuliVS.javaPath` points at something that will not work,
you are prompted to pick a `java` binary and the choice is saved to your settings.

## Limitations / Future Work

Currently does not replace all Sikuli IDE functions.

- **Environment:** Only tested on Fedora 44 KDE Plasma. Running scripts does not work on
  Wayland yet; it was verified against a real X server in an Ubuntu container.
- **Debugging:** No breakpoints yet. The Jython bundled in the jar does support `sys.settrace`
  with correct line numbers and live locals, so a debug adapter is feasible; it is not built.

## Known Bugs

- **???:** Probably a bunch of stuff.

## Installing

There are two ways in, and they differ in one respect: where the Python interpreter for the
visual tools comes from.

### As a packaged extension

*Not published yet — this is how it will work.* Install the `.vsix` in VSCodium, then
provide the two things the extension deliberately does not bundle:

1. **A SikuliX jar.** Download `sikulixapi-<version>-<platform>.jar` and either drop it in
   your workspace root or set `sikuliVS.jarPath`.
2. **A Python environment for the visual tools.** The `.vsix` ships the sidecar scripts but
   no virtualenv — one would be hundreds of megabytes of platform-specific binaries. Build
   one anywhere and point `sikuliVS.pythonPath` at its interpreter:

   ```bash
   python3 -m venv ~/.sikulivs-venv
   ~/.sikulivs-venv/bin/pip install opencv-python numpy pillow dbus-fast
   ```

   Then set `sikuliVS.pythonPath` to `~/.sikulivs-venv/bin/python3`. On Debian-family
   systems `tkinter` comes from the system package `python3-tk`, not from pip.

Java is found automatically if a headful runtime is installed; see
[Configuration](#configuration).

### From source

For modifying the extension. Everything is discovered automatically here, so no settings
are needed.

```bash
git clone https://github.com/tyson-01/sikuliVS.git
cd sikuliVS
npm install

# The interpreter is looked for at ./.venv first, so this path is the convenient one.
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

Drop a `sikulixapi-<version>-<platform>.jar` in the repo root and it will be found without
configuring anything.

Then open the folder in VS Code / VSCodium and press **F5** to launch an Extension
Development Host window, and work on your automation scripts inside that second window.

### Running the tests

Both suites run from the terminal, no extension host required.

```bash
npm run test:unit      # parsing, script targets, SikuliX error output, command line
npm run test:python    # OpenCV template matching engine
```

## Acknowledgements

All hail RaiMan.