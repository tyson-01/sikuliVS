import os
import sys
from typing import Any

import cv2
import numpy as np

# Ceiling on how many candidate peaks are kept, so that dragging the similarity to
# zero over a large flat desktop cannot blow up the suppression pass.
MAX_CANDIDATES = 100_000
MAX_MATCHES = 200


def load_template(image_path: str) -> np.ndarray | None:
    """Reads a template asset as a 3 channel BGR matrix, discarding any alpha layer."""
    if not os.path.exists(image_path):
        print(f"Error: Target image file not found at {image_path}", file=sys.stderr)
        return None

    template = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
    if template is None:
        print(f"Error: OpenCV could not read image at {image_path}", file=sys.stderr)
        return None

    if template.ndim == 2:
        return cv2.cvtColor(template, cv2.COLOR_GRAY2BGR)
    if template.shape[2] == 4:
        return cv2.cvtColor(template, cv2.COLOR_BGRA2BGR)
    return template


class ScreenMatcher:
    """Correlates one template against one frozen screen frame.

    The correlation surface depends only on the screen and the template, never on the
    similarity threshold, so the expensive OpenCV pass runs exactly once at construction.
    Re-tuning similarity afterwards only re-filters a small precomputed peak list, which
    is what makes the preview window able to update interactively.
    """

    def __init__(self, screen_bgr: np.ndarray, image_path: str):
        self.error: str | None = None
        self.width = 0
        self.height = 0
        self._shape = (0, 0)
        self._scores = np.empty(0, dtype=np.float32)
        self._ys = np.empty(0, dtype=np.int64)
        self._xs = np.empty(0, dtype=np.int64)

        template_bgr = load_template(image_path)
        if template_bgr is None:
            self.error = f"Could not read template image: {os.path.basename(image_path)}"
            return

        self.height, self.width = template_bgr.shape[:2]
        screen_h, screen_w = screen_bgr.shape[:2]
        if self.height > screen_h or self.width > screen_w:
            self.error = (
                f"Template ({self.width}x{self.height}) is larger than "
                f"the screen ({screen_w}x{screen_h})."
            )
            print(f"Error: {self.error}", file=sys.stderr)
            return

        res = self._score_map(screen_bgr, template_bgr)
        self._shape = res.shape
        self._collect_peaks(res)

    @staticmethod
    def _score_map(screen_bgr: np.ndarray, template_bgr: np.ndarray) -> np.ndarray:
        """Builds a correlation surface where 1.0 is a perfect hit and 0.0 is no relation.

        Matching runs on colour data the way SikuliX does; greyscale collapses distinctly
        coloured widgets onto the same luminance and invents matches that are not there.
        """
        # A flat single-colour template has zero variance, which makes the normalized
        # correlation coefficient divide by zero. Squared-difference stays well defined.
        if float(template_bgr.std()) < 1e-6:
            res = 1.0 - cv2.matchTemplate(screen_bgr, template_bgr, cv2.TM_SQDIFF_NORMED)
        else:
            res = cv2.matchTemplate(screen_bgr, template_bgr, cv2.TM_CCOEFF_NORMED)

        return np.nan_to_num(res, nan=0.0, posinf=1.0, neginf=0.0)

    def _collect_peaks(self, res: np.ndarray) -> None:
        """Reduces the score surface to local maxima, sorted strongest first.

        Every pixel of a real hit scores highly, so a plain threshold sweep returns one
        candidate per pixel of every hit (millions of them on a 4K screen at a low
        threshold). Keeping only points that lead their template sized neighbourhood
        cuts that down to roughly one candidate per genuine hit.
        """
        kernel = np.ones(
            (max(self.height // 2 * 2 + 1, 3), max(self.width // 2 * 2 + 1, 3)), np.uint8
        )
        mask = res >= cv2.dilate(res, kernel) - 1e-6

        if int(np.count_nonzero(mask)) > MAX_CANDIDATES:
            peak_scores = res[mask]
            kth = peak_scores.size - MAX_CANDIDATES
            mask &= res >= float(np.partition(peak_scores, kth)[kth])

        ys, xs = np.nonzero(mask)
        scores = res[ys, xs]

        order = np.argsort(-scores, kind="stable")
        self._ys = ys[order]
        self._xs = xs[order]
        self._scores = scores[order]

    def matches_at(
        self, threshold: float, max_matches: int = MAX_MATCHES
    ) -> tuple[list[dict[str, Any]], tuple[int, int] | None]:
        """Filters the precomputed peaks down to non-overlapping hits at `threshold`.

        Returns the matches ordered best first, plus the centre of the single strongest
        one, which is the hit SikuliX itself would act on.
        """
        # Scores are sorted descending, so everything at or above the threshold is a
        # prefix; searchsorted on the negated view finds where that prefix ends.
        cutoff = int(np.searchsorted(-self._scores, -threshold, side="right"))
        if cutoff == 0:
            return [], None

        claimed = np.zeros(self._shape, dtype=bool)
        pad_x = max(self.width // 2, 1)
        pad_y = max(self.height // 2, 1)

        matches: list[dict[str, Any]] = []
        for i in range(cutoff):
            y = int(self._ys[i])
            x = int(self._xs[i])
            if claimed[y, x]:
                continue

            matches.append(
                {
                    "x": x,
                    "y": y,
                    "w": self.width,
                    "h": self.height,
                    "score": float(self._scores[i]),
                }
            )

            # A peak whose corner lands within half a template of an accepted hit
            # overlaps it by more than 50% on both axes: same hit, weaker reading.
            claimed[max(y - pad_y, 0):y + pad_y + 1, max(x - pad_x, 0):x + pad_x + 1] = True

            if len(matches) >= max_matches:
                break

        if not matches:
            return [], None

        best = matches[0]
        return matches, (best["x"] + self.width // 2, best["y"] + self.height // 2)


def match_against_screen(
    screen_bgr: np.ndarray,
    image_path: str,
    threshold: float = 0.7,
    max_matches: int = MAX_MATCHES,
) -> tuple[list[dict[str, Any]], tuple[int, int] | None]:
    """One-shot convenience wrapper for callers that only need a single threshold."""
    matcher = ScreenMatcher(screen_bgr, image_path)
    if matcher.error:
        return [], None
    return matcher.matches_at(threshold, max_matches)
