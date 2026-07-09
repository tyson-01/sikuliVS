import cv2
import numpy as np
import os
import sys
from typing import Any

def match_against_screen(
    screen_bgr: np.ndarray, 
    image_path: str, 
    threshold: float = 0.7
) -> tuple[list[dict[str, Any]], tuple[int, int] | None]:
    """Runs template matching against an already-captured BGR screen matrix.

    Returns:
        A tuple containing:
          - A list of matching bounding-box dictionaries with coordinates and scores.
          - A coordinate tuple (x, y) representing the absolute highest match center.
    """
    if not os.path.exists(image_path):
        print(f"Error: Target image file not found at {image_path}", file=sys.stderr)
        return [], None

    screen_gray = cv2.cvtColor(screen_bgr, cv2.COLOR_BGR2GRAY)
    template_bgr = cv2.imread(image_path)
    
    if template_bgr is None:
        print(f"Error: OpenCV could not read image at {image_path}", file=sys.stderr)
        return [], None

    template_gray = cv2.cvtColor(template_bgr, cv2.COLOR_BGR2GRAY)
    h, w = template_gray.shape[:2]

    # Execute Normalized Cross-Correlation Template Match
    res = cv2.matchTemplate(screen_gray, template_gray, cv2.TM_CCOEFF_NORMED)

    # Locate hits that pass our similarity score threshold
    loc = np.where(res >= threshold)
    matches = []

    # Identify the absolute single best candidate hit
    _, max_val, _, max_loc = cv2.minMaxLoc(res)
    highest_match_center = None
    if max_val >= threshold:
        highest_match_center = (max_loc[0] + w // 2, max_loc[1] + h // 2)

    # Compile overlapping match bounding boxes
    rectangles = [[int(pt[0]), int(pt[1]), int(w), int(h)] for pt in zip(*loc[::-1])]

    # Suppress overlapping duplicate bounding box frames
    rectangles, _ = cv2.groupRectangles(rectangles, groupThreshold=1, eps=0.2)

    for rect in rectangles:
        rx, ry, rw, rh = map(int, rect[:4])
        
        # Guard against array index overruns when retrieving specific confidence metrics
        score_y = min(ry, res.shape[0] - 1)
        score_x = min(rx, res.shape[1] - 1)
        actual_score = float(res[score_y, score_x])

        matches.append({
            "x": rx, "y": ry, "w": rw, "h": rh,
            "score": max(actual_score, threshold)
        })

    return matches, highest_match_center