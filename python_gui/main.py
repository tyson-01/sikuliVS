import argparse
import sys

def main():
    parser = argparse.ArgumentParser(description="SikuliVS GUI Engine")
    parser.add_argument('--action', choices=['region', 'capture', 'offset', 'match'], required=True)
    parser.add_argument('--out', type=str, help="Output destination path for file captures.")
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
        
    else:
        print(f"Action {args.action} is registered but placeholder on backend.", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()