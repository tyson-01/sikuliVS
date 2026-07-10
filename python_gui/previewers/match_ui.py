import sys
import tkinter as tk
from typing import Any
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageTk
from previewers.match_engine import match_against_screen
from screenshot import take_freeze_frame

class MatchPreviewWindow:
    def __init__(self, screen_bgr: np.ndarray, image_path: str, initial_sim: float = 0.7):
        self.image_path = image_path
        self.similarity = initial_sim
        self.screen_bgr = screen_bgr  # High-res master source layer
        
        self.orig_h, self.orig_w = screen_bgr.shape[:2]
        
        # Initialize match caching list so zoom events don't re-trigger OpenCV
        self.cached_matches: list[dict[str, Any]] = []

        self.root = tk.Tk()
        self.root.title("SikuliVS: Match Analyzer")
        self.root.configure(bg="#1e1e1e")

        # 1. Dynamic Window Geometry (80% of Display screen bounds)
        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        win_w = int(screen_w * 0.8)
        win_h = int(screen_h * 0.8)
        self.root.geometry(f"{win_w}x{win_h}")

        # 2. Compute Fit-To-Screen Scaling factor default
        # Leave a small pixel buffer for the embedded toolbars
        scale_w = (win_w - 40) / self.orig_w
        scale_h = (win_h - 120) / self.orig_h
        self.scale_factor = min(scale_w, scale_h, 1.0)

        # 3. Workspace Layout Architecture Setup
        self.workspace_frame = tk.Frame(self.root, bg="#1e1e1e")
        self.workspace_frame.pack(fill="both", expand=True)

        self.v_scroll = tk.Scrollbar(self.workspace_frame, orient="vertical")
        self.v_scroll.pack(side="right", fill="y")
        
        self.h_scroll = tk.Scrollbar(self.workspace_frame, orient="horizontal")
        self.h_scroll.pack(side="bottom", fill="x")

        self.canvas = tk.Canvas(
            self.workspace_frame, 
            bg="#111111", 
            highlightthickness=0,
            xscrollcommand=self.h_scroll.set,
            yscrollcommand=self.v_scroll.set
        )
        self.canvas.pack(fill="both", expand=True)
        
        self.v_scroll.config(command=self.canvas.yview)
        self.h_scroll.config(command=self.canvas.xview)

        # 4. Control Toolbar Panel
        self.control_panel = tk.Frame(
            self.root, bg="#2d2d2d", padx=15, pady=10,
            highlightthickness=1, highlightbackground="#444444"
        )
        self.control_panel.pack(side="bottom", fill="x")

        tk.Label(
            self.control_panel, text="Similarity Threshold:", 
            bg="#2d2d2d", fg="white", font=("Helvetica", 10, "bold")
        ).pack(side="left", padx=(0, 5))

        self.sim_text_var = tk.StringVar(value=f"{self.similarity:.2f}")
        
        # Real-time binding for Entry box text changes
        self.sim_text_var.trace_add("write", self.on_text_type)

        self.sim_entry = tk.Entry(
            self.control_panel, textvariable=self.sim_text_var, width=5, 
            bg="#1e1e1e", fg="white", insertbackground="white", justify="center"
        )
        self.sim_entry.pack(side="left", padx=5)

        # Real-time binding for Slider movements
        self.slider = tk.Scale(
            self.control_panel, from_=0.0, to=1.0, resolution=0.01, 
            orient="horizontal", showvalue=False, bg="#2d2d2d", fg="white", 
            highlightthickness=0, length=150, command=self.on_slider_move
        )
        self.slider.set(self.similarity)
        self.slider.pack(side="left", padx=10)

        tk.Label(
            self.control_panel, text="Ctrl+Scroll to Zoom | Enter to Save | Esc to Cancel", 
            bg="#2d2d2d", fg="#aaaaaa", font=("Helvetica", 9, "italic")
        ).pack(side="right", padx=(15, 0))

        # Event shortcuts
        self.root.bind("<Return>", lambda _: self.save_and_exit())
        self.root.bind("<Escape>", lambda _: self.root.destroy())
        
        self.root.bind("<Control-MouseWheel>", self.on_zoom_wheel)
        self.root.bind("<Control-Button-4>", lambda e: self.adjust_zoom(1.1))
        self.root.bind("<Control-Button-5>", lambda e: self.adjust_zoom(0.9))
        
        self.canvas.bind("<Configure>", lambda _: self.update_scroll_region())

        # First compute loop setup seed
        self.recalculate_matches()

    def recalculate_matches(self) -> None:
        """Runs the OpenCV engine to evaluate matches. Only triggered when similarity updates."""
        try:
            self.cached_matches, _ = match_against_screen(self.screen_bgr, self.image_path, self.similarity)
        except Exception as e:
            print(f"[DEBUG ERROR] CV matching failure: {e}", file=sys.stderr)
        self.update_match_render()

    def update_match_render(self) -> None:
        """Renders presentation visual components out out from precomputed cache maps."""
        try:
            display_w = max(int(self.orig_w * self.scale_factor), 1)
            display_h = max(int(self.orig_h * self.scale_factor), 1)

            # Fast interpolation mapping for speedy layout zooms
            resized_bgr = cv2.resize(self.screen_bgr, (display_w, display_h), interpolation=cv2.INTER_LINEAR)
            rgb_img = cv2.cvtColor(resized_bgr, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(rgb_img)
            draw = ImageDraw.Draw(pil_img)

            # Render bounding matrices using our cached matches
            for m in self.cached_matches:
                x = int(m["x"] * self.scale_factor)
                y = int(m["y"] * self.scale_factor)
                w = int(m["w"] * self.scale_factor)
                h = int(m["h"] * self.scale_factor)
                
                draw.rectangle([x, y, x + w, y + h], outline="#ff3333", width=2)
                draw.text((x, max(0, y - 15)), f"{m['score']:.2f}", fill="#ff3333")

            self.tk_render = ImageTk.PhotoImage(pil_img)
            self.canvas.delete("all")
            self.canvas.create_image(0, 0, anchor="nw", image=self.tk_render)
            
            self.update_scroll_region()
        except Exception as e:
            print(f"[DEBUG ERROR] Frame transformation mapping update dropped: {e}", file=sys.stderr)

    def on_zoom_wheel(self, event: tk.Event) -> None:
        if event.delta > 0:
            self.adjust_zoom(1.1)
        else:
            self.adjust_zoom(0.9)

    def adjust_zoom(self, factor: float) -> None:
        new_scale = self.scale_factor * factor
        if 0.05 <= new_scale <= 4.0:
            self.scale_factor = new_scale
            self.update_match_render()  # Instantly re-draws from cache without OpenCV overhead

    def update_scroll_region(self) -> None:
        self.canvas.config(scrollregion=self.canvas.bbox("all"))

    def on_slider_move(self, val: str) -> None:
        """Slider interaction tracker loop."""
        new_sim = float(val)
        if abs(self.similarity - new_sim) > 0.001:
            self.similarity = new_sim
            # Suppress infinite update loops with trace tracker state switches
            self.sim_text_var.set(f"{self.similarity:.2f}")
            self.recalculate_matches()

    def on_text_type(self, *args: Any) -> None:
        """Real-time validation handler for keyboard input entries."""
        try:
            val = float(self.sim_text_var.get())
            if 0.0 <= val <= 1.0:
                if abs(self.similarity - val) > 0.001:
                    self.similarity = val
                    self.slider.set(val)
                    self.recalculate_matches()
        except ValueError:
            pass # Keep looking for cleaner characters as the user is typing

    def save_and_exit(self) -> None:
        print(f"{self.similarity:.2f}")
        sys.stdout.flush()
        self.root.destroy()

def run_match_preview(image_path: str, initial_sim: float) -> None:
    screen_pil = take_freeze_frame()
    screen_bgr = cv2.cvtColor(np.array(screen_pil), cv2.COLOR_RGB2BGR)

    app = MatchPreviewWindow(screen_bgr, image_path, initial_sim)
    app.root.mainloop()