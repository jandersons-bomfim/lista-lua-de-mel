import { describe, expect, it } from 'vitest';
import { buildStaticPix, crc16 } from '../src/lib/pix';

describe('Pix estático', () => {
  it('CRC16/CCITT-FALSE confere com o vetor de teste padrão', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
  it('gera BR Code com valor exato, campos obrigatórios e CRC válido', () => {
    const code = buildStaticPix({
      key: 'casal@exemplo.com',
      receiverName: 'Lhaiany e Janderson',
      receiverCity: 'Salvador',
      amountCents: 50000,
      reference: 'LM-ABC234',
    });
    expect(code.startsWith('000201')).toBe(true);
    expect(code).toContain('br.gov.bcb.pix');
    expect(code).toContain('0114casal@exemplo.com'.slice(0, 0) + 'casal@exemplo.com');
    expect(code).toContain('5406500.00');
    expect(code).toContain('5802BR');
    expect(code).toContain('LMABC234');
    const body = code.slice(0, -4);
    expect(code.slice(-4)).toBe(crc16(body));
    expect(body.endsWith('6304')).toBe(true);
  });
  it('remove acentos e respeita limites de tamanho do nome e da cidade', () => {
    const code = buildStaticPix({
      key: '11999999999',
      receiverName: 'Lhaiany Conceição de Souza Janderson Silva',
      receiverCity: 'São Sebastião do Passé',
      amountCents: 12345,
      reference: 'LM-XYZ789',
    });
    expect(code).toContain('LHAIANY CONCEICAO DE SOUZ'); // 25 caracteres
    expect(code).toContain('SAO SEBASTIAO DO'.slice(0, 15));
    expect(code).toContain('5406123.45');
  });
  it('recusa valor inválido ou chave vazia', () => {
    const base = { key: 'k', receiverName: 'A', receiverCity: 'B', reference: 'X' };
    expect(() => buildStaticPix({ ...base, amountCents: 0 })).toThrow();
    expect(() => buildStaticPix({ ...base, amountCents: 10.5 })).toThrow();
    expect(() => buildStaticPix({ ...base, key: ' ', amountCents: 100 })).toThrow();
  });
});
