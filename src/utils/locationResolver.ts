export interface LocationRef {
    x: number;
    y: number;
    start: number;  // Character range of the whole `Location(...)` call on the line
    end: number;
}

const LOCATION_CALL = /\bLocation\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g;

/**
 * Finds every literal `Location(x, y)` call on a line, in source order.
 */
export function findLocationRefs(lineText: string): LocationRef[] {
    const commentIndex = lineText.indexOf('#');
    const searchText = commentIndex === -1 ? lineText : lineText.slice(0, commentIndex);

    const refs: LocationRef[] = [];
    LOCATION_CALL.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LOCATION_CALL.exec(searchText)) !== null) {
        refs.push({
            x: parseInt(match[1], 10),
            y: parseInt(match[2], 10),
            start: match.index,
            end: match.index + match[0].length
        });
    }

    return refs;
}

/**
 * Returns the location reference at a character offset, for cursor and CodeLens driven actions.
 */
export function findLocationRefAt(lineText: string, character: number): LocationRef | null {
    const refs = findLocationRefs(lineText);
    return (
        refs.find(r => character >= r.start && character <= r.end) ??
        refs.find(r => character <= r.end) ??
        refs[0] ??
        null
    );
}
