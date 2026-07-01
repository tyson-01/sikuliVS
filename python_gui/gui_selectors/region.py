import sys
import tkinter as tk
from PIL import ImageTk, ImageEnhance
from screenshot import take_freeze_frame

class RegionCanvas:
    def __init__(self):
        self.root = tk.Tk()
        self.root.attributes('-fullscreen', True)
        self.root.attributes('-topmost', True)

        # 1. Capture environment layout
        self.orig_img = take_freeze_frame()
        
        # 2. Render darkened overlay visual environment
        enhancer = ImageEnhance.Brightness(self.orig_img)
        self.dark_img = enhancer.enhance(0.4) # 60% tint drop
        self.tk_dark_img = ImageTk.PhotoImage(self.dark_img)

        self.canvas = tk.Canvas(self.root, cursor="cross", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.create_image(0, 0, anchor="nw", image=self.tk_dark_img)

        # State vars
        self.start_x = None
        self.start_y = None
        self.rect_id = None
        self.crop_id = None
        self.tk_crop = None

        # Safe system events mapping via Tkinter Core abstraction layer
        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        self.root.bind("<Escape>", lambda e: self.root.destroy())

    def on_press(self, event):
        self.start_x = event.x
        self.start_y = event.y

    def on_drag(self, event):
        x1 = min(self.start_x, event.x)
        y1 = min(self.start_y, event.y)
        x2 = max(self.start_x, event.x)
        y2 = max(self.start_y, event.y)

        if self.rect_id: self.canvas.delete(self.rect_id)
        if self.crop_id: self.canvas.delete(self.crop_id)

        if (x2 - x1) > 0 and (y2 - y1) > 0:
            # Replicate transparency cut-out block cleanly by slicing bright source img
            cropped = self.orig_img.crop((x1, y1, x2, y2))
            self.tk_crop = ImageTk.PhotoImage(cropped)
            self.crop_id = self.canvas.create_image(x1, y1, anchor="nw", image=self.tk_crop)
            self.rect_id = self.canvas.create_rectangle(x1, y1, x2, y2, outline="#00FF00", width=2)

    def on_release(self, event):
        x = min(self.start_x, event.x)
        y = min(self.start_y, event.y)
        w = abs(event.x - self.start_x)
        h = abs(event.y - self.start_y)

        if w > 4 and h > 4:
            print(f"{x},{y},{w},{h}")
            sys.stdout.flush()

        self.root.destroy()

def run_selector():
    app = RegionCanvas()
    app.root.mainloop()