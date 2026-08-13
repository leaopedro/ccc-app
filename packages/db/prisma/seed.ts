import { PrismaClient } from '@prisma/client';

import {
  GARAGE_SPOT_DEFAULT_DESCRIPTION,
  GARAGE_SPOT_DEFAULT_PRICE_CENTS,
  GARAGE_SPOT_DEFAULT_TITLE,
  GARAGE_SPOT_PRODUCT_SLUG,
  GARAGE_SPOT_PRODUCT_TYPE_NAME,
  GARAGE_SPOT_VARIANT_NAME,
  assertVirtualSingletonProtected,
} from '../src/garage-spot-product.js';

const prisma = new PrismaClient();

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000);
const hours = (n: number) => n * 3_600_000;

const events = [
  {
    slug: 'encontro-ccc-sp-2026-05',
    title: 'Encontro CCC São Paulo: Maio',
    description: 'Domingo de exposição e rolê no autódromo. Traga seu carro e venha curtir.',
    startsAt: daysFromNow(14),
    endsAt: new Date(daysFromNow(14).getTime() + hours(8)),
    venueName: 'Autódromo de Interlagos',
    venueAddress: 'Av. Senador Teotônio Vilela, 261, Interlagos',
    city: 'São Paulo',
    stateCode: 'SP',
    type: 'meeting' as const,
    status: 'published' as const,
    capacity: 500,
    tiers: [
      { name: 'Pista', priceCents: 4000, quantityTotal: 400, sortOrder: 0 },
      { name: 'VIP', priceCents: 12000, quantityTotal: 50, sortOrder: 1 },
    ],
  },
  {
    slug: 'drift-day-curitiba-2026-06',
    title: 'Drift Day Curitiba',
    description: 'Sessão de drift aberta a inscritos. Vagas limitadas.',
    startsAt: daysFromNow(30),
    endsAt: new Date(daysFromNow(30).getTime() + hours(10)),
    venueName: 'Autódromo Internacional de Curitiba',
    venueAddress: 'Rodovia Deputado João Leopoldo Jacomel, s/n, Pinhais',
    city: 'Curitiba',
    stateCode: 'PR',
    type: 'drift' as const,
    status: 'published' as const,
    capacity: 80,
    tiers: [{ name: 'Piloto', priceCents: 35000, quantityTotal: 80, sortOrder: 0 }],
  },
  {
    slug: 'encontro-ccc-rj-2026-03',
    title: 'Encontro CCC Rio: Março (encerrado)',
    description: 'Edição anterior.',
    startsAt: daysFromNow(-30),
    endsAt: new Date(daysFromNow(-30).getTime() + hours(6)),
    venueName: 'Aterro do Flamengo',
    venueAddress: 'Av. Infante Dom Henrique',
    city: 'Rio de Janeiro',
    stateCode: 'RJ',
    type: 'meeting' as const,
    status: 'published' as const,
    capacity: 300,
    tiers: [{ name: 'Geral', priceCents: 3000, quantityTotal: 300, sortOrder: 0 }],
  },
  {
    slug: 'rascunho-secreto',
    title: 'Rascunho (não deve aparecer)',
    description: 'Evento em rascunho.',
    startsAt: daysFromNow(60),
    endsAt: new Date(daysFromNow(60).getTime() + hours(4)),
    venueName: null,
    venueAddress: null,
    city: 'São Paulo',
    stateCode: 'SP',
    type: 'other' as const,
    status: 'draft' as const,
    capacity: 10,
    tiers: [{ name: 'Geral', priceCents: 0, quantityTotal: 10, sortOrder: 0 }],
  },
];

const STORE_PRODUCT_TYPE_NAME = 'Vestuário e Acessórios';

const STORE_COLLECTION = {
  slug: 'colecao-ccc-2026',
  name: 'Coleção CCC 2026',
  description: 'Peças oficiais para os encontros CCC da temporada.',
  sortOrder: 0,
};

type SeedVariant = {
  name: string;
  sku: string;
  priceCents: number;
  quantityTotal: number;
  attributes: Record<string, string>;
};

