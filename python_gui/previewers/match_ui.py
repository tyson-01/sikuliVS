import os
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

BEST_COLOUR = "#00e05a"   # The hit SikuliX would act on
MATCH_COLOUR = "#ff3333"  # Every other hit above the threshold

# One colour per image in the overlay-all view. Green and red are deliberately absent:
# they mean best hit and other hits in the single-image view, and reusing them here makes
# two images look like one image's ranked matches.
PALETTE = ["#3aa0ff", "#ffb020", "#c86bff", "#00d0c0", "#ff6fd8", "#ffe14d", "#7d8cff"]

STEP = 0.01
COARSE_STEP = 0.05
MIN_LABEL_WIDTH = 26  # Below this on-screen box width, score labels become unreadable
LEGEND_COLUMNS = 3
LEGEND_MAX_ROWS = 4
THUMBNAIL_MAX = (120, 40)


def _load_font(size: int) -> Any:
    """Best available font at a usable size."""
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
    def __init__(self, screen_bgr: np.ndarray, image_paths: list[str], initial_sim: float = 0.7):
        self.image_paths = list(image_paths)
        self.multi = len(self.image_paths) > 1
        self.similarity = min(max(initial_sim, 0.0), 1.0)
        self.screen_bgr = screen_bgr  # High-res master source layer

        self.orig_h, self.orig_w = screen_bgr.shape[:2]

        # A correlation pass is threshold independent, so each image is analysed once on a
        # worker thread and only re-filtered afterwards.
        self.matchers: dict[str, ScreenMatcher | Exception] = {}
        self.results: dict[str, list[dict[str, Any]]] = {}
        self._result_queue: queue.Queue[tuple[str, ScreenMatcher | Exception]] = queue.Queue()

        # "all" overlays every image, an int isolates that one
        self.view: str | int = "all" if self.multi else 0

        # Guards Entry <-> Scale write-backs, and coalesces redraws during a drag
        self._syncing = False
        self._render_job: str | None = None
        self._closing = False

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
        chrome = 220 if self.multi else 150
        self.fit_scale = min((win_w - 40) / self.orig_w, (win_h - chrome) / self.orig_h, 1.0)
        self.scale_factor = self.fit_scale

        # 3. Workspace Layout Architecture Setup
        # Packed first so a cramped window shrinks the image instead of the controls
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
        self._update_carousel_label()

        # 4. Paint the screenshot immediately, then analyse in the background
        self.request_render()
        self.set_status("Analyzing screen…", MUTED)
        threading.Thread(target=self._run_analysis, daemon=True).start()
        self.root.after(50, self._poll_analysis)

    def colour_for(self, index: int) -> str:
        return PALETTE[index % len(PALETTE)]

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

        # Commit on Enter or focus loss, not on every keystroke
        self.sim_entry.bind("<Return>", self.on_entry_return)
        self.sim_entry.bind("<KP_Enter>", self.on_entry_return)
        self.sim_entry.bind("<FocusOut>", self.on_entry_commit)
        self.sim_entry.bind("<Escape>", self.on_entry_revert)
        self.sim_entry.bind("<Up>", lambda _: self.step_similarity(STEP) or "break")
        self.sim_entry.bind("<Down>", lambda _: self.step_similarity(-STEP) or "break")

        if self.multi:
            self._build_carousel(left)

        self.status_label = tk.Label(
            left, text="", bg=PANEL_BG, fg=MUTED, font=("Helvetica", 10), anchor="w"
        )
        self.status_label.pack(side="top", anchor="w", pady=(8, 0))

        if self.multi:
            self._build_legend(left)

        right = tk.Frame(self.control_panel, bg=PANEL_BG)
        right.pack(side="right", padx=(20, 0))

        buttons = tk.Frame(right, bg=PANEL_BG)
        buttons.pack(side="top", anchor="e")
        self._button(buttons, "Save  (Enter)", self.save_and_exit, bg=ACCENT, activebackground="#1b8ad6").pack(side="left", padx=(0, 8))
        self._button(buttons, "Cancel  (Esc)", self.cancel_and_exit).pack(side="left")

        hint = "◀ ▶ or ← → step 0.01  ·  Shift ± 0.05  ·  Ctrl+Scroll zoom  ·  Ctrl+0 fit"
        if self.multi:
            hint = "[ ] switch image  ·  " + hint
        tk.Label(
            right, text=hint,
            bg=PANEL_BG, fg=MUTED, font=("Helvetica", 9, "italic"), anchor="e"
        ).pack(side="top", anchor="e", pady=(8, 0))

    def _build_carousel(self, parent: tk.Misc) -> None:
        row = tk.Frame(parent, bg=PANEL_BG)
        row.pack(side="top", anchor="w", pady=(10, 0))

        self._button(row, "◀", lambda: self.step_view(-1), font=("Helvetica", 12), padx=12).pack(side="left")

        self.view_label = tk.Label(
            row, text="", bg=PANEL_BG, fg=TEXT, font=("Helvetica", 10, "bold"),
            width=32, anchor="w"
        )
        self.view_label.pack(side="left", padx=10)

        self._button(row, "▶", lambda: self.step_view(1), font=("Helvetica", 12), padx=12).pack(side="left")

        self.thumbnail_label = tk.Label(row, bg=PANEL_BG, bd=0)
        self.thumbnail_label.pack(side="left", padx=(14, 0))
        self._thumbnail_cache: dict[str, ImageTk.PhotoImage] = {}

    def _build_legend(self, parent: tk.Misc) -> None:
        self.legend_frame = tk.Frame(parent, bg=PANEL_BG)
        self.legend_frame.pack(side="top", anchor="w", pady=(8, 0))

        self.legend_labels: dict[str, tk.Label] = {}
        shown = self.image_paths[:LEGEND_COLUMNS * LEGEND_MAX_ROWS]

        for index, path in enumerate(shown):
            cell = tk.Frame(self.legend_frame, bg=PANEL_BG, cursor="hand2")
            cell.grid(row=index // LEGEND_COLUMNS, column=index % LEGEND_COLUMNS, sticky="w", padx=(0, 16))

            swatch = tk.Label(cell, bg=self.colour_for(index), width=2, height=1, bd=0)
            swatch.pack(side="left", padx=(0, 6))

            text = tk.Label(
                cell, text=f"{os.path.basename(path)} …", bg=PANEL_BG, fg=MUTED,
                font=("Helvetica", 9), anchor="w"
            )
            text.pack(side="left")

            for widget in (cell, swatch, text):
                widget.bind("<Button-1>", lambda _e, i=index: self.set_view(i))

            self.legend_labels[path] = text

        hidden = len(self.image_paths) - len(shown)
        if hidden > 0:
            tk.Label(
                self.legend_frame, text=f"+{hidden} more", bg=PANEL_BG, fg=MUTED,
                font=("Helvetica", 9, "italic")
            ).grid(row=LEGEND_MAX_ROWS, column=0, sticky="w", pady=(4, 0))

    def _bind_shortcuts(self) -> None:
        self.root.bind("<Return>", self.on_global_return)
        self.root.bind("<KP_Enter>", self.on_global_return)
        self.root.bind("<Escape>", lambda _: self.cancel_and_exit())

        self.root.bind("<Left>", lambda e: self._arrow_step(e, -STEP))
        self.root.bind("<Right>", lambda e: self._arrow_step(e, STEP))
        self.root.bind("<Shift-Left>", lambda e: self._arrow_step(e, -COARSE_STEP))
        self.root.bind("<Shift-Right>", lambda e: self._arrow_step(e, COARSE_STEP))

        self.root.bind("<bracketleft>", lambda _: self.step_view(-1))
        self.root.bind("<bracketright>", lambda _: self.step_view(1))
        self.root.bind("<Prior>", lambda _: self.step_view(-1))
        self.root.bind("<Next>", lambda _: self.step_view(1))

        self.root.bind("<Control-MouseWheel>", self.on_zoom_wheel)
        self.root.bind("<Control-Button-4>", lambda _: self.adjust_zoom(1.25))
        self.root.bind("<Control-Button-5>", lambda _: self.adjust_zoom(0.8))
        self.root.bind("<Control-Key-0>", lambda _: self.reset_zoom())

        self.canvas.bind("<Configure>", lambda _: self.update_scroll_region())
        self.canvas.bind("<Button-1>", lambda _: self.canvas.focus_set())

    # ------------------------------------------------------------ match pipeline

    def _run_analysis(self) -> None:
        """Worker thread: one correlation pass per image, posted as each finishes."""
        for path in self.image_paths:
            try:
                self._result_queue.put((path, ScreenMatcher(self.screen_bgr, path)))
            except Exception as e:  # noqa: BLE001 - report to the UI instead of stalling
                print(f"[DEBUG ERROR] CV matching failure for {path}: {e}", file=sys.stderr)
                self._result_queue.put((path, e))

    def _poll_analysis(self) -> None:
        """Tk-side pump that collects finished matchers off the worker thread."""
        if self._closing:
            return

        arrived = False
        while True:
            try:
                path, result = self._result_queue.get_nowait()
            except queue.Empty:
                break
            self.matchers[path] = result
            arrived = True

        if arrived:
            self.refresh_matches()

        if not self._closing and len(self.matchers) < len(self.image_paths):
            self.root.after(50, self._poll_analysis)

    def refresh_matches(self) -> None:
        """Re-filters every analysed image's correlation peaks at the current similarity."""
        for path, matcher in self.matchers.items():
            if isinstance(matcher, ScreenMatcher) and not matcher.error:
                self.results[path] = matcher.matches_at(self.similarity)[0]
            else:
                self.results[path] = []

        self._update_legend()
        self._update_status()
        self.request_render()

    def _update_legend(self) -> None:
        if not self.multi:
            return
        for path, label in self.legend_labels.items():
            name = os.path.basename(path)
            matcher = self.matchers.get(path)
            if matcher is None:
                label.config(text=f"{name} …", fg=MUTED)
            elif isinstance(matcher, Exception) or matcher.error:
                label.config(text=f"{name} — failed", fg="#ff6666")
            else:
                count = len(self.results.get(path, []))
                label.config(text=f"{name} ({count})", fg=TEXT if count else MUTED)

    def _update_status(self) -> None:
        done = len(self.matchers)
        total = len(self.image_paths)

        if done < total:
            self.set_status(f"Analyzing… {done} of {total} images", MUTED)
            return

        failed = [p for p in self.image_paths
                  if isinstance(self.matchers.get(p), Exception) or
                  (isinstance(self.matchers.get(p), ScreenMatcher) and self.matchers[p].error)]

        if self.view == "all":
            hits = sum(len(self.results.get(p, [])) for p in self.image_paths)
            with_matches = sum(1 for p in self.image_paths if self.results.get(p))
            if hits:
                best_path = max(self.image_paths, key=lambda p: self.results.get(p, [{"score": 0}])[0]["score"]
                                if self.results.get(p) else 0)
                best = self.results[best_path][0]["score"]
                text = (f"{hits} hit{'' if hits == 1 else 's'} across {with_matches} of {total} images"
                        f"  ·  best {best:.3f} in {os.path.basename(best_path)}")
                self.set_status(text, "#8fd98f")
            else:
                self.set_status("No matches at this similarity — lower the threshold", "#ffcc00")
        else:
            path = self.image_paths[self.view]
            matcher = self.matchers.get(path)
            if isinstance(matcher, Exception):
                self.set_status(f"Match failed: {matcher}", "#ff6666")
                return
            if isinstance(matcher, ScreenMatcher) and matcher.error:
                self.set_status(matcher.error, "#ff6666")
                return

            matches = self.results.get(path, [])
            if matches:
                plural = "" if len(matches) == 1 else "es"
                self.set_status(
                    f"{len(matches)} match{plural}  ·  best {matches[0]['score']:.3f}"
                    f"  ·  green box is the match SikuliX would use", "#8fd98f")
            else:
                self.set_status("No matches at this similarity — lower the threshold", "#ffcc00")

        if failed:
            self.status_label.config(text=self.status_label.cget("text") +
                                     f"  ·  {len(failed)} image(s) failed")

    def set_status(self, text: str, colour: str = MUTED) -> None:
        self.status_label.config(text=text, fg=colour)

    # -------------------------------------------------------------- image carousel

    def set_view(self, view: str | int) -> None:
        if view == self.view:
            return
        self.view = view
        self._update_carousel_label()
        self._update_status()
        self.request_render()

    def step_view(self, delta: int) -> None:
        if not self.multi:
            return
        order: list[str | int] = ["all"] + list(range(len(self.image_paths)))
        index = (order.index(self.view) + delta) % len(order)
        self.set_view(order[index])

    def _update_carousel_label(self) -> None:
        if not self.multi:
            return

        if self.view == "all":
            self.view_label.config(text=f"All  ·  {len(self.image_paths)} images")
            self.thumbnail_label.config(image="")
        else:
            path = self.image_paths[self.view]
            self.view_label.config(
                text=f"{self.view + 1} / {len(self.image_paths)}  ·  {os.path.basename(path)}"
            )
            thumbnail = self._thumbnail(path)
            self.thumbnail_label.config(image=thumbnail if thumbnail else "")

    def _thumbnail(self, path: str) -> ImageTk.PhotoImage | None:
        if path in self._thumbnail_cache:
            return self._thumbnail_cache[path]
        try:
            image = Image.open(path).convert("RGB")
            image.thumbnail(THUMBNAIL_MAX)
            photo = ImageTk.PhotoImage(image, master=self.root)
        except Exception as e:  # noqa: BLE001 - a preview thumbnail is not worth failing over
            print(f"[DEBUG ERROR] Thumbnail failed for {path}: {e}", file=sys.stderr)
            return None
        self._thumbnail_cache[path] = photo
        return photo

    # ------------------------------------------------------------------ rendering

    def request_render(self) -> None:
        """Coalesces redraws so a fast slider drag repaints once per frame."""
        if self._closing or self._render_job is not None:
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

            if self.view == "all":
                self._draw_all_images(draw, pil_img.size)
            else:
                self._draw_single_image(draw, pil_img.size)

            self.tk_render = ImageTk.PhotoImage(pil_img, master=self.canvas)
            self.canvas.delete("all")
            self.canvas.create_image(0, 0, anchor="nw", image=self.tk_render)

            self.update_scroll_region()
        except Exception as e:
            print(f"[DEBUG ERROR] Frame transformation mapping update dropped: {e}", file=sys.stderr)

    def _draw_all_images(self, draw: ImageDraw.ImageDraw, bounds: tuple[int, int]) -> None:
        """One colour per image; only each image's best hit is labelled to stay readable."""
        for index, path in enumerate(self.image_paths):
            colour = self.colour_for(index)
            for rank, m in enumerate(self.results.get(path, [])):
                x, y, w, h = self._scaled_box(m)
                draw.rectangle([x, y, x + w, y + h], outline=colour, width=2)
                if rank == 0:
                    self._draw_label(draw, f"{m['score']:.2f}", x, y, colour, bounds)

    def _draw_single_image(self, draw: ImageDraw.ImageDraw, bounds: tuple[int, int]) -> None:
        path = self.image_paths[self.view]
        for rank, m in enumerate(self.results.get(path, [])):
            x, y, w, h = self._scaled_box(m)

            is_best = rank == 0
            colour = BEST_COLOUR if is_best else MATCH_COLOUR
            draw.rectangle([x, y, x + w, y + h], outline=colour, width=3 if is_best else 2)

            # Tiny boxes cannot carry a legible label; the best hit always gets one
            if is_best or w >= MIN_LABEL_WIDTH:
                self._draw_label(draw, f"#{rank + 1}  {m['score']:.2f}", x, y, colour, bounds)

    def _scaled_box(self, match: dict[str, Any]) -> tuple[int, int, int, int]:
        return (
            int(match["x"] * self.scale_factor),
            int(match["y"] * self.scale_factor),
            max(int(match["w"] * self.scale_factor), 1),
            max(int(match["h"] * self.scale_factor), 1),
        )

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
        """Single entry point for a similarity change from any widget."""
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
        # The entry caret and tk.Scale both handle arrows themselves when focused
        if event.widget in (self.sim_entry, self.slider):
            return None
        self.step_similarity(delta)
        return "break"

    def on_slider_move(self, val: str) -> None:
        if self._syncing:
            return
        self.set_similarity(float(val))

    def on_entry_commit(self, _event: tk.Event | None = None) -> None:
        """Applies a typed value, snapping bad input back to the current threshold."""
        try:
            self.set_similarity(float(self.sim_text_var.get()))
        except ValueError:
            pass
        self.sim_text_var.set(f"{self.similarity:.2f}")

    def on_entry_return(self, event: tk.Event) -> str:
        """Applies the typed value and releases focus, so a second Enter saves."""
        self.on_entry_commit(event)
        self.canvas.focus_set()
        return "break"

    def on_entry_revert(self, _event: tk.Event) -> str:
        self.sim_text_var.set(f"{self.similarity:.2f}")
        self.canvas.focus_set()
        return "break"

    # ----------------------------------------------------------------------- exit

    def on_global_return(self, event: tk.Event) -> None:
        # Enter inside the entry box applies the value instead of closing
        if event.widget is self.sim_entry:
            return
        self.save_and_exit()

    def save_and_exit(self) -> None:
        print(f"{self.similarity:.2f}")
        sys.stdout.flush()
        self._shutdown()

    def cancel_and_exit(self) -> None:
        """Closes without emitting a value, which the extension reads as a cancel."""
        self._shutdown()

    def _shutdown(self) -> None:
        """Cancels pending callbacks before destroying, so none fire against a dead root."""
        self._closing = True
        if self._render_job is not None:
            self.root.after_cancel(self._render_job)
            self._render_job = None
        self.root.destroy()


def run_match_preview(image_paths: list[str], initial_sim: float) -> None:
    screen_pil = take_freeze_frame()
    screen_bgr = cv2.cvtColor(np.array(screen_pil), cv2.COLOR_RGB2BGR)

    app = MatchPreviewWindow(screen_bgr, image_paths, initial_sim)
    app.root.mainloop()
