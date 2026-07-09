import sys
import tkinter as tk
from typing import Any
from PIL import Image, ImageTk

class OffsetWindow:
    def __init__(self, image_path: str, init_dx: int = 0, init_dy: int = 0):
        self.root = tk.Tk()
        self.root.title("SikuliVS: Target Offset Selector")
        
        # 1. Load and measure the source image asset
        try:
            self.orig_img = Image.open(image_path)
        except Exception as e:
            print(f"Error loading image: {e}", file=sys.stderr)
            sys.exit(1)
            
        self.img_w, self.img_h = self.orig_img.size
        self.center_x = self.img_w // 2
        self.center_y = self.img_h // 2

        # State tracking values
        self.dx = init_dx
        self.dy = init_dy

        # 2. Window scaling constraints
        window_w = max(self.img_w + 40, 300)
        window_h = self.img_h + 80
        self.root.geometry(f"{window_w}x{window_h}")
        self.root.resizable(False, False)

        # 3. Canvas rendering interface
        self.tk_img = ImageTk.PhotoImage(self.orig_img)
        self.canvas = tk.Canvas(
            self.root, width=self.img_w, height=self.img_h, 
            bg="#1e1e1e", highlightthickness=1, highlightbackground="#333333"
        )
        self.canvas.pack(pady=10)
        self.canvas.create_image(0, 0, anchor="nw", image=self.tk_img)

        # 4. Numeric readout display label elements
        self.info_label = tk.Label(self.root, font=("Helvetica", 11, "bold"))
        self.info_label.pack()

        self.hint_label = tk.Label(
            self.root, text="Click to target | Move with Arrow Keys | Press Enter to Save", 
            font=("Helvetica", 9), fg="#888888"
        )
        self.hint_label.pack()

        # Canvas crosshair canvas element ID references
        self.red_cross_h: int | None = None
        self.red_cross_v: int | None = None

        # Draw default layouts
        self.draw_center_crosshair()
        self.update_offset_crosshair()

        # 5. Bind keyboard inputs and navigation triggers
        self.canvas.bind("<Button-1>", self.on_canvas_click)
        self.root.bind("<Left>", lambda _: self.adjust_offset(-1, 0))
        self.root.bind("<Right>", lambda _: self.adjust_offset(1, 0))
        self.root.bind("<Up>", lambda _: self.adjust_offset(0, -1))
        self.root.bind("<Down>", lambda _: self.adjust_offset(0, 1))
        self.root.bind("<Return>", lambda _: self.save_and_exit())
        self.root.bind("<Escape>", lambda _: self.root.destroy())

        self.root.focus_set()

    def draw_center_crosshair(self) -> None:
        """Draws a static blue crosshair at the image center coordinate anchor (0,0)."""
        cx, cy = self.center_x, self.center_y
        self.canvas.create_line(cx - 15, cy, cx + 15, cy, fill="#007acc", width=1)
        self.canvas.create_line(cx, cy - 15, cx, cy + 15, fill="#007acc", width=1)

    def update_offset_crosshair(self) -> None:
        """Calculates current landing crosshairs based on delta delta state variables."""
        target_x = self.center_x + self.dx
        target_y = self.center_y + self.dy

        # Clear previous crosshair lines
        if self.red_cross_h is not None:
            self.canvas.delete(self.red_cross_h)
        if self.red_cross_v is not None:
            self.canvas.delete(self.red_cross_v)

        # Draw the new targeting indicator position
        self.red_cross_h = self.canvas.create_line(
            target_x - 10, target_y, target_x + 10, target_y, fill="#ff3333", width=2
        )
        self.red_cross_v = self.canvas.create_line(
            target_x, target_y - 10, target_x, target_y + 10, fill="#ff3333", width=2
        )

        self.info_label.config(text=f"Target Offset: ( dX: {self.dx}, dY: {self.dy} )")

    def on_canvas_click(self, event: tk.Event) -> None:
        """Calculates relative click offset compared directly against absolute pixel middle."""
        self.dx = event.x - self.center_x
        self.dy = event.y - self.center_y
        self.update_offset_crosshair()

    def adjust_offset(self, change_x: int, change_y: int) -> None:
        """Applies positional micro-stepping deltas."""
        self.dx += change_x
        self.dy += change_y
        self.update_offset_crosshair()

    def save_and_exit(self) -> None:
        """Flushes chosen pixel coordinates up out to stdout stream."""
        print(f"{self.dx},{self.dy}")
        sys.stdout.flush()
        self.root.destroy()

def run_offset(image_path: str, init_dx: int, init_dy: int) -> None:
    """Launches interactive offset target picker application window frame."""
    app = OffsetWindow(image_path, init_dx, init_dy)
    app.root.mainloop()