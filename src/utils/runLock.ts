/**
 * Guards against a script being run and debugged at the same time.
 *
 * Two SikuliX processes would fight over the same screen, and the second one's clicks
 * would land wherever the first one had left the pointer.
 */
let holder: string | null = null;

export function acquireRun(what: string): boolean {
    if (holder !== null) {
        return false;
    }
    holder = what;
    return true;
}

export function releaseRun(): void {
    holder = null;
}

export function runHolder(): string | null {
    return holder;
}
