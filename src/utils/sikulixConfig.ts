import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { log } from './output';
import { headfulMarker, javaBinary, jvmRoots } from './platform';

export interface SikulixEnvironment {
    javaPath: string;
    jarPath: string;
    jvmArgs: string[];
    debugLevel: number;
}

interface JavaRuntime {
    javaPath: string;
    home: string;
    version: string;
    headful: boolean;
}

const JAVA_HOME_SETTING = /^\s*java\.home\s*=\s*(.+?)\s*$/m;
const JAVA_VERSION_SETTING = /^\s*java\.version\s*=\s*(.+?)\s*$/m;
const RELEASE_VERSION = /^JAVA_VERSION="?([^"\n]+)"?$/m;

// The library whose absence means a runtime cannot open a screen. See platform.ts.
const MARKER = headfulMarker();

// macOS keeps its JDKs behind a tool rather than at a predictable path, and it honours
// the runtime the user selected, so it is asked before anything is scanned.
const MAC_JAVA_HOME = '/usr/libexec/java_home';

// SikuliX 2.0.5 predates the module-system tightening; on 24+ it warns that its native
// access will stop working, so an older runtime is preferred when there is a choice.
const PREFERRED_MAX_MAJOR = 21;

let resolvedJava: JavaRuntime | null = null;
let resolvedJavaFor: string | null = null;

/**
 * Resolves everything needed to launch SikuliX, prompting for the jar the first time.
 * Returns null when something is missing, having already reported it to the user.
 */
export async function resolveEnvironment(): Promise<SikulixEnvironment | null> {
    const config = vscode.workspace.getConfiguration('sikuliVS');

    const jarPath = await resolveJarPath(config);
    if (!jarPath) {
        return null;
    }

    const java = await resolveJava(config);
    if (!java) {
        return null;
    }

    return {
        javaPath: java.javaPath,
        jarPath,
        jvmArgs: config.get<string[]>('jvmArgs', []),
        debugLevel: config.get<number>('debugLevel', 0)
    };
}

let waylandWarningAccepted = false;

/**
 * Warns once per session before running on Wayland.
 *
 * SikuliX acts on the screen through `java.awt.Robot`, which emulates input through
 * XTEST. That reaches the XWayland X server only, so events never arrive at a native
 * Wayland client, clicks do not raise or focus windows, and the pointer does not move.
 * The JDK has no other route: input emulation on Wayland is unimplemented upstream and
 * waiting on libei, with no release it is scheduled for. Screen capture does work, via
 * the desktop portal, so a script will find its image and then act on nothing.
 *
 * The visual tools are unaffected, since none of them emulate input.
 */
export async function confirmDisplayServer(): Promise<boolean> {
    if (waylandWarningAccepted || !isWaylandSession()) {
        return true;
    }

    const choice = await vscode.window.showWarningMessage(
        'SikuliVS: This is a Wayland session, where SikuliX cannot emulate mouse or keyboard ' +
        'input at all. Searches will succeed and then every click and keystroke will land ' +
        'nowhere. Each screen capture also asks the desktop portal for permission, so a short ' +
        'script can raise many prompts. Running scripts needs an X server.',
        { modal: true },
        'Run Anyway'
    );

    waylandWarningAccepted = choice === 'Run Anyway';
    return waylandWarningAccepted;
}

function isWaylandSession(): boolean {
    return Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE === 'wayland';
}

// SikuliX publishes two jars. The IDE one bundles its own editor and re-executes java on
// startup, so JVM options passed on the command line are dropped before a script runs, and
// nothing the extension sets on the command line survives. The API jar runs in the process
// it is given.
const IDE_JAR = /sikulixide/i;

let ideJarWarned = false;

/**
 * Says so when the configured jar is the IDE build rather than the API one. Warned once per
 * session and never blocking: it mostly works, so refusing to run would be worse than
 * saying what is wrong.
 */
function warnAboutIdeJar(jarPath: string): void {
    if (ideJarWarned || !IDE_JAR.test(path.basename(jarPath))) {
        return;
    }
    ideJarWarned = true;

    log(`[run] warning: ${path.basename(jarPath)} is the IDE jar, not the API jar`);
    void vscode.window.showWarningMessage(
        `SikuliVS: ${path.basename(jarPath)} is the SikuliX IDE jar. It restarts the Java ` +
        'runtime on startup, which discards the options this extension sets, including the ' +
        'display scale fix that keeps coordinates correct. Use sikulixapi-<version>.jar instead.'
    );
}

/**
 * The configured jar, else one sitting in a workspace root, else ask.
 */
