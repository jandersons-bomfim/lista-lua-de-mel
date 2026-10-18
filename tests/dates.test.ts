import { describe, expect, it } from 'vitest';
import { formatDeadlineLong, fromInputLocal, isListOpen, toInputLocal } from '../src/lib/dates';

const DEADLINE = '2027-01-06T02:59:00.000Z'; // 05/01/2027 23:59 em Salvador (UTC-3)

describe('prazo e fuso America/Bahia', () => {
  it('exibe a data limite em português, no fuso de Salvador', () => {
    expect(formatDeadlineLong(DEADLINE)).toBe('05 de janeiro de 2027');
  });
  it('23h59 de 05/01 ainda está aberta; 00h00 de 06/01 já está encerrada', () => {
    expect(isListOpen(DEADLINE, false, Date.parse('2027-01-06T02:59:00Z'))).toBe(true);
    expect(isListOpen(DEADLINE, false, Date.parse('2027-01-06T03:00:00Z'))).toBe(false);
  });
  it('encerramento manual vale mesmo antes do prazo', () => {
    expect(isListOpen(DEADLINE, true, Date.parse('2026-12-01T12:00:00Z'))).toBe(false);
  });
  it('converte de/para input datetime-local no horário de Salvador', () => {
    expect(toInputLocal(DEADLINE)).toBe('2027-01-05T23:59');
    expect(fromInputLocal('2027-01-05T23:59')).toBe(DEADLINE);
  });
  it('recusa data inválida', () => {
    expect(() => fromInputLocal('')).toThrow();
  });
});
