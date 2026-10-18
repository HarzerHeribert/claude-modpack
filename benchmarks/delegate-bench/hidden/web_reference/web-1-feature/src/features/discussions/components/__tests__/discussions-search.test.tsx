import { default as DiscussionsRoute } from '@/app/routes/app/discussions/discussions';
import { createDiscussion, createUser, renderApp, screen, userEvent } from '@/testing/test-utils';

test('the search finds a discussion on a later page', { timeout: 15000 }, async () => {
  const user = await createUser();
  for (let i = 1; i <= 10; i++) await createDiscussion({ title: `Filler ${i}`, teamId: user.teamId, authorId: user.id });
  await createDiscussion({ title: 'The needle', teamId: user.teamId, authorId: user.id });
  await renderApp(<DiscussionsRoute />, { user });
  await screen.findByText('Filler 1', {}, { timeout: 5000 });
  await userEvent.type(screen.getByLabelText(/search discussions/i), 'needle');
  expect(await screen.findByText('The needle', {}, { timeout: 4000 })).toBeInTheDocument();
});