type SeedProduct = {
  slug: string;
  title: string;
  description: string;
  basePriceCents: number;
  status: 'draft' | 'active' | 'archived';
  shippingFeeCents: number | null;
  variants: SeedVariant[];
};

const STORE_PRODUCTS: SeedProduct[] = [
  {
    slug: 'camiseta-ccc-classic',
    title: 'Camiseta CCC Classic',
    description:
      'Camiseta de algodão pesado com estampa CCC Classic nas costas. Caimento regular, gola reforçada.',
    basePriceCents: 12900,
    status: 'active',
    shippingFeeCents: null,
    variants: [
      {
        name: 'Tamanho P',
        sku: 'CCC-TEE-CLS-P',
        priceCents: 12900,
        quantityTotal: 30,
        attributes: { size: 'P', color: 'Preto' },
      },
      {
        name: 'Tamanho M',
        sku: 'CCC-TEE-CLS-M',
        priceCents: 12900,
        quantityTotal: 50,
        attributes: { size: 'M', color: 'Preto' },
      },
      {
        name: 'Tamanho G',
        sku: 'CCC-TEE-CLS-G',
        priceCents: 12900,
        quantityTotal: 40,
        attributes: { size: 'G', color: 'Preto' },
      },
    ],
  },
  {
    slug: 'adesivo-ccc-logo',
    title: 'Adesivo CCC Logo',
    description: 'Adesivo recortado em vinil resistente, 12x6 cm. Aplicação interna ou externa.',
    basePriceCents: 1500,
    status: 'active',
    shippingFeeCents: 0,
    variants: [
      {
        name: 'Único',
        sku: 'CCC-STK-LOGO',
        priceCents: 1500,
        quantityTotal: 200,
        attributes: { size: '12x6cm' },
      },
    ],
  },
];

const seedStore = async (): Promise<void> => {
  const productType = await prisma.productType.upsert({
    where: { name: STORE_PRODUCT_TYPE_NAME },
    update: { sortOrder: 0 },
    create: { name: STORE_PRODUCT_TYPE_NAME, sortOrder: 0 },
  });

  const collection = await prisma.collection.upsert({
    where: { slug: STORE_COLLECTION.slug },
    update: {
      name: STORE_COLLECTION.name,
      description: STORE_COLLECTION.description,
      sortOrder: STORE_COLLECTION.sortOrder,
      active: true,
    },
    create: {
      slug: STORE_COLLECTION.slug,
      name: STORE_COLLECTION.name,
      description: STORE_COLLECTION.description,
      sortOrder: STORE_COLLECTION.sortOrder,
      active: true,
    },
  });

  for (let index = 0; index < STORE_PRODUCTS.length; index += 1) {
    const product = STORE_PRODUCTS[index];
    if (!product) continue;
    const upserted = await prisma.product.upsert({
      where: { slug: product.slug },
      update: {
        title: product.title,
        description: product.description,
        basePriceCents: product.basePriceCents,
        status: product.status,
        shippingFeeCents: product.shippingFeeCents,
        productTypeId: productType.id,
      },
      create: {
        slug: product.slug,
        title: product.title,
        description: product.description,
        basePriceCents: product.basePriceCents,
        status: product.status,
        shippingFeeCents: product.shippingFeeCents,
        productTypeId: productType.id,
      },
    });

    for (const variant of product.variants) {
      const existing = await prisma.variant.findFirst({
        where: { productId: upserted.id, name: variant.name },
      });
      if (existing) {
        await prisma.variant.update({
          where: { id: existing.id },
          data: {
            sku: variant.sku,
            priceCents: variant.priceCents,
            attributes: variant.attributes,
            active: true,
          },
        });
      } else {
        await prisma.variant.create({
          data: {
            productId: upserted.id,
            name: variant.name,
            sku: variant.sku,
            priceCents: variant.priceCents,
            quantityTotal: variant.quantityTotal,
            attributes: variant.attributes,
            active: true,
          },
        });
      }
    }

    await prisma.productCollection.upsert({
      where: {
        productId_collectionId: {
          productId: upserted.id,
          collectionId: collection.id,
        },
      },
      update: { sortOrder: index },
      create: {
        productId: upserted.id,
        collectionId: collection.id,
        sortOrder: index,
      },
    });
  }

  const existingSettings = await prisma.storeSettings.findFirst();
  if (existingSettings) {
    await prisma.storeSettings.update({
      where: { id: existingSettings.id },
      data: {
        defaultShippingFeeCents: 1990,
        lowStockThreshold: 5,
        pickupDisplayLabel: 'Retirada nos encontros CCC',
        supportPhone: '+5511999999999',
      },
    });
  } else {
    await prisma.storeSettings.create({
      data: {
        defaultShippingFeeCents: 1990,
        lowStockThreshold: 5,
        pickupDisplayLabel: 'Retirada nos encontros CCC',
        supportPhone: '+5511999999999',
      },
    });
  }

  const variantCount = STORE_PRODUCTS.reduce((sum, p) => sum + p.variants.length, 0);
  console.log(
    `Seeded store: 1 product type, 1 collection, ${STORE_PRODUCTS.length} products, ${variantCount} variants, store settings.`,
  );
};

