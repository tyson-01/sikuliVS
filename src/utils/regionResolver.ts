export interface RegionRef {
    x: number;
    y: number;
    w: number;
    h: number;
    start: number;  // Character range of the whole `Region(...)` call on the line
    end: number;
}

const REGION_CALL = /\bRegion\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g;

/**
 * Finds every literal `Region(x, y, w, h)` call on a line, in source order.
 */
export function findRegionRefs(lineText: string): RegionRef[] {
    const commentIndex = lineText.indexOf('#');
    const searchText = commentIndex === -1 ? lineText : lineText.slice(0, commentIndex);

    const refs: RegionRef[] = [];
    REGION_CALL.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = REGION_CALL.exec(searchText)) !== null) {
        refs.push({
            x: parseInt(match[1], 10),
            y: parseInt(match[2], 10),
            w: parseInt(match[3], 10),
            h: parseInt(match[4], 10),
            start: match.index,
            end: match.index + match[0].length
        });
    }

    return refs;
}

/**
 * Returns the region reference at a character offset, for cursor and CodeLens driven actions.
 */
export function findRegionRefAt(lineText: string, character: number): RegionRef | null {
    const refs = findRegionRefs(lineText);
    return (
        refs.find(r => character >= r.start && character <= r.end) ??
        refs.find(r => character <= r.end) ??
        refs[0] ??
        null
    );
}
