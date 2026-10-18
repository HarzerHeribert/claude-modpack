import { default as DiscussionsRoute } from '@/app/routes/app/discussions/discussions';
import {
  createDiscussion,
  createUser,
  renderApp,
  screen,
  userEvent,
  waitFor,
} from '@/testing/test-utils';

// Eleven fillers first: page 1 holds Topic 01 … Topic 10, so every title below is on page 2.
const seed = async () => {
  const user = await createUser();
  for (let i = 1; i <= 11; i++) {
    await createDiscussion({ title: `Topic ${String(i).padStart(2, '0')}`, teamId: user.teamId, authorId: user.id });
  }
  for (const title of ['Alpha release plan', 'alphabet soup recipe', 'Beta feedback round']) {
    await createDiscussion({ title, teamId: user.teamId, authorId: user.id });
  }
  return user;
};

test('finds matching titles on every page, ignoring case', { timeout: 20000 }, async () => {
  const user = await seed();
  await renderApp(<DiscussionsRoute />, { user });
  await screen.findByText('Topic 01', {}, { timeout: 5000 });
  await userEvent.type(screen.getByLabelText(/search discussions/i), 'ALPHA');
  expect(await screen.findByText('Alpha release plan', {}, { timeout: 5000 })).toBeInTheDocument();
  expect(await screen.findByText('alphabet soup recipe', {}, { timeout: 5000 })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Topic 01')).not.toBeInTheDocument(), { timeout: 5000 });
  expect(screen.queryByText('Beta feedback round')).not.toBeInTheDocument();
});

test('a search in the URL is applied when the page opens', { timeout: 20000 }, async () => {
  const user = await seed();
  await renderApp(<DiscussionsRoute />, { user, url: '/?search=beta' });
  expect(await screen.findByText('Beta feedback round', {}, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.queryByText('Topic 01')).not.toBeInTheDocument();
  expect((screen.getByLabelText(/search discussions/i) as HTMLInputElement).value).toBe('beta');
});

test('says so when no discussion matches', { timeout: 20000 }, async () => {
  const user = await seed();
  await renderApp(<DiscussionsRoute />, { user });
  await screen.findByText('Topic 01', {}, { timeout: 5000 });
  await userEvent.type(screen.getByLabelText(/search discussions/i), 'zzz');
  expect(await screen.findByText(/no discussions found/i, {}, { timeout: 5000 })).toBeInTheDocument();
});

test('clearing the search shows the first page again', { timeout: 20000 }, async () => {
  const user = await seed();
  await renderApp(<DiscussionsRoute />, { user, url: '/?search=beta' });
  await screen.findByText('Beta feedback round', {}, { timeout: 5000 });
  await userEvent.clear(screen.getByLabelText(/search discussions/i));
  expect(await screen.findByText('Topic 01', {}, { timeout: 5000 })).toBeInTheDocument();
});
