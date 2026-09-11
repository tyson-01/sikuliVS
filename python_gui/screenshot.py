import ctypes
import os
import subprocess
import sys
import tempfile
from typing import Callable
from PIL import Image, ImageGrab

# A Wayland compositor will not hand its framebuffer to a client, so the screenshot has
# to come from a tool the desktop itself ships. One of these exists on any desktop that
# can take a screenshot at all; the path is appended to the command.
DESKTOP_TOOLS = [
    ['spectacle', '-b', '-o'],
    ['grim'],
    ['gnome-screenshot', '-f']
]

def enable_dpi_awareness() -> None:
    """
    Makes Windows report real pixels rather than scaled ones.

    On a display at anything other than 100%, Tk reports logical pixels while PIL
    returns physical ones, so without this every coordinate a selector prints is out by
    the scale factor. Does nothing anywhere else.
    """
    if sys.platform != 'win32':
        return

    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)      # Per-monitor aware
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()       # Windows 8 and older
        except Exception:
            pass    # An unscaled display needs neither, and a wrong guess is worse

def take_freeze_frame() -> Image.Image:
    """
    Photographs the primary screen.

    The primary screen alone, deliberately. Every selector takes the image's size as the
    screen's size, and SikuliX's own Screen(0) is that same surface, so spanning a
    multi-monitor desktop would put every picked coordinate out by the offset of whichever
    monitor sits above or to the left of the primary one.
    """
    for route in _routes():
        frame = route()
        if frame is not None:
            return frame

    raise RuntimeError("Could not find a valid display capture driver on your desktop environment.")

def _routes() -> list[Callable[[], Image.Image | None]]:
    """
    Whichever capture route is likelier to work first. Only Linux has two: Wayland needs
    a desktop tool, X11 can be read directly, and either can be wrong about its session.
    """
    if sys.platform != 'linux':
        return [_capture_direct]

    return [_capture_via_desktop_tool, _capture_direct] if _is_wayland() \
        else [_capture_direct, _capture_via_desktop_tool]

def _is_wayland() -> bool:
    return bool(os.environ.get('WAYLAND_DISPLAY')) \
        or os.environ.get('XDG_SESSION_TYPE') == 'wayland'

def _capture_direct() -> Image.Image | None:
    """Reads the screen through PIL, which is native on Windows and macOS and X11 only on Linux."""
    try:
        return ImageGrab.grab()
    except Exception:
        return None

def _capture_via_desktop_tool() -> Image.Image | None:
    """
    Asks the desktop's own screenshot tool for a file and loads it.

    The temp file is removed in either case: a tool that exits non-zero having already
    written, or an image PIL cannot read, would otherwise leave it behind for good.
    """
    handle, tmp_path = tempfile.mkstemp(prefix='svs-snap-', suffix='.png')
    os.close(handle)

    try:
        for tool in DESKTOP_TOOLS:
            try:
                subprocess.run(
                    tool + [tmp_path],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True
                )
            except (OSError, subprocess.CalledProcessError):
                continue    # Not this desktop's tool

            if os.path.getsize(tmp_path) > 0:
                # convert() loads the pixels, so the file can go in the finally below.
                return Image.open(tmp_path).convert("RGB")

        return None
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
