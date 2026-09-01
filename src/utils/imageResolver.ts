import * as fs from 'fs';
import * as path from 'path';

export type ImageRefKind = 'static' | 'percent' | 'format' | 'fstring';

export interface ImageRef {
    raw: string;            // Whole expression, e.g. '"btn_%s.png" % state'
    literal: string;        // Just the literal, e.g. 'f"btn_{s}.png"'
    namePattern: string;    // Filename inside the quotes, e.g. 'btn_{s}.png'
    kind: ImageRefKind;
    isDynamic: boolean;
    start: number;          // Character range of `raw` on the line
    end: number;
    literalStart: number;
    literalEnd: number;
}

const STRING_PREFIX = /[fFrRuUbB]/;
const CLOSERS = new Set([')', ']', '}']);

/**
 * Finds every image string on a line, in source order.
 */
export function findImageRefs(lineText: string): ImageRef[] {
    const refs: ImageRef[] = [];
    let i = 0;

    while (i < lineText.length) {
        if (lineText[i] === '#') {
            break; // Comment
        }

        const literal = readStringLiteral(lineText, i);
        if (!literal) {
            i++;
            continue;
        }

        if (/\.png$/i.test(literal.content)) {
            refs.push(buildRef(lineText, literal));
        }
        i = literal.end;
    }

    return refs;
}

/**
 * Returns the image reference at a character offset, for cursor and hover driven actions.
 */
export function findImageRefAt(lineText: string, character: number): ImageRef | null {
    const refs = findImageRefs(lineText);
    return (
        refs.find(r => character >= r.start && character <= r.end) ??
        refs.find(r => character <= r.end) ??
        refs[0] ??
        null
    );
}

/**
 * Lists every file on disk that a reference can stand for, sorted by name.
 */
export function resolveImageFiles(ref: ImageRef, scriptDir: string): string[] {
    if (!ref.isDynamic) {
        const fullPath = path.join(scriptDir, ref.namePattern);
        return fs.existsSync(fullPath) ? [fullPath] : [];
    }

    const searchRegex = imagePatternToRegExp(ref.namePattern);
    try {
        return fs
            .readdirSync(scriptDir)
            .filter(file => searchRegex.test(file))
            .sort()
            .map(file => path.join(scriptDir, file));
    } catch {
        return []; // Directory unreadable
    }
}

/**
 * Converts a filename pattern into a search matcher.
 * `%s %r %(name)s` and `{} {0} {name}` widen; `%d %03d` and `{n:03d}` narrow to digits;
 * `%%`, `{{` and `}}` are literals.
 */
export function imagePatternToRegExp(namePattern: string): RegExp {
    let out = '';
    let i = 0;

    while (i < namePattern.length) {
        const ch = namePattern[i];

        if (ch === '{' && namePattern[i + 1] === '{') {
            out += '\\{';
            i += 2;
        } else if (ch === '}' && namePattern[i + 1] === '}') {
            out += '\\}';
            i += 2;
        } else if (ch === '{') {
            const close = findClosingBrace(namePattern, i);
            if (close === -1) {
                out += '\\{';
                i++;
            } else {
                out += bracePlaceholderToRegExp(namePattern.slice(i + 1, close));
                i = close + 1;
            }
        } else if (ch === '%') {
            const token = readPercentToken(namePattern, i);
            if (!token) {
                out += '%';
                i++;
            } else {
                out += token.regex;
                i = token.end;
            }
        } else {
            out += escapeRegex(ch);
            i++;
        }
    }

    return new RegExp(`^${out}$`);
}

/**
 * Index of the `)` matching the `(` at `open`, skipping over string literals.
 */
export function findClosingParen(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' || ch === "'") {
            const literal = readStringLiteral(text, i);
            if (literal) {
                i = literal.end - 1;
                continue;
            }
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            if (--depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

export function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface StringLiteral {
    prefix: string;
    content: string;
    start: number;
    end: number;
}

/**
 * Reads a Python string literal starting at `start`, prefixes included.
 */
function readStringLiteral(line: string, start: number): StringLiteral | null {
    let i = start;
    let prefix = '';

    while (i < line.length && STRING_PREFIX.test(line[i]) && prefix.length < 3) {
        prefix += line[i];
        i++;
    }

    const quote = line[i];
    if (quote !== '"' && quote !== "'") {
        return null;
    }

    // Reject the tail of an identifier, e.g. the quote in `bar"a.png"`
    if (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1])) {
        return null;
    }

    const raw = prefix.toLowerCase().includes('r');
    let content = '';
    i++;

    while (i < line.length) {
        const ch = line[i];
        if (ch === '\\' && !raw && i + 1 < line.length) {
            content += ch + line[i + 1];
            i += 2;
            continue;
        }
        if (ch === quote) {
            return { prefix, content, start, end: i + 1 };
        }
        content += ch;
        i++;
    }

    return null;
}

