import sys
import tkinter as tk
from PIL import Image, ImageDraw, ImageEnhance, ImageTk
from screenshot import take_freeze_frame

LOUPE_SRC = 41          # Odd, so one source pixel sits dead centre under the crosshair
ZOOM = 8
LOUPE_GAP = 30          # Distance the loupe is held away from the picked point
FRAME_COLOR = "#00FF00"
CROSS_COLOR = "#ff3333"

class LocationCanvas:
    def __init__(self, init_x: int | None = None, init_y: int | None = None):
        self.root = tk.Tk()
        self.root.attributes('-fullscreen', True)
        self.root.attributes('-topmost', True)

        # 1. Capture environment layout freeze-frame
        self.orig_img = take_freeze_frame()
        self.screen_w, self.screen_h = self.orig_img.size

        # 2. Render darkened overlay visual workspace environment
        self.dark_img = ImageEnhance.Brightness(self.orig_img).enhance(0.4)
        self.tk_dark_img = ImageTk.PhotoImage(self.dark_img)

        self.canvas = tk.Canvas(self.root, highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.create_image(0, 0, anchor="nw", image=self.tk_dark_img)

        # The point trails the pointer until a click pins it for arrow-key refinement.
        # Once pinned the real cursor is handed back so the mouse can be aimed again;
        # a right click unpins and the magnifier resumes following it.
        # A retake starts pinned on the coordinates already in the script.
        self.locked = init_x is not None and init_y is not None
        self.x = init_x if init_x is not None else self.screen_w // 2
        self.y = init_y if init_y is not None else self.screen_h // 2

        self.tk_loupe: ImageTk.PhotoImage | None = None
        self.overlay_ids: list[int] = []

        self.canvas.bind("<Motion>", self.on_motion)
        self.canvas.bind("<Button-1>", self.on_click)
        self.canvas.bind("<Button-3>", self.on_right_click)
        self.root.bind("<Left>", lambda _: self.nudge(-1, 0))
        self.root.bind("<Right>", lambda _: self.nudge(1, 0))
        self.root.bind("<Up>", lambda _: self.nudge(0, -1))
        self.root.bind("<Down>", lambda _: self.nudge(0, 1))
        self.root.bind("<Return>", lambda _: self.save_and_exit())
        self.root.bind("<Escape>", lambda _: self.root.destroy())

        self.update_render()

    def on_motion(self, event: tk.Event) -> None:
        """Trails the pointer while the point is still free."""
        if self.locked:
            return
        self.x = event.x
        self.y = event.y
        self.update_render()

    def on_click(self, event: tk.Event) -> None:
        """Pins the point down so arrow keys can walk it a pixel at a time."""
        self.x = event.x
        self.y = event.y
        self.locked = True
        self.update_render()

    def on_right_click(self, _event: tk.Event) -> None:
        """Releases the pin, handing the magnifier back to the pointer."""
        self.locked = False
        self.x = self.root.winfo_pointerx()
        self.y = self.root.winfo_pointery()
        self.update_render()

    def nudge(self, change_x: int, change_y: int) -> None:
        """Enables microscopic stepping precision shifts."""
        self.locked = True
        self.x = max(0, min(self.screen_w - 1, self.x + change_x))
        self.y = max(0, min(self.screen_h - 1, self.y + change_y))
        self.update_render()

    def build_loupe(self) -> Image.Image:
        """Blows up the raw pixels around the point and crosshairs the exact one being picked."""
        half = LOUPE_SRC // 2
        # Pad the source crop so the point stays centred even at the screen edges
        crop = self.orig_img.crop((self.x - half, self.y - half, self.x + half + 1, self.y + half + 1))
        size = LOUPE_SRC * ZOOM
        loupe = crop.resize((size, size), Image.NEAREST)

        draw = ImageDraw.Draw(loupe)
        centre = half * ZOOM + ZOOM // 2
        draw.line([0, centre, size, centre], fill=CROSS_COLOR, width=1)
        draw.line([centre, 0, centre, size], fill=CROSS_COLOR, width=1)
        draw.rectangle(
            [half * ZOOM, half * ZOOM, half * ZOOM + ZOOM - 1, half * ZOOM + ZOOM - 1],
            outline=CROSS_COLOR, width=1
        )
        draw.rectangle([0, 0, size - 1, size - 1], outline=FRAME_COLOR, width=2)
        return loupe

    def loupe_origin(self, size: int) -> tuple[int, int]:
        """Keeps the loupe beside the point, flipping sides rather than running off screen."""
        lx = self.x + LOUPE_GAP
        ly = self.y + LOUPE_GAP
        if lx + size > self.screen_w:
            lx = self.x - LOUPE_GAP - size
        if ly + size > self.screen_h:
            ly = self.y - LOUPE_GAP - size
        return max(0, lx), max(0, ly)

    def update_render(self) -> None:
        """Redraws the crosshair, the magnified loupe and the live coordinate readout."""
        for item_id in self.overlay_ids:
            self.canvas.delete(item_id)
        self.overlay_ids = []

        # Hide the pointer only while it is driving the magnifier, so a pinned
        # point never leaves the mouse invisible and unusable
        self.canvas.config(cursor="crosshair" if self.locked else "none")

        loupe = self.build_loupe()
        size = loupe.size[0]
        lx, ly = self.loupe_origin(size)

        self.tk_loupe = ImageTk.PhotoImage(loupe)
        self.overlay_ids.append(self.canvas.create_image(lx, ly, anchor="nw", image=self.tk_loupe))

        self.overlay_ids.append(
            self.canvas.create_line(self.x - 20, self.y, self.x + 20, self.y, fill=CROSS_COLOR, width=1)
        )
        self.overlay_ids.append(
            self.canvas.create_line(self.x, self.y - 20, self.x, self.y + 20, fill=CROSS_COLOR, width=1)
        )

        label = f"({self.x}, {self.y})" + ("  pinned" if self.locked else "")
        self.overlay_ids.append(
            self.canvas.create_text(
                lx, ly + size + 4, anchor="nw", text=label,
                fill=FRAME_COLOR, font=("Helvetica", 11, "bold")
            )
        )
        self.overlay_ids.append(
            self.canvas.create_text(
                lx, ly + size + 22, anchor="nw",
                text="Click pins | Right-click unpins | Arrows nudge | Enter to Save | Esc to cancel",
                fill="#aaaaaa", font=("Helvetica", 9, "italic")
            )
        )

    def save_and_exit(self) -> None:
        print(f"{self.x},{self.y}")
        sys.stdout.flush()
        self.root.destroy()

def run_location(init_x: int | None = None, init_y: int | None = None) -> None:
    """Launches the interactive magnified screen point picker."""
    app = LocationCanvas(init_x, init_y)
    app.root.mainloop()
