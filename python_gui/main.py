import argparse
import sys
from typing import NoReturn

def main() -> None:
    parser = argparse.ArgumentParser(description="SikuliVS GUI Engine")
    parser.add_argument('--action', choices=['region', 'capture', 'offset', 'match', 'highlight', 'location', 'showlocation'], required=True)
    parser.add_argument('--out', type=str, help="Output destination path for file captures.")
    parser.add_argument('--image', type=str, help="Target image path for offset configurations.")
    parser.add_argument('--images', type=str, nargs='+', help="Target image paths for match preview.")
    parser.add_argument('--dx', type=int, default=0, help="Initial X offset value context.")
    parser.add_argument('--dy', type=int, default=0, help="Initial Y offset value context.")
    parser.add_argument('--similarity', type=float, default=0.7, help="Initial similarity evaluation threshold.")
    parser.add_argument('--x', type=int, help="X coordinate for the highlight, location and showlocation actions.")
    parser.add_argument('--y', type=int, help="Y coordinate for the highlight, location and showlocation actions.")
    parser.add_argument('--w', type=int, help="Region width for the highlight action.")
    parser.add_argument('--h', type=int, help="Region height for the highlight action.")
    args = parser.parse_args()

    # Route the actions to their respective handlers
    if args.action == 'region':
        from gui_selectors.region import run_selector
        run_selector()
        
    elif args.action == 'capture':
        validate_required_arg(args.out, "--out path required for capture action.")
        from gui_selectors.capture import run_capture
        run_capture(args.out)
        
    elif args.action == 'offset':
        validate_required_arg(args.image, "--image path required for offset action.")
        from gui_selectors.offset import run_offset
        run_offset(args.image, args.dx, args.dy, args.similarity)
        
    elif args.action == 'match':
        # A dynamic image string can resolve to several files, all previewed together
        images = args.images or ([args.image] if args.image else [])
        validate_required_arg(images, "--images path(s) required for match action.")
        from previewers.match_ui import run_match_preview
        run_match_preview(images, args.similarity)

    elif args.action == 'highlight':
        if None in (args.x, args.y, args.w, args.h):
            print("Error: --x --y --w --h required for highlight action.", file=sys.stderr)
            sys.exit(1)
        from gui_selectors.highlight import run_highlight
        run_highlight(args.x, args.y, args.w, args.h)

    elif args.action == 'location':
        # --x/--y are optional here; supplying them seeds a retake on an existing point
        from gui_selectors.location import run_location
        run_location(args.x, args.y)

    elif args.action == 'showlocation':
        if None in (args.x, args.y):
            print("Error: --x --y required for showlocation action.", file=sys.stderr)
            sys.exit(1)
        from gui_selectors.show_location import run_show_location
        run_show_location(args.x, args.y)

def validate_required_arg(arg_value: str | list[str] | None, error_message: str) -> None | NoReturn:
    """Safely asserts an argument is present, printing to stderr and exiting on failure."""
    if not arg_value:
        print(f"Error: {error_message}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()