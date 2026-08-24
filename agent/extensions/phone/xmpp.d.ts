declare module "@xmpp/client" {
    export function client(opts: {
        service?: string;
        domain?: string;
        username?: string;
        password?: string;
        resource?: string;
    }): {
        on(event: string, handler: (...args: never[]) => void): void;
        start(): Promise<unknown>;
        stop(): Promise<unknown>;
        send(stanza: unknown): Promise<unknown>;
    };
    export function xml(
        name: string,
        attrs?: Record<string, string>,
        ...children: unknown[]
    ): unknown;
}
