import * as path from 'path';

const BUNDLE_SUFFIX = '.sikuli';

export interface ScriptTarget {
    target: string;  // What gets handed to SikuliX's -r option
    cwd: string;     // Working directory for the java process
    pyFile: string;  // The file whose line numbers SikuliX's errors refer to
    name: string;    // Bundle name, as it appears in `script [ name ]` error lines
}

/**
 * True when a directory is a Sikuli bundle, i.e. `login.sikuli`.
 */
export function isBundleDir(dirPath: string): boolean {
    return path.basename(dirPath).endsWith(BUNDLE_SUFFIX);
}

/**
 * The bundle's bare name, with the `.sikuli` suffix removed only when it is a suffix.
 */
export function bundleName(dirPath: string): string {
    const base = path.basename(dirPath);
    return base.endsWith(BUNDLE_SUFFIX) ? base.slice(0, -BUNDLE_SUFFIX.length) : base;
}

/**
 * Decides what SikuliX should be pointed at for a given script file.
 * A file inside a bundle runs as the bundle, so that ImagePath's BundlePath is set to
 * the folder and its images resolve; a loose script runs on its own.
 */
export function resolveScriptTarget(pyFile: string): ScriptTarget {
    const fileDir = path.dirname(pyFile);

    if (isBundleDir(fileDir)) {
        return {
            target: fileDir,
            cwd: path.dirname(fileDir),
            pyFile,
            name: bundleName(fileDir)
        };
    }

    return {
        target: pyFile,
        cwd: fileDir,
        pyFile,
        name: path.basename(pyFile, path.extname(pyFile))
    };
}
