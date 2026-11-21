export interface LatestRequestTicket {
  isCurrent(): boolean;
}

export function beginLatestRequest(cursor: { current: number }): LatestRequestTicket {
  const requestId = cursor.current + 1;
  cursor.current = requestId;
  return {
    isCurrent: () => cursor.current === requestId,
  };
}

export function invalidateLatestRequests(cursor: { current: number }): void {
  cursor.current += 1;
}
