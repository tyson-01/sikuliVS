import * as path from 'path';

/**
 * Everything that differs between operating systems, in one place, so a port touches
 * one file. Each function takes the platform and environment rather than reading them,
 * so the tables can be tested from any machine.
 */

export interface HeadfulMarker {
    dir: string;    // Directory under the Java home holding native libraries
    file: string;   // Library present only in a headful runtime
}

export interface JvmLocations {
    roots: string[];
    /** Appended to each entry inside a root to reach the Java home. Empty on most platforms. */
    homeSuffix: string;
}

// Vendor folders under Program Files. Installers use their own name, so there is no
// single root to scan the way there is on Linux.
const WINDOWS_JVM_VENDORS = [
    'Java',
    'Eclipse Adoptium',
    'Eclipse Foundation',
    'Microsoft',
    'Amazon Corretto',
    'Zulu',
    'BellSoft',
    'Semeru'
];

export function javaBinary(platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32' ? 'java.exe' : 'java';
}

/**
 * Without this library a runtime cannot open a screen, and SikuliX fails silently when
 * it is missing: the JVM exits 1 having printed nothing unless -d 3 is in play.
 */
export function headfulMarker(platform: NodeJS.Platform = process.platform): HeadfulMarker {
    switch (platform) {
        case 'win32':
            return { dir: 'bin', file: 'awt.dll' };
        case 'darwin':
            return { dir: 'lib', file: 'libawt_lwawt.dylib' };
        default:
            return { dir: 'lib', file: 'libawt_xawt.so' };
    }
}

/**
 * Where distributions install JVMs. Only consulted when nothing is configured and
 * neither JAVA_HOME nor PATH yields a runtime that can open a screen.
 */
export function jvmRoots(
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env
): JvmLocations {
    if (platform === 'win32') {
        const bases = [
            env.ProgramFiles,
            env['ProgramFiles(x86)'],
            env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs') : undefined
        ].filter((base): base is string => Boolean(base));

        const roots = bases.flatMap(base => WINDOWS_JVM_VENDORS.map(vendor => path.join(base, vendor)));
        return { roots: unique(roots), homeSuffix: '' };
    }

    if (platform === 'darwin') {
        // A JDK there is a bundle, so the home sits below the directory that is listed.
        return { roots: ['/Library/Java/JavaVirtualMachines'], homeSuffix: path.join('Contents', 'Home') };
    }

    return { roots: ['/usr/lib/jvm', '/usr/java', '/opt/java'], homeSuffix: '' };
}

/** The interpreter inside a virtualenv, relative to its root. */
export function venvBin(platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32'
        ? path.join('Scripts', 'python.exe')
        : path.join('bin', 'python3');
}

/** What a bare interpreter is called on PATH. */
export function pythonCommand(platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32' ? 'python' : 'python3';
}

function unique(values: string[]): string[] {
    return values.filter((value, index) => values.indexOf(value) === index);
}
