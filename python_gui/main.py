import argparse
import sys

def main():
    parser = argparse.ArgumentParser(description="SikuliVS GUI Engine")
    parser.add_argument('--action', choices=['region', 'capture', 'offset', 'match'], required=True)
    args = parser.parse_args()

    if args.action == 'region':
        # Change 'selectors' to 'gui_selectors'
        from gui_selectors.region import run_selector
        run_selector()
    else:
        print(f"Action {args.action} is registered but placeholder on backend.", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()