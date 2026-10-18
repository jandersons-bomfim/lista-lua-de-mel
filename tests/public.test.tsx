// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContributionView, Gift, PublicState } from '../src/lib/types';

vi.mock('../src/lib/supabase', () => ({ isConfigured: true, supabase: {} }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AAAA') } }));
vi.mock('../src/lib/api', async (orig) => {
  const real = await orig<typeof import('../src/lib/api')>();
  return {
    ...real,
    fetchGifts: vi.fn(),
    fetchPublicState: vi.fn(),
    createContribution: vi.fn(),
    getContribution: vi.fn(),
    claimPayment: vi.fn(),
    requestDynamicCharge: vi.fn(),
  };
});

import * as api from '../src/lib/api';
import Public from '../src/pages/Public';

const gift = (id: string, title: string, price_cents: number, order: number): Gift => ({
  id, title, description: `Descrição de ${title}`, price_cents, image_url: null, image_alt: title, sort_order: order, active: true,
});
const GIFTS = [gift('g1', 'Nosso primeiro café no Rio', 10000, 1), gift('g2', 'Nosso encontro com o Cristo', 30000, 2)];
const STATE: PublicState = {
  goal_cents: 600000, confirmed_cents: 0, deadline: '2027-01-06T02:59:00Z', is_open: true, pix_mode: 'static',
  pix_key: 'casal@exemplo.com', pix_receiver_name: 'Lhaiany e Janderson', pix_receiver_city: 'Salvador', server_now: '2026-10-13T12:00:00Z',
};
const VIEW: ContributionView = {
  id: '11111111-1111-4111-8111-111111111111', code: 'LM-ABC234', guest_name: 'Tia Maria', total_cents: 50000,
  status: 'aguardando_pagamento', pix_copia_cola: null, pix_expires_at: null, created_at: '2026-10-13T12:00:00Z',
  items: [{ title: 'Nosso primeiro café no Rio', unit_cents: 10000, quantity: 2 }, { title: 'Nosso encontro com o Cristo', unit_cents: 30000, quantity: 1 }],
};
const brl = (s: string) => s.replace(/\u00a0/g, ' ');

function setup(state: Partial<PublicState> = {}) {
  vi.mocked(api.fetchGifts).mockResolvedValue(GIFTS);
  vi.mocked(api.fetchPublicState).mockResolvedValue({ ...STATE, ...state });
  return userEvent.setup();
}

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

async function pickTwoAndContinue(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Nosso primeiro café no Rio');
  await user.click(screen.getByRole('button', { name: 'Escolher presente: Nosso primeiro café no Rio' }));
  await user.click(screen.getByRole('button', { name: 'Aumentar quantidade de Nosso primeiro café no Rio' }));
  await user.click(screen.getByRole('button', { name: 'Escolher presente: Nosso encontro com o Cristo' }));
  await user.click(screen.getByRole('button', { name: 'Continuar para presentear' }));
}

describe('página pública', () => {
  it('mostra textos principais, meta, R$ 0,00 e 0% sem contribuições', async () => {
    setup();
    render(<Public />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nossa lua de mel, com um pouquinho de vocês.' })).toBeTruthy();
    expect(screen.getByText('Escolha um pedacinho da nossa viagem')).toBeTruthy();
    expect(screen.getByText('Contribuições até 05 de janeiro de 2027.')).toBeTruthy();
    await screen.findByText(/Nosso sonho: R\$\s6\.000,00/);
    const dl = document.querySelector('.goal')!;
    expect(brl(dl.textContent!)).toContain('R$ 0,00');
    expect(dl.textContent).toContain('0%');
    expect(brl(dl.textContent!)).toContain('R$ 6.000,00');
  });

  it('meta usa só o confirmado do servidor (R$ 1.500 = 25%; restante R$ 4.500)', async () => {
    setup({ confirmed_cents: 150000 });
    render(<Public />);
    await screen.findByText(/Nosso sonho/);
    const text = brl(document.querySelector('.goal')!.textContent!);
    expect(text).toContain('R$ 1.500,00');
    expect(text).toContain('25%');
    expect(text).toContain('R$ 4.500,00');
  });

  it('seleciona uma e várias cotas, altera quantidades e atualiza o total na hora', async () => {
    const user = setup();
    render(<Public />);
    await screen.findByText('Nosso primeiro café no Rio');
    expect(screen.queryByRole('complementary')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Escolher presente: Nosso primeiro café no Rio' }));
    const bar = screen.getByRole('complementary', { name: 'Resumo dos presentes' });
    expect(brl(bar.textContent!)).toContain('1 presente');
    expect(brl(bar.textContent!)).toContain('R$ 100,00');

    await user.click(screen.getByRole('button', { name: 'Aumentar quantidade de Nosso primeiro café no Rio' }));
    await user.click(screen.getByRole('button', { name: 'Escolher presente: Nosso encontro com o Cristo' }));
    expect(brl(bar.textContent!)).toContain('3 presentes');
    expect(brl(bar.textContent!)).toContain('R$ 500,00');

    await user.click(screen.getByRole('button', { name: /Ver resumo/ }));
    expect(brl(bar.textContent!)).toContain('2 × R$ 100,00 = R$ 200,00');
    await user.click(screen.getByRole('button', { name: 'Remover Nosso encontro com o Cristo' }));
    expect(brl(bar.textContent!)).toContain('R$ 200,00');
    expect(brl(bar.textContent!)).not.toContain('R$ 500,00');
  });

  it('exige o nome, envia só gift_id/quantidade e mostra Pix com status pendente (nunca "confirmada")', async () => {
    const user = setup();
    vi.mocked(api.createContribution).mockResolvedValue(VIEW);
    render(<Public />);
    await pickTwoAndContinue(user);

    await user.click(screen.getByRole('button', { name: 'Continuar para o Pix' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(api.createContribution).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Seu nome ou o da sua família/), 'Tia Maria');
    await user.click(screen.getByRole('button', { name: 'Continuar para o Pix' }));

    await screen.findByRole('heading', { name: 'Seu presente para a nossa lua de mel' });
    const call = vi.mocked(api.createContribution).mock.calls[0];
    expect(call[1]).toBe('Tia Maria');
    expect(call[3]).toEqual([{ gift_id: 'g1', quantity: 2 }, { gift_id: 'g2', quantity: 1 }]);
    expect(JSON.stringify(call)).not.toMatch(/total|cents|price/i);

    expect(screen.getByText('Aguardando pagamento')).toBeTruthy();
    expect(screen.getByText(/Agora é só concluir o Pix/)).toBeTruthy();
    expect(screen.queryByText('Contribuição confirmada')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copiar código Pix' })).toBeTruthy();
    const code = (screen.getByLabelText('Pix copia e cola') as HTMLTextAreaElement).value;
    expect(code).toContain('br.gov.bcb.pix');
    expect(code).toContain('5406500.00'); // valor exato do total
    expect(screen.getByText(/não é automática/)).toBeTruthy(); // aviso de confirmação manual
    expect(localStorage.getItem('lm.contribution.v1')).toContain(VIEW.id); // retoma após recarregar
  });

  it('duplo clique em "Continuar para o Pix" cria uma única contribuição', async () => {
    const user = setup();
    let resolve!: (v: ContributionView) => void;
    vi.mocked(api.createContribution).mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Public />);
    await pickTwoAndContinue(user);
    await user.type(screen.getByLabelText(/Seu nome/), 'Ana');
    await user.dblClick(screen.getByRole('button', { name: 'Continuar para o Pix' }));
    resolve(VIEW);
    await screen.findByRole('heading', { name: 'Seu presente para a nossa lua de mel' });
    expect(api.createContribution).toHaveBeenCalledTimes(1);
  });

  it('retoma a contribuição após recarregar a página', async () => {
    setup();
    localStorage.setItem('lm.contribution.v1', JSON.stringify({ id: VIEW.id, client_key: '22222222-2222-4222-8222-222222222222' }));
    vi.mocked(api.getContribution).mockResolvedValue(VIEW);
    render(<Public />);
    expect(await screen.findByRole('heading', { name: 'Seu presente para a nossa lua de mel' })).toBeTruthy();
    expect(screen.getByText('LM-ABC234')).toBeTruthy();
  });

  it('Pix não configurado: não inventa QR Code nem código', async () => {
    const user = setup({ pix_key: null });
    vi.mocked(api.createContribution).mockResolvedValue(VIEW);
    render(<Public />);
    await pickTwoAndContinue(user);
    await user.type(screen.getByLabelText(/Seu nome/), 'Tia Maria');
    await user.click(screen.getByRole('button', { name: 'Continuar para o Pix' }));
    await screen.findByText(/O Pix ainda não está disponível nesta página/);
    expect(screen.queryByRole('button', { name: 'Copiar código Pix' })).toBeNull();
    expect(screen.queryByAltText(/QR Code/)).toBeNull();
  });

  it('erro de rede ao registrar: mensagem clara, mantém os dados e a seleção', async () => {
    const user = setup();
    vi.mocked(api.createContribution).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Public />);
    await pickTwoAndContinue(user);
    await user.type(screen.getByLabelText(/Seu nome/), 'Tia Maria');
    await user.click(screen.getByRole('button', { name: 'Continuar para o Pix' }));
    expect(await screen.findByText(/Não conseguimos conectar/)).toBeTruthy();
    expect((screen.getByLabelText(/Seu nome/) as HTMLInputElement).value).toBe('Tia Maria');
    expect(brl(document.body.textContent!)).toContain('R$ 500,00');
  });

  it('erro de rede ao carregar a lista: mostra aviso e botão para tentar de novo', async () => {
    vi.mocked(api.fetchGifts).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(api.fetchPublicState).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Public />);
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Tentar novamente' }).length).toBeGreaterThan(0);
  });

  it('lista encerrada: sem seleção, sem barra de resumo, mensagem delicada', async () => {
    setup({ is_open: false });
    render(<Public />);
    expect(await screen.findByText('A lista foi encerrada')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: /Escolher presente/ });
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByText(/Contribuições até/)).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('contribuição confirmada mostra o agradecimento definitivo; pendente nunca mostra', async () => {
    setup();
    localStorage.setItem('lm.contribution.v1', JSON.stringify({ id: VIEW.id, client_key: '22222222-2222-4222-8222-222222222222' }));
    vi.mocked(api.getContribution).mockResolvedValue({ ...VIEW, status: 'confirmada' });
    render(<Public />);
    const box = await screen.findByText('Contribuição confirmada', { selector: 'p.serif' });
    expect(within(box.parentElement!).getByText(/Seu carinho já faz parte da nossa história/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copiar código Pix' })).toBeNull();
  });
});
