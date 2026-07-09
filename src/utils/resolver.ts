import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ResolvedImage {
    staticName: string;         // The literal string from code (e.g. "btn_%s.png")
    isDynamic: boolean;         // True if it contained formatting tokens
    absolutePaths: string[];    // List of matching file(s) found on disk
}

/**
 * Parses a code string to find an image filename, then scans the script's directory 
 * to find any matching files (handling dynamic wildcards(no f-strings)).
 */
export function resolveImageFromLine(lineText: string, scriptDir: string): ResolvedImage | null {
    // 1. Pull the first single or double-quoted string ending in .png
    const stringMatch = lineText.match(/(?:"([^"]+\.png)"|'([^']+\.png)')/);
    if (!stringMatch) return null;

    const rawString = stringMatch[1] ?? stringMatch[2];
    
    // 2. Identify Jython 2.7 formatting features (%s, %d, or {})
    const isDynamic = /%[sd]/.test(rawString) || /\{.*\}/.test(rawString);
    let absolutePaths: string[] = [];

    if (!isDynamic) {
        // Simple case: Direct path verification for static assets
        const fullPath = path.join(scriptDir, rawString);
        if (fs.existsSync(fullPath)) {
            absolutePaths.push(fullPath);
        }
    } else {
        // Complex case: Convert string format tokens into a search regex pattern
        const regexStr = escapeRegex(rawString)
            .replace(/%[sd]/g, '.*')
            .replace(/\\{.*?\\}/g, '.*');
            
        const searchRegex = new RegExp(`^${regexStr}$`);

        // Scan the folder for dynamic wildcard matches
        try {
            const files = fs.readdirSync(scriptDir);
            absolutePaths = files
                .filter(file => searchRegex.test(file))
                .map(file => path.join(scriptDir, file));
        } catch {
            // Silence standard folder read / empty directory structural crashes
        }
    }

    return {
        staticName: rawString,
        isDynamic,
        absolutePaths
    };
}

/**
 * Handles showing a VS Code QuickPick selection dropdown if a dynamic string yields 
 * multiple physical file options. Returns the single selected absolute path string.
 */
export async function getTargetImagePath(resolved: ResolvedImage): Promise<string | null> {
    if (resolved.absolutePaths.length === 0) {
        vscode.window.showErrorMessage(`SikuliVS: Asset file matching "${resolved.staticName}" could not be found.`);
        return null;
    }

    if (resolved.absolutePaths.length === 1) {
        return resolved.absolutePaths[0]; // Skip menu layer if there is only 1 asset path match
    }

    // Multiple assets matched. Map items straight into standard "QuickPick" choices
    const quickPickItems = resolved.absolutePaths.map(absolutePath => ({
        label: path.basename(absolutePath),
        description: absolutePath
    }));

    const selection = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: `Multiple files match "${resolved.staticName}". Select target image for action:`
    });

    return selection?.description ?? null;
}

/**
 * Helper to safely escape characters for dynamic RegExp creation.
 */
function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}