function buildRef(line: string, literal: StringLiteral): ImageRef {
    const trailing = readTrailingFormat(line, literal.end);
    const end = trailing?.end ?? literal.end;

    const isFString = literal.prefix.toLowerCase().includes('f');
    const hasBraces = /\{[^{}]*\}/.test(literal.content.replace(/\{\{|\}\}/g, ''));
    const hasPercent = readsAnyPercentToken(literal.content);

    let kind: ImageRefKind = 'static';
    if (isFString) {
        kind = 'fstring';
    } else if (trailing?.style === 'format' || (hasBraces && !hasPercent)) {
        kind = 'format';
    } else if (trailing?.style === 'percent' || hasPercent) {
        kind = 'percent';
    }

    return {
        raw: line.slice(literal.start, end),
        literal: line.slice(literal.start, literal.end),
        namePattern: literal.content,
        kind,
        isDynamic: hasBraces || hasPercent,
        start: literal.start,
        end,
        literalStart: literal.start,
        literalEnd: literal.end
    };
}

/**
 * Consumes a trailing `% operand` or `.format(...)` belonging to the literal.
 */
function readTrailingFormat(line: string, from: number): { style: 'percent' | 'format'; end: number } | null {
    let i = from;
    while (i < line.length && /\s/.test(line[i])) {
        i++;
    }

    if (line[i] === '%') {
        i++;
        while (i < line.length && /\s/.test(line[i])) {
            i++;
        }

        let depth = 0;
        while (i < line.length) {
            const ch = line[i];
            if (ch === '(' || ch === '[' || ch === '{') {
                depth++;
            } else if (CLOSERS.has(ch)) {
                if (depth === 0) {
                    break;
                }
                depth--;
            } else if (ch === ',' && depth === 0) {
                break;
            }
            i++;
        }
        return { style: 'percent', end: i };
    }

    if (line.startsWith('.format', i)) {
        let j = i + '.format'.length;
        while (j < line.length && /\s/.test(line[j])) {
            j++;
        }
        if (line[j] === '(') {
            const close = findClosingParen(line, j);
            if (close !== -1) {
                return { style: 'format', end: close + 1 };
            }
        }
    }

    return null;
}

function bracePlaceholderToRegExp(inner: string): string {
    // Format spec follows the last top-level colon: `{n!r:^8}` -> `^8`
    let depth = 0;
    let spec = '';
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === '[' || ch === '(') {
            depth++;
        } else if (ch === ']' || ch === ')') {
            depth--;
        } else if (ch === ':' && depth === 0) {
            spec = inner.slice(i + 1);
        }
    }
    return /[dioxXn]$/.test(spec) ? '\\d+' : '.*';
}

const PERCENT_TOKEN = /^%(\([^)]*\))?[-+ #0]*(\*|\d+)?(\.(\*|\d+))?[hlL]?([diouxXeEfFgGcrsa%])/;

function readPercentToken(pattern: string, start: number): { regex: string; end: number } | null {
    const match = PERCENT_TOKEN.exec(pattern.slice(start));
    if (!match) {
        return null;
    }

    const conversion = match[5];
    if (conversion === '%') {
        return { regex: '%', end: start + match[0].length };
    }

    return { regex: /[diouxX]/.test(conversion) ? '\\d+' : '.*', end: start + match[0].length };
}

function readsAnyPercentToken(pattern: string): boolean {
    for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] !== '%') {
            continue;
        }
        const token = readPercentToken(pattern, i);
        if (token && pattern.slice(i, token.end) !== '%%') {
            return true;
        }
    }
    return false;
}

function findClosingBrace(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '{') {
            depth++;
        } else if (text[i] === '}' && --depth === 0) {
            return i;
        }
    }
    return -1;
}
