import type { Category, NewCategory } from '@/db/schema/categories';
import type { CategoryType } from '@/db/constants';

export type { Category };

export type CreateCategoryInput = {
  name: string;
  type: CategoryType;
  icon?: string | null;
};

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

export type CreateCategoryRecord = Pick<
  NewCategory,
  'name' | 'type' | 'icon' | 'systemKey' | 'isDefault' | 'createdAt' | 'updatedAt'
>;

export type UpdateCategoryRecord = Pick<NewCategory, 'updatedAt'> &
  Partial<Pick<NewCategory, 'name' | 'type' | 'icon'>>;
