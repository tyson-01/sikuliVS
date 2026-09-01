# sikuliVS

A VS Code extension designed to completely replace the external Sikuli IDE by embedding visual automation tools directly into your standard code editor.

*Note: This extension is in **early** development.*

## What/Why

This extension provides an inline VS Code/VSCodium workflow for writing SikuliX visual automation scripts; aiming to allow the key functionalities of the Sikuli IDE within VS Code/VSCodium. It hooks into your active text window and sidebar, split into region tools and image tools.

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

## Differences from the Sikuli IDE / Quality of Life Features

This extension is opinionated. A few things that fit my workflow have been implemented.

### Image display

Rather than a toggle for displaying image in-line within the code or the image path text; this instead shows text with hover for image display.

### Dynamic image naming

Dynamic image names resolve to every file they could stand for, so hover, Set Offset and
Preview Match all work on templated filenames. Match Preview overlays every variant at
once, colour coded with a hit count per file, and `◀ ▶` isolates one at a time. All three
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

Highlighting doesn't rely on real window transparency, since Wayland compositors are
inconsistent about honouring per-window alpha. Instead it grabs a freeze-frame of the
screen, crops to the region's bounds, dims it, and draws a green border around the crop,
then shows that as a plain opaque window in place for two seconds. Looks the same, works
everywhere.

## Limitations / Future Work

Currently does not replace all Sikuli IDE functions.

- **Run:** Does not currently allow running the open Sikuli Jython script.
- **Environment:** Only tested on Fedora 44 KDE Plasma.

## Known Bugs

- **???:** Probably a bunch of stuff.

## How to Run and Test

Execute these steps in your local terminal to establish workspace and run the extension in debug mode.

### 1. Install Extension Dependencies

Download and compile the extension frontend dependencies from the project root.

```bash
npm install
```

### 2. Configure the Python Virtual Environment

The extension bridge strictly invokes a localized Python binary at `./.venv/bin/python3`. You must provision your virtual environment exactly at this path in the root folder.

```bash
# Initialize the environment
python3 -m venv .venv

# Activate the environment
source .venv/bin/activate

# Install required computer-vision packages
pip install -r requirements.txt
```

### 3. Run the Tests (Optional, if your changing stuff)

Both suites run from the terminal without the extension host.

```bash
npm run test:unit      # image reference and Pattern expression parsing
npm run test:python    # OpenCV template matching engine
```

### 4. Launch the Debugger

1. Open the **sikuliVS** project root folder in VS Code.
2. Press **F5** (or navigate to the **Run and Debug** panel and select **Launch Extension**).
3. This will launch a separate **Extension Development Host** workspace window.
4. Open your active automation scripts or directories inside that development window to test or execute the tools via the sidebar panel and text shortcuts.

## Acknowledgements

All hail RaiMan.