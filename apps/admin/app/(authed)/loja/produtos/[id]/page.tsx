import { notFound } from 'next/navigation';

import { ProductStatusBadge } from '../product-status-badge';

import { PhotoGallery } from './photo-gallery';
import { ProductForm } from './product-form';
import { VariantList } from './variant-list';
import { VirtualProductBanner } from './virtual-product-banner';

import { getAdminStoreProduct, listAdminProductTypes } from '~/lib/admin-api';
import { ApiError } from '~/lib/api';

export const dynamic = 'force-dynamic';

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let product;
  try {
    product = await getAdminStoreProduct(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const { items: productTypes } = await listAdminProductTypes();
  const isVirtual = product.virtual === true;

  return (
    <section className="flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{product.title}</h1>
          <p className="text-sm text-[color:var(--color-muted)]">{product.slug}</p>
        </div>
        <ProductStatusBadge status={product.status} />
      </header>
      {isVirtual ? <VirtualProductBanner productTypeName={product.productTypeName} /> : null}
      <ProductForm product={product} productTypes={productTypes} />
      <VariantList
        productId={product.id}
        productPriceCents={product.basePriceCents}
        variants={product.variants}
      />
      {isVirtual ? null : <PhotoGallery productId={product.id} photos={product.photos} />}
    </section>
  );
}
