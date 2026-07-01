import sys
import tkinter as tk
from PIL import Image, ImageTk, ImageDraw
import cv2
import numpy as np
from previewers.match_engine import match_against_screen
from screenshot import take_freeze_frame

class MatchPreviewWindow:
    def __init__(self, screen_bgr, image_path, initial_sim=0.7):
        self.image_path = image_path
        self.similarity = initial_sim
        self.screen_bgr = screen_bgr  # captured ONCE, before this window existed

        self.root = tk.Tk()
        self.root.title("SikuliVS: Match Analyzer")
        self.root.attributes("-fullscreen", True)
        self.root.configure(bg="black")

        self.canvas = tk.Canvas(self.root, bg="black", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)

        self.control_panel = tk.Frame(self.root, bg="#2d2d2d", padx=15, pady=10, highlightthickness=1, highlightbackground="#444444")
        self.control_panel.place(relx=0.5, y=40, anchor="n")

        tk.Label(self.control_panel, text="Similarity Threshold:", bg="#2d2d2d", fg="white", font=("Helvetica", 10, "bold")).pack(side="left", padx=(0, 5))

        self.sim_text_var = tk.StringVar(value=f"{self.similarity:.2f}")
        self.sim_entry = tk.Entry(self.control_panel, textvariable=self.sim_text_var, width=5, bg="#1e1e1e", fg="white", insertbackground="white", justify="center")
        self.sim_entry.pack(side="left", padx=5)

        self.slider = tk.Scale(self.control_panel, from_=0.0, to=1.0, resolution=0.01, orient="horizontal", showvalue=False, bg="#2d2d2d", fg="white", highlightthickness=0, length=150, command=self.on_slider_move)
        self.slider.set(self.similarity)
        self.slider.pack(side="left", padx=10)

        tk.Label(self.control_panel, text="Press Enter to Save Score | Esc to Cancel", bg="#2d2d2d", fg="#aaaaaa", font=("Helvetica", 9, "italic")).pack(side="left", padx=(15, 0))

        self.sim_entry.bind("<Return>", self.on_entry_submit)

        # This just re-runs matching against the cached screen_bgr — no new screenshot
        self.update_match_render()

        self.root.bind("<Return>", lambda e: self.save_and_exit())
        self.root.bind("<Escape>", lambda e: self.root.destroy())

    def update_match_render(self):
        print(f"[DEBUG] Starting match render pass. Current threshold: {self.similarity}", file=sys.stderr)
        sys.stderr.flush()

        try:
            matches, _ = match_against_screen(self.screen_bgr, self.image_path, self.similarity)
        except Exception as e:
            print(f"[DEBUG ERROR] match_against_screen blew up: {e}", file=sys.stderr)
            sys.stderr.flush()
            return

        print(f"[DEBUG] Screenshot matrix shape: {self.screen_bgr.shape}, Found matches count: {len(matches)}", file=sys.stderr)
        sys.stderr.flush()

        try:
            rgb_img = cv2.cvtColor(self.screen_bgr, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(rgb_img)
            draw = ImageDraw.Draw(pil_img)

            for m in matches:
                x, y, w, h, score = m["x"], m["y"], m["w"], m["h"], m["score"]
                draw.rectangle([x, y, x + w, y + h], outline="#ff3333", width=3)
                draw.text((x, max(0, y - 15)), f"{score:.2f}", fill="#ff3333")

            self.tk_render = ImageTk.PhotoImage(pil_img)
            self.canvas.delete("all")
            self.canvas.create_image(0, 0, anchor="nw", image=self.tk_render)

            self.control_panel.lift()
            print("[DEBUG] Canvas render committed successfully.", file=sys.stderr)
            sys.stderr.flush()
        except Exception as e:
            print(f"[DEBUG ERROR] Tkinter canvas update failed: {e}", file=sys.stderr)
            sys.stderr.flush()

    def on_slider_move(self, val):
        self.similarity = float(val)
        self.sim_text_var.set(f"{self.similarity:.2f}")
        self.update_match_render()

    def on_entry_submit(self, event):
        try:
            val = float(self.sim_text_var.get())
            if 0.0 <= val <= 1.0:
                self.similarity = val
                self.slider.set(val)
                self.update_match_render()
            else:
                self.sim_text_var.set(f"{self.similarity:.2f}")
        except ValueError:
            self.sim_text_var.set(f"{self.similarity:.2f}")

    def save_and_exit(self):
        print(f"{self.similarity:.2f}")
        sys.stdout.flush()
        self.root.destroy()

def run_match_preview(image_path, initial_sim):
    # Capture the desktop ONCE, before any Tkinter window exists to cover it
    screen_pil = take_freeze_frame()
    screen_bgr = cv2.cvtColor(np.array(screen_pil), cv2.COLOR_RGB2BGR)

    app = MatchPreviewWindow(screen_bgr, image_path, initial_sim)
    app.root.mainloop()