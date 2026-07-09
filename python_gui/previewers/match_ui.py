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
        self.screen_bgr = screen_bgr  # Captured ONCE before window instantiation

        # Initialize full-screen window layer
        self.root = tk.Tk()
        self.root.title("SikuliVS: Match Analyzer")
        self.root.attributes("-fullscreen", True)
        self.root.configure(bg="black")

        # Layout Canvas view buffer
        self.canvas = tk.Canvas(self.root, bg="black", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)

        # Build floating control toolbar panel
        self.control_panel = tk.Frame(
            self.root, bg="#2d2d2d", padx=15, pady=10, 
            highlightthickness=1, highlightbackground="#444444"
        )
        self.control_panel.place(relx=0.5, y=40, anchor="n")

        tk.Label(
            self.control_panel, text="Similarity Threshold:", 
            bg="#2d2d2d", fg="white", font=("Helvetica", 10, "bold")
        ).pack(side="left", padx=(0, 5))

        self.sim_text_var = tk.StringVar(value=f"{self.similarity:.2f}")
        self.sim_entry = tk.Entry(
            self.control_panel, textvariable=self.sim_text_var, width=5, 
            bg="#1e1e1e", fg="white", insertbackground="white", justify="center"
        )
        self.sim_entry.pack(side="left", padx=5)

        self.slider = tk.Scale(
            self.control_panel, from_=0.0, to=1.0, resolution=0.01, 
            orient="horizontal", showvalue=False, bg="#2d2d2d", fg="white", 
            highlightthickness=0, length=150, command=self.on_slider_move
        )
        self.slider.set(self.similarity)
        self.slider.pack(side="left", padx=10)

        tk.Label(
            self.control_panel, text="Press Enter to Save Score | Esc to Cancel", 
            bg="#2d2d2d", fg="#aaaaaa", font=("Helvetica", 9, "italic")
        ).pack(side="left", padx=(15, 0))

        # Event and keybinding registrations
        self.sim_entry.bind("<Return>", self.on_entry_submit)
        self.root.bind("<Return>", lambda _: self.save_and_exit())
        self.root.bind("<Escape>", lambda _: self.root.destroy())

        # Seed initial canvas match calculations
        self.update_match_render()

    def update_match_render(self) -> None:
        """Executes matching computations against the cached screen buffer and draws highlights."""
        try:
            matches, _ = match_against_screen(self.screen_bgr, self.image_path, self.similarity)
        except Exception as e:
            print(f"[DEBUG ERROR] match_against_screen failed: {e}", file=sys.stderr)
            return

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

            self.control_panel.lift()  # Keep panel row resting cleanly above drawn canvas lines
        except Exception as e:
            print(f"[DEBUG ERROR] Tkinter canvas update failed: {e}", file=sys.stderr)

    def on_slider_move(self, val: str) -> None:
        """Handles slider reposition transformations."""
        self.similarity = float(val)
        self.sim_text_var.set(f"{self.similarity:.2f}")
        self.update_match_render()

    def on_entry_submit(self, _event: Any = None) -> None:
        """Validates entry box submissions, adjusting limits or rolling back on failure."""
        try:
            val = float(self.sim_text_var.get())
            if 0.0 <= val <= 1.0:
                self.similarity = val
                self.slider.set(val)
                self.update_match_render()
                return
        except ValueError:
            pass
        
        self.sim_text_var.set(f"{self.similarity:.2f}")

    def save_and_exit(self) -> None:
        """Flushes the finalized chosen similarity value back up out via stdout stream."""
        print(f"{self.similarity:.2f}")
        sys.stdout.flush()
        self.root.destroy()

def run_match_preview(image_path: str, initial_sim: float) -> None:
    """Takes a static screen capture freeze-frame and launches the interactive UI."""
    screen_pil = take_freeze_frame()
    screen_bgr = cv2.cvtColor(np.array(screen_pil), cv2.COLOR_RGB2BGR)

    app = MatchPreviewWindow(screen_bgr, image_path, initial_sim)
    app.root.mainloop()