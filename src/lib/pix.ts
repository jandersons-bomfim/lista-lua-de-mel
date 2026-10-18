/** Gera o "Pix copia e cola" (BR Code estático) a partir da chave real configurada pelo casal. */

const tlv = (id: string, value: string): string => id + String(value.length).padStart(2, '0') + value;

export function crc16(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const asciiUpper = (s: string, max: number): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .trim()
    .slice(0, max);

export interface StaticPixInput {
  key: string;
  receiverName: string;
  receiverCity: string;
  amountCents: number;
  /** Referência da contribuição (ex.: LM-ABC234). Apenas letras e números, até 25 caracteres. */
  reference: string;
}

export function buildStaticPix(i: StaticPixInput): string {
  if (!i.key.trim()) throw new Error('Chave Pix ausente');
  if (!Number.isInteger(i.amountCents) || i.amountCents <= 0) throw new Error('Valor inválido');
  const txid = i.reference.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const body =
    tlv('00', '01') +
    tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', i.key.trim())) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('54', (i.amountCents / 100).toFixed(2)) +
    tlv('58', 'BR') +
    tlv('59', asciiUpper(i.receiverName, 25) || 'RECEBEDOR') +
    tlv('60', asciiUpper(i.receiverCity, 15) || 'BRASIL') +
    tlv('62', tlv('05', txid)) +
    '6304';
  return body + crc16(body);
}
