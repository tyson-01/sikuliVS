import { findClosingParen, ImageRef } from './imageResolver';

export interface PatternModifier {
    name: string;
    args: string;   // Raw argument text, kept as written
}

export interface PatternExpr {
    imageExpr: string;
    wrapped: boolean;
    modifiers: PatternModifier[];
    similar: number | null;
    targetOffset: [number, number] | null;
    start: number;  // Character range of the whole expression on the line
    end: number;
}

export interface PatternUpdates {
    similar?: number;
    targetOffset?: [number, number];
}

// SikuliX exposes Pattern.similar(double); `similarity` is a private field, not a method.
const SIMILAR = 'similar';
const TARGET_OFFSET = 'targetOffset';

// SikuliX's own Settings.MinSimilarity
export const DEFAULT_SIMILARITY = 0.7;

/**
 * Parses the Pattern expression that an image reference belongs to, keeping the whole
 * modifier chain so unrecognised modifiers survive a rewrite.
 */
export function parsePatternExpr(line: string, ref: ImageRef): PatternExpr {
    const wrapper = findPatternWrapper(line, ref);
    const chain = readModifierChain(line, wrapper ? wrapper.closeParen + 1 : ref.end);

    const expr: PatternExpr = {
        imageExpr: ref.raw,
        wrapped: wrapper !== null,
        modifiers: chain.modifiers,
        similar: null,
        targetOffset: null,
        start: wrapper ? wrapper.start : ref.start,
        end: chain.end
    };

    for (const modifier of chain.modifiers) {
        if (modifier.name === SIMILAR) {
            const value = parseFloat(modifier.args);
            if (!isNaN(value)) {
                expr.similar = value;
            }
        } else if (modifier.name === TARGET_OFFSET) {
            const parts = modifier.args.split(',').map(part => parseInt(part.trim(), 10));
            if (parts.length === 2 && parts.every(n => !isNaN(n))) {
                expr.targetOffset = [parts[0], parts[1]];
            }
        }
    }

    return expr;
}

/**
 * Renders the expression back to source with the requested updates applied in place.
 */
export function renderPatternExpr(expr: PatternExpr, updates: PatternUpdates = {}): string {
    const modifiers = expr.modifiers.map(modifier => ({ ...modifier }));

    if (updates.similar !== undefined) {
        upsert(modifiers, SIMILAR, updates.similar.toFixed(2));
    }

    if (updates.targetOffset !== undefined) {
        const [dx, dy] = updates.targetOffset;
        if (dx === 0 && dy === 0) {
            remove(modifiers, TARGET_OFFSET);
        } else {
            upsert(modifiers, TARGET_OFFSET, `${dx}, ${dy}`);
        }
    }

    if (modifiers.length === 0) {
        return expr.imageExpr; // No modifiers left, so the Pattern wrapper is redundant
    }

    return `Pattern(${expr.imageExpr})` + modifiers.map(m => `.${m.name}(${m.args})`).join('');
}

function upsert(modifiers: PatternModifier[], name: string, args: string): void {
    const existing = modifiers.find(modifier => modifier.name === name);
    if (existing) {
        existing.args = args;
    } else {
        modifiers.push({ name, args });
    }
}

function remove(modifiers: PatternModifier[], name: string): void {
    const index = modifiers.findIndex(modifier => modifier.name === name);
    if (index !== -1) {
        modifiers.splice(index, 1);
    }
}

/**
 * Locates an enclosing `Pattern(` immediately before the image reference.
 */
function findPatternWrapper(line: string, ref: ImageRef): { start: number; closeParen: number } | null {
    let i = ref.start - 1;
    while (i >= 0 && /\s/.test(line[i])) {
        i--;
    }
    if (line[i] !== '(') {
        return null;
    }

    const openParen = i;
    i--;
    while (i >= 0 && /\s/.test(line[i])) {
        i--;
    }

    const end = i + 1;
    while (i >= 0 && /[A-Za-z0-9_]/.test(line[i])) {
        i--;
    }

    if (line.slice(i + 1, end) !== 'Pattern') {
        return null;
    }

    const closeParen = findClosingParen(line, openParen);
    return closeParen === -1 ? null : { start: i + 1, closeParen };
}

/**
 * Reads a `.name(args).name(args)...` chain, returning where it ends.
 */
function readModifierChain(line: string, from: number): { modifiers: PatternModifier[]; end: number } {
    const modifiers: PatternModifier[] = [];
    let end = from;
    let i = from;

    for (;;) {
        while (i < line.length && /\s/.test(line[i])) {
            i++;
        }
        if (line[i] !== '.') {
            break;
        }

        const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i + 1));
        if (!nameMatch) {
            break;
        }

        let j = i + 1 + nameMatch[0].length;
        while (j < line.length && /\s/.test(line[j])) {
            j++;
        }
        if (line[j] !== '(') {
            break;
        }

        const closeParen = findClosingParen(line, j);
        if (closeParen === -1) {
            break;
        }

        modifiers.push({ name: nameMatch[0], args: line.slice(j + 1, closeParen).trim() });
        i = closeParen + 1;
        end = i;
    }

    return { modifiers, end };
}
