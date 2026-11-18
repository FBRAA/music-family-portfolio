# Studio operations

## Payments through Telegram

Staff enter a payment or expense in a Telegram Mini App. The backend validates the request and stores the operation and its delivery state in SQLite. A CRM adapter handles delivery while Telegram notifications follow the persisted state.

The [update scheduler](../samples/payments/update-queue.mjs) runs independent users concurrently and allows only one in-flight action for a given user. It reports spare capacity to the polling caller so the caller can size intake. On processing failure it stops scheduling new work and leaves unacknowledged items in the durable inbox for recovery. SQLite persistence and acknowledgement happen in the surrounding service.

A different problem arises if the CRM request times out after it may have committed. The reconciliation path searches for the original operation and records whether it found one match, several possible matches or no match. An uncertain outcome stays available for review instead of generating an automatic second write.

## Public site and inquiries

The studio site serves static pages and sends inquiries through a backend. Work on the inquiry flow covered attribution, CRM handoff and separate email and Telegram notifications. The UI distinguishes sending, acceptance and failure so the person submitting a form has a clear next step.

## Teacher calendar sync

A Google Apps Script integration reads lessons from AlfaCRM and updates managed events in Google Calendar. It indexes existing events and compares signatures so unchanged lessons can be skipped. A run lock, deadlines and quota-aware writes constrain how much work one execution does. The archived source establishes the design and leaves current deployment parity open.