const seedGarageSpotProduct = async (): Promise<void> => {
  // 1. ProductType. Upsert by unique name.
  const productType = await prisma.productType.upsert({
    where: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME },
    update: { sortOrder: 99 },
    create: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME, sortOrder: 99 },
  });

  // 2. Product. Upsert by unique slug. Refuse to duplicate if a non-singleton row
  //    has somehow claimed the slug *or* the garage_spot ProductType.
  const existing = await prisma.product.findUnique({
    where: { slug: GARAGE_SPOT_PRODUCT_SLUG },
    include: { productType: { select: { name: true } } },
  });

  if (existing && existing.productType.name !== GARAGE_SPOT_PRODUCT_TYPE_NAME) {
    // A different product is squatting the slug. Hard fail rather than silently corrupting.
    // assertVirtualSingletonProtected always throws when slug matches, so no further throw needed.
    assertVirtualSingletonProtected('duplicate', {
      slug: existing.slug,
      virtual: existing.virtual,
      visibleInStore: existing.visibleInStore,
      productType: { name: existing.productType.name },
    });
  }

  // Refuse if any *other* product is already attached to the garage_spot ProductType.
  // Findunique-by-slug alone misses this case (a squatter could live under our type
  // with an unrelated slug). Singleton invariant: exactly one product per garage_spot type.
  const foreignTypedProducts = await prisma.product.findMany({
    where: {
      productTypeId: productType.id,
      NOT: { slug: GARAGE_SPOT_PRODUCT_SLUG },
    },
    select: { slug: true, virtual: true, visibleInStore: true },
  });
  if (foreignTypedProducts.length > 0) {
    const squatter = foreignTypedProducts[0];
    if (!squatter) return;
    assertVirtualSingletonProtected('duplicate', {
      slug: squatter.slug,
      virtual: squatter.virtual,
      visibleInStore: squatter.visibleInStore,
      productType: { name: GARAGE_SPOT_PRODUCT_TYPE_NAME },
    });
  }

  const product = await prisma.product.upsert({
    where: { slug: GARAGE_SPOT_PRODUCT_SLUG },
    update: {
      title: GARAGE_SPOT_DEFAULT_TITLE,
      description: GARAGE_SPOT_DEFAULT_DESCRIPTION,
      status: 'active',
      virtual: true,
      visibleInStore: false,
      allowPickup: false,
      allowShip: false,
      productTypeId: productType.id,
      // Price is admin-configurable post-seed. Don't clobber an admin-set price on re-run.
    },
    create: {
      slug: GARAGE_SPOT_PRODUCT_SLUG,
      title: GARAGE_SPOT_DEFAULT_TITLE,
      description: GARAGE_SPOT_DEFAULT_DESCRIPTION,
      productTypeId: productType.id,
      basePriceCents: GARAGE_SPOT_DEFAULT_PRICE_CENTS,
      status: 'active',
      virtual: true,
      visibleInStore: false,
      allowPickup: false,
      allowShip: false,
    },
  });

  // 3. Singleton Variant. quantityTotal=0 is fine: virtual products skip inventory checks (TASK-C).
  const existingVariant = await prisma.variant.findFirst({
    where: { productId: product.id, name: GARAGE_SPOT_VARIANT_NAME },
  });

  if (existingVariant) {
    await prisma.variant.update({
      where: { id: existingVariant.id },
      data: {
        priceCents: product.basePriceCents,
        active: true,
      },
    });
  } else {
    // Refuse if any variant for this product already exists with a different name.
    const anyOtherVariant = await prisma.variant.findFirst({ where: { productId: product.id } });
    if (anyOtherVariant) {
      throw new Error(
        `seed: garage product already has variants; singleton invariant violated (variant.name=${anyOtherVariant.name})`,
      );
    }
    await prisma.variant.create({
      data: {
        productId: product.id,
        name: GARAGE_SPOT_VARIANT_NAME,
        sku: null,
        priceCents: product.basePriceCents,
        quantityTotal: 0,
        attributes: {},
        active: true,
      },
    });
  }

  console.log(
    `Seeded garage spot product: type=${GARAGE_SPOT_PRODUCT_TYPE_NAME}, slug=${GARAGE_SPOT_PRODUCT_SLUG}.`,
  );
};

