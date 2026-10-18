import { queryOptions, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { QueryConfig } from '@/lib/react-query';
import { Discussion, Meta } from '@/types/api';

export const getDiscussions = (
  page = 1,
  search = '',
): Promise<{
  data: Discussion[];
  meta: Meta;
}> => {
  return api.get(`/discussions`, {
    params: {
      page,
      ...(search ? { search } : {}),
    },
  });
};

export const getDiscussionsQueryOptions = ({
  page,
  search = '',
}: { page?: number; search?: string } = {}) => {
  return queryOptions({
    queryKey: page || search ? ['discussions', { page, search }] : ['discussions'],
    queryFn: () => getDiscussions(page, search),
  });
};

type UseDiscussionsOptions = {
  page?: number;
  search?: string;
  queryConfig?: QueryConfig<typeof getDiscussionsQueryOptions>;
};

export const useDiscussions = ({
  queryConfig,
  page,
  search,
}: UseDiscussionsOptions) => {
  return useQuery({
    ...getDiscussionsQueryOptions({ page, search }),
    ...queryConfig,
  });
};
