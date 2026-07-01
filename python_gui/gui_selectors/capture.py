import sys
import tkinter as tk
from PIL import ImageTk, ImageEnhance

# Use your working pure-python desktop screenshot driver
from screenshot import take_freeze_frame

class CaptureCanvas:
    def __init__(self, output_path):
        self.output_path = output_path
        self.root = tk.Tk()
        self.root.attributes('-fullscreen', True)
        self.root.attributes('-topmost', True)

        # 1. Grab environment background layout
        self.orig_img = take_freeze_frame()
        
        # 2. Render darkened overlay visual environment
        enhancer = ImageEnhance.Brightness(self.orig_img)
        self.dark_img = enhancer.enhance(0.4)
        self.tk_dark_img = ImageTk.PhotoImage(self.dark_img)

        self.canvas = tk.Canvas(self.root, cursor="cross", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.create_image(0, 0, anchor="nw", image=self.tk_dark_img)

        # State tracking
        self.start_x = None
        self.start_y = None
        self.rect_id = None
        self.crop_id = None
        self.tk_crop = None

        # Bind interface layer controls
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
            cropped = self.orig_img.crop((x1, y1, x2, y2))
            self.tk_crop = ImageTk.PhotoImage(cropped)
            self.crop_id = self.canvas.create_image(x1, y1, anchor="nw", image=self.tk_crop)
            self.rect_id = self.canvas.create_rectangle(x1, y1, x2, y2, outline="#00FF00", width=2)

    def on_release(self, event):
        x1 = min(self.start_x, event.x)
        y1 = min(self.start_y, event.y)
        x2 = max(self.start_x, event.x)
        y2 = max(self.start_y, event.y)

        w = x2 - x1
        h = y2 - y1

        if w > 4 and h > 4:
            # Crop out the raw un-dimmed source pixels
            final_crop = self.orig_img.crop((x1, y1, x2, y2))
            final_crop.save(self.output_path, "PNG")
            print("SUCCESS")
            sys.stdout.flush()

        self.root.destroy()

def run_capture(output_path):
    app = CaptureCanvas(output_path)
    app.root.mainloop()