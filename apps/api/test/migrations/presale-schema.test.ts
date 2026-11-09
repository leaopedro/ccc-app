import { ensurePresaleSystemUser, prisma, PRESALE_SYSTEM_USER_EMAIL } from '@ccc/db';
import { INACTIVE_USER_STATUSES } from '@ccc/shared/auth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetDatabase } from '../helpers.js';
import { createProduct, createProductOrder } from '../presale/fixtures.js';

describe('presale schema (Casa In Box)', () => {
  beforeEach(async () => {
    await resetDatabase();
    // PresaleGuest/PresaleSettings não são tocados por resetDatabase (arquivo
    // compartilhado, não editado por esta tarefa), então limpamos aqui.
    await prisma.presaleGuest.deleteMany();
    await prisma.presaleSettings.deleteMany();
    await ensurePresaleSystemUser();
  });

  afterEach(async () => {
    await resetDatabase();
    await prisma.presaleGuest.deleteMany();
    await prisma.presaleSettings.deleteMany();
  });

  it('product nasce fora da pré-venda', async () => {
    const product = await createProduct();
    expect(product.visibleInPresale).toBe(false);
  });

  it('order nasce com origin app', async () => {
    const order = await createProductOrder();
    expect(order.origin).toBe('app');
    expect(order.clientRequestId).toBeNull();
    expect(order.confirmationEmailSentAt).toBeNull();
  });

  it('a unique de clientRequestId não impede dois pedidos sem id', async () => {
    await expect(Promise.all([createProductOrder(), createProductOrder()])).resolves.toHaveLength(
      2,
    );
  });

  it('PresaleSettings nasce desligado', async () => {
    const s = await prisma.presaleSettings.create({ data: {} });
    expect(s.enabled).toBe(false);
    expect(s.shippingFeeCents).toBe(0);
    expect(s.deliveryCepRanges).toEqual([]);
  });

  it('PresaleGuest é apagado junto com o pedido', async () => {
    const order = await createProductOrder();
    await prisma.presaleGuest.create({ data: { orderId: order.id, name: 'A', email: 'a@b.c' } });
    await prisma.order.delete({ where: { id: order.id } });
    await expect(
      prisma.presaleGuest.findUnique({ where: { orderId: order.id } }),
    ).resolves.toBeNull();
  });

  it('o usuário-sistema não consegue autenticar', async () => {
    const u = await prisma.user.findUnique({ where: { email: PRESALE_SYSTEM_USER_EMAIL } });
    expect(INACTIVE_USER_STATUSES).toContain(u!.status);
  });
});
