export type Status =
  | 'em_selecao'
  | 'aguardando_pagamento'
  | 'em_verificacao'
  | 'confirmada'
  | 'expirada'
  | 'cancelada';

export interface Gift {
  id: string;
  title: string;
  description: string;
  price_cents: number;
  image_url: string | null;
  image_alt: string;
  sort_order: number;
  active: boolean;
}

export interface PublicState {
  goal_cents: number;
  confirmed_cents: number;
  deadline: string;
  is_open: boolean;
  pix_mode: 'static' | 'dynamic';
  pix_key: string | null;
  pix_receiver_name: string | null;
  pix_receiver_city: string | null;
  server_now: string;
}

export interface ContributionView {
  id: string;
  code: string;
  guest_name: string;
  total_cents: number;
  status: Status;
  items: { title: string; unit_cents: number; quantity: number }[];
  pix_copia_cola: string | null;
  pix_expires_at: string | null;
  created_at: string;
}

export interface AdminContribution {
  id: string;
  code: string;
  guest_name: string;
  message: string | null;
  total_cents: number;
  status: Status;
  provider: string | null;
  provider_payment_id: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  confirmation_source: 'webhook' | 'manual' | null;
  created_at: string;
  contribution_items: { title: string; unit_cents: number; quantity: number }[];
}

export interface AdminSettings {
  goal_cents: number;
  deadline: string;
  manually_closed: boolean;
  pix_mode: 'static' | 'dynamic';
  pix_key: string | null;
  pix_receiver_name: string | null;
  pix_receiver_city: string | null;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor_email: string | null;
  entity: string;
  entity_id: string | null;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  note: string | null;
}

export const STATUS_LABEL: Record<Status, string> = {
  em_selecao: 'Em seleção',
  aguardando_pagamento: 'Aguardando pagamento',
  em_verificacao: 'Em verificação',
  confirmada: 'Contribuição confirmada',
  expirada: 'Expirada',
  cancelada: 'Cancelada',
};
