"""Tests for the template matching engine.

    .venv/bin/python3 -m unittest discover -s python_gui/tests -v
"""

import os
import sys
import time
import tempfile
import unittest

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from previewers.match_engine import ScreenMatcher, match_against_screen  # noqa: E402

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "test-proj", "test-file.sikuli", "test-file_1783709899.png",
)
PLANTED = [(80, 60), (900, 400), (1500, 800)]


def build_screen(spots=PLANTED, size=(1080, 1920)):
    """A noisy screen with the fixture template planted at known coordinates."""
    rng = np.random.default_rng(0)
    screen = cv2.GaussianBlur((rng.random((*size, 3)) * 255).astype(np.uint8), (21, 21), 0)
    template = cv2.imread(FIXTURE)
    h, w = template.shape[:2]
    for x, y in spots:
        screen[y:y + h, x:x + w] = template
    return screen, template


class TestMatchDetection(unittest.TestCase):
    def setUp(self):
        self.screen, self.template = build_screen()
        self.matcher = ScreenMatcher(self.screen, FIXTURE)

    def test_finds_every_exact_copy_at_a_high_threshold(self):
        matches, _ = self.matcher.matches_at(0.99)
        self.assertEqual(len(matches), len(PLANTED))
        self.assertEqual(sorted((m["x"], m["y"]) for m in matches), sorted(PLANTED))

    def test_reports_true_match_scores(self):
        for threshold in (0.5, 0.7, 0.9):
            matches, _ = self.matcher.matches_at(threshold)
            for match in matches[:len(PLANTED)]:
                self.assertAlmostEqual(match["score"], 1.0, places=3)

    def test_boxes_carry_the_template_dimensions(self):
        h, w = self.template.shape[:2]
        for match in self.matcher.matches_at(0.9)[0]:
            self.assertEqual((match["w"], match["h"]), (w, h))

    def test_matches_are_sorted_best_first_and_best_centre_agrees(self):
        matches, best_centre = self.matcher.matches_at(0.5)
        scores = [m["score"] for m in matches]
        self.assertEqual(scores, sorted(scores, reverse=True))
        h, w = self.template.shape[:2]
        self.assertEqual(best_centre, (matches[0]["x"] + w // 2, matches[0]["y"] + h // 2))

    def test_overlapping_duplicates_are_suppressed(self):
        matches, _ = self.matcher.matches_at(0.95)
        self.assertEqual(len(matches), len(PLANTED))

    def test_lowering_the_threshold_never_loses_a_hit(self):
        strong = {(m["x"], m["y"]) for m in self.matcher.matches_at(0.95)[0]}
        weak = {(m["x"], m["y"]) for m in self.matcher.matches_at(0.5)[0]}
        self.assertTrue(strong.issubset(weak))


class TestBoundedCost(unittest.TestCase):
    def test_threshold_zero_stays_bounded(self):
        screen, _ = build_screen()
        matcher = ScreenMatcher(screen, FIXTURE)

        start = time.time()
        matches, _ = matcher.matches_at(0.0)
        elapsed = time.time() - start

        self.assertLess(elapsed, 2.0, "re-thresholding must stay interactive")
        self.assertLessEqual(len(matches), 200, "match count must stay capped")

    def test_rethresholding_is_far_cheaper_than_the_initial_pass(self):
        screen, _ = build_screen()

        start = time.time()
        matcher = ScreenMatcher(screen, FIXTURE)
        build = time.time() - start

        start = time.time()
        for step in range(0, 100):
            matcher.matches_at(step / 100)
        hundred_steps = time.time() - start

        self.assertLess(hundred_steps, build, "100 threshold changes must cost less than one build")


class TestDegenerateInput(unittest.TestCase):
    def test_missing_file_reports_an_error_instead_of_raising(self):
        screen, _ = build_screen()
        matcher = ScreenMatcher(screen, "/nonexistent/nope.png")
        self.assertIsNotNone(matcher.error)
        self.assertEqual(match_against_screen(screen, "/nonexistent/nope.png"), ([], None))

    def test_template_larger_than_the_screen_reports_an_error(self):
        tiny = np.zeros((10, 10, 3), np.uint8)
        matcher = ScreenMatcher(tiny, FIXTURE)
        self.assertIsNotNone(matcher.error)
        self.assertIn("larger than", matcher.error)

    def test_blank_screen_yields_no_matches(self):
        blank = np.full((600, 800, 3), 127, np.uint8)
        matches, best_centre = ScreenMatcher(blank, FIXTURE).matches_at(0.7)
        self.assertEqual(matches, [])
        self.assertIsNone(best_centre)

    def test_flat_single_colour_template_does_not_divide_by_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            flat_path = os.path.join(tmp, "flat.png")
            cv2.imwrite(flat_path, np.full((20, 20, 3), 200, np.uint8))

            screen = np.full((400, 400, 3), 30, np.uint8)
            screen[100:120, 150:170] = 200

            matches, _ = ScreenMatcher(screen, flat_path).matches_at(0.9)
            self.assertTrue(any((m["x"], m["y"]) == (150, 100) for m in matches))

    def test_greyscale_template_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            grey_path = os.path.join(tmp, "grey.png")
            patch = np.tile(np.arange(20, dtype=np.uint8).reshape(1, 20) * 12, (20, 1))
            cv2.imwrite(grey_path, patch)

            screen = np.full((400, 400, 3), 30, np.uint8)
            screen[50:70, 60:80] = cv2.cvtColor(patch, cv2.COLOR_GRAY2BGR)

            matcher = ScreenMatcher(screen, grey_path)
            self.assertIsNone(matcher.error)
            self.assertTrue(any((m["x"], m["y"]) == (60, 50) for m in matcher.matches_at(0.9)[0]))


if __name__ == "__main__":
    unittest.main()
