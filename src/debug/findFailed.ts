export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface FindFailure {
    image: string;
    region: Rect;
    /** Where SikuliX last saw this image, when it says so. */
    lastSeen?: { x: number; y: number; score: number };
}

// SikuliX builds the message as "<image> in <region>". The region's toString
// always carries "[x,y wxh]", so that is what this anchors on. The image half
// has three different shapes ("name: (WxH)", "name not loaded", "name as text")
// and pinning the parse to any one of them is what broke this twice.
const REGION = /\[(-?\d+),\s*(-?\d+)\s+(\d+)x(\d+)\]/g;

// Jython prepends the exception type to a message that already carries it.
const PREFIXES = /^(?:(?:org\.sikuli\.script\.)?FindFailed:\s*)+/i;

// Everything SikuliX appends after the image's name. Stripped in a loop rather
// than as one pattern, because they combine: an image that has been found once
// before reports both its size and where it was last seen.
const DETAILS = [
    /\s+seen at \(-?\d+,\s*-?\d+\)\s+with\s+[\d.]+$/i,
    /:\s*\(\d+x\d+\)$/,
    /\s+not loaded$/i,
    /\s+as text$/i
];

// "seen at (0, 0) with 1.00": SikuliX volunteering where it last found this.
const LAST_SEEN = /\s+seen at \((-?\d+),\s*(-?\d+)\)\s+with\s+([\d.]+)/i;

/**
 * Reads SikuliX's own failure message for what was searched for and where.
 *
 * Preferred over parsing the line that failed, because it reports what actually
 * ran: it still works when the image was held in a variable or passed into a
 * helper, and it names the region really searched rather than the whole screen.
 */
export function parseFindFailed(text: string): FindFailure | null {
    if (!text) {
        return null;
    }

    // The region is the last bracketed rectangle: an image name could contain
    // anything, but nothing follows the region except the screen it is on.
    let last: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    REGION.lastIndex = 0;
    while ((match = REGION.exec(text)) !== null) {
        last = match;
    }

    if (!last) {
        return null;
    }

    const head = text.slice(0, last.index);
    const image = imageName(head);
    if (!image) {
        return null;
    }

    const failure: FindFailure = {
        image,
        region: {
            x: Number(last[1]),
            y: Number(last[2]),
            w: Number(last[3]),
            h: Number(last[4])
        }
    };

    const seen = LAST_SEEN.exec(head);
    if (seen) {
        failure.lastSeen = {
            x: Number(seen[1]),
            y: Number(seen[2]),
            score: Number(seen[3])
        };
    }

    return failure;
}

/**
 * The image name, out of everything the message says before the region.
 */
function imageName(head: string): string {
    // Drop the region's own prefix ("R", "M", "S(0)@" and so on) and the " in "
    // that joins the two halves.
    let name = head.replace(/\s+in\s+\S*$/, '').replace(PREFIXES, '').trim();

    // The details combine in more than one order, so strip until nothing changes.
    for (let pass = 0; pass < DETAILS.length; pass++) {
        const before = name;
        for (const detail of DETAILS) {
            name = name.replace(detail, '').trim();
        }
        if (name === before) {
            break;
        }
    }

    return name.trim();
}