async function resolveJarPath(config: vscode.WorkspaceConfiguration): Promise<string | null> {
    const configured = config.get<string>('jarPath', '').trim();
    if (configured) {
        if (!fs.existsSync(configured)) {
            await vscode.window.showErrorMessage(
                `SikuliVS: sikuliVS.jarPath points at a file that does not exist: ${configured}`
            );
            return null;
        }
        warnAboutIdeJar(configured);
        return configured;
    }

    const discovered = findJarInWorkspace();
    if (discovered) {
        log(`[run] using discovered jar: ${discovered}`);
        warnAboutIdeJar(discovered);
        return discovered;
    }

    return promptForJar(config);
}

/**
 * Looks for a `sikulix*.jar` at the top level of each workspace folder.
 */
function findJarInWorkspace(): string | null {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const root = folder.uri.fsPath;
        let entries: string[];
        try {
            entries = fs.readdirSync(root);
        } catch {
            continue;
        }

        const jar = entries.find(name => /^sikulix.*\.jar$/i.test(name));
        if (jar) {
            return path.join(root, jar);
        }
    }

    return null;
}

async function promptForJar(config: vscode.WorkspaceConfiguration): Promise<string | null> {
    const choice = await vscode.window.showErrorMessage(
        'SikuliVS: No SikuliX jar configured. Running scripts needs sikulixapi-<version>.jar.',
        'Select Jar...'
    );
    if (choice !== 'Select Jar...') {
        return null;
    }

    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Use this jar',
        filters: { 'Java archive': ['jar'] }
    });
    if (!picked || picked.length === 0) {
        return null;
    }

    const jarPath = picked[0].fsPath;
    await config.update('jarPath', jarPath, vscode.ConfigurationTarget.Global);
    return jarPath;
}

/**
 * The Java runtime to launch SikuliX with, resolved the same way as the jar: take the
 * setting if there is one, otherwise find a usable runtime, otherwise ask.
 *
 * "Usable" means headful. The distribution default is often not: on Fedora the packaged
 * `java` is the headless build, so the runtime that works has to be looked for rather
 * than assumed.
 */
async function resolveJava(config: vscode.WorkspaceConfiguration): Promise<JavaRuntime | null> {
    const configured = config.get<string>('javaPath', '').trim();

    if (resolvedJava && resolvedJavaFor === configured) {
        return resolvedJava;
    }

    const runtime = configured
        ? await inspectJava(configured)
        : await findUsableJava();

    if (!runtime) {
        return promptForJava(config, configured);
    }

    if (!runtime.headful) {
        return reportHeadless(config, runtime);
    }

    log(`[run] java ${runtime.version} (${runtime.home})`);
    resolvedJava = runtime;
    resolvedJavaFor = configured;
    return runtime;
}

/**
 * JAVA_HOME and PATH first, since an explicitly chosen runtime beats a guess; installed
 * JVMs are only scanned when neither of those can open a screen.
 */
async function findUsableJava(): Promise<JavaRuntime | null> {
    const javaHome = process.env.JAVA_HOME ?? await macSelectedJavaHome();
    const preferred = [
        javaHome ? path.join(javaHome, 'bin', javaBinary()) : null,
        javaBinary()
    ].filter((candidate): candidate is string => candidate !== null);

    for (const candidate of preferred) {
        const runtime = await inspectJava(candidate);
        if (runtime?.headful) {
            return runtime;
        }
    }

    return discoverInstalledJava();
}

/**
 * The runtime macOS itself considers current. Nothing elsewhere, and nothing when the
 * tool is absent or reports no JDK at all.
 */
function macSelectedJavaHome(): Promise<string | null> {
    if (process.platform !== 'darwin' || !fs.existsSync(MAC_JAVA_HOME)) {
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        execFile(MAC_JAVA_HOME, (error, stdout) => {
            const home = stdout.trim();
            resolve(error || home === '' ? null : home);
        });
    });
}

/**
 * Reads installed JVMs straight off disk — the release file gives the version and the
 * presence of the AWT library gives headfulness, so nothing has to be executed.
 */
function discoverInstalledJava(): JavaRuntime | null {
    const found: JavaRuntime[] = [];
    const seen = new Set<string>();
    const { roots, homeSuffix } = jvmRoots();

    for (const root of roots) {
        let entries: string[];
        try {
            entries = fs.readdirSync(root);
        } catch {
            continue;   // Root does not exist on this machine
        }

        for (const entry of entries) {
            const home = realPath(path.join(root, entry, homeSuffix));
            const javaPath = path.join(home, 'bin', javaBinary());
            if (seen.has(home) || !fs.existsSync(javaPath)) {
                continue;
            }
            seen.add(home);

            found.push({
                javaPath,
                home,
                version: readReleaseVersion(home),
                headful: isHeadful(home)
            });
        }
    }

    const usable = found.filter(runtime => runtime.headful).sort(bySikulixPreference);
    return usable[0] ?? null;
}

