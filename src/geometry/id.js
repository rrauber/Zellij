// Lightweight monotonic ID generator. Combines wall-clock time with a counter
// so IDs are unique even within the same millisecond.
let counter = 1;
export const newId = () => `id_${Date.now()}_${counter++}`;
