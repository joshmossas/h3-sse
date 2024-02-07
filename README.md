# H3 SSE

H3 utilities for [server sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)

## Basic Usage

```ts
import { eventHandler } from 'h3';
import { createEventStream, sendEventStream } from 'h3-sse';

eventHandler((event) => {
    const eventStream = createEventStream(event);

    // send a message every second
    const interval = setInterval(async () => {
        await eventStream.push('hello world');
    }, 1000);

    // cleanup when the connection is closed
    eventStream.on('request:close', () => {
        clearInterval(interval);
        await eventStream.close();
    });

    // send the stream to the client
    await sendEventStream(event, eventStream);
});
```

### Autoclose Parameter

`createEventStream()` also comes with an `autoclose` option. When set to true the `EventStream` will automatically be closed when the connection has been closed after being sent to the client. (An EventStream that has not been sent using `sendEventStream()` will not be automatically closed when the connection closes)

```ts
import { eventHandler } from 'h3';
import { createEventStream, sendEventStream } from 'h3-sse';

eventHandler((event) => {
    const eventStream = createEventStream(event, true);

    const interval = setInterval(async () => {
        await eventStream.push('hello world');
    });
    // only the interval needs to be cleaned up now
    eventStream.on('close', () => {
        clearInterval(interval);
    });

    await sendEventStream(event, eventStream);
});
```

## Advanced Messages

`eventStream.push()` accepts a `string` or an `EventStreamMessage`

When sending a `string` the input will be placed into the "data" field.

When sending `EventStreamMessage` you are able to send additional metadata such as an eventId and eventName. However the main data should be placed in the "data" field. For info on what all of these fields do please read [here](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format)

```ts
// this
await eventStream.push('hello world');
// is equivalent to this
await eventStream.push({
    data: 'hello world',
});

// however the EventStreamMessage let's you add additional metadata fields
await eventStream.push({
    id: '1', // the event id
    event: 'message' // the event name. When blank the client assumes this is "message"
    data: 'hello world',
    retry: 200, // how long the client should wait before trying to reconnect

});
```

If you want to send an object you must first serialize it to a `string`.

```ts
const user = {
    id: '1',
    name: 'john doe',
    email: 'johndoe@gmail.com',
};
// without metadata
await eventStream.push(JSON.stringify(user));

// with metadata
await eventStream.push({
    data: JSON.stringify(user),
});
```

## Accessing Last Event ID

For details about this header see [here](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-last-event-id-header).

```ts
const eventStream = createEventStream(event);
eventStream.lastEventId; // string | undefined;
```

## Closing the Stream and Connection

Calling `eventStream.close()` will close the stream and if the stream has been handed to the client it will also close the connection.

```ts
eventHandler((event) => {
    const eventStream = createEventStream(event);
    // send 10 messages then close the stream and connection
    let msgCount = 0;
    setInterval(async () => {
        msgCount++;
        await eventStream.push(`hello world ${msgCount}`);
        if (msgCount >= 10) {
            await eventStream.close();
            clearInterval(interval);
        }
    }, 1000);
    await sendEventStream(event, eventStream);
});
```

Be aware that spec compliant SSE clients will auto-reconnect when the connection is closed. To get around this you can send a "done" or "finished" event and then add logic to the client application to stop reconnecting.

```ts
eventHandler((event) => {
    const eventStream = createEventStream(event);
    let msgCount = 0;
    setInterval(async () => {
        msgCount++;
        await eventStream.push(`hello world ${msgCount}`);
        if (msgCount >= 0) {
            // send some kind of "finished" 'event
            // then add logic to the client to stop
            await eventStream.push('done');
            // alternative
            await eventStream.push({
                event: 'done',
                data: 'No more data',
            });
            // cleanup
            await eventStream.close();
            clearInterval(interval);
        }
    }, 1000);
    await sendEventStream(event, eventStream);
});
```
