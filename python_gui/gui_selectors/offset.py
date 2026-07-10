import sys
import tkinter as tk
from typing import Any
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageTk
from previewers.match_engine import match_against_screen
from screenshot import take_freeze_frame

class OffsetWindow:
    def __init__(self, image_path: str, init_dx: int = 0, init_dy: int = 0, similarity_threshold: float = 0.7):
        self.image_path = image_path
        self.dx = init_dx
        self.dy = init_dy
        self.similarity_threshold = similarity_threshold

        # 1. Grab full screen freeze frame environment
        self.screen_pil = take_freeze_frame()
        self.screen_bgr = cv2.cvtColor(np.array(self.screen_pil), cv2.COLOR_RGB2BGR)
        self.orig_h, self.orig_w = self.screen_bgr.shape[:2]

        # 2. Match Layer calculation to find target anchor points
        matches, best_center = match_against_screen(self.screen_bgr, image_path, threshold=self.similarity_threshold)
        
        self.match_rect = None
        if best_center:
            self.anchor_x, self.anchor_y = best_center
            for m in matches:
                if abs((m["x"] + m["w"] // 2) - self.anchor_x) < 5 and abs((m["y"] + m["h"] // 2) - self.anchor_y) < 5:
                    self.match_rect = m
                    break
            self.found_match = True
        else:
            self.anchor_x = self.orig_w // 2
            self.anchor_y = self.orig_h // 2
            self.found_match = False

        # Initialize Tkinter Workspace
        self.root = tk.Tk()
        self.root.title("SikuliVS: Target Offset Selector")
        self.root.configure(bg="#1e1e1e")

        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        win_w = int(screen_w * 0.8)
        win_h = int(screen_h * 0.8)
        self.root.geometry(f"{win_w}x{win_h}")

        scale_w = (win_w - 40) / self.orig_w
        scale_h = (win_h - 120) / self.orig_h
        self.scale_factor = min(scale_w, scale_h, 1.0)

        # Main Scrollable Panel Frame
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

        # 3. Bottom Panel Layout
        self.control_panel = tk.Frame(
            self.root, bg="#2d2d2d", padx=15, pady=10,
            highlightthickness=1, highlightbackground="#444444"
        )
        self.control_panel.pack(side="bottom", fill="x")

        self.dx_var = tk.StringVar(value=str(self.dx))
        self.dy_var = tk.StringVar(value=str(self.dy))
        
        # Guard to prevent dynamic cascade cycles during data mutations
        self.updating_vars = False
        self.dx_var.trace_add("write", self.on_input_field_change)
        self.dy_var.trace_add("write", self.on_input_field_change)

        # X Offset Fields
        tk.Label(self.control_panel, text="dX:", bg="#2d2d2d", fg="white", font=("Helvetica", 10, "bold")).pack(side="left", padx=(5, 2))
        self.dx_entry = tk.Entry(self.control_panel, textvariable=self.dx_var, width=6, bg="#1e1e1e", fg="white", insertbackground="white", justify="center")
        self.dx_entry.pack(side="left", padx=5)

        # Y Offset Fields
        tk.Label(self.control_panel, text="dY:", bg="#2d2d2d", fg="white", font=("Helvetica", 10, "bold")).pack(side="left", padx=(10, 2))
        self.dy_entry = tk.Entry(self.control_panel, textvariable=self.dy_var, width=6, bg="#1e1e1e", fg="white", insertbackground="white", justify="center")
        self.dy_entry.pack(side="left", padx=5)

        self.status_label = tk.Label(self.control_panel, text="", bg="#2d2d2d", font=("Helvetica", 10, "italic"))
        self.status_label.pack(side="left", padx=20)

        if self.found_match:
            self.status_label.config(text="🎯 Target Match Pattern Anchored!", fg="#4CAF50")
        else:
            self.status_label.config(text="⚠️ No Pattern Hit. Center Origin Default.", fg="#FFCC00")

        tk.Label(
            self.control_panel, text="Click to Offset | Type values | Arrows for micro-steps | Enter to Save", 
            bg="#2d2d2d", fg="#aaaaaa", font=("Helvetica", 9, "italic")
        ).pack(side="right")

        # Control Bindings
        self.canvas.bind("<Button-1>", self.on_canvas_click)
        self.root.bind("<Left>", lambda _: self.adjust_offset(-1, 0))
        self.root.bind("<Right>", lambda _: self.adjust_offset(1, 0))
        self.root.bind("<Up>", lambda _: self.adjust_offset(0, -1))
        self.root.bind("<Down>", lambda _: self.adjust_offset(0, 1))
        self.root.bind("<Return>", lambda _: self.save_and_exit())
        self.root.bind("<Escape>", lambda _: self.root.destroy())
        
        self.root.bind("<Control-MouseWheel>", self.on_zoom_wheel)
        self.root.bind("<Control-Button-4>", lambda e: self.adjust_zoom(1.1))
        self.root.bind("<Control-Button-5>", lambda e: self.adjust_zoom(0.9))
        self.canvas.bind("<Configure>", lambda _: self.canvas.config(scrollregion=self.canvas.bbox("all")))

        # Render first scene map
        self.update_render()

    def update_render(self) -> None:
        """Draws the visualization layer and explicitly forces updates back to entry containers."""
        try:
            display_w = max(int(self.orig_w * self.scale_factor), 1)
            display_h = max(int(self.orig_h * self.scale_factor), 1)

            resized_bgr = cv2.resize(self.screen_bgr, (display_w, display_h), interpolation=cv2.INTER_LINEAR)
            rgb_img = cv2.cvtColor(resized_bgr, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(rgb_img)
            draw = ImageDraw.Draw(pil_img)

            # 1. Match Boundary
            if self.match_rect:
                rx = int(self.match_rect["x"] * self.scale_factor)
                ry = int(self.match_rect["y"] * self.scale_factor)
                rw = int(self.match_rect["w"] * self.scale_factor)
                rh = int(self.match_rect["h"] * self.scale_factor)
                draw.rectangle([rx, ry, rx + rw, ry + rh], outline="#007acc", width=2)

            # 2. Anchor Origin
            cx = int(self.anchor_x * self.scale_factor)
            cy = int(self.anchor_y * self.scale_factor)
            draw.line([cx - 15, cy, cx + 15, cy], fill="#007acc", width=1)
            draw.line([cx, cy - 15, cx, cy + 15], fill="#007acc", width=1)

            # 3. Active Offset Crosshair Target Indicator
            target_x = int((self.anchor_x + self.dx) * self.scale_factor)
            target_y = int((self.anchor_y + self.dy) * self.scale_factor)
            draw.line([target_x - 12, target_y, target_x + 12, target_y], fill="#ff3333", width=2)
            draw.line([target_x, target_y - 12, target_x, target_y + 12], fill="#ff3333", width=2)

            self.tk_render = ImageTk.PhotoImage(pil_img)
            self.canvas.delete("all")
            self.canvas.create_image(0, 0, anchor="nw", image=self.tk_render)
            self.canvas.config(scrollregion=self.canvas.bbox("all"))

            # Synchronize variables safely into input forms
            self.updating_vars = True
            if self.root.focus_get() != self.dx_entry:
                self.dx_var.set(str(self.dx))
            if self.root.focus_get() != self.dy_entry:
                self.dy_var.set(str(self.dy))
            self.updating_vars = False

        except Exception as e:
            print(f"[DEBUG ERROR] Offset canvas draw fallback drop: {e}", file=sys.stderr)

    def on_canvas_click(self, event: tk.Event) -> None:
        """Handles canvas mouse pointer clicks, releases Entry focus, and recalculates coordinates."""
        # Force focus away from Entry widgets onto the root/canvas window to kill the cursor
        self.root.focus_set()

        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)

        real_click_x = canvas_x / self.scale_factor
        real_click_y = canvas_y / self.scale_factor

        self.dx = int(real_click_x - self.anchor_x)
        self.dy = int(real_click_y - self.anchor_y)
        
        # Explicitly force-sync the field text fields right now
        self.updating_vars = True
        self.dx_var.set(str(self.dx))
        self.dy_var.set(str(self.dy))
        self.updating_vars = False
        
        self.update_render()

    def on_input_field_change(self, *args: Any) -> None:
        """Triggers live rendering updates when numerical values are typed directly."""
        if self.updating_vars:
            return
        try:
            val_x = self.dx_var.get()
            val_y = self.dy_var.get()
            
            # Support negative signs '-' while typing without crashing parsing routines
            new_x = int(val_x) if val_x and val_x != '-' else self.dx
            new_y = int(val_y) if val_y and val_y != '-' else self.dy
            
            if new_x != self.dx or new_y != self.dy:
                self.dx = new_x
                self.dy = new_y
                self.update_render()
        except ValueError:
            pass 

    def adjust_offset(self, change_x: int, change_y: int) -> None:
        """Enables microscopic stepping precision shifts."""
        self.dx += change_x
        self.dy += change_y
        self.update_render()

    def on_zoom_wheel(self, event: tk.Event) -> None:
        if event.delta > 0:
            self.adjust_zoom(1.1)
        else:
            self.adjust_zoom(0.9)

    def adjust_zoom(self, factor: float) -> None:
        new_scale = self.scale_factor * factor
        if 0.05 <= new_scale <= 4.0:
            self.scale_factor = new_scale
            self.update_render()

    def save_and_exit(self) -> None:
        print(f"{self.dx},{self.dy}")
        sys.stdout.flush()
        self.root.destroy()

def run_offset(image_path: str, init_dx: int, init_dy: int) -> None:
    app = OffsetWindow(image_path, init_dx, init_dy, similarity_threshold=0.7)
    app.root.mainloop()