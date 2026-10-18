import { default as DiscussionRoute } from '@/app/routes/app/discussions/discussion';
import { db } from '@/testing/mocks/db';
import {
  createDiscussion,
  createUser,
  renderApp,
  screen,
  within,
} from '@/testing/test-utils';

const renderWithComment = async (viewer: any, author: any) => {
  const discussion = await createDiscussion({ teamId: viewer.teamId, authorId: author.id });
  db.comment.create({ body: 'a comment to delete', authorId: author.id, discussionId: discussion.id });
  await renderApp(<DiscussionRoute />, {
    user: viewer,
    path: '/app/discussions/:discussionId',
    url: `/app/discussions/${discussion.id}`,
  });
  await screen.findByText(discussion.title, {}, { timeout: 5000 });
  const list = await screen.findByRole('list', { name: 'comments' }, { timeout: 5000 });
  await within(list).findByText('a comment to delete', {}, { timeout: 5000 });
  return list;
};

test('a regular user can delete their own comment', { timeout: 15000 }, async () => {
  const user = await createUser({ role: 'USER' });
  const list = await renderWithComment(user, user);
  expect(within(list).getByRole('button', { name: /delete comment/i })).toBeInTheDocument();
});

test("a regular user cannot delete someone else's comment", { timeout: 15000 }, async () => {
  const user = await createUser({ role: 'USER' });
  const other = await createUser({ role: 'USER', teamId: user.teamId });
  const list = await renderWithComment(user, other);
  expect(within(list).queryByRole('button', { name: /delete comment/i })).not.toBeInTheDocument();
});

test('an admin can delete anyone\'s comment', { timeout: 15000 }, async () => {
  const admin = await createUser({ role: 'ADMIN' });
  const other = await createUser({ role: 'USER', teamId: admin.teamId });
  const list = await renderWithComment(admin, other);
  expect(within(list).getByRole('button', { name: /delete comment/i })).toBeInTheDocument();
});
