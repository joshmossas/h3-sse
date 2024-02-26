import {
    getHeader,
    sendStream,
    setResponseHeaders,
    setResponseStatus,
} from 'h3';
import type { H3Event, HTTPHeaderName } from 'h3';

export interface EventStreamOptions {
    autoclose?: boolean;
}

/**
 * Initialize an EventStream instance for creating [server sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
 *
 * @param event H3Event
 * @param autoclose Automatically close the writable stream when the request is closed
 *
 * ####  Example
 * ```ts
 * const eventStream = createEventStream(event);
 *
 * // send messages
 * const interval = setInterval(async () => {
 *   eventStream.push({data: "hello world"});
 * }, 1000);
 *
 * // handle cleanup upon client disconnect
 * eventStream.on("disconnect", () => {
 *   clearInterval(interval);
 * });
 *
 * // send the stream to the client
 * sendEventStream(event, eventStream);
 * ```
 */
export function createEventStream(
    event: H3Event,
    opts: EventStreamOptions = {},
) {
    return new EventStream(event, { autoclose: opts.autoclose ?? true });
}

/**
 * A helper class for [server sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format)
 */
export class EventStream {
    private readonly _h3Event: H3Event;
    lastEventId?: string;
    private readonly _transformStream = new TransformStream();
    private readonly _writer: WritableStreamDefaultWriter;
    private readonly _encoder: TextEncoder = new TextEncoder();
    private _writerIsClosed = false;
    private _paused = false;
    private _unsentData: undefined | string;
    private _disposed = false;
    _handled = false;

    /**
     *
     * @param event H3Event
     * @param autoclose Automatically close the stream when the request has been closed
     */
    constructor(event: H3Event, opts: EventStreamOptions = {}) {
        this._h3Event = event;
        this.lastEventId = getHeader(event, 'Last-Event-ID');
        this._writer = this._transformStream.writable.getWriter();
        this._writer.closed.then(() => {
            this._writerIsClosed = true;
        });
        if (opts.autoclose ?? true) {
            this._h3Event.node.req.on('close', () => this.close());
        }
    }

    /**
     * Publish new event(s) for the client
     */
    async push(message: string): Promise<void>;
    async push(message: string[]): Promise<void>;
    async push(message: EventStreamMessage): Promise<void>;
    async push(message: EventStreamMessage[]): Promise<void>;
    async push(
        message: EventStreamMessage | EventStreamMessage[] | string | string[],
    ) {
        if (typeof message === 'string') {
            await this.sendEvent({ data: message });
            return;
        }
        if (Array.isArray(message)) {
            if (message.length === 0) {
                return;
            }
            if (typeof message[0] === 'string') {
                const msgs: EventStreamMessage[] = [];
                for (const item of message as string[]) {
                    msgs.push({ data: item });
                }
                await this.sendEvents(msgs);
                return;
            }
            await this.sendEvents(message as EventStreamMessage[]);
            return;
        }
        await this.sendEvent(message);
    }

    private async sendEvent(message: EventStreamMessage) {
        if (this._writerIsClosed) {
            return;
        }
        if (this._paused && !this._unsentData) {
            this._unsentData = formatEventStreamMessage(message);
            return;
        }
        if (this._paused) {
            this._unsentData += formatEventStreamMessage(message);
            return;
        }
        await this._writeToStream(formatEventStreamMessage(message));
    }

    private async sendEvents(messages: EventStreamMessage[]) {
        if (this._writerIsClosed) {
            return;
        }
        const payload = formatEventStreamMessages(messages);
        if (this._paused && !this._unsentData) {
            this._unsentData = payload;
            return;
        }
        if (this._paused) {
            this._unsentData += payload;
            return;
        }

        await this._writeToStream(payload);
    }

    private async _writeToStream(payload: string) {
        if (this._writerIsClosed) {
            return;
        }
        try {
            await this._writer.write(this._encoder.encode(payload));
            this._unsentData = '';
        } catch (error) {
            console.error('ERROR WRITING:', error);
        }
    }

    pause() {
        this._paused = true;
    }

    get isPaused() {
        return this._paused;
    }

    async resume() {
        this._paused = false;
        await this.flush();
    }

    async flush() {
        if (this._writerIsClosed) {
            return;
        }
        if (this._unsentData?.length) {
            await this._writeToStream(this._unsentData);
        }
    }

    /**
     * Close the stream and the connection if the stream is being sent to the client
     */
    async close() {
        if (this._disposed) {
            return;
        }
        if (!this._writerIsClosed) {
            try {
                await this._writer.close();
            } catch (error) {
                console.error('ERROR CLOSING:', error);
            }
        }
        // check if the stream has been given to the client before closing the connection
        if (
            this._h3Event._handled &&
            this._handled &&
            !this._h3Event.node.res.closed
        ) {
            this._h3Event.node.res.end();
        }
        this._disposed = true;
    }

    onClose(cb: () => any): void {
        this._writer.closed.then(cb);
    }

    get stream() {
        return this._transformStream.readable;
    }

    /**
     * Send the event stream to the client
     */
    async send() {
        await sendEventStream(this._h3Event, this);
    }
}

export function isEventStream(input: unknown): input is EventStream {
    if (typeof input !== 'object' || input === null) {
        return false;
    }
    return input instanceof EventStream;
}

async function sendEventStream(event: H3Event, eventStream: EventStream) {
    setEventStreamHeaders(event);
    setResponseStatus(event, 200);
    event._handled = true;
    eventStream._handled = true;
    await sendStream(event, eventStream.stream);
}

/**
 * See https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#fields
 */
export interface EventStreamMessage {
    id?: string;
    event?: string;
    retry?: number;
    data: string;
}

export function formatEventStreamMessage(message: EventStreamMessage): string {
    let result = '';
    if (message.id) {
        result += `id: ${message.id}\n`;
    }
    if (message.event) {
        result += `event: ${message.event}\n`;
    }
    if (typeof message.retry === 'number' && Number.isInteger(message.retry)) {
        result += `retry: ${message.retry}\n`;
    }
    result += `data: ${message.data}\n\n`;
    return result;
}

export function formatEventStreamMessages(
    messages: EventStreamMessage[],
): string {
    let result = '';
    for (const msg of messages) {
        result += formatEventStreamMessage(msg);
    }
    return result;
}

function setEventStreamHeaders(event: H3Event) {
    const headers: Partial<
        Record<HTTPHeaderName, string | number | readonly string[]>
    > = {
        'Content-Type': 'text/event-stream',
        'Cache-Control':
            'private, no-cache, no-store, no-transform, must-revalidate, max-age=0',
        'X-Accel-Buffering': 'no', // prevent nginx from buffering the response
    };

    if (!isHttp2Request(event)) {
        headers.Connection = 'keep-alive';
    }

    setResponseHeaders(event, headers);
}

export function isHttp2Request(event: H3Event) {
    return (
        getHeader(event, ':path') !== undefined &&
        getHeader(event, ':method') !== undefined
    );
}