const seedGaragesForExistingUsers = async (): Promise<void> => {
  // Eagerly ensure every User has a Garage row. Production data flows through
  // the signup hook + migration backfill; this loop covers dev fixtures and
  // any user that pre-dates the pivot. Neutral defaults only — never derive
  // anything from User.name (LGPD).
  const users = await prisma.user.findMany({
    select: { id: true },
    where: { garage: null },
  });
  for (const u of users) {
    const baseSlug = `user-${u.id.slice(0, 8).toLowerCase()}`;
    let candidate = baseSlug;
    let suffix = 2;

    while (true) {
      const exists = await prisma.garage.findUnique({ where: { slug: candidate } });
      if (!exists) break;
      candidate = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    await prisma.garage.create({
      data: {
        userId: u.id,
        name: 'Garagem',
        slug: candidate,
        isPublic: false,
      },
    });
  }
  if (users.length > 0) {
    console.log(`Seeded ${users.length} garage row(s) for existing users.`);
  }
};

const BADGES = [
  { code: 'EVT-001', category: 'eventos', rarity: 'common', icon: 'flag', premiumExclusive: false },
  { code: 'EVT-002', category: 'eventos', rarity: 'rare', icon: 'streak', premiumExclusive: false },
  {
    code: 'EVT-003',
    category: 'eventos',
    rarity: 'legendary',
    icon: 'medal',
    premiumExclusive: false,
  },
  { code: 'CAR-001', category: 'carros', rarity: 'common', icon: 'car', premiumExclusive: false },
  {
    code: 'CAR-002',
    category: 'carros',
    rarity: 'rare',
    icon: 'garageFull',
    premiumExclusive: false,
  },
  {
    code: 'CAR-003',
    category: 'carros',
    rarity: 'legendary',
    icon: 'curator',
    premiumExclusive: false,
  },
  {
    code: 'COM-001',
    category: 'comunidade',
    rarity: 'common',
    icon: 'post',
    premiumExclusive: false,
  },
  {
    code: 'COM-002',
    category: 'comunidade',
    rarity: 'rare',
    icon: 'chat',
    premiumExclusive: false,
  },
  {
    code: 'COM-003',
    category: 'comunidade',
    rarity: 'legendary',
    icon: 'fire',
    premiumExclusive: false,
  },
  { code: 'CCC-001', category: 'ccc', rarity: 'common', icon: 'pin', premiumExclusive: false },
  { code: 'CCC-002', category: 'ccc', rarity: 'rare', icon: 'flagCheck', premiumExclusive: false },
  {
    code: 'CCC-003',
    category: 'ccc',
    rarity: 'legendary',
    icon: 'founder',
    premiumExclusive: false,
  },
] as const;

const seedBadgeCatalog = async (): Promise<void> => {
  for (const b of BADGES) {
    await prisma.badge.upsert({
      where: { code: b.code },
      create: b,
      update: {
        category: b.category,
        rarity: b.rarity,
        icon: b.icon,
        premiumExclusive: b.premiumExclusive,
      },
    });
  }
  console.log(`Seeded badge catalog: ${BADGES.length} entries.`);
};

// Premium plans catalog. tier links to the existing GaragePremiumTier enum.
// PT-BR display names: silver == Prata, gold == Ouro (enum stays bronze/silver/gold).
const PREMIUM_PLANS = [
  {
    tier: 'bronze' as const,
    slug: 'ingresso',
    name: 'Ingresso',
    sortOrder: 0,
    monthlyCents: 49000,
    benefits: [
      'Acesso ao clube em horário comercial',
      'Eventos abertos da comunidade',
      'Comunidade no app',
    ],
  },
  {
    tier: 'silver' as const,
    slug: 'estrada',
    name: 'Estrada',
    sortOrder: 1,
    monthlyCents: 89000,
    benefits: [
      'Tudo do Bronze',
      'Prioridade em eventos exclusivos',
      '1 convidado por evento',
      'Descontos com parceiros',
    ],
  },
  {
    tier: 'gold' as const,
    slug: 'fundador',
    name: 'Fundador',
    sortOrder: 2,
    monthlyCents: 149000,
    benefits: [
      'Tudo da Prata',
      'Acesso ao clube 24 horas',
      'Até 3 convidados por evento',
      'Concierge dedicado',
      'Vaga premium na garagem',
    ],
  },
];

const PREMIUM_ADDON_MODULES = [
  {
    key: 'detailing',
    name: 'Detailing',
    description: '3 acessos/mês para lavagem & detailing',
    monthlyDeltaCents: 15000,
    // Repasse real ainda nao definido pelo operador. Zero e null deliberadamente:
    // o seed nao inventa dado financeiro. Ate ser preenchido, a margem exibida no
    // admin iguala o valor cobrado.
    payoutAmountCents: 0,
    vendorName: null,
    quotaPerCycle: 3,
    quotaUnit: 'access' as const,
    sortOrder: 0,
  },
  {
    key: 'oficina',
    name: 'Oficina',
    description: '5 horas de oficina por mês',
    monthlyDeltaCents: 50000,
    payoutAmountCents: 0,
    vendorName: null,
    quotaPerCycle: 5,
    quotaUnit: 'hours' as const,
    sortOrder: 1,
  },
];

const seedPremiumCatalog = async (): Promise<void> => {
  for (const p of PREMIUM_PLANS) {
    // Plan. Upsert on the unique tier.
    const plan = await prisma.premiumPlan.upsert({
      where: { tier: p.tier },
      update: { slug: p.slug, name: p.name, sortOrder: p.sortOrder, active: true },
      create: { tier: p.tier, slug: p.slug, name: p.name, sortOrder: p.sortOrder, active: true },
    });

    // Monthly price. Upsert on composite [planId, cadence].
    // stripePriceId / rcProductId stay null until the Stripe/RC products are
    // created in a later billing phase; do not clobber them here.
    await prisma.premiumPlanPrice.upsert({
      where: { planId_cadence: { planId: plan.id, cadence: 'monthly' } },
      update: { baseAmountCents: p.monthlyCents, currency: 'BRL', active: true },
      create: {
        planId: plan.id,
        cadence: 'monthly',
        baseAmountCents: p.monthlyCents,
        currency: 'BRL',
        active: true,
      },
    });

    // Benefits have no natural unique beyond (planId,label). Delete-and-recreate
    // per plan keeps display order authoritative and is trivially idempotent.
    await prisma.premiumPlanBenefit.deleteMany({ where: { planId: plan.id } });
    await prisma.premiumPlanBenefit.createMany({
      data: p.benefits.map((label, index) => ({ planId: plan.id, label, sortOrder: index })),
    });
  }

  for (const m of PREMIUM_ADDON_MODULES) {
    // Addon module. Upsert on the unique key.
    await prisma.premiumAddonModule.upsert({
      where: { key: m.key },
      update: {
        name: m.name,
        description: m.description,
        monthlyDeltaCents: m.monthlyDeltaCents,
        payoutAmountCents: m.payoutAmountCents,
        vendorName: m.vendorName,
        currency: 'BRL',
        quotaPerCycle: m.quotaPerCycle,
        quotaUnit: m.quotaUnit,
        sortOrder: m.sortOrder,
        active: true,
      },
      create: {
        key: m.key,
        name: m.name,
        description: m.description,
        monthlyDeltaCents: m.monthlyDeltaCents,
        payoutAmountCents: m.payoutAmountCents,
        vendorName: m.vendorName,
        currency: 'BRL',
        quotaPerCycle: m.quotaPerCycle,
        quotaUnit: m.quotaUnit,
        sortOrder: m.sortOrder,
        active: true,
      },
    });
  }

  const benefitCount = PREMIUM_PLANS.reduce((sum, p) => sum + p.benefits.length, 0);
  console.log(
    `Seeded premium catalog: ${PREMIUM_PLANS.length} plans, ${PREMIUM_PLANS.length} monthly prices, ${benefitCount} benefits, ${PREMIUM_ADDON_MODULES.length} addon modules.`,
  );
};

// Keep in sync with BOX_SETTINGS_SINGLETON_ID in @ccc/shared/admin-box.
const BOX_SETTINGS_SINGLETON_ID = 'box_default';

const seedBoxSettings = async (): Promise<void> => {
  await prisma.boxSettings.upsert({
    where: { id: BOX_SETTINGS_SINGLETON_ID },
    update: {},
    create: {
      id: BOX_SETTINGS_SINGLETON_ID,
      boxEnabled: false,
      cutoffDaysBeforeRenewal: 5,
      headerTitle: 'Sua caixa do mes',
      shippingFeeCents: 0,
      freeShippingCepRanges: [{ from: '80000-000', to: '83800-999' }],
    },
  });
  console.log('Seeded box settings.');
};

const main = async (): Promise<void> => {
  for (const e of events) {
    const { tiers, ...rest } = e;
    // Refresh time-sensitive fields on re-run so "upcoming" stays upcoming.
    // Tiers are not touched on update: quantitySold is load-bearing once F4 ships.
    const publishedAt = rest.status === 'published' ? new Date() : null;
    await prisma.event.upsert({
      where: { slug: rest.slug },
      update: {
        startsAt: rest.startsAt,
        endsAt: rest.endsAt,
        status: rest.status,
        publishedAt,
      },
      create: {
        ...rest,
        publishedAt,
        tiers: { create: tiers },
      },
    });
  }
  console.log(`Seeded ${events.length} events.`);

  await seedStore();

  // Retired from the default seed on 2026-08-13, opt-in only.
  //
  // "Vaga de Garagem Adicional" (R$49, virtual: true) is a non-consumable
  // digital feature unlock sold through the normal cart. Apple guideline 3.1.5(a)
  // covers physical goods and real-world services; it does not cover this, so
  // the SKU would be the weakest item in an App Store submission that otherwise
  // charges outside IAP. Decision recorded in
  // docs/superpowers/specs/2026-08-12-apple-pay-ios-design.md.
  //
  // The function, the virtual-singleton guards and the GarageSpot fulfillment
  // path all stay: a spot granted by a premium plan is still a valid concept
  // (GarageSpotSource.premium_membership), and the API tests seed the product
  // themselves to exercise that machinery. Only the sale is retired, and the
  // opt-in exists so that machinery can still be driven locally on purpose.
  if (process.env.SEED_GARAGE_SPOT_PRODUCT === 'true') {
    await seedGarageSpotProduct();
    console.log('Seeded garage spot product (SEED_GARAGE_SPOT_PRODUCT=true).');
  }

  await seedGaragesForExistingUsers();

  await seedBadgeCatalog();

  await seedPremiumCatalog();

  await seedBoxSettings();
};

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
