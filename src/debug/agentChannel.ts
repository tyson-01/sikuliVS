import * as net from 'net';

export interface AgentEvent {
    event: string;
    [key: string]: unknown;
}

interface AgentReply {
    id: number;
    body?: unknown;
    error?: string;
}

/**
 * The extension's end of the link to the Jython debug agent.
 *
 * Listens rather than connects: SikuliX is spawned afterwards and dials back in, so the
 * port is known before there is anything to tell it to.
 */
export class AgentChannel {
    private readonly server = net.createServer();
    private socket: net.Socket | null = null;
    private buffer = '';
    private seq = 0;
    private readonly pending = new Map<number, (reply: AgentReply) => void>();

    constructor(private readonly onEvent: (event: AgentEvent) => void) {}

    /** Starts listening on a free loopback port and resolves with it. */
    listen(): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.on('connection', (socket) => this.accept(socket));
            this.server.listen(0, '127.0.0.1', () => {
                const address = this.server.address();
                if (address === null || typeof address === 'string') {
                    return reject(new Error('Could not open a debug port.'));
                }
                resolve(address.port);
            });
        });
    }

    get connected(): boolean {
        return this.socket !== null;
    }

    /**
     * Sends a command and waits for the agent's reply. Rejects if the agent reported the
     * command failed, so a bad expression surfaces as an error rather than an empty value.
     */
    request(command: string, payload: Record<string, unknown> = {}): Promise<any> {
        if (!this.socket) {
            return Promise.reject(new Error('The debug agent is not connected.'));
        }

        const seq = ++this.seq;
        return new Promise((resolve, reject) => {
            this.pending.set(seq, (reply) => {
                if (reply.error) {
                    reject(new Error(reply.error));
                } else {
                    resolve(reply.body);
                }
            });
            this.socket?.write(`${JSON.stringify({ ...payload, command, seq })}\n`);
        });
    }

    /** Fire-and-forget, for commands whose reply nothing waits on. */
    notify(command: string, payload: Record<string, unknown> = {}): void {
        this.request(command, payload).catch(() => undefined);
    }

    dispose(): void {
        for (const resolve of this.pending.values()) {
            resolve({ id: 0, error: 'The debug session ended.' });
        }
        this.pending.clear();
        this.socket?.destroy();
        this.socket = null;
        // With a callback the "was never listening" case is handed back rather than
        // raised as an unhandled error event.
        this.server.close(() => undefined);
    }

    private accept(socket: net.Socket): void {
        // One script, one connection: a second would mean a stale JVM still dialling in.
        if (this.socket) {
            socket.destroy();
            return;
        }

        this.socket = socket;
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => this.receive(chunk));
        socket.on('close', () => {
            this.socket = null;
            this.onEvent({ event: 'disconnected' });
        });
        socket.on('error', () => undefined);
    }

    private receive(chunk: string): void {
        this.buffer += chunk;

        let newlineIndex: number;
        while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, newlineIndex);
            this.buffer = this.buffer.slice(newlineIndex + 1);
            if (line.trim() !== '') {
                this.deliver(JSON.parse(line));
            }
        }
    }

    private deliver(message: AgentReply & Partial<AgentEvent>): void {
        if (typeof message.id === 'number') {
            const resolve = this.pending.get(message.id);
            this.pending.delete(message.id);
            resolve?.(message);
            return;
        }

        if (typeof message.event === 'string') {
            this.onEvent(message as AgentEvent);
        }
    }
}
