# Karaoke queue

Guests request solo songs or duets from their phones. A host runs the queue and a shared screen plays the current track. One person can appear in several requests, so ordering songs by submission time can make everyone else wait while that person sings repeatedly.

## How the queue works

The [scheduler](../samples/karaoke/queue.ts) groups the projected queue into virtual rounds. During a round, each participant can appear in at most one request. A duet uses a slot for each singer. The current performance seeds the round, and the host's locked-next request stays next when all its performers are available and have yet to sing in that round.

Within a round, a request involving someone who has yet to sing gets priority. Among remaining eligible requests, preference goes to the least recently served participant. Request age and ID break ties. The scheduler starts another round once no remaining request fits. A paused or missing performer holds their requests out of the projection.

The function receives a snapshot and returns ordered request IDs. The same input produces the same projection without changing the input. The round rule is easy to explain during a live session, and the trade-off is that pauses, duets and newly arrived requests can change the order seen earlier.

## Follow the frontend

- Guest, host and player views consume versioned session snapshots over WebSocket. The client reconnects and refreshes over HTTP so it can recover after a dropped connection.
- The client keeps the same idempotency key when retrying a mutation. Request edits also carry a revision so the server can reject an edit based on an older version.
- The [React player](../samples/karaoke/youtube.tsx) shares an asynchronous YouTube IFrame API loader and handles player state changes, errors and blocked autoplay. It destroys the player on cleanup.

## Run the scheduler

From the repository root with Node.js 22.18+:

```sh
node --input-type=module <<'JS'
import { orderRequests } from './samples/karaoke/queue.ts';

const participants = [
  { id: 'p1', paused: false, lastPerformedAt: 100 },
  { id: 'p2', paused: false },
  { id: 'p3', paused: false },
];
const requests = [
  { id: 'solo', authorId: 'p1', partnerIds: [], createdAt: 101 },
  { id: 'duet', authorId: 'p1', partnerIds: ['p2'], createdAt: 102 },
  { id: 'guest', authorId: 'p3', partnerIds: [], createdAt: 103 },
];
console.log(orderRequests({ participants, requests }));
JS
```

Expected order is `duet`, `guest`, `solo`. The duet takes priority because one singer is new, then the third guest fits in the same round. The solo waits one round because its singer is already in the duet. All IDs and timestamps in the example are synthetic.
