import argparse
import sys

def main():
    parser = argparse.ArgumentParser(description="SikuliVS GUI Engine")
    parser.add_argument('--action', choices=['region', 'capture', 'offset', 'match'], required=True)
    parser.add_argument('--out', type=str, help="Output destination path for file captures.")
    parser.add_argument('--image', type=str, help="Target image path for offset or match configurations.")
    parser.add_argument('--dx', type=int, default=0, help="Initial X offset value context.")
    parser.add_argument('--dy', type=int, default=0, help="Initial Y offset value context.")
    parser.add_argument('--similarity', type=float, default=0.7, help="Initial similarity evaluation threshold.")
    args = parser.parse_args()

    if args.action == 'region':
        from gui_selectors.region import run_selector
        run_selector()
        
    elif args.action == 'capture':
        if not args.out:
            print("Error: --out path required for capture action.", file=sys.stderr)
            sys.exit(1)
        from gui_selectors.capture import run_capture
        run_capture(args.out)
        
    elif args.action == 'offset':
        if not args.image:
            print("Error: --image path required for offset action.", file=sys.stderr)
            sys.exit(1)
        from gui_selectors.offset import run_offset
        run_offset(args.image, args.dx, args.dy)
        
    elif args.action == 'match':
        if not args.image:
            print("Error: --image path required for match action.", file=sys.stderr)
            sys.exit(1)
        from previewers.match_ui import run_match_preview
        run_match_preview(args.image, args.similarity)

if __name__ == "__main__":
    main()