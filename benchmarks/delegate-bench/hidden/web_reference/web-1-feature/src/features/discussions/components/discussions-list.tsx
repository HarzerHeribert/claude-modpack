import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { Link } from '@/components/ui/link';
import { Spinner } from '@/components/ui/spinner';
import { Table } from '@/components/ui/table';
import { paths } from '@/config/paths';
import { formatDate } from '@/utils/format';

import { getDiscussionQueryOptions } from '../api/get-discussion';
import { useDiscussions } from '../api/get-discussions';

import { DeleteDiscussion } from './delete-discussion';

export type DiscussionsListProps = {
  onDiscussionPrefetch?: (id: string) => void;
};

export const DiscussionsList = ({
  onDiscussionPrefetch,
}: DiscussionsListProps) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';

  const discussionsQuery = useDiscussions({
    page: +(searchParams.get('page') || 1),
    search,
  });
  const queryClient = useQueryClient();

  const onSearch = (value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set('search', value);
      else next.delete('search');
      next.delete('page');
      return next;
    });
  };

  const discussions = discussionsQuery.data?.data;
  const meta = discussionsQuery.data?.meta;

  return (
    <div className="space-y-4">
      <input
        type="search"
        aria-label="Search discussions"
        placeholder="Search discussions"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
      />
      {discussionsQuery.isLoading ? (
        <div className="flex h-48 w-full items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : !discussions ? null : search && discussions.length === 0 ? (
        <p className="text-gray-500">No discussions found</p>
      ) : (
    <Table
      data={discussions}
      columns={[
        {
          title: 'Title',
          field: 'title',
        },
        {
          title: 'Created At',
          field: 'createdAt',
          Cell({ entry: { createdAt } }) {
            return <span>{formatDate(createdAt)}</span>;
          },
        },
        {
          title: '',
          field: 'id',
          Cell({ entry: { id } }) {
            return (
              <Link
                onMouseEnter={() => {
                  // Prefetch the discussion data when the user hovers over the link
                  queryClient.prefetchQuery(getDiscussionQueryOptions(id));
                  onDiscussionPrefetch?.(id);
                }}
                to={paths.app.discussion.getHref(id)}
              >
                View
              </Link>
            );
          },
        },
        {
          title: '',
          field: 'id',
          Cell({ entry: { id } }) {
            return <DeleteDiscussion id={id} />;
          },
        },
      ]}
      pagination={
        meta && {
          totalPages: meta.totalPages,
          currentPage: meta.page,
          rootUrl: '',
        }
      }
    />
      )}
    </div>
  );
};
