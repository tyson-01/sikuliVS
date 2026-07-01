
import * as path from 'path';
import { resolveImageFromLine } from './resolver';

export interface SikuliLineTokens {
    fullLineText: string;
    imageString: string | null;       // e.g., '"img.png"' or '"img_%s.png" % var'
    currentSimilarity: number | null; // Extracted from .similarity(X)
    currentOffset: [number, number] | null; // Extracted from .targetOffset(X, Y)
    hasPattern: boolean;              // True if wrapped in Pattern(...)
    prefixText: string;               // Code before the Pattern/String image match
    suffixText: string;               // Code after the Pattern/String modifiers (including comments)
}

/**
 * Parses a single line of Jython code to extract existing Sikuli image objects and modifiers.
 */
export function parseSikuliLine(lineText: string, scriptDir: string): SikuliLineTokens | null {
    // Look for the foundational image file token using our working resolver logic
    const resolved = resolveImageFromLine(lineText, scriptDir);
    if (!resolved) return null;

    // Isolate the raw image statement (along with any trailing Jython format expressions)
    const escapedStaticName = resolved.staticName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Catch classic modulo strings: "img_%s.png" % state OR standard single/double quotes string matching staticName
    const imageBlockRegex = new RegExp(`(["']${escapedStaticName}["'](?:\\s*%\\s*[^\\s].*?|\\.format\\([^)]*\\))?)`);
    const blockMatch = lineText.match(imageBlockRegex);
    if (!blockMatch) return null;

    const imageString = blockMatch[1];

    // Determine Pattern wrapping
    const patternRegex = new RegExp(`Pattern\\s*\\(\\s*${imageString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)`);
    const hasPattern = patternRegex.test(lineText);

    // Extract Similarity Modifier -> .similarity(0.95)
    let currentSimilarity: number | null = null;
    const similarityMatch = lineText.match(/\.similarity\s*\(\s*([0-9.]+)\s*\)/);
    if (similarityMatch) {
        currentSimilarity = parseFloat(similarityMatch[1]);
    }

    // Extract Target Offset Modifier -> .targetOffset(-10, 5)
    let currentOffset: [number, number] | null = null;
    const offsetMatch = lineText.match(/\.targetOffset\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/);
    if (offsetMatch) {
        currentOffset = [parseInt(offsetMatch[1], 10), parseInt(offsetMatch[2], 10)];
    }

    // Isolate structural prefixes and suffixes so we don't destroy surrounding statements
    let corePatternExpression = imageString;
    if (hasPattern) {
        corePatternExpression = `Pattern\\s*\\(\\s*${imageString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)`;
    }

    const fullExpressionRegex = new RegExp(
        `(${corePatternExpression}(?:\\.(?:similarity|targetOffset)\\s*\\([^)]*\\)\\s*)*)`
    );
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

    const finalSimilarity = updates.similarity !== undefined ? updates.similarity : tokens.currentSimilarity;
    const finalOffset = updates.offset !== undefined ? updates.offset : tokens.currentOffset;

    let coreExpression = tokens.imageString;

    // Check if modifiers exist. If none exist, we strip out Pattern() and keep it a pure string literal
    const needsModifiers = (finalSimilarity !== null) || (finalOffset !== null && (finalOffset[0] !== 0 || finalOffset[1] !== 0));

    if (needsModifiers) {
        coreExpression = `Pattern(${tokens.imageString})`;
        
        if (finalOffset !== null && (finalOffset[0] !== 0 || finalOffset[1] !== 0)) {
            coreExpression += `.targetOffset(${finalOffset[0]}, ${finalOffset[1]})`;
        }
        
        if (finalSimilarity !== null) {
            coreExpression += `.similarity(${finalSimilarity})`;
        }
    }

    return `${tokens.prefixText}${coreExpression}${tokens.suffixText}`;
}