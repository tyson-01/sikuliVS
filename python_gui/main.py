import argparse
import sys
from typing import NoReturn

def main() -> None:
    parser = argparse.ArgumentParser(description="SikuliVS GUI Engine")
    parser.add_argument('--action', choices=['region', 'capture', 'offset', 'match'], required=True)
    parser.add_argument('--out', type=str, help="Output destination path for file captures.")
    parser.add_argument('--image', type=str, help="Target image path for offset configurations.")
    parser.add_argument('--images', type=str, nargs='+', help="Target image paths for match preview.")
    parser.add_argument('--dx', type=int, default=0, help="Initial X offset value context.")
    parser.add_argument('--dy', type=int, default=0, help="Initial Y offset value context.")
    parser.add_argument('--similarity', type=float, default=0.7, help="Initial similarity evaluation threshold.")
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

def validate_required_arg(arg_value: str | list[str] | None, error_message: str) -> None | NoReturn:
    """Safely asserts an argument is present, printing to stderr and exiting on failure."""
    if not arg_value:
        print(f"Error: {error_message}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()