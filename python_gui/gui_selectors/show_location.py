import tkinter as tk
from PIL import ImageEnhance, ImageTk
from screenshot import take_freeze_frame

DURATION_MS = 2500
SPOTLIGHT = 160         # Undimmed window kept around the point
MARK_COLOR = "#00FF00"
DIM_FACTOR = 0.35

class LocationOverlay:
    def __init__(self, x: int, y: int):
        # 1. Freeze the screen and dim the whole of it, so the point can be found in context
        # rather than in an isolated crop that says nothing about where it sits
        frame = take_freeze_frame()
        self.screen_w, self.screen_h = frame.size
        dimmed = ImageEnhance.Brightness(frame).enhance(DIM_FACTOR)

        half = SPOTLIGHT // 2
        left = max(0, min(self.screen_w - SPOTLIGHT, x - half))
        top = max(0, min(self.screen_h - SPOTLIGHT, y - half))
        spot = frame.crop((left, top, left + SPOTLIGHT, top + SPOTLIGHT))

        self.root = tk.Tk()
        self.root.attributes('-fullscreen', True)
        self.root.attributes('-topmost', True)

        self.canvas = tk.Canvas(self.root, highlightthickness=0, cursor="none")
        self.canvas.pack(fill="both", expand=True)

        # 2. Dimmed screen underneath, the point's own surroundings at full brightness on top
        self.tk_dim = ImageTk.PhotoImage(dimmed)
        self.canvas.create_image(0, 0, anchor="nw", image=self.tk_dim)
        self.tk_spot = ImageTk.PhotoImage(spot)
        self.canvas.create_image(left, top, anchor="nw", image=self.tk_spot)
        self.canvas.create_rectangle(
            left, top, left + SPOTLIGHT - 1, top + SPOTLIGHT - 1, outline=MARK_COLOR, width=2
        )

        # 3. Rails running the full screen, so the eye is led to the point, this monitor is too fucking big
        self.canvas.create_line(0, y, self.screen_w, y, fill=MARK_COLOR, width=1)
        self.canvas.create_line(x, 0, x, self.screen_h, fill=MARK_COLOR, width=1)

        label_x = min(left + SPOTLIGHT + 8, self.screen_w - 90)
        label_y = min(top + SPOTLIGHT + 8, self.screen_h - 20)
        self.canvas.create_text(
            label_x, label_y, anchor="nw", text=f"({x}, {y})",
            fill=MARK_COLOR, font=("Helvetica", 12, "bold")
        )

        self.alive = True
        self.root.bind("<Escape>", lambda _: self.close())
        self.canvas.bind("<Button-1>", lambda _: self.close())
        self.root.after(DURATION_MS, self.close)

    def close(self) -> None:
        """Tears the overlay down once, so the timer and an early dismissal cannot collide."""
        if not self.alive:
            return
        self.alive = False
        self.root.destroy()

def run_show_location(x: int, y: int) -> None:
    """Dims a freeze-frame of the whole screen and spotlights the point's surroundings in place."""
    app = LocationOverlay(x, y)
    app.root.mainloop()
