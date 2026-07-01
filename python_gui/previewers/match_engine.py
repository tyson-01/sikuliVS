# match_engine.py
import cv2
import numpy as np
import os
import sys

def match_against_screen(screen_bgr, image_path, threshold=0.7):
    """
    Runs template matching against an ALREADY-CAPTURED screen image.
    Does not take a new screenshot — caller is responsible for capturing once.
    Returns: (match_list_of_dicts, highest_match_xy)
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

    res = cv2.matchTemplate(screen_gray, template_gray, cv2.TM_CCOEFF_NORMED)

    loc = np.where(res >= threshold)
    matches = []

    min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(res)
    highest_match_center = None
    if max_val >= threshold:
        highest_match_center = (max_loc[0] + w // 2, max_loc[1] + h // 2)

    rectangles = []
    for pt in zip(*loc[::-1]):
        rectangles.append([int(pt[0]), int(pt[1]), int(w), int(h)])

    rectangles = list(rectangles)
    rectangles, weights = cv2.groupRectangles(rectangles, groupThreshold=1, eps=0.2)

    for rect in rectangles:
        rx, ry, rw, rh = int(rect[0]), int(rect[1]), int(rect[2]), int(rect[3])
        score_y = min(ry, res.shape[0] - 1)
        score_x = min(rx, res.shape[1] - 1)
        actual_score = float(res[score_y, score_x])

        matches.append({
            "x": rx, "y": ry, "w": rw, "h": rh,
            "score": max(actual_score, threshold)
        })

    return matches, highest_match_center