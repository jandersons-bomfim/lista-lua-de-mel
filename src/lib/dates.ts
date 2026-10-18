export const TIMEZONE = 'America/Bahia';

export const formatDeadlineLong = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: TIMEZONE }).format(
    new Date(iso),
  );

export const formatDateTime = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: TIMEZONE }).format(new Date(iso));

/** ISO -> valor de <input type="datetime-local"> no horário de Salvador. */
export function toInputLocal(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/** Valor de <input type="datetime-local"> (horário de Salvador, UTC-3 fixo) -> ISO UTC. */
export function fromInputLocal(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Data inválida');
  const d = new Date(`${value}:00-03:00`);
  if (Number.isNaN(d.getTime())) throw new Error('Data inválida');
  return d.toISOString();
}

/** Decisão pura de "lista aberta" (o servidor é a fonte da verdade; isto serve para a interface). */
export const isListOpen = (deadlineIso: string, manuallyClosed: boolean, nowMs: number): boolean =>
  !manuallyClosed && nowMs <= new Date(deadlineIso).getTime();
