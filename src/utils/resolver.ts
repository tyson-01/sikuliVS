import * as path from 'path';
import * as vscode from 'vscode';
import { findImageRefAt, findImageRefs, ImageRef, resolveImageFiles } from './imageResolver';

export interface ResolvedImage {
    ref: ImageRef;
    absolutePaths: string[];
}

/**
 * Resolves every image reference on a line, in source order.
 */
export function resolveImagesOnLine(lineText: string, scriptDir: string): ResolvedImage[] {
    return findImageRefs(lineText).map(ref => ({
        ref,
        absolutePaths: resolveImageFiles(ref, scriptDir)
    }));
}

/**
 * Resolves the image reference at a character offset.
 */
export function resolveImageAt(lineText: string, scriptDir: string, character: number): ResolvedImage | null {
    const ref = findImageRefAt(lineText, character);
    return ref ? { ref, absolutePaths: resolveImageFiles(ref, scriptDir) } : null;
}

/**
 * Narrows a reference to one file, showing a QuickPick when a dynamic string
 * resolved to several.
 */
export async function pickImagePath(resolved: ResolvedImage): Promise<string | null> {
    if (resolved.absolutePaths.length === 0) {
        vscode.window.showErrorMessage(
            `SikuliVS: Asset file matching "${resolved.ref.namePattern}" could not be found.`
        );
        return null;
    }

    if (resolved.absolutePaths.length === 1) {
        return resolved.absolutePaths[0];
    }

    const quickPickItems = resolved.absolutePaths.map(absolutePath => ({
        label: path.basename(absolutePath),
        description: absolutePath
    }));

    const selection = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: `Multiple files match "${resolved.ref.namePattern}". Select target image for action:`
    });

    return selection?.description ?? null;
}
