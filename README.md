# sikuliVS

A VS Code / VSCodium extension that brings the SikuliX IDE's visual automation tools into
your normal editor, so a `.sikuli` script can be written, run and debugged without leaving
it.

*Note: this extension is in **early** development.*

## Which SikuliX

Built against [SikuliX](https://github.com/oculix-org/SikuliX1) 2.0.5, which is the jar the
API stub is generated from.

SikuliX now continues as [OculiX](https://github.com/oculix-org/Oculix), which has not been
tested here. Its jar is named `oculixapi-<version>-<platform>.jar`, which this extension
does not pick up on its own, so point `sikuliVS.jarPath` at it rather than dropping it in
your workspace.

## Features

Every tool acts on the line your cursor is on and writes its result back there. Image paths
get a hover preview, and existing `Location(...)` and `Region(...)` calls get a **Retake**
link above them that reopens the picker on the values already in the script.

### Location and region

| Command | What it does |
|---|---|
| **Pick Location** | Click anywhere on screen to insert `Location(x, y)`. A magnifier follows the pointer, a click pins the point, the arrow keys walk it a pixel at a time, a right click unpins it, Enter commits. |
| **Show Location** | Points out your Location on screen. |
| **Create Region** | Click and drag to insert `Region(x, y, w, h)`. |
| **Highlight Region** | Flashes the region's bounds on screen, dimmed inside a green border, for two seconds. |

### Images

| Command | What it does |
|---|---|
| **Capture Image** | Snapshots part of the screen and names the file after the variable being assigned on the current line, as `script_variable.png`, falling back to `script_timestamp.png`. |
| **Set Target Offset** | Finds the image on screen and opens a crosshair over it, so a mouse `[dx, dy]` can be aimed and written back into the line. |
| **Preview Matches** | Matches the image against the screen with OpenCV at the similarity from your line, boxing and scoring every hit, the strongest in green. Tune the value and it is written back on exit. |

*Preview Matches shows the strongest match (highest similarity score), SikuliX does not necessarily return the
strongest match. The preview is for tuning similarity, not for predicting which hit a script will act on.*

### Run and debug

| Feature | What it does |
|---|---|
| **Run** | The ▶ button in the editor title bar hands the enclosing `.sikuli` bundle to SikuliX and streams its output into the **SikuliVS** output channel. It becomes ⏹ while a script runs. SikuliX's own **Alt+Shift+C** aborts a script that has taken over the mouse. |
| **Errors** | A failure is parsed out of SikuliX's output, underlined on the reported line and listed in the Problems panel. |
| **Breakpoints** | Set in the gutter on the script or any `.py` beside it, with conditions and hit counts. One on a blank line or a comment moves to the next line that runs. |
| **Stepping** | In, over and out of your own functions. Never descends into SikuliX, so `wait`, `click` and `find` each run as a single step. |
| **Variables** | Locals and module level names, with SikuliX's hundreds of exported names filtered out. `Region`, `Match`, `Location`, `Screen` and `Pattern` show a fixed set of fields, fixed deliberately because some Jython properties, `Region.image` among them, take a screenshot when read. Right click one to highlight it on screen or copy it as `Region(...)`. |
| **Watch and hover** | Evaluated in the selected frame, calls into SikuliX included: `reg.find("x.png")` really does search the screen. |
| **Debug panel** | A filmstrip of the screen through the run. On a `FindFailed` the search is re-run at similarity 0.05 both inside the region the script searched and across the whole screen, and both are drawn on the screenshot. Seeing the two boxes apart is usually the whole explanation. |
| **Interactive Console** | Opens a SikuliX interpreter already stopped in a fully initialised namespace, images resolving against the bundle you have open, with no script to write first. |

## Platform support

| Platform | Status |
|---|---|
| Linux, X11 | Tested |
| Windows 10 | Tested |
| Linux, Wayland | Authoring only; run and debug cannot work |
| macOS | Implemented, never run |

SikuliX drives the screen through `java.awt.Robot`, which emulates input through XTEST.
XTEST reaches the XWayland server and nothing past it, so on a Wayland session a script
captures the screen through the desktop portal, finds its image, then acts on nothing. The
JDK has no other route; input emulation on Wayland is unimplemented upstream and waits on
libei. The visual tools emulate no input, so authoring on Wayland is fine and only running
needs an X server.

## Install

Each release is a `.vsix` on the
[Releases page](https://github.com/tyson-01/sikuliVS/releases). There is no marketplace
listing, so check back there for new versions rather than waiting to be offered one.

```bash
codium --install-extension sikulivs-<version>.vsix
```

The Extensions view does the same job through its **...** menu, **Install from VSIX**.

Then open a script inside a `.sikuli` bundle. The extension offers once to walk the three
things it cannot supply for itself, and **SikuliVS: Set Up** does the same on demand. Each
step can be skipped.

| What | For | If skipped |
|---|---|---|
| SikuliX API jar | Running and debugging | You are asked on your first run |
| Python with opencv, numpy, pillow | The visual tools | You are asked the first time a tool needs it |
| API stub | Completion, so `Region` is not undefined | Nothing asks again; run **SikuliVS: Set Up Script Completion** when you want it |

The jar cannot be fetched for you, since SikuliX publishes a separate build per platform.
Take `sikulixapi-<version>-<platform>.jar`, not the IDE jar, which restarts the Java runtime
on startup and discards the options this extension sets. Drop it in a workspace root or set
`sikuliVS.jarPath`.

The Python environment is built on request, in the extension's own storage rather than your
system Python or your project. One limit: `tkinter` cannot be installed by pip, so on Linux
a system package may still be needed, `python3-tk` on Debian and Ubuntu or `python3-tkinter`
on Fedora, which the extension names rather than installs. To use an environment of your own
instead, install `opencv-python numpy pillow` into it and point `sikuliVS.pythonPath` at its
interpreter.

Java is found automatically if a headful runtime is installed. Nothing is installed or
written without being asked, and everything the extension installs for itself lives in one
folder that VS Code removes when the extension is uninstalled.

## Settings

| Setting | Default | Description |
|---|---|---|
| `sikuliVS.jarPath` | *(empty)* | The SikuliX API jar, which is platform specific. When empty, a `sikulix*.jar` in a workspace root is used; failing that you are prompted once and the choice is saved. |
| `sikuliVS.javaPath` | *(empty)* | Java runtime used to launch SikuliX. It has to be headful, since a headless JRE cannot reach the screen at all. When empty, `JAVA_HOME` is tried, then `java` on `PATH`, then wherever this platform installs JVMs. |
| `sikuliVS.pythonPath` | *(empty)* | Interpreter for the visual tools. When empty, a `.venv` beside the extension is tried, then the one **Set Up** built, then a `.venv` in a workspace root, then `python3` on `PATH` (`python` on Windows); the first that can import `cv2`, `numpy`, `PIL` and `tkinter` wins. It has to be an interpreter, not a `.cmd` or `.bat` wrapper. |
| `sikuliVS.debugLevel` | `0` | SikuliX's `-d` level. `0` omits the option; `3` logs everything, including where startup fails. |
| `sikuliVS.jvmArgs` | `[]` | Extra JVM arguments, e.g. `--enable-native-access=ALL-UNNAMED`. Nothing is added automatically except `-Dsun.java2d.uiScale=1`, which keeps Java's coordinates in the same pixels the visual tools use on a scaled display. |
| `sikuliVS.debug.captureMode` | `actions` | When a debugged script has its screen photographed. `actions` after every line that did something and at every stop, `stops` only when it stops, `off` never. |

## Notes

**Where output goes.** Script output lands in the **SikuliVS** channel of the OUTPUT panel,
which you pick from its dropdown. It is not the Terminal, since java is spawned directly
rather than through a shell.

**Logging from a script.** `print` and `Debug.user(...)` are visible by default.
`Debug.log(...)` is gated on SikuliX's `Settings.DebugLogs` and shows up only once
`sikuliVS.debugLevel` is 1 or above, so `Debug.user` is the one to reach for.

**Templated image names.** Dynamic names resolve to every file they could stand for, so
hover, Set Target Offset and Preview Matches all work on them. Preview Matches overlays
every variant at once, colour coded with a hit count per file, and `[` `]` step through
them one at a time.

| Style | Example | Resolves |
|---|---|---|
| `%` | `"btn_%s.png" % state`, `"btn_%(name)s.png" % d` | any suffix |
| `.format()` | `"btn_{}.png".format(state)` | any suffix |
| f-string | `f"btn_{state}.png"` | any suffix |

An integer conversion narrows the search to digits, so `btn_%d.png` will not pick up
`btn_cancel.png`. `%%`, `{{` and `}}` are treated as literals. Jython 2.7 has no f-strings,
so use `%` or `.format()` in scripts you actually run.

## Limitations

* Setting a variable's value from the VARIABLES pane is not supported; Jython offers no way
  to write back into a function's locals.
* Only the main script thread is traced, and tracing costs time per line. Image searching
  dominates a typical script so this rarely shows, but a tight pure Python loop runs slower
  under the debugger. **Pause** stops at the next line of your code and cannot interrupt a
  `wait()` that is already running.

## Bugs
* **???**: Probably a bunch of them

## From source

```bash
git clone https://github.com/tyson-01/sikuliVS.git
cd sikuliVS
npm install

python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

On Windows the last two become `py -m venv .venv` and
`.venv\Scripts\pip install -r requirements.txt`. The interpreter is looked for at `./.venv`
first, so nothing needs configuring.

Drop the `sikulixapi-<version>-<platform>.jar` for your machine in the repo root. Only one,
since the first `sikulix*.jar` in a workspace root wins and a jar for the wrong platform
will not run. Then open the folder and press **F5** to launch an Extension Development Host,
and work on your automation scripts in that second window.

## Acknowledgement

All hail RaiMan.
