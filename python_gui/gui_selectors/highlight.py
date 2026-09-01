import tkinter as tk
from PIL import ImageDraw, ImageEnhance, ImageTk
from screenshot import take_freeze_frame

DURATION_MS = 2000
BORDER_COLOR = "#00FF00"
BORDER_WIDTH = 4
DIM_FACTOR = 0.5

class HighlightOverlay:
    def __init__(self, x: int, y: int, w: int, h: int):
        # 1. Grab a freeze frame and crop out just the target region
        crop = take_freeze_frame().crop((x, y, x + w, y + h))

        # 2. Dim it and draw a border, so a plain opaque window reads as a highlight
        # rather than depending on real compositor transparency (unreliable on Wayland)
        dimmed = ImageEnhance.Brightness(crop).enhance(DIM_FACTOR)
        ImageDraw.Draw(dimmed).rectangle(
            [BORDER_WIDTH // 2, BORDER_WIDTH // 2, w - BORDER_WIDTH // 2 - 1, h - BORDER_WIDTH // 2 - 1],
            outline=BORDER_COLOR, width=BORDER_WIDTH
        )

        self.root = tk.Tk()
        self.root.overrideredirect(True)
        self.root.attributes('-topmost', True)
        self.root.geometry(f"{w}x{h}+{x}+{y}")

        self.tk_image = ImageTk.PhotoImage(dimmed)
        tk.Label(self.root, image=self.tk_image, borderwidth=0).pack()

        self.root.after(DURATION_MS, self.root.destroy)

def run_highlight(x: int, y: int, w: int, h: int) -> None:
    """Composites a dimmed, bordered snapshot of a screen region and shows it in place for a couple seconds."""
    app = HighlightOverlay(x, y, w, h)
    app.root.mainloop()
