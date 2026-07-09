import * as path from 'path';
import { resolveImageFromLine } from './resolver';

export interface SikuliLineTokens {
    fullLineText: string;                   // Figure it out dummy
    imageString: string | null;             // e.g., '"img.png"' or '"img_%s.png" % var'
    currentSimilarity: number | null;       // Extracted from .similarity(X)
    currentOffset: [number, number] | null; // Extracted from .targetOffset(X, Y)
    hasPattern: boolean;                    // True if wrapped in Pattern(...)
    prefixText: string;                     // Code before the Pattern/String image match
    suffixText: string;                     // Code after the Pattern/String modifiers (including comments)
}

/**
 * Parses a single line of Jython code to extract existing Sikuli image objects and modifiers...
 */
export function parseSikuliLine(lineText: string, scriptDir: string): SikuliLineTokens | null {
    const resolved = resolveImageFromLine(lineText, scriptDir);
    if (!resolved) return null;

    // Isolate the raw image statement (along with any trailing Jython format expressions)
    const escapedStaticName = escapeRegex(resolved.staticName);
    const imageBlockRegex = new RegExp(`(["']${escapedStaticName}["'](?:\\s*%\\s*[^\\s].*?|\\.format\\([^)]*\\))?)`);
    const blockMatch = lineText.match(imageBlockRegex);
    if (!blockMatch) return null;

    const imageString = blockMatch[1];

    // Determine Pattern wrapping
    const patternRegex = new RegExp(`Pattern\\s*\\(\\s*${escapeRegex(imageString)}\\s*\\)`);
    const hasPattern = patternRegex.test(lineText);

    // Extract Similarity Modifier -> .similarity(0.95)
    const similarityMatch = lineText.match(/\.similarity\s*\(\s*([0-9.]+)\s*\)/);
    const currentSimilarity = similarityMatch ? parseFloat(similarityMatch[1]) : null;

    // Extract Target Offset Modifier -> .targetOffset(-10, 5)
    const offsetMatch = lineText.match(/\.targetOffset\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/);
    const currentOffset: [number, number] | null = offsetMatch 
        ? [parseInt(offsetMatch[1], 10), parseInt(offsetMatch[2], 10)] 
        : null;

    // Isolate structural prefixes and suffixes so we don't destroy surrounding statements
    const corePatternExpression = hasPattern 
        ? `Pattern\\s*\\(\\s*${escapeRegex(imageString)}\\s*\\)` 
        : imageString;

    const fullExpressionRegex = new RegExp(`(${corePatternExpression}(?:\\.(?:similarity|targetOffset)\\s*\\([^)]*\\)\\s*)*)`);
    const splitMatch = lineText.match(fullExpressionRegex);
    
    let prefixText = lineText;
    let suffixText = "";
    if (splitMatch && splitMatch.index !== undefined) {
        prefixText = lineText.substring(0, splitMatch.index);
        suffixText = lineText.substring(splitMatch.index + splitMatch[0].length);
    }

    return {
        fullLineText: lineText,
        imageString,
        currentSimilarity,
        currentOffset,
        hasPattern,
        prefixText,
        suffixText
    };
}

/**
 * Safely updates or rebuilds a parsed Sikuli line, ensuring Pattern() wrappers 
 * are applied idiomatic to the presence of secondary target modifiers.
 */
export function rebuildSikuliLine(
    tokens: SikuliLineTokens,
    updates: { similarity?: number | null; offset?: [number, number] | null }
): string {
    if (!tokens.imageString) return tokens.fullLineText;

    // Use nullish coalescing to fall back on current token value if undefined
    const finalSimilarity = updates.similarity ?? tokens.currentSimilarity;
    const finalOffset = updates.offset ?? tokens.currentOffset;

    let coreExpression = tokens.imageString;

    // If no modifiers exist, we strip out Pattern() and keep it a pure string literal
    const hasOffset = finalOffset !== null && (finalOffset[0] !== 0 || finalOffset[1] !== 0);
    const needsModifiers = (finalSimilarity !== null) || hasOffset;

    if (needsModifiers) {
        coreExpression = `Pattern(${tokens.imageString})`;
        
        if (hasOffset && finalOffset) {
            coreExpression += `.targetOffset(${finalOffset[0]}, ${finalOffset[1]})`;
        }
        
        if (finalSimilarity !== null) {
            coreExpression += `.similarity(${finalSimilarity})`;
        }
    }

    return `${tokens.prefixText}${coreExpression}${tokens.suffixText}`;
}

/**
 * Helper to safely escape characters for dynamic RegExp creation.
 */
function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}