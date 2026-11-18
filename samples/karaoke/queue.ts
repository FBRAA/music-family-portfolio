export type QueueTimestamp = string | number;

export interface QueueParticipant {
  id: string;
  paused: boolean;
  lastPerformedAt?: QueueTimestamp | null;
}

export type Participant = QueueParticipant;

export type QueueRequestStatus = 'queued' | 'started' | 'completed' | 'cancelled';

export interface QueueRequest {
  id: string;
  authorId: string;
  partnerIds: readonly string[];
  createdAt: QueueTimestamp;
  /**
   * May be omitted when the caller passes an already-filtered queued-request
   * projection.
   */
  status?: QueueRequestStatus;
}

export type KaraokeRequest = QueueRequest;

export interface QueueState {
  participants: readonly QueueParticipant[];
  requests: readonly QueueRequest[];
  currentRequestId?: string | null;
  lockedNextRequestId?: string | null;
}

interface Candidate {
  request: QueueRequest;
  participantIds: readonly string[];
  priority: RequestPriority;
}

type RequestPriority =
  | { hasNeverPerformedParticipant: true }
  | {
      hasNeverPerformedParticipant: false;
      oldestLastPerformedAt: QueueTimestamp;
    };

/**
 * Builds the predicted queue without mutating the supplied state.
 *
 * The current performance seeds the first virtual round. A valid locked-next
 * request follows it, and every later request is selected from the best
 * candidate whose participants have not yet appeared in that round.
 */
export function orderRequests(state: QueueState): string[] {
  const participantsById = indexParticipants(state.participants);
  const currentRequest = state.currentRequestId
    ? state.requests.find((request) => request.id === state.currentRequestId)
    : undefined;
  const usedInRound = new Set(currentRequest ? requestParticipantIds(currentRequest) : []);

  const candidates = state.requests
    .filter(
      (request) =>
        request.id !== state.currentRequestId &&
        (request.status === undefined || request.status === 'queued'),
    )
    .map((request) => toReadyCandidate(request, participantsById))
    .filter((candidate): candidate is Candidate => candidate !== undefined);

  const orderedIds: string[] = [];
  const remaining = new Map(candidates.map((candidate) => [candidate.request.id, candidate]));

  const lockedCandidate = state.lockedNextRequestId
    ? remaining.get(state.lockedNextRequestId)
    : undefined;

  if (lockedCandidate && doesNotOverlap(lockedCandidate.participantIds, usedInRound)) {
    orderedIds.push(lockedCandidate.request.id);
    remaining.delete(lockedCandidate.request.id);
    addAll(usedInRound, lockedCandidate.participantIds);
  }

  while (remaining.size > 0) {
    const fitting = [...remaining.values()].filter((candidate) =>
      doesNotOverlap(candidate.participantIds, usedInRound),
    );

    if (fitting.length === 0) {
      usedInRound.clear();
      continue;
    }

    fitting.sort(compareCandidates);
    const next = fitting[0];
    orderedIds.push(next.request.id);
    remaining.delete(next.request.id);
    addAll(usedInRound, next.participantIds);
  }

  return orderedIds;
}

function indexParticipants(
  participants: readonly QueueParticipant[],
): ReadonlyMap<string, QueueParticipant> {
  const byId = new Map<string, QueueParticipant>();
  const duplicateIds = new Set<string>();

  for (const participant of participants) {
    if (!participant.id || duplicateIds.has(participant.id)) {
      continue;
    }

    if (byId.has(participant.id)) {
      byId.delete(participant.id);
      duplicateIds.add(participant.id);
      continue;
    }

    byId.set(participant.id, participant);
  }

  return byId;
}

function toReadyCandidate(
  request: QueueRequest,
  participantsById: ReadonlyMap<string, QueueParticipant>,
): Candidate | undefined {
  if (!request.id || !request.authorId) {
    return undefined;
  }

  const participantIds = requestParticipantIds(request);
  const participants: QueueParticipant[] = [];

  for (const participantId of participantIds) {
    const participant = participantsById.get(participantId);
    if (!participant || participant.paused) {
      return undefined;
    }
    participants.push(participant);
  }

  return {
    request,
    participantIds,
    priority: priorityOf(participants),
  };
}

function requestParticipantIds(request: QueueRequest): string[] {
  return [...new Set([request.authorId, ...request.partnerIds])];
}

function priorityOf(participants: readonly QueueParticipant[]): RequestPriority {
  if (
    participants.some(
      (participant) =>
        participant.lastPerformedAt === undefined || participant.lastPerformedAt === null,
    )
  ) {
    return { hasNeverPerformedParticipant: true };
  }

  let oldestLastPerformedAt = participants[0]?.lastPerformedAt;
  if (oldestLastPerformedAt === undefined || oldestLastPerformedAt === null) {
    return { hasNeverPerformedParticipant: true };
  }

  for (const participant of participants.slice(1)) {
    const performedAt = participant.lastPerformedAt;
    if (performedAt === undefined || performedAt === null) {
      return { hasNeverPerformedParticipant: true };
    }

    if (compareTimestamps(performedAt, oldestLastPerformedAt) < 0) {
      oldestLastPerformedAt = performedAt;
    }
  }

  return {
    hasNeverPerformedParticipant: false,
    oldestLastPerformedAt,
  };
}

function compareCandidates(left: Candidate, right: Candidate): number {
  if (left.priority.hasNeverPerformedParticipant !== right.priority.hasNeverPerformedParticipant) {
    return left.priority.hasNeverPerformedParticipant ? -1 : 1;
  }

  if (!left.priority.hasNeverPerformedParticipant && !right.priority.hasNeverPerformedParticipant) {
    const performanceOrder = compareTimestamps(
      left.priority.oldestLastPerformedAt,
      right.priority.oldestLastPerformedAt,
    );
    if (performanceOrder !== 0) {
      return performanceOrder;
    }
  }

  const createdOrder = compareTimestamps(left.request.createdAt, right.request.createdAt);
  return createdOrder || compareIds(left.request.id, right.request.id);
}

function compareTimestamps(left: QueueTimestamp, right: QueueTimestamp): number {
  const leftTime = timestampValue(left);
  const rightTime = timestampValue(right);

  if (leftTime !== undefined && rightTime !== undefined) {
    return leftTime === rightTime ? 0 : leftTime < rightTime ? -1 : 1;
  }

  if (leftTime !== undefined) {
    return -1;
  }
  if (rightTime !== undefined) {
    return 1;
  }

  return compareIds(String(left), String(right));
}

function timestampValue(timestamp: QueueTimestamp): number | undefined {
  if (typeof timestamp === 'number') {
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function doesNotOverlap(
  participantIds: readonly string[],
  usedParticipantIds: ReadonlySet<string>,
): boolean {
  return participantIds.every((participantId) => !usedParticipantIds.has(participantId));
}

function addAll(target: Set<string>, values: readonly string[]): void {
  for (const value of values) {
    target.add(value);
  }
}

function compareIds(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
