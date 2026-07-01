import * as fs from 'fs';
import * as path from 'path';

export interface ResolvedImage {
    staticName: string;      // The literal string from code (e.g. "btn_%s.png")
    isDynamic: boolean;       // True if it contained formatting tokens
    absolutePaths: string[];  // List of matching file(s) found on disk
}

export function resolveImageFromLine(lineText: string, scriptDir: string): ResolvedImage | null {
    // 1. Regex to pull the first single or double-quoted string ending in .png
    const stringMatch = lineText.match(/(?:"([^"]+\.png)"|'([^']+\.png)')/);
    if (!stringMatch) return null;

    const rawString = stringMatch[1] || stringMatch[2];
    
    // 2. Check if it contains Jython 2.7 formatting features: %s, %d, or {}
    const hasModulo = /%[sd]/.test(rawString);
    const hasFormat = /\{.*\}/.test(rawString);
    const isDynamic = hasModulo || hasFormat;

    let absolutePaths: string[] = [];

    if (!isDynamic) {
        // Static file: Simple direct path verification
        const fullPath = path.join(scriptDir, rawString);
        if (fs.existsSync(fullPath)) {
            absolutePaths.push(fullPath);
        }
    } else {
        // Dynamic file: Convert string format tokens into a robust regex
        // Escape standard regex characters first, then swap out format blocks for wildcards
        let regexStr = rawString
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape regex symbols
            .replace(/%[sd]/g, '.*')               // swap %s or %d for wildcard
            .replace(/\\{.*?\\}/g, '.*');           // swap {} or {name} for wildcard
            
        const searchRegex = new RegExp(`^${regexStr}$`);

        // Scan the active folder for physical asset hits
        try {
            const files = fs.readdirSync(scriptDir);
            absolutePaths = files
                .filter(file => searchRegex.test(file))
                .map(file => path.join(scriptDir, file));
        } catch (e) {
            // Folder read failed or missing
        }
    }

    return {
        staticName: rawString,
        isDynamic,
        absolutePaths
    };
}