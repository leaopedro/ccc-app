import { brand } from '@ccc/design';

export const PUBLIC_PROFILE_BASE_URL = brand.urls.publicProfileBase;

export const publicGarageUrl = (slug: string): string => `${PUBLIC_PROFILE_BASE_URL}/${slug}`;
