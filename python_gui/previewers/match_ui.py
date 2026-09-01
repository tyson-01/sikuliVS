import queue
import sys
import threading
import tkinter as tk
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageTk

from previewers.match_engine import ScreenMatcher
from screenshot import take_freeze_frame

BG = "#1e1e1e"
PANEL_BG = "#2d2d2d"
FIELD_BG = "#1e1e1e"
BORDER = "#444444"
ACCENT = "#007acc"
TEXT = "#ffffff"
MUTED = "#aaaaaa"

BEST_COLOUR = "#00e05a"   # The hit SikuliX would actually act on
MATCH_COLOUR = "#ff3333"  # Every other hit above the threshold

STEP = 0.01
COARSE_STEP = 0.05
MIN_LABEL_WIDTH = 26  # Below this on-screen box width, score labels become unreadable


def _load_font(size: int) -> Any:
    """Best available font at a usable size; PIL's bitmap default is otherwise tiny."""
    for name in ("DejaVuSans.ttf", "NotoSans-Regular.ttf", "LiberationSans-Regular.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


class MatchPreviewWindow:
    def __init__(self, screen_bgr: np.ndarray, image_path: str, initial_sim: float = 0.7):
        self.image_path = image_path
        self.similarity = min(max(initial_sim, 0.0), 1.0)
        self.screen_bgr = screen_bgr  # High-res master source layer

        self.orig_h, self.orig_w = screen_bgr.shape[:2]

        # The correlation pass is expensive and threshold independent, so it runs once
        # on a worker thread. Everything after that is just re-filtering its output.
        self.matcher: ScreenMatcher | None = None
        self.cached_matches: list[dict[str, Any]] = []
        self._result_queue: queue.Queue[ScreenMatcher | Exception] = queue.Queue()

        # Guards against Entry <-> Scale write-backs re-triggering each other, and
        # against a burst of drag events queueing up one full redraw each.
        self._syncing = False
        self._render_job: str | None = None

        self._base_scale: float | None = None
        self._base_image: Image.Image | None = None
        self.label_font = _load_font(13)

        self.root = tk.Tk()
        self.root.title("SikuliVS: Match Analyzer")
        self.root.configure(bg=BG)
        self.root.protocol("WM_DELETE_WINDOW", self.cancel_and_exit)

        # 1. Dynamic Window Geometry (80% of Display screen bounds)
        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        win_w = int(screen_w * 0.8)
        win_h = int(screen_h * 0.8)
        self.root.geometry(f"{win_w}x{win_h}")
        self.root.minsize(720, 420)

        # 2. Compute Fit-To-Screen Scaling factor default
        # Leave a small pixel buffer for the embedded toolbars
        self.fit_scale = min((win_w - 40) / self.orig_w, (win_h - 150) / self.orig_h, 1.0)
        self.scale_factor = self.fit_scale

        # 3. Workspace Layout Architecture Setup
        # The control panel is packed first so a cramped window steals space from the
        # image instead of clipping the controls off the bottom edge.
        self.control_panel = tk.Frame(
            self.root, bg=PANEL_BG, padx=14, pady=10,
            highlightthickness=1, highlightbackground=BORDER
        )
        self.control_panel.pack(side="bottom", fill="x")

        self.workspace_frame = tk.Frame(self.root, bg=BG)
        self.workspace_frame.pack(side="top", fill="both", expand=True)

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

        self._build_controls()
        self._bind_shortcuts()

        # 4. Paint the screenshot immediately, then analyse in the background so the
        # window is on screen and responsive while OpenCV works.
        self.request_render()
        self.set_status("Analyzing screen…", MUTED)
        threading.Thread(target=self._run_analysis, daemon=True).start()
        self.root.after(50, self._poll_analysis)

    # ------------------------------------------------------------------ UI build

    def _button(self, parent: tk.Misc, text: str, command: Any, **kwargs: Any) -> tk.Button:
        options: dict[str, Any] = {
            "bg": "#3c3c3c", "fg": TEXT, "activebackground": ACCENT, "activeforeground": TEXT,
            "relief": "flat", "bd": 0, "highlightthickness": 0, "cursor": "hand2",
            "font": ("Helvetica", 10, "bold"), "padx": 10, "pady": 4,
        }
        options.update(kwargs)
        return tk.Button(parent, text=text, command=command, **options)

    def _build_controls(self) -> None:
        left = tk.Frame(self.control_panel, bg=PANEL_BG)
        left.pack(side="left", fill="x", expand=True)

        row = tk.Frame(left, bg=PANEL_BG)
        row.pack(side="top", anchor="w")

        tk.Label(
            row, text="Similarity", bg=PANEL_BG, fg=TEXT, font=("Helvetica", 11, "bold")
        ).pack(side="left", padx=(0, 12))

        self._button(row, "◀", lambda: self.step_similarity(-STEP), font=("Helvetica", 12), padx=12).pack(side="left")

        self.slider = tk.Scale(
            row, from_=0.0, to=1.0, resolution=STEP,
            orient="horizontal", showvalue=False, length=420, width=22, sliderlength=28,
            bg=PANEL_BG, fg=TEXT, troughcolor="#1a1a1a", activebackground=ACCENT,
            highlightthickness=0, bd=0, relief="flat", command=self.on_slider_move
        )
        self.slider.set(self.similarity)
        self.slider.pack(side="left", padx=8)

        self._button(row, "▶", lambda: self.step_similarity(STEP), font=("Helvetica", 12), padx=12).pack(side="left")

        self.sim_text_var = tk.StringVar(value=f"{self.similarity:.2f}")
        self.sim_entry = tk.Entry(
            row, textvariable=self.sim_text_var, width=6,
            bg=FIELD_BG, fg=TEXT, insertbackground=TEXT, justify="center",
            font=("Helvetica", 14, "bold"), relief="flat",
            highlightthickness=1, highlightbackground=BORDER, highlightcolor=ACCENT
        )
        self.sim_entry.pack(side="left", padx=(14, 0), ipady=4)

        # Commit typed values on Enter or when focus leaves; validating on every
        # keystroke would re-match on the transient "0" of a value like "0.85".
        self.sim_entry.bind("<Return>", self.on_entry_return)
        self.sim_entry.bind("<KP_Enter>", self.on_entry_return)
        self.sim_entry.bind("<FocusOut>", self.on_entry_commit)
        self.sim_entry.bind("<Escape>", self.on_entry_revert)
        self.sim_entry.bind("<Up>", lambda _: self.step_similarity(STEP) or "break")
        self.sim_entry.bind("<Down>", lambda _: self.step_similarity(-STEP) or "break")

        self.status_label = tk.Label(
            left, text="", bg=PANEL_BG, fg=MUTED, font=("Helvetica", 10), anchor="w"
        )
        self.status_label.pack(side="top", anchor="w", pady=(8, 0))

        right = tk.Frame(self.control_panel, bg=PANEL_BG)
        right.pack(side="right", padx=(20, 0))

        buttons = tk.Frame(right, bg=PANEL_BG)
        buttons.pack(side="top", anchor="e")
        self._button(buttons, "Save  (Enter)", self.save_and_exit, bg=ACCENT, activebackground="#1b8ad6").pack(side="left", padx=(0, 8))
        self._button(buttons, "Cancel  (Esc)", self.cancel_and_exit).pack(side="left")

        tk.Label(
            right,
            text="◀ ▶ or ← → step 0.01  ·  Shift ± 0.05  ·  Ctrl+Scroll zoom  ·  Ctrl+0 fit",
            bg=PANEL_BG, fg=MUTED, font=("Helvetica", 9, "italic"), anchor="e"
        ).pack(side="top", anchor="e", pady=(8, 0))

    def _bind_shortcuts(self) -> None:
        self.root.bind("<Return>", self.on_global_return)
        self.root.bind("<KP_Enter>", self.on_global_return)
        self.root.bind("<Escape>", lambda _: self.cancel_and_exit())

        self.root.bind("<Left>", lambda e: self._arrow_step(e, -STEP))
        self.root.bind("<Right>", lambda e: self._arrow_step(e, STEP))
        self.root.bind("<Shift-Left>", lambda e: self._arrow_step(e, -COARSE_STEP))
        self.root.bind("<Shift-Right>", lambda e: self._arrow_step(e, COARSE_STEP))

        self.root.bind("<Control-MouseWheel>", self.on_zoom_wheel)
        self.root.bind("<Control-Button-4>", lambda _: self.adjust_zoom(1.25))
        self.root.bind("<Control-Button-5>", lambda _: self.adjust_zoom(0.8))
        self.root.bind("<Control-Key-0>", lambda _: self.reset_zoom())

        self.canvas.bind("<Configure>", lambda _: self.update_scroll_region())
        self.canvas.bind("<Button-1>", lambda _: self.canvas.focus_set())

    # ------------------------------------------------------------ match pipeline

    def _run_analysis(self) -> None:
        """Worker thread: the single expensive OpenCV correlation pass."""
        try:
            self._result_queue.put(ScreenMatcher(self.screen_bgr, self.image_path))
        except Exception as e:  # noqa: BLE001 - must reach the UI rather than hang it
            print(f"[DEBUG ERROR] CV matching failure: {e}", file=sys.stderr)
            self._result_queue.put(e)

    def _poll_analysis(self) -> None:
        """Tk-side pump that picks the finished matcher up off the worker thread."""
        try:
            result = self._result_queue.get_nowait()
        except queue.Empty:
            self.root.after(50, self._poll_analysis)
            return

        if isinstance(result, Exception):
            self.set_status(f"Match failed: {result}", "#ff6666")
            return

        self.matcher = result
        if result.error:
            self.set_status(result.error, "#ff6666")
            return

        self.refresh_matches()

    def refresh_matches(self) -> None:
        """Re-filters the precomputed correlation peaks at the current similarity.

        This is the only work a similarity change causes: sub-millisecond, because the
        matching itself already ran once when the window opened.
        """
        if self.matcher is None or self.matcher.error:
            return

        self.cached_matches, _ = self.matcher.matches_at(self.similarity)

        count = len(self.cached_matches)
        if count:
            best = self.cached_matches[0]["score"]
            plural = "" if count == 1 else "es"
            self.set_status(f"{count} match{plural}  ·  best {best:.3f}  ·  green box is the match SikuliX would use", "#8fd98f")
        else:
            self.set_status("No matches at this similarity — lower the threshold", "#ffcc00")

        self.request_render()

    def set_status(self, text: str, colour: str = MUTED) -> None:
        self.status_label.config(text=text, fg=colour)

    # ------------------------------------------------------------------ rendering

    def request_render(self) -> None:
        """Coalesces redraws so a fast slider drag repaints once, not once per event."""
        if self._render_job is not None:
            return
        self._render_job = self.root.after(16, self._do_render)

    def _scaled_screen(self) -> Image.Image:
        """Returns the screenshot at the current zoom, rebuilt only when zoom changes."""
        if self._base_image is not None and self._base_scale == self.scale_factor:
            return self._base_image

        display_w = max(int(self.orig_w * self.scale_factor), 1)
        display_h = max(int(self.orig_h * self.scale_factor), 1)

        # Fast interpolation mapping for speedy layout zooms
        resized_bgr = cv2.resize(self.screen_bgr, (display_w, display_h), interpolation=cv2.INTER_AREA)
        self._base_image = Image.fromarray(cv2.cvtColor(resized_bgr, cv2.COLOR_BGR2RGB))
        self._base_scale = self.scale_factor
        return self._base_image

    def _do_render(self) -> None:
        """Draws the match overlay over a cached copy of the scaled screenshot."""
        self._render_job = None
        try:
            pil_img = self._scaled_screen().copy()
            draw = ImageDraw.Draw(pil_img)

            for rank, m in enumerate(self.cached_matches):
                x = int(m["x"] * self.scale_factor)
                y = int(m["y"] * self.scale_factor)
                w = max(int(m["w"] * self.scale_factor), 1)
                h = max(int(m["h"] * self.scale_factor), 1)

                is_best = rank == 0
                colour = BEST_COLOUR if is_best else MATCH_COLOUR
                draw.rectangle([x, y, x + w, y + h], outline=colour, width=3 if is_best else 2)

                # Tiny boxes cannot carry a legible label; the best hit always gets one
                # so there is at least one score on screen at any zoom level.
                if is_best or w >= MIN_LABEL_WIDTH:
                    self._draw_label(draw, f"#{rank + 1}  {m['score']:.2f}", x, y, colour, pil_img.size)

            self.tk_render = ImageTk.PhotoImage(pil_img, master=self.canvas)
            self.canvas.delete("all")
            self.canvas.create_image(0, 0, anchor="nw", image=self.tk_render)

            self.update_scroll_region()
        except Exception as e:
            print(f"[DEBUG ERROR] Frame transformation mapping update dropped: {e}", file=sys.stderr)

    def _draw_label(
        self, draw: ImageDraw.ImageDraw, text: str, x: int, y: int, colour: str, bounds: tuple[int, int]
    ) -> None:
        """Draws a score chip above the box, nudged to stay inside the image."""
        left, top, right, bottom = draw.textbbox((0, 0), text, font=self.label_font)
        pad = 3
        box_w = (right - left) + pad * 2
        box_h = (bottom - top) + pad * 2

        chip_x = min(max(x, 0), max(bounds[0] - box_w, 0))
        chip_y = y - box_h - 2
        if chip_y < 0:
            chip_y = min(y + 2, max(bounds[1] - box_h, 0))

        draw.rectangle([chip_x, chip_y, chip_x + box_w, chip_y + box_h], fill="#000000")
        draw.text((chip_x + pad - left, chip_y + pad - top), text, fill=colour, font=self.label_font)

    def update_scroll_region(self) -> None:
        self.canvas.config(scrollregion=self.canvas.bbox("all"))

    # ----------------------------------------------------------------- zoom input

    def on_zoom_wheel(self, event: tk.Event) -> None:
        self.adjust_zoom(1.25 if event.delta > 0 else 0.8)

    def adjust_zoom(self, factor: float) -> None:
        new_scale = min(max(self.scale_factor * factor, 0.05), 4.0)
        if abs(new_scale - self.scale_factor) > 1e-6:
            self.scale_factor = new_scale
            self.request_render()

    def reset_zoom(self) -> None:
        self.scale_factor = self.fit_scale
        self.request_render()

    # ----------------------------------------------------------- similarity input

    def set_similarity(self, value: float) -> None:
        """Single funnel for every similarity change, whatever widget triggered it."""
        value = round(min(max(value, 0.0), 1.0), 2)
        if abs(value - self.similarity) < 1e-9:
            return

        self.similarity = value

        self._syncing = True
        self.slider.set(value)
        self.sim_text_var.set(f"{value:.2f}")
        self._syncing = False

        self.refresh_matches()

    def step_similarity(self, delta: float) -> None:
        self.set_similarity(self.similarity + delta)

    def _arrow_step(self, event: tk.Event, delta: float) -> str | None:
        # Arrow keys belong to the caret in the entry box, and tk.Scale already steps
        # itself by one resolution unit when it holds focus.
        if event.widget in (self.sim_entry, self.slider):
            return None
        self.step_similarity(delta)
        return "break"

    def on_slider_move(self, val: str) -> None:
        if self._syncing:
            return
        self.set_similarity(float(val))

    def on_entry_commit(self, _event: tk.Event | None = None) -> None:
        """Applies a typed value, snapping bad input back to the live threshold."""
        try:
            self.set_similarity(float(self.sim_text_var.get()))
        except ValueError:
            pass
        self.sim_text_var.set(f"{self.similarity:.2f}")

    def on_entry_return(self, event: tk.Event) -> str:
        """Enter applies the typed value and releases focus, so a second Enter saves."""
        self.on_entry_commit(event)
        self.canvas.focus_set()
        return "break"

    def on_entry_revert(self, _event: tk.Event) -> str:
        self.sim_text_var.set(f"{self.similarity:.2f}")
        self.canvas.focus_set()
        return "break"

    # ----------------------------------------------------------------------- exit

    def on_global_return(self, event: tk.Event) -> None:
        # Enter inside the entry box means "apply what I typed", not "close the window".
        if event.widget is self.sim_entry:
            return
        self.save_and_exit()

    def save_and_exit(self) -> None:
        print(f"{self.similarity:.2f}")
        sys.stdout.flush()
        self.root.destroy()

    def cancel_and_exit(self) -> None:
        """Closes without emitting a value, which the extension reads as a cancel."""
        self.root.destroy()


def run_match_preview(image_path: str, initial_sim: float) -> None:
    screen_pil = take_freeze_frame()
    screen_bgr = cv2.cvtColor(np.array(screen_pil), cv2.COLOR_RGB2BGR)

    app = MatchPreviewWindow(screen_bgr, image_path, initial_sim)
    app.root.mainloop()