/**
 * Runtimes SikuliX is happy with come first; beyond that, newer before older.
 */
function bySikulixPreference(a: JavaRuntime, b: JavaRuntime): number {
    const aSupported = majorVersion(a.version) <= PREFERRED_MAX_MAJOR;
    const bSupported = majorVersion(b.version) <= PREFERRED_MAX_MAJOR;

    if (aSupported !== bSupported) {
        return aSupported ? -1 : 1;
    }
    return majorVersion(b.version) - majorVersion(a.version);
}

function majorVersion(version: string): number {
    const parts = version.split('.');
    // Pre-9 runtimes report as 1.8.x, where the major version is the second part.
    const major = parts[0] === '1' ? parts[1] : parts[0];
    return parseInt(major, 10) || 0;
}

function readReleaseVersion(home: string): string {
    try {
        return RELEASE_VERSION.exec(fs.readFileSync(path.join(home, 'release'), 'utf8'))?.[1]
            ?? 'unknown';
    } catch {
        return 'unknown';
    }
}

function isHeadful(home: string): boolean {
    return fs.existsSync(path.join(home, MARKER.dir, MARKER.file));
}

function realPath(candidate: string): string {
    try {
        return fs.realpathSync(candidate);
    } catch {
        return candidate;
    }
}

/**
 * Asks a runtime about itself. Used for anything named rather than discovered, since a
 * bare `java` has to be located on PATH before its home is known.
 */
async function inspectJava(javaPath: string): Promise<JavaRuntime | null> {
    let settings: string;
    try {
        settings = await javaSettings(javaPath);
    } catch {
        return null;
    }

    const home = JAVA_HOME_SETTING.exec(settings)?.[1] ?? path.dirname(path.dirname(javaPath));
    return {
        javaPath,
        home,
        version: JAVA_VERSION_SETTING.exec(settings)?.[1] ?? 'unknown',
        headful: isHeadful(home)
    };
}

function javaSettings(javaPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(javaPath, ['-XshowSettings:properties', '-version'], (error, stdout, stderr) => {
            if (error) {
                return reject(error);
            }
            resolve(`${stderr}\n${stdout}`);   // -XshowSettings reports on stderr
        });
    });
}

async function reportHeadless(
    config: vscode.WorkspaceConfiguration,
    runtime: JavaRuntime
): Promise<JavaRuntime | null> {
    const choice = await vscode.window.showErrorMessage(
        `SikuliVS: The Java runtime at ${runtime.home} is headless (no ${MARKER.file}), so ` +
        'SikuliX cannot access the screen. A full JDK is needed rather than a headless build.',
        'Select Java...'
    );

    return choice === 'Select Java...' ? pickJava(config) : null;
}

async function promptForJava(
    config: vscode.WorkspaceConfiguration,
    configured: string
): Promise<JavaRuntime | null> {
    const message = configured
        ? `SikuliVS: Could not run java at "${configured}".`
        : 'SikuliVS: No Java runtime that can access the screen was found. SikuliX needs a headful JDK.';

    const choice = await vscode.window.showErrorMessage(message, 'Select Java...');
    return choice === 'Select Java...' ? pickJava(config) : null;
}

/**
 * Falls back to picking the `java` binary by hand, saving it so the prompt is one-time.
 */
async function pickJava(config: vscode.WorkspaceConfiguration): Promise<JavaRuntime | null> {
    const start = jvmRoots().roots.find(root => fs.existsSync(root));
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Use this java',
        defaultUri: start ? vscode.Uri.file(start) : undefined
    });
    if (!picked || picked.length === 0) {
        return null;
    }

    const runtime = await inspectJava(picked[0].fsPath);
    if (!runtime) {
        await vscode.window.showErrorMessage(
            `SikuliVS: ${picked[0].fsPath} is not a Java runtime.`
        );
        return null;
    }

    if (!runtime.headful) {
        // Saving it would only make the next run fail the same way, with the setting to
        // undo first.
        await vscode.window.showErrorMessage(
            `SikuliVS: ${runtime.home} is headless (no ${MARKER.file}) and cannot run SikuliX.`
        );
        return null;
    }

    await config.update('javaPath', runtime.javaPath, vscode.ConfigurationTarget.Global);
    log(`[run] java ${runtime.version} (${runtime.home})`);

    resolvedJava = runtime;
    resolvedJavaFor = runtime.javaPath;
    return runtime;
}
