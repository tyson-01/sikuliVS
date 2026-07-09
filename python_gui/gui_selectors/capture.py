import sys
import tkinter as tk
from PIL import Image, ImageEnhance, ImageTk
from screenshot import take_freeze_frame

class CaptureCanvas:
    def __init__(self, output_path: str):
        self.output_path = output_path
        
        self.root = tk.Tk()
        self.root.attributes('-fullscreen', True)
        self.root.attributes('-topmost', True)

        # 1. Grab environmental freeze frame background
        self.orig_img = take_freeze_frame()
        
        # 2. Render darkened overlay environment
        enhancer = ImageEnhance.Brightness(self.orig_img)
        self.dark_img = enhancer.enhance(0.4)
        self.tk_dark_img = ImageTk.PhotoImage(self.dark_img)

        self.canvas = tk.Canvas(self.root, cursor="cross", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.create_image(0, 0, anchor="nw", image=self.tk_dark_img)

        # Mouse coordinate and tracking states
        self.start_x: int | None = None
        self.start_y: int | None = None
        self.rect_id: int | None = None
        self.crop_id: int | None = None
        self.tk_crop: ImageTk.PhotoImage | None = None

        # Bind mouse interface interactions
        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        self.root.bind("<Escape>", lambda _: self.root.destroy())

    def on_press(self, event: tk.Event) -> None:
        """Anchors the initial bounding coordinates on click down."""
        self.start_x = event.x
        self.start_y = event.y

    def on_drag(self, event: tk.Event) -> None:
        """Cuts a clean un-dimmed frame viewport out of the darkened layout overlay."""
        if self.start_x is None or self.start_y is None:
            return

        x1, x2 = sorted((self.start_x, event.x))
        y1, y2 = sorted((self.start_y, event.y))

        if self.rect_id:
            self.canvas.delete(self.rect_id)
        if self.crop_id:
            self.canvas.delete(self.crop_id)

        if (x2 - x1) > 0 and (y2 - y1) > 0:
            cropped = self.orig_img.crop((x1, y1, x2, y2))
            self.tk_crop = ImageTk.PhotoImage(cropped)
            self.crop_id = self.canvas.create_image(x1, y1, anchor="nw", image=self.tk_crop)
            self.rect_id = self.canvas.create_rectangle(x1, y1, x2, y2, outline="#00FF00", width=2)

    def on_release(self, event: tk.Event) -> None:
        """Saves out the final highlighted asset bounding box."""
        if self.start_x is None or self.start_y is None:
            return

        x1, x2 = sorted((self.start_x, event.x))
        y1, y2 = sorted((self.start_y, event.y))

        w = x2 - x1
        h = y2 - y1

        if w > 4 and h > 4:
            # Crop out raw un-dimmed source pixels
            final_crop = self.orig_img.crop((x1, y1, x2, y2))
            final_crop.save(self.output_path, "PNG")
            print("SUCCESS")
            sys.stdout.flush()

        self.root.destroy()

def run_capture(output_path: str) -> None:
    """Launches the interactive snip cropping window selection tool."""
    app = CaptureCanvas(output_path)
    app.root.mainloop()