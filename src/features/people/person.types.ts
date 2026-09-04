import type { Person, NewPerson } from '@/db/schema/people';

export type { Person };

export type CreatePersonInput = {
  name: string;
  note?: string | null;
};

export type UpdatePersonInput = Partial<CreatePersonInput>;

export type CreatePersonRecord = Pick<NewPerson, 'name' | 'note' | 'createdAt' | 'updatedAt'>;

export type UpdatePersonRecord = Pick<NewPerson, 'updatedAt'> &
  Partial<Pick<NewPerson, 'name' | 'note'>>;